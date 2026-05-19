import {
  isAudioFilename,
  isImageFilename,
  parseContinuityFromConfigJson,
} from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  type AgentStartDispatch,
  type AgentStartResponse,
  HubEvents,
  type RestoreData,
  type ResumeEntry,
} from "@naisys/hub-protocol";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import type { NaisysServer } from "../server/naisysServer.js";
import type { HubOwnershipService } from "./hubOwnershipService.js";

type CompactCursor = {
  logId: number;
  runId: number;
  sessionId: number;
  summary: string;
};

type StartTransportResult =
  | { kind: "ack"; response: AgentStartResponse }
  | { kind: "send-failed" }
  | { kind: "disconnected" }
  | { kind: "timeout" };

type StartPlaceholder = {
  runId: number;
  sessionId: number;
  now: string;
  rowWhere: {
    user_id: number;
    run_id: number;
    subagent_id: number;
    session_id: number;
  };
  rollbackPlaceholder: (reason: string) => Promise<void>;
};

type HubDbContext = Pick<HubDatabaseService, "hubDb">;

/** Owns start preparation, placeholder lifecycle, host dispatch, and ack finalization. */
export function createHubAgentStartService(
  naisysServer: NaisysServer,
  { hubDb }: HubDbContext,
  logService: DualLogger,
  ownershipService: HubOwnershipService,
  runtimeKeyService: HubRuntimeKeyService,
) {
  const { issueRuntimeApiKey } = runtimeKeyService;

  // ownershipService only reflects "running" after the host ack lands, so
  // concurrent callers could all pass decideStartAgent and dispatch duplicate
  // starts in that gap.
  const startingUsers = new Set<number>();

  // If the hub crashed between placeholder create and ack-finalize, the row
  // is stranded with model_name="" — the ack resolver lived in-process. Sweep
  // any such row older than the ack backstop with no logged activity. A live
  // start that's still in flight would be younger than the cutoff; one that
  // actually started would have latest_log_id > 0.
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - 10 * 60_000);
      const { count } = await hubDb.run_session.deleteMany({
        where: {
          model_name: "",
          latest_log_id: 0,
          created_at: { lt: cutoff },
        },
      });
      if (count > 0) {
        logService.log(
          `[Hub:Agents] Swept ${count} stranded placeholder run_session row(s)`,
        );
      }
    } catch (err) {
      logService.error(
        `[Hub:Agents] Stranded-placeholder sweep failed: ${err}`,
      );
    }
  })();

  function acquireStartLock(userId: number): boolean {
    if (startingUsers.has(userId)) return false;
    startingUsers.add(userId);
    return true;
  }

  function releaseStartLock(userId: number) {
    startingUsers.delete(userId);
  }

  /** Own the start attempt lock from setup through ack handling. */
  async function dispatchAgentStart(args: {
    bestHostId: number;
    payload: Omit<AgentStartDispatch, "runtimeApiKey" | "runId" | "sessionId">;
    triggeredBy?: string;
  }): Promise<AgentStartResponse> {
    const { bestHostId, payload, triggeredBy } = args;
    const startUserId = payload.startUserId;

    if (!acquireStartLock(startUserId)) {
      return {
        success: false,
        error: `Agent ${startUserId} start is already in flight`,
      };
    }

    try {
      return await dispatchAgentStartLocked(
        bestHostId,
        payload,
        triggeredBy,
        startUserId,
      );
    } finally {
      releaseStartLock(startUserId);
    }
  }

  async function dispatchAgentStartLocked(
    bestHostId: number,
    payload: Omit<AgentStartDispatch, "runtimeApiKey" | "runId" | "sessionId">,
    triggeredBy: string | undefined,
    startUserId: number,
  ): Promise<AgentStartResponse> {
    const prepared = await prepareStartPayload(startUserId);
    const placeholder = await createStartPlaceholder(
      startUserId,
      bestHostId,
      triggeredBy,
    );
    const { runId, sessionId, rowWhere, now, rollbackPlaceholder } =
      placeholder;

    const transport = await waitForStartAck(bestHostId, {
      ...payload,
      runtimeApiKey: prepared.runtimeApiKey,
      runId,
      sessionId,
      ...(prepared.startupAttachments.length > 0
        ? { startupAttachments: prepared.startupAttachments }
        : {}),
      ...(prepared.restoreData ? { restoreData: prepared.restoreData } : {}),
    });

    if (transport.kind === "send-failed") {
      await rollbackPlaceholder("send failed");
      return {
        success: false,
        error: `Failed to send to host ${bestHostId}`,
      };
    }

    // The message was sent, so the host may still start the agent even if the
    // ack is lost. Preserve the placeholder and let reconnect/heartbeat settle.
    if (transport.kind === "disconnected") {
      return {
        success: false,
        error: `Host ${bestHostId} disconnected before acknowledging start; start state unknown`,
      };
    }
    if (transport.kind === "timeout") {
      return {
        success: false,
        error: "Start acknowledgement timed out; start state unknown",
      };
    }

    const response = transport.response;
    if (!response.success) {
      await rollbackPlaceholder("host failure");
      return response;
    }
    if (!response.modelName) {
      logService.error(
        `[Hub:Agents] Host ${bestHostId} acked agent_start without modelName for user ${startUserId}; treating as failure`,
      );
      await rollbackPlaceholder("missing modelName");
      return {
        success: false,
        error: "Host did not return modelName",
        hostname: response.hostname,
      };
    }

    const modelName = response.modelName;
    try {
      await hubDb.run_session.updateMany({
        where: rowWhere,
        data: { model_name: modelName },
      });
    } catch (err) {
      logService.error(
        `[Hub:Agents] Failed to finalize run_session row for run ${runId}: ${err}`,
      );
      // Roll back the placeholder so we don't leave a row with model_name="".
      await rollbackPlaceholder("update failed");
      return {
        success: false,
        error: `Failed to finalize run_session row: ${err}`,
        hostname: response.hostname,
      };
    }

    if (naisysServer.getConnectionByHostId(bestHostId)) {
      ownershipService.addStartedAgent(bestHostId, startUserId);
      naisysServer.broadcastToSupervisors(HubEvents.SESSION_PUSH, {
        session: {
          userId: startUserId,
          runId,
          sessionId,
          modelName,
          createdAt: now,
          lastActive: now,
          latestLogId: 0,
          totalLines: 0,
          totalTokens: 0,
          totalCost: 0,
        },
      });
    } else {
      logService.log(
        `[Hub:Agents] Host ${bestHostId} disconnected after successful ack for run ${runId}; row kept, awaiting reconnect heartbeat`,
      );
    }

    return { ...response, runId, sessionId };
  }

  /** Phase 1: gather runtime key, startup attachments, and restore data. */
  async function prepareStartPayload(startUserId: number): Promise<{
    runtimeApiKey: string;
    startupAttachments: Array<{
      publicId: string;
      filename: string;
      fileSize: number;
      fileHash: string;
      path: string;
    }>;
    restoreData: RestoreData | undefined;
  }> {
    const runtimeApiKey = await issueRuntimeApiKey(startUserId);
    const startupAttachmentRows = await hubDb.user_startup_attachments.findMany(
      {
        where: { user_id: startUserId },
        orderBy: { path: "asc" },
        include: {
          attachment: {
            select: {
              public_id: true,
              filename: true,
              file_size: true,
              file_hash: true,
            },
          },
        },
      },
    );
    const startupAttachments = startupAttachmentRows.map((r) => ({
      publicId: r.attachment.public_id,
      filename: r.attachment.filename,
      fileSize: r.attachment.file_size,
      fileHash: r.attachment.file_hash,
      path: r.path,
    }));

    const userRow = await hubDb.users.findUnique({
      where: { id: startUserId },
      select: { config: true },
    });
    const continuity = parseContinuityFromConfigJson(userRow?.config);

    let restoreData: RestoreData | undefined;
    if (continuity === "summary" || continuity === "full") {
      const compact = await loadCompactCursor(startUserId);
      const tail = await loadEntriesSinceCompact(
        startUserId,
        compact?.logId ?? null,
      );
      const cursor = compact
        ? { runId: compact.runId, sessionId: compact.sessionId }
        : undefined;

      if (continuity === "full") {
        if (compact) {
          restoreData = {
            summary: compact.summary,
            ...(tail.length > 0 ? { entries: tail } : {}),
            cursor,
          };
        } else if (tail.length > 0) {
          restoreData = { entries: tail };
        }
      } else if (compact && tail.length === 0) {
        restoreData = { summary: compact.summary, cursor };
      } else if (tail.length > 0) {
        restoreData = {
          ...(compact ? { summary: compact.summary } : {}),
          entries: tail,
          stale: true,
          ...(cursor ? { cursor } : {}),
        };
      }
    }

    return { runtimeApiKey, startupAttachments, restoreData };
  }

  async function loadCompactCursor(
    userId: number,
  ): Promise<CompactCursor | null> {
    // The cached pointer on users.compact_log_id is both summary source and
    // tail cursor for continuity replay.
    const user = await hubDb.users.findUnique({
      where: { id: userId },
      select: { compact_log_id: true },
    });
    if (!user?.compact_log_id) return null;

    const row = await hubDb.context_log.findUnique({
      where: { id: user.compact_log_id },
      select: { id: true, run_id: true, session_id: true, message: true },
    });
    if (!row) return null;

    return {
      logId: row.id,
      runId: row.run_id,
      sessionId: row.session_id,
      summary: row.message,
    };
  }

  async function loadEntriesSinceCompact(
    userId: number,
    sinceLogId: number | null,
  ): Promise<ResumeEntry[]> {
    // sinceLogId=null means no compact exists yet, so full continuity falls
    // back to replaying the whole parent-agent history.
    const rows = await hubDb.context_log.findMany({
      where: {
        user_id: userId,
        subagent_id: 0,
        source: { not: null },
        ...(sinceLogId !== null ? { id: { gt: sinceLogId } } : {}),
      },
      orderBy: { id: "asc" },
      select: {
        source: true,
        message: true,
        attachment: { select: { public_id: true, filename: true } },
      },
    });

    const entries: ResumeEntry[] = [];
    for (const r of rows) {
      if (!r.source) continue;

      const entry: ResumeEntry = { source: r.source, message: r.message };
      // Only console-source media is wired into contextManager; other sources
      // replay text-only.
      if (
        r.attachment &&
        r.source === "console" &&
        (isImageFilename(r.attachment.filename) ||
          isAudioFilename(r.attachment.filename))
      ) {
        entry.attachment = {
          publicId: r.attachment.public_id,
          filename: r.attachment.filename,
        };
      }
      entries.push(entry);
    }
    return entries;
  }

  /** Phase 2: allocate run/session IDs and write the placeholder row. */
  async function createStartPlaceholder(
    startUserId: number,
    bestHostId: number,
    triggeredBy: string | undefined,
  ): Promise<StartPlaceholder> {
    const lastRun = await hubDb.run_session.findFirst({
      select: { run_id: true },
      orderBy: { run_id: "desc" },
    });
    const runId = lastRun ? lastRun.run_id + 1 : 1;
    const sessionId = 1;
    const subagentId = 0;
    const now = new Date().toISOString();
    const rowWhere = {
      user_id: startUserId,
      run_id: runId,
      subagent_id: subagentId,
      session_id: sessionId,
    };

    await hubDb.run_session.create({
      data: {
        ...rowWhere,
        host_id: bestHostId,
        model_name: "",
        created_at: now,
        last_active: now,
        triggered_by: triggeredBy,
      },
    });

    return {
      runId,
      sessionId,
      now,
      rowWhere,
      async rollbackPlaceholder(reason: string) {
        try {
          await hubDb.run_session.deleteMany({ where: rowWhere });
        } catch (err) {
          logService.error(
            `[Hub:Agents] Failed to roll back run_session row for run ${runId} (${reason}): ${err}`,
          );
        }
      },
    };
  }

  /** Transport layer for AGENT_START: send and wait for ack, disconnect, or timeout. */
  function waitForStartAck(
    bestHostId: number,
    payload: AgentStartDispatch,
  ): Promise<StartTransportResult> {
    return new Promise<StartTransportResult>((resolve) => {
      let settled = false;
      const claim = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(backstop);
        naisysServer.unregisterEvent(
          HubEvents.CLIENT_DISCONNECTED,
          onDisconnect,
        );
        return true;
      };

      const onDisconnect = (disconnectedHostId: number) => {
        if (disconnectedHostId !== bestHostId) return;
        if (claim()) resolve({ kind: "disconnected" });
      };
      naisysServer.registerEvent(HubEvents.CLIENT_DISCONNECTED, onDisconnect);

      // Backstop for a dropped ack where the host neither responds nor disconnects.
      const backstop = setTimeout(() => {
        if (claim()) resolve({ kind: "timeout" });
      }, 10 * 60_000);

      let sent = false;
      try {
        sent = naisysServer.sendMessage(
          bestHostId,
          HubEvents.AGENT_START,
          payload,
          (response: AgentStartResponse) => {
            if (claim()) resolve({ kind: "ack", response });
          },
        );
      } catch (err) {
        logService.error(
          `[Hub:Agents] Failed to send agent_start to host ${bestHostId}: ${err}`,
        );
      }

      if (!sent && claim()) resolve({ kind: "send-failed" });
    });
  }

  return { dispatchAgentStart };
}

export type HubAgentStartService = ReturnType<
  typeof createHubAgentStartService
>;
