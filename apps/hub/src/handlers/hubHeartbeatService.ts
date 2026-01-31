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
  // Handle heartbeat from NAISYS instances
  naisysServer.registerEvent(
    HubEvents.HEARTBEAT,
    async (hostId: string, data: unknown) => {
      const parsed = HeartbeatSchema.parse(data);

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
              data: { last_active: now },
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

  // Periodically query DB for active users and push status to all NAISYS instances
  const pushInterval = setInterval(async () => {
    try {
      const activeUserIds = await dbService.usingDatabase(async (prisma) => {
        const cutoff = new Date(Date.now() - HUB_HEARTBEAT_INTERVAL_MS);
        const activeUsers = await prisma.user_notifications.findMany({
          where: { last_active: { gte: cutoff } },
          select: { user_id: true },
        });
        return activeUsers.map((u) => u.user_id);
      });

      const payload = { activeUserIds };

      for (const connection of naisysServer.getConnectedClients()) {
        naisysServer.sendMessage(
          connection.getHostId(),
          HubEvents.HEARTBEAT_STATUS,
          payload,
        );
      }
    } catch (error) {
      logService.error(
        `[HubHeartbeatService] Error querying active users: ${error}`,
      );
    }
  }, HUB_HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    clearInterval(pushInterval);
  }

  return { cleanup };
}
