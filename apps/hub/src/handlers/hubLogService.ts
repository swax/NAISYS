import { DatabaseService, monotonicFactory } from "@naisys/database";
import { HubEvents, LogWriteRequestSchema } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Handles log_write events from NAISYS instances (fire-and-forget) */
export function createHubLogService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
) {
  // Use monotonic ULID to preserve strict ordering within a batch
  const monotonicUlid = monotonicFactory();

  naisysServer.registerEvent(
    HubEvents.LOG_WRITE,
    async (hostId: string, data: unknown) => {
      try {
        const parsed = LogWriteRequestSchema.parse(data);

        await dbService.usingDatabase(async (prisma) => {
          for (const entry of parsed.entries) {
            const id = monotonicUlid();
            const now = new Date().toISOString();

            await prisma.context_log.create({
              data: {
                id,
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
                latest_log_id: id,
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
                latest_log_id: id,
                last_active: now,
              },
            });
          }
        });
      } catch (error) {
        logService.error(
          `[HubLogService] Error processing log_write from host ${hostId}: ${error}`,
        );
      }
    },
  );
}
