import { DatabaseService } from "@naisys/hub-database";
import { HubEvents, LogWriteRequestSchema } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Handles log_write events from NAISYS instances (fire-and-forget) */
export function createHubLogService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
) {
  naisysServer.registerEvent(
    HubEvents.LOG_WRITE,
    async (hostId: number, data: unknown) => {
      try {
        const parsed = LogWriteRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          for (const entry of parsed.entries) {
            const now = new Date().toISOString();

            const log = await prisma.context_log.create({
              data: {
                user_id: entry.userId,
                run_id: entry.runId,
                session_id: entry.sessionId,
                host_id: hostId,
                role: entry.role,
                source: entry.source,
                type: entry.type,
                message: entry.message,
                created_at: entry.createdAt,
              },
            });

            // Update session table with total lines and last active
            await prisma.run_session.updateMany({
              where: {
                user_id: entry.userId,
                run_id: entry.runId,
                session_id: entry.sessionId,
              },
              data: {
                last_active: now,
                latest_log_id: log.id,
                total_lines: {
                  increment: entry.message.split("\n").length,
                },
              },
            });

            // Update user_notifications with latest_log_id and last_active
            await prisma.user_notifications.updateMany({
              where: {
                user_id: entry.userId,
              },
              data: {
                latest_log_id: log.id,
                last_active: now,
              },
            });

            // Push notification ID update via heartbeat
            heartbeatService.updateAgentNotification(
              entry.userId,
              "latestLogId",
              log.id,
            );
          }
        });

        // Trigger throttled push after all entries processed
        heartbeatService.throttledPushAgentsStatus();
      } catch (error) {
        logService.error(
          `[Hub:Logs] Error processing log_write from host ${hostId}: ${error}`,
        );
      }
    },
  );
}
