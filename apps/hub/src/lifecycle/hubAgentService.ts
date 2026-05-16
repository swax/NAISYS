import {
  isAudioFilename,
  isImageFilename,
  parseContinuityFromConfigJson,
} from "@naisys/common";
import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  AgentPeekRequestSchema,
  AgentRunCommandRequestSchema,
  AgentRunPauseRequestSchema,
  type AgentStartDispatch,
  AgentStartInboundSchema,
  type AgentStartResponse,
  AgentStopRequestSchema,
  HubEvents,
  type RestoreData,
  type ResumeEntry,
} from "@naisys/hub-protocol";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import type { HubConfigService } from "../config/hubConfigService.js";
import type { HubSendMailService } from "../mail/hubSendMailService.js";
import type { NaisysServer } from "../server/naisysServer.js";
import type { HostRegistrar } from "./hostRegistrar.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

type StartDecision =
  | { kind: "fail"; error: string }
  | { kind: "go"; bestHostId: number };

/** Handles agent_start requests by routing them to the least-loaded eligible host */
export function createHubAgentService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  heartbeatService: HubHeartbeatService,
  sendMailService: HubSendMailService,
  hostRegistrar: HostRegistrar,
  runtimeKeyService: HubRuntimeKeyService,
  configService: HubConfigService,
) {
  const { issueRuntimeApiKey, revokeRuntimeApiKey } = runtimeKeyService;
  /** Find the least-loaded eligible host for a given user */
  async function findBestHost(startUserId: number): Promise<number | null> {
    // Look up which hosts this user is assigned to
    const userHosts = await hubDb.user_hosts.findMany({
      where: { user_id: startUserId },
      select: { host_id: true },
    });
    const assignedHostIds = userHosts.map((uh) => uh.host_id);

    // Determine eligible hosts: assigned hosts, or all connected (non-restricted) if unassigned
    let eligibleHostIds: number[];
    if (assignedHostIds.length > 0) {
      eligibleHostIds = assignedHostIds;
    } else {
      const restrictedHostIds = new Set(
        hostRegistrar
          .getAllHosts()
          .filter((h) => h.restricted)
          .map((h) => h.hostId),
      );
      eligibleHostIds = naisysServer
        .getConnectedClients()
        .map((c) => c.getHostId())
        .filter((hid) => !restrictedHostIds.has(hid));
    }

    // Filter to connected hosts that can run agents
    const connectedEligible = eligibleHostIds.filter((hid) => {
      const conn = naisysServer.getConnectionByHostId(hid);
      return conn && conn.getHostType() === "naisys";
    });

    if (connectedEligible.length === 0) {
      return null;
    }

    // Pick the host with the fewest active agents
    let bestHostId = connectedEligible[0];
    let bestCount = heartbeatService.getHostActiveAgentCount(bestHostId);

    for (const hid of connectedEligible.slice(1)) {
      const count = heartbeatService.getHostActiveAgentCount(hid);
      if (count < bestCount) {
        bestHostId = hid;
        bestCount = count;
      }
    }

    return bestHostId;
  }

  /** Check if a user is enabled (not disabled or archived) */
  async function isAgentEnabled(userId: number): Promise<boolean> {
    const user = await hubDb.users.findUnique({
      where: { id: userId },
      select: { enabled: true, archived: true },
    });
    return !!user?.enabled && !user?.archived;
  }

  /** Run the start preconditions and pick a host. */
  async function decideStartAgent(userId: number): Promise<StartDecision> {
    if (!(await isAgentEnabled(userId))) {
      return { kind: "fail", error: `Agent ${userId} is disabled` };
    }
    if (heartbeatService.findHostsForAgent(userId).length > 0) {
      return { kind: "fail", error: `Agent ${userId} is already running` };
    }
    const bestHostId = await findBestHost(userId);
    if (bestHostId === null) {
      return {
        kind: "fail",
        error: `No eligible hosts are online for user ${userId}`,
      };
    }
    return { kind: "go", bestHostId };
  }

  /**
   * Mint and ship a key with AGENT_START so the agent's authenticated from
   * spawn time, avoiding the one-RTT window heartbeat-only would create.
   * Heartbeat-driven reissue covers later hash mismatches.
   *
   * The run_session row is written up front with model_name="" so the
   * agent's command loop (which starts before the host acks) can FK-safely
   * write logs/costs. model_name is patched in from the ack; the session
   * is pushed to supervisors and runId/sessionId returned to the caller
   * only on success. Any failure rolls back the placeholder.
   */

  type CompactCursor = {
    logId: number;
    runId: number;
    sessionId: number;
    summary: string;
  };

  /** The user's latest compact, fetched via the cached pointer on
   *  `users.compact_log_id`. Acts as both summary source and tail cursor. */
  async function loadCompactCursor(
    userId: number,
  ): Promise<CompactCursor | null> {
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

  /** Parent-agent entries logged after the compact cursor. `sinceLogId=null`
   *  means "no compact ever" → return everything (continuity=full fallback
   *  for brand-new agents). Replay re-injects without re-logging, so
   *  context_log stays a single chronological record across runs. */
  async function loadEntriesSinceCompact(
    userId: number,
    sinceLogId: number | null,
  ): Promise<ResumeEntry[]> {
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
      // Only console-source media is wired into contextManager (appendImage/
      // appendAudio stamp console messages); everything else replays text-only.
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

  async function dispatchAgentStart(args: {
    bestHostId: number;
    payload: Omit<AgentStartDispatch, "runtimeApiKey" | "runId" | "sessionId">;
    onResponse: (response: AgentStartResponse) => void;
  }): Promise<{ sent: boolean }> {
    const { bestHostId, payload, onResponse } = args;
    const startUserId = payload.startUserId;
    const runtimeApiKey = await issueRuntimeApiKey(startUserId);

    // Fetch before run_session.create — a query failure here would otherwise
    // leak the placeholder. Hashes ship so the host can skip already-on-disk files.
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
      // Tail ships unfiltered — the post-compact restore echo lives in it
      // naturally; host scans for it on replay and falls back to prepending
      // `summary` only if missing.
      const tail = await loadEntriesSinceCompact(
        startUserId,
        compact?.logId ?? null,
      );
      const cursor = compact
        ? { runId: compact.runId, sessionId: compact.sessionId }
        : undefined;

      if (continuity === "full") {
        if (compact) {
          // Always ship summary + cursor; entries if any past the cursor.
          // Covers both the normal post-compact case and the rare gap where
          // the post-restart restore echo never logged before the process died.
          restoreData = {
            summary: compact.summary,
            ...(tail.length > 0 ? { entries: tail } : {}),
            cursor,
          };
        } else if (tail.length > 0) {
          // No compact ever — replay whole history (brand-new agents).
          restoreData = { entries: tail };
        }
      } else {
        // continuity === "summary"
        // - compact + no tail past → snapshot is current
        // - compact + tail         → stale, retro-compact after replay
        // - no compact + tail      → seed first summary via retro-compact
        if (compact && tail.length === 0) {
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
    }

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
      },
    });

    async function rollbackPlaceholder(reason: string) {
      try {
        await hubDb.run_session.deleteMany({ where: rowWhere });
      } catch (err) {
        logService.error(
          `[Hub:Agents] Failed to roll back run_session row for run ${runId} (${reason}): ${err}`,
        );
      }
    }

    const sent = naisysServer.sendMessage(
      bestHostId,
      HubEvents.AGENT_START,
      {
        ...payload,
        runtimeApiKey,
        runId,
        sessionId,
        ...(startupAttachments.length > 0 ? { startupAttachments } : {}),
        ...(restoreData ? { restoreData } : {}),
      },
      async (response: AgentStartResponse) => {
        if (response.success && response.modelName) {
          const modelName = response.modelName;
          try {
            await hubDb.run_session.updateMany({
              where: rowWhere,
              data: { model_name: modelName },
            });
            heartbeatService.addStartedAgent(bestHostId, startUserId);
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
                totalCost: 0,
              },
            });
            onResponse({ ...response, runId, sessionId });
          } catch (err) {
            logService.error(
              `[Hub:Agents] Failed to finalize run_session row for run ${runId}: ${err}`,
            );
            await rollbackPlaceholder("update failed");
            onResponse({
              success: false,
              error: `Failed to finalize run_session row: ${err}`,
              hostname: response.hostname,
            });
          }
        } else {
          if (response.success && !response.modelName) {
            logService.error(
              `[Hub:Agents] Host ${bestHostId} acked agent_start without modelName for user ${startUserId}; treating as failure`,
            );
          }
          await rollbackPlaceholder(
            response.success ? "missing modelName" : "host failure",
          );
          onResponse(
            response.success
              ? {
                  success: false,
                  error: "Host did not return modelName",
                  hostname: response.hostname,
                }
              : response,
          );
        }
      },
    );

    if (!sent) {
      await rollbackPlaceholder("send failed");
    }

    return { sent };
  }

  /** Try to start an agent on the best available host (fire-and-forget) */
  async function tryStartAgent(startUserId: number): Promise<boolean> {
    try {
      const decision = await decideStartAgent(startUserId);
      if (decision.kind === "fail") {
        logService.log(`[Hub:Agents] Auto-start: ${decision.error}`);
        return false;
      }

      const { sent } = await dispatchAgentStart({
        bestHostId: decision.bestHostId,
        payload: { startUserId },
        onResponse: (response) => {
          if (!response.success) {
            logService.error(
              `[Hub:Agents] Auto-start failed for user ${startUserId}: ${response.error}`,
            );
          }
        },
      });

      if (sent) {
        logService.log(
          `[Hub:Agents] Auto-start: sent start for user ${startUserId} to host ${decision.bestHostId}`,
        );
      }
      return sent;
    } catch (error) {
      logService.error(`[Hub:Agents] Auto-start error: ${error}`);
      return false;
    }
  }

  naisysServer.registerEvent(
    HubEvents.AGENT_START,
    async (hostId, data, ack) => {
      try {
        const parsed = AgentStartInboundSchema.parse(data);

        const decision = await decideStartAgent(parsed.startUserId);
        if (decision.kind === "fail") {
          ack({ success: false, error: decision.error });
          return;
        }

        const { sent } = await dispatchAgentStart({
          bestHostId: decision.bestHostId,
          payload: {
            startUserId: parsed.startUserId,
            taskDescription: parsed.taskDescription,
            sourceHostId: hostId,
          },
          onResponse: (response) => {
            // Reverse-ack with the response from the host (including success status and any error message) back to the original requester
            ack(response);
            // Send task description mail after successful start to avoid
            // orphaned mails from failed start attempts
            if (response.success && parsed.taskDescription) {
              void sendTaskMail(
                parsed.startUserId,
                parsed.requesterUserId,
                parsed.taskDescription,
              );
            }
          },
        });

        if (!sent) {
          ack({
            success: false,
            error: `Failed to send to host ${decision.bestHostId}`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] agent_start error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  async function sendTaskMail(
    startUserId: number,
    requesterUserId: number,
    taskDescription: string,
  ) {
    try {
      const mailEnabled =
        !!configService.getConfig().config?.mailServiceEnabled;
      await sendMailService.sendMail({
        fromUserId: requesterUserId,
        recipientUserIds: [startUserId],
        // Agent will send a 'Session Completed' message when session is completed
        subject: mailEnabled ? "Agent Start" : "",
        body: mailEnabled ? taskDescription : `Agent Start: ${taskDescription}`,
        kind: mailEnabled ? "mail" : "chat",
      });
    } catch (err) {
      logService.error(`[Hub:Agents] Failed to send task mail: ${err}`);
    }
  }

  naisysServer.registerEvent(HubEvents.AGENT_STOP, (hostId, data, ack) => {
    try {
      const parsed = AgentStopRequestSchema.parse(data);

      // Find which hosts the agent is currently running on
      const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

      if (targetHostIds.length === 0) {
        ack({
          success: false,
          error: `Agent ${parsed.userId} is not running on any known host`,
        });
        return;
      }

      // Forward the stop request to all hosts running this agent
      let acked = false;
      let sendFailures = 0;

      for (const targetHostId of targetHostIds) {
        const sent = naisysServer.sendMessage(
          targetHostId,
          HubEvents.AGENT_STOP,
          {
            userId: parsed.userId,
            reason: parsed.reason,
            sourceHostId: hostId,
          },
          (response) => {
            if (response.success) {
              heartbeatService.removeStoppedAgent(targetHostId, parsed.userId);
              revokeRuntimeApiKey(parsed.userId).catch((err) => {
                logService.error(
                  `[Hub:Agents] Failed to revoke runtime key for user ${parsed.userId} on stop: ${err}`,
                );
              });
            }
            // Ack with the first response
            if (!acked) {
              acked = true;
              ack(response);
            }
          },
        );

        if (!sent) {
          sendFailures++;
        }
      }

      if (sendFailures === targetHostIds.length && !acked) {
        ack({
          success: false,
          error: `No target hosts are connected`,
        });
      }
    } catch (error) {
      logService.error(
        `[Hub:Agents] agent_stop error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  function registerRunPauseHandler(
    event: typeof HubEvents.AGENT_RUN_PAUSE | typeof HubEvents.AGENT_RUN_RESUME,
  ) {
    naisysServer.registerEvent(event, (hostId, data, ack) => {
      try {
        const parsed = AgentRunPauseRequestSchema.parse(data);

        const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

        if (targetHostIds.length === 0) {
          ack({
            success: false,
            error: `Agent ${parsed.userId} is not running on any known host`,
          });
          return;
        }

        let acked = false;
        let sendFailures = 0;

        for (const targetHostId of targetHostIds) {
          const sent = naisysServer.sendMessage(
            targetHostId,
            event,
            {
              userId: parsed.userId,
              runId: parsed.runId,
              subagentId: parsed.subagentId,
              sessionId: parsed.sessionId,
              sourceHostId: hostId,
            },
            (response) => {
              if (!acked) {
                acked = true;
                ack(response);
              }
            },
          );

          if (!sent) {
            sendFailures++;
          }
        }

        if (sendFailures === targetHostIds.length && !acked) {
          ack({
            success: false,
            error: `No target hosts are connected`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] ${event} error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    });
  }

  registerRunPauseHandler(HubEvents.AGENT_RUN_PAUSE);
  registerRunPauseHandler(HubEvents.AGENT_RUN_RESUME);

  naisysServer.registerEvent(
    HubEvents.AGENT_RUN_COMMAND,
    (hostId, data, ack) => {
      try {
        const parsed = AgentRunCommandRequestSchema.parse(data);

        const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

        if (targetHostIds.length === 0) {
          ack({
            success: false,
            error: `Agent ${parsed.userId} is not running on any known host`,
          });
          return;
        }

        let acked = false;
        let sendFailures = 0;

        for (const targetHostId of targetHostIds) {
          const sent = naisysServer.sendMessage(
            targetHostId,
            HubEvents.AGENT_RUN_COMMAND,
            {
              userId: parsed.userId,
              runId: parsed.runId,
              subagentId: parsed.subagentId,
              sessionId: parsed.sessionId,
              command: parsed.command,
              sourceHostId: hostId,
            },
            (response) => {
              if (!acked) {
                acked = true;
                ack(response);
              }
            },
          );

          if (!sent) {
            sendFailures++;
          }
        }

        if (sendFailures === targetHostIds.length && !acked) {
          ack({
            success: false,
            error: `No target hosts are connected`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] ${HubEvents.AGENT_RUN_COMMAND} error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  naisysServer.registerEvent(HubEvents.AGENT_PEEK, (hostId, data, ack) => {
    try {
      const parsed = AgentPeekRequestSchema.parse(data);

      // Find which host the agent is running on
      const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

      if (targetHostIds.length === 0) {
        ack({
          success: false,
          error: `Agent ${parsed.userId} is not running on any known host`,
        });
        return;
      }

      // Forward peek request to the first host (only need one response)
      const targetHostId = targetHostIds[0];
      const sent = naisysServer.sendMessage(
        targetHostId,
        HubEvents.AGENT_PEEK,
        {
          userId: parsed.userId,
          skip: parsed.skip,
          take: parsed.take,
          sourceHostId: hostId,
        },
        (response) => {
          ack(response);
        },
      );

      if (!sent) {
        ack({
          success: false,
          error: `Failed to send to host ${targetHostId}`,
        });
      }
    } catch (error) {
      logService.error(
        `[Hub:Agents] agent_peek error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  return { tryStartAgent };
}

export type HubAgentService = ReturnType<typeof createHubAgentService>;
