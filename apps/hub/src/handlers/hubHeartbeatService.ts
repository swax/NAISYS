import { DatabaseService } from "@naisys/database";
import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatSchema,
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
  const hostActiveAgents = new Map<string, string[]>();

  // Handle heartbeat from NAISYS instances
  naisysServer.registerEvent(
    HubEvents.HEARTBEAT,
    async (hostId: string, data: unknown) => {
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
          `[HubHeartbeatService] Error updating heartbeat for host ${hostId}: ${error}`,
        );
      }
    },
  );

  // Clean up tracking when a host disconnects
  naisysServer.registerEvent(
    HubEvents.CLIENT_DISCONNECTED,
    (hostId: string) => {
      hostActiveAgents.delete(hostId);
      throttledPushHeartbeatStatus();
    },
  );

  /** Push aggregate active user status to all connected NAISYS instances */
  function pushHeartbeatStatus() {
    const payload = {
      hostActiveAgents: Object.fromEntries(hostActiveAgents),
    };

    for (const connection of naisysServer.getConnectedClients()) {
      naisysServer.sendMessage(
        connection.getHostId(),
        HubEvents.HEARTBEAT_STATUS,
        payload,
      );
    }
  }

  /** Throttled push for agent start/stop changes — at most once per 500ms */
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function throttledPushHeartbeatStatus() {
    if (throttleTimer) return;
    pushHeartbeatStatus();
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
    }, 500);
  }

  // Periodically push aggregate active user status to all NAISYS instances
  const pushInterval = setInterval(
    pushHeartbeatStatus,
    HUB_HEARTBEAT_INTERVAL_MS,
  );

  function getHostActiveAgentCount(hostId: string): number {
    return hostActiveAgents.get(hostId)?.length ?? 0;
  }

  /** Find which hosts a given agent is currently running on */
  function findHostsForAgent(userId: string): string[] {
    const hostIds: string[] = [];
    for (const [hostId, userIds] of hostActiveAgents) {
      if (userIds.includes(userId)) {
        hostIds.push(hostId);
      }
    }
    return hostIds;
  }

  /** Add a userId to a host's active list after a successful start */
  function addStartedAgent(hostId: string, userId: string) {
    const userIds = hostActiveAgents.get(hostId);
    if (userIds) {
      if (!userIds.includes(userId)) {
        userIds.push(userId);
      }
    } else {
      hostActiveAgents.set(hostId, [userId]);
    }
    throttledPushHeartbeatStatus();
  }

  /** Remove a userId from a host's active list after a successful stop */
  function removeStoppedAgent(hostId: string, userId: string) {
    const userIds = hostActiveAgents.get(hostId);
    if (userIds) {
      const index = userIds.indexOf(userId);
      if (index !== -1) {
        userIds.splice(index, 1);
      }
    }
    throttledPushHeartbeatStatus();
  }

  function cleanup() {
    clearInterval(pushInterval);
  }

  /** Get all active user IDs across all connected hosts */
  function getActiveUserIds(): Set<string> {
    const allActiveUserIds = new Set<string>();
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
  };
}

export type HubHeartbeatService = ReturnType<typeof createHubHeartbeatService>;
