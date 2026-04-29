import type { DualLogger } from "@naisys/common-node";
import { type HubDatabaseService } from "@naisys/hub-database";
import type {
  AgentsStatus,
  CommandLoopState,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";
import {
  HeartbeatSchema,
  HUB_HEARTBEAT_INTERVAL_MS,
  HubEvents,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";

/** Tracks NAISYS instance heartbeats and pushes aggregate active user status to all instances */
export function createHubHeartbeatService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
) {
  // Active agent user ids per host. Subagents ride under the parent's userId.
  const hostActiveAgents = new Map<number, number[]>();

  // Active sessions per host, keyed by `${userId}:${subagentId ?? 0}` so a
  // parent and its subagents are tracked independently.
  interface ActiveSessionInfo {
    userId: number;
    subagentId: number | null;
    runId: number;
    sessionId: number;
    lastActive: string;
    paused?: boolean;
    state?: CommandLoopState;
  }
  const hostActiveSessions = new Map<number, Map<string, ActiveSessionInfo>>();
  const sessionKey = (userId: number, subagentId: number | null | undefined) =>
    `${userId}:${subagentId ?? 0}`;

  // Track per-agent notification IDs (latestLogId, latestMailId)
  const agentNotifications = new Map<
    number,
    { latestLogId: number; latestMailId: number; latestChatId: number }
  >();

  /** Update a single notification field for an agent */
  function updateAgentNotification(
    userId: number,
    field: "latestLogId" | "latestMailId" | "latestChatId",
    value: number,
  ) {
    let entry = agentNotifications.get(userId);
    if (!entry) {
      entry = { latestLogId: 0, latestMailId: 0, latestChatId: 0 };
      agentNotifications.set(userId, entry);
    }
    entry[field] = value;
  }

  // Handle heartbeat from NAISYS instances
  naisysServer.registerEvent(HubEvents.HEARTBEAT, async (hostId, data) => {
    const parsed = HeartbeatSchema.parse(data);

    // Dedup: a parent and its subagents share a userId.
    const activeUserIds = [
      ...new Set(parsed.activeSessions.map((s) => s.userId)),
    ];

    // Update in-memory per-host active agent IDs
    hostActiveAgents.set(hostId, activeUserIds);

    try {
      const now = new Date().toISOString();

      // Update host last_active
      await hubDb.hosts.updateMany({
        where: { id: hostId },
        data: { last_active: now },
      });

      // Update user_notifications.last_active for each active user
      if (activeUserIds.length > 0) {
        await hubDb.user_notifications.updateMany({
          where: { user_id: { in: activeUserIds } },
          data: { last_active: now, latest_host_id: hostId },
        });
      }

      // Bump run_session.last_active for each active session so the run-online
      // badge stays lit even during quiet periods with no log writes. The
      // aggregate SESSION_HEARTBEAT broadcast runs on its own interval below.
      const sessionMap = new Map<string, ActiveSessionInfo>();
      for (const session of parsed.activeSessions) {
        const subagentId = session.subagentId ?? 0;
        sessionMap.set(sessionKey(session.userId, subagentId), {
          userId: session.userId,
          subagentId: subagentId === 0 ? null : subagentId,
          runId: session.runId,
          sessionId: session.sessionId,
          lastActive: now,
          paused: session.paused,
          state: session.state,
        });
      }
      if (parsed.activeSessions.length > 0) {
        await hubDb.run_session.updateMany({
          where: {
            OR: parsed.activeSessions.map((session) => ({
              user_id: session.userId,
              run_id: session.runId,
              subagent_id: session.subagentId ?? 0,
              session_id: session.sessionId,
            })),
          },
          data: { last_active: now },
        });
      }
      hostActiveSessions.set(hostId, sessionMap);
    } catch (error) {
      logService.error(
        `[Hub:Heartbeat] Error updating heartbeat for host ${hostId}: ${error}`,
      );
    }
  });

  // Clean up tracking when a host disconnects. Runtime API keys are not
  // touched here — they're rotated on the next AGENT_START and revoked
  // explicitly on user disable/archive/delete.
  naisysServer.registerEvent(HubEvents.CLIENT_DISCONNECTED, (hostId) => {
    hostActiveAgents.delete(hostId);
    hostActiveSessions.delete(hostId);
    throttledPushAgentsStatus();
  });

  /** Push aggregate agent status to all connected NAISYS instances */
  let lastPushedJson = "";

  function pushAgentsStatus() {
    const payload: AgentsStatus = {
      hostActiveAgents: Object.fromEntries(hostActiveAgents),
      agentNotifications: Object.fromEntries(agentNotifications),
    };

    const json = JSON.stringify(payload);
    if (json === lastPushedJson) return;
    lastPushedJson = json;

    naisysServer.broadcastToAll(HubEvents.AGENTS_STATUS, payload);
  }

  /** Throttled push for agent start/stop changes — at most once per 500ms */
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function throttledPushAgentsStatus() {
    if (throttleTimer) return;
    pushAgentsStatus();
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
    }, 500);
  }

  /** Push aggregate session lastActive bumps to supervisors */
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
        });
      }
    }
    if (updates.length === 0) return;

    naisysServer.broadcastToSupervisors(HubEvents.SESSION_HEARTBEAT, {
      updates,
    });
  }

  // Periodically push aggregate active user status to all NAISYS instances,
  // plus aggregate session heartbeats to supervisors.
  const pushInterval = setInterval(() => {
    pushAgentsStatus();
    pushSessionHeartbeat();
  }, HUB_HEARTBEAT_INTERVAL_MS);

  function getHostActiveAgentCount(hostId: number): number {
    return hostActiveAgents.get(hostId)?.length ?? 0;
  }

  /** Find which hosts a given agent is currently running on */
  function findHostsForAgent(userId: number): number[] {
    const hostIds: number[] = [];
    for (const [hostId, userIds] of hostActiveAgents) {
      if (userIds.includes(userId)) {
        hostIds.push(hostId);
      }
    }
    return hostIds;
  }

  /** Add a userId to a host's active list after a successful start */
  function addStartedAgent(hostId: number, userId: number) {
    const userIds = hostActiveAgents.get(hostId);
    if (userIds) {
      if (!userIds.includes(userId)) {
        userIds.push(userId);
      }
    } else {
      hostActiveAgents.set(hostId, [userId]);
    }
    throttledPushAgentsStatus();
  }

  /** Remove a userId from a host's active list after a successful stop */
  function removeStoppedAgent(hostId: number, userId: number) {
    const userIds = hostActiveAgents.get(hostId);
    if (userIds) {
      const index = userIds.indexOf(userId);
      if (index !== -1) {
        userIds.splice(index, 1);
      }
    }
    throttledPushAgentsStatus();
  }

  function cleanup() {
    clearInterval(pushInterval);
  }

  /** Get all active user IDs across all connected hosts */
  function getActiveUserIds(): Set<number> {
    const allActiveUserIds = new Set<number>();
    for (const userIds of hostActiveAgents.values()) {
      for (const id of userIds) {
        allActiveUserIds.add(id);
      }
    }
    return allActiveUserIds;
  }

  return {
    cleanup,
    getActiveUserIds,
    getHostActiveAgentCount,
    findHostsForAgent,
    addStartedAgent,
    removeStoppedAgent,
    updateAgentNotification,
    throttledPushAgentsStatus,
  };
}

export type HubHeartbeatService = ReturnType<typeof createHubHeartbeatService>;
