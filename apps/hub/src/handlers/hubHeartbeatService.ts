import { DatabaseService } from "@naisys/database";
import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatSchema,
  AgentsStatus,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

const HUB_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS * 2;

/** Tracks NAISYS instance heartbeats and pushes aggregate active user status to all instances */
export function createHubHeartbeatService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  // Track active agent user IDs per host from heartbeat data
  const hostActiveAgents = new Map<number, number[]>();

  // Track per-agent notification IDs (latestLogId, latestMailId)
  const agentNotifications = new Map<
    number,
    { latestLogId: number; latestMailId: number }
  >();

  /** Update a single notification field for an agent */
  function updateAgentNotification(
    userId: number,
    field: "latestLogId" | "latestMailId",
    value: number,
  ) {
    let entry = agentNotifications.get(userId);
    if (!entry) {
      entry = { latestLogId: 0, latestMailId: 0 };
      agentNotifications.set(userId, entry);
    }
    entry[field] = value;
  }

  // Handle heartbeat from NAISYS instances
  naisysServer.registerEvent(
    HubEvents.HEARTBEAT,
    async (hostId: number, data: unknown) => {
      const parsed = HeartbeatSchema.parse(data);

      // Update in-memory per-host active agent IDs
      hostActiveAgents.set(hostId, parsed.activeUserIds);

      try {
        await dbService.usingDatabase(async (prisma) => {
          const now = new Date().toISOString();

          // Update host last_active
          await prisma.hosts.updateMany({
            where: { id: hostId },
            data: { last_active: now },
          });

          // Update user_notifications.last_active for each active user
          if (parsed.activeUserIds.length > 0) {
            await prisma.user_notifications.updateMany({
              where: { user_id: { in: parsed.activeUserIds } },
              data: { last_active: now, latest_host_id: hostId },
            });
          }
        });
      } catch (error) {
        logService.error(
          `[Hub:Heartbeat] Error updating heartbeat for host ${hostId}: ${error}`,
        );
      }
    },
  );

  // Clean up tracking when a host disconnects
  naisysServer.registerEvent(
    HubEvents.CLIENT_DISCONNECTED,
    (hostId: number) => {
      hostActiveAgents.delete(hostId);
      throttledPushAgentsStatus();
    },
  );

  /** Push aggregate agent status to all connected NAISYS instances */
  function pushAgentsStatus() {
    const payload: AgentsStatus = {
      hostActiveAgents: Object.fromEntries(hostActiveAgents),
      agentNotifications: Object.fromEntries(agentNotifications),
    };

    for (const connection of naisysServer.getConnectedClients()) {
      naisysServer.sendMessage<AgentsStatus>(
        connection.getHostId(),
        HubEvents.AGENTS_STATUS,
        payload,
      );
    }
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

  // Periodically push aggregate active user status to all NAISYS instances
  const pushInterval = setInterval(pushAgentsStatus, HUB_HEARTBEAT_INTERVAL_MS);

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
