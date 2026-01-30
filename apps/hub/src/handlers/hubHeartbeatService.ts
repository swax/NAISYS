import { DatabaseService } from "@naisys/database";
import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { RunnerServer } from "../services/runnerServer.js";

const HUB_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS * 2;

/** Tracks runner heartbeats and pushes aggregate active user status to all runners */
export function createHubHeartbeatService(
  runnerServer: RunnerServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  // Handle heartbeat from runners
  runnerServer.registerEvent(
    HubEvents.HEARTBEAT,
    async (runnerId: string, data: unknown) => {
      const parsed = HeartbeatSchema.parse(data);

      try {
        await dbService.usingDatabase(async (prisma) => {
          const now = new Date().toISOString();

          // Update runner last_active
          await prisma.runners.updateMany({
            where: { id: runnerId },
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
          `[HubHeartbeatService] Error updating heartbeat for runner ${runnerId}: ${error}`,
        );
      }
    },
  );

  // Periodically query DB for active users and push status to all runners
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

      for (const connection of runnerServer.getConnectedClients()) {
        runnerServer.sendMessage(
          connection.getRunnerId(),
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
