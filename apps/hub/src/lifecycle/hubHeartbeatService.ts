import { keyBy, unique } from "@naisys/common";
import { type DualLogger, hashToken } from "@naisys/common-node";
import { type HubDatabaseService } from "@naisys/hub-database";
import type {
  CommandLoopState,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";
import {
  HeartbeatSchema,
  HUB_HEARTBEAT_INTERVAL_MS,
  HubEvents,
} from "@naisys/hub-protocol";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import type { HubRedactionService } from "../observability/hubRedactionService.js";
import type { NaisysServer } from "../server/naisysServer.js";
import type { HubOwnershipService } from "./hubOwnershipService.js";

/** Per-session identity (parent or subagent). */
export interface HubActiveSession {
  userId: number;
  runId: number;
  subagentId: number | null;
  sessionId: number;
}

/**
 * Verifies runtime-key claims (adding verified ones to the ACL in
 * hubOwnershipService), filters session state by ACL membership, persists
 * session liveness, and broadcasts SESSION_HEARTBEAT.
 */
export function createHubHeartbeatService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  redactionService: HubRedactionService,
  runtimeKeyService: HubRuntimeKeyService,
  ownershipService: HubOwnershipService,
) {
  const { adminUserId } = ownershipService;

  // Keyed by `${userId}:${subagentId ?? 0}` so a parent and its subagents are
  // tracked independently.
  interface ActiveSessionInfo {
    userId: number;
    subagentId: number | null;
    runId: number;
    sessionId: number;
    lastActive: string;
    paused?: boolean;
    state?: CommandLoopState;
    tokenCount?: number;
  }
  const hostActiveSessions = new Map<number, Map<string, ActiveSessionInfo>>();
  const sessionKey = (userId: number, subagentId: number | null | undefined) =>
    `${userId}:${subagentId ?? 0}`;

  // Full-identity key for an active session — used to detect when a host's
  // session set changes (a run started, ended, or compacted).
  const sessionRunKey = (s: {
    userId: number;
    runId: number;
    subagentId: number | null;
    sessionId: number;
  }) => `${s.userId}-${s.runId}-${s.subagentId ?? 0}-${s.sessionId}`;

  naisysServer.registerEvent(HubEvents.HEARTBEAT, async (hostId, data) => {
    const parsed = HeartbeatSchema.parse(data);
    const now = new Date().toISOString();

    try {
      // Authorize each runtime-key claim: (a) host already in the ACL, or
      // (b) the key matches the DB hash (hub minted it earlier — the
      // restart-recovery path). Unauthorized claims are dropped *before* the
      // redactor sees the plaintext so a hostile host can't poison redaction.
      if (parsed.runtimeApiKeys?.length) {
        const userIds = parsed.runtimeApiKeys.map((k) => k.userId);
        const users = await hubDb.users.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            api_key_hash: true,
            enabled: true,
            archived: true,
          },
        });
        const userMap = keyBy(users, (u) => u.id);

        for (const claim of parsed.runtimeApiKeys) {
          if (claim.userId === adminUserId) continue;

          const user = userMap.get(claim.userId);
          if (!user || !user.enabled || user.archived) continue;

          const alreadyOwned = ownershipService.hostOwnsUser(
            hostId,
            claim.userId,
          );
          const keyMatches = !!(
            claim.runtimeApiKey &&
            user.api_key_hash &&
            hashToken(claim.runtimeApiKey) === user.api_key_hash
          );

          if (!alreadyOwned && !keyMatches) {
            logService.log(
              `[Hub:Heartbeat] Rejected runtime key claim from host ${hostId} for user ${claim.userId}: host is not the authorized owner`,
            );
            continue;
          }

          if (claim.runtimeApiKey) {
            redactionService.registerRuntimeApiKey(
              claim.userId,
              claim.runtimeApiKey,
            );
          }

          // Hub-restart recovery path: re-seed the ACL from a verified key.
          if (keyMatches && !alreadyOwned) {
            ownershipService.addStartedAgent(hostId, claim.userId);
          }

          if (keyMatches) continue;

          try {
            const runtimeApiKey = await runtimeKeyService.issueRuntimeApiKey(
              claim.userId,
            );
            naisysServer.sendMessage(hostId, HubEvents.RUNTIME_KEY_REISSUE, {
              userId: claim.userId,
              runtimeApiKey,
            });
          } catch (err) {
            logService.error(
              `[Hub:Heartbeat] Failed to reissue runtime key for user ${claim.userId}: ${err}`,
            );
          }
        }
      }

      // Sync the host's ACL with what it claims to be running: adds admin
      // (which has no AGENT_START path), drops users it stopped running
      // (top-level agents that exited naturally — no AGENT_STOP for those).
      const claimedUserIds = new Set(
        parsed.activeSessions.map((s) => s.userId),
      );
      ownershipService.reconcileHeartbeatPresence(hostId, claimedUserIds);

      // Drop sessions for users the host doesn't own — otherwise a host
      // would write its own ACL via heartbeat claims.
      const allowedSessions = parsed.activeSessions.filter((s) =>
        ownershipService.hostOwnsUser(hostId, s.userId),
      );
      const allowedUserIds = unique(allowedSessions.map((s) => s.userId));

      const sessionMap = new Map<string, ActiveSessionInfo>();
      for (const session of allowedSessions) {
        const subagentId = session.subagentId ?? 0;
        sessionMap.set(sessionKey(session.userId, subagentId), {
          userId: session.userId,
          subagentId: subagentId === 0 ? null : subagentId,
          runId: session.runId,
          sessionId: session.sessionId,
          lastActive: now,
          paused: session.paused,
          state: session.state,
          tokenCount: session.tokenCount,
        });
      }
      // Detect a change in this host's active-session set — a run started,
      // ended, or compacted to a new session. Mirrors the agent's
      // onHeartbeatNeeded: on a change, push immediately so the supervisor
      // reflects it within roundtrip latency, not at the next interval tick.
      const prevSessions = hostActiveSessions.get(hostId);
      const prevKeys = new Set(
        prevSessions ? [...prevSessions.values()].map(sessionRunKey) : [],
      );
      const sessionSetChanged =
        prevKeys.size !== sessionMap.size ||
        [...sessionMap.values()].some((s) => !prevKeys.has(sessionRunKey(s)));

      hostActiveSessions.set(hostId, sessionMap);

      if (sessionSetChanged) pushSessionHeartbeat();

      await hubDb.hosts.updateMany({
        where: { id: hostId },
        data: { last_active: now },
      });

      if (allowedUserIds.length > 0) {
        await hubDb.user_notifications.updateMany({
          where: { user_id: { in: allowedUserIds } },
          data: { last_active: now, latest_host_id: hostId },
        });
      }

      // Per-session updates (not a batched OR-updateMany) so each row gets
      // its own total_tokens. lastActive bumps keep the online badge lit
      // between log writes.
      if (allowedSessions.length > 0) {
        await Promise.all(
          allowedSessions.map((session) =>
            hubDb.run_session.updateMany({
              where: {
                user_id: session.userId,
                run_id: session.runId,
                subagent_id: session.subagentId ?? 0,
                session_id: session.sessionId,
              },
              data: {
                last_active: now,
                ...(session.tokenCount !== undefined && {
                  total_tokens: session.tokenCount,
                }),
              },
            }),
          ),
        );
      }
    } catch (error) {
      logService.error(
        `[Hub:Heartbeat] Error updating heartbeat for host ${hostId}: ${error}`,
      );
    }
  });

  // The ACL is durable across disconnect (hubOwnershipService); only the
  // session-liveness mirror is cleared here.
  naisysServer.registerEvent(HubEvents.CLIENT_DISCONNECTED, (hostId) => {
    const hadSessions = (hostActiveSessions.get(hostId)?.size ?? 0) > 0;
    hostActiveSessions.delete(hostId);
    // The host's runs just went offline — push immediately, don't wait.
    if (hadSessions) pushSessionHeartbeat();
  });

  function pushSessionHeartbeat() {
    const updates: SessionHeartbeatUpdate[] = [];
    for (const sessions of hostActiveSessions.values()) {
      for (const info of sessions.values()) {
        updates.push({
          userId: info.userId,
          runId: info.runId,
          subagentId: info.subagentId ?? undefined,
          sessionId: info.sessionId,
          lastActive: info.lastActive,
          paused: info.paused,
          state: info.state,
          totalTokens: info.tokenCount,
        });
      }
    }

    // Always broadcast, even an empty snapshot: it's the full active set, so
    // an empty one is how the supervisor retires the last session — and how a
    // supervisor that reconnected mid-idle resyncs against current truth.
    naisysServer.broadcastToSupervisors(HubEvents.SESSION_HEARTBEAT, {
      updates,
    });
  }

  const pushInterval = setInterval(
    pushSessionHeartbeat,
    HUB_HEARTBEAT_INTERVAL_MS,
  );

  function cleanup() {
    clearInterval(pushInterval);
  }

  /** Active sessions across hosts. Callers use the identity to look up the
   *  session's model in run_session, where historical rows aren't deleted. */
  function getActiveSessions(): HubActiveSession[] {
    const sessions: HubActiveSession[] = [];
    for (const sessionMap of hostActiveSessions.values()) {
      for (const info of sessionMap.values()) {
        sessions.push({
          userId: info.userId,
          runId: info.runId,
          subagentId: info.subagentId,
          sessionId: info.sessionId,
        });
      }
    }
    return sessions;
  }

  return {
    cleanup,
    getActiveSessions,
  };
}

export type HubHeartbeatService = ReturnType<typeof createHubHeartbeatService>;
