import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  HubEvents,
  type LogPushEntry,
  type LogPushSessionUpdate,
  LogWriteRequestSchema,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../services/naisysServer.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Handles log_write events from NAISYS instances (fire-and-forget) */
export function createHubLogService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  heartbeatService: HubHeartbeatService,
) {
  // Track last pushed log ID per session for gap detection
  const lastPushedLogId = new Map<string, number>();

  naisysServer.registerEvent(HubEvents.LOG_WRITE, async (hostId, data) => {
    try {
      const parsed = LogWriteRequestSchema.parse(data);

      // Collect push entries and session deltas
      const pushEntries: LogPushEntry[] = [];
      const sessionUpdates = new Map<string, LogPushSessionUpdate>();

      for (const entry of parsed.entries) {
        const now = new Date().toISOString();
        const lineCount = entry.message.split("\n").length;
        const subagentId = entry.subagentId ?? 0;
        // Wire format: undefined for parent (subagent_id 0 in DB), number otherwise
        const wireSubagentId = subagentId === 0 ? undefined : subagentId;

        const log = await hubDb.context_log.create({
          data: {
            user_id: entry.userId,
            run_id: entry.runId,
            subagent_id: subagentId,
            session_id: entry.sessionId,
            host_id: hostId,
            role: entry.role,
            source: entry.source ?? null,
            type: entry.type ?? null,
            message: entry.message,
            created_at: entry.createdAt,
            attachment_id: entry.attachmentId ?? null,
          },
        });

        // Update session table with total lines and last active
        await hubDb.run_session.updateMany({
          where: {
            user_id: entry.userId,
            run_id: entry.runId,
            subagent_id: subagentId,
            session_id: entry.sessionId,
          },
          data: {
            last_active: now,
            latest_log_id: log.id,
            total_lines: {
              increment: lineCount,
            },
          },
        });

        // Update user_notifications with latest_log_id and last_active
        await hubDb.user_notifications.updateMany({
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

        // Look up attachment metadata if present
        let attachmentPublicId: string | undefined;
        let attachmentFilename: string | undefined;
        let attachmentFileSize: number | undefined;
        if (entry.attachmentId) {
          const att = await hubDb.attachments.findUnique({
            where: { id: entry.attachmentId },
            select: { public_id: true, filename: true, file_size: true },
          });
          if (att) {
            attachmentPublicId = att.public_id;
            attachmentFilename = att.filename;
            attachmentFileSize = att.file_size;
          }
        }

        // Collect push entry with DB-assigned ID
        const sessionKey = `${entry.userId}-${entry.runId}-${subagentId}-${entry.sessionId}`;
        const previousId = lastPushedLogId.get(sessionKey) ?? null;

        pushEntries.push({
          id: log.id,
          previousId,
          userId: entry.userId,
          runId: entry.runId,
          subagentId: wireSubagentId,
          sessionId: entry.sessionId,
          role: entry.role,
          source: entry.source,
          type: entry.type,
          message: entry.message,
          createdAt: entry.createdAt,
          attachmentId: attachmentPublicId,
          attachmentFilename,
          attachmentFileSize,
        });

        lastPushedLogId.set(sessionKey, log.id);

        // Track session delta (accumulate totalLinesDelta, keep latest logId)
        const existing = sessionUpdates.get(sessionKey);
        if (existing) {
          existing.latestLogId = Math.max(existing.latestLogId, log.id);
          existing.lastActive = now;
          existing.totalLinesDelta += lineCount;
        } else {
          sessionUpdates.set(sessionKey, {
            userId: entry.userId,
            runId: entry.runId,
            subagentId: wireSubagentId,
            sessionId: entry.sessionId,
            lastActive: now,
            latestLogId: log.id,
            totalLinesDelta: lineCount,
          });
        }
      }

      // Push full log data to supervisor connections
      naisysServer.broadcastToSupervisors(HubEvents.LOG_PUSH, {
        entries: pushEntries,
        sessionUpdates: Array.from(sessionUpdates.values()),
      });

      // Trigger throttled push after all entries processed
      heartbeatService.throttledPushAgentsStatus();
    } catch (error) {
      logService.error(
        `[Hub:Logs] Error processing log_write from host ${hostId}: ${error}`,
      );
    }
  });
}
