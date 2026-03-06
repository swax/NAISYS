import { z } from "zod";

/** How often NAISYS instances flush buffered log entries to the hub (ms) */
export const LOG_FLUSH_INTERVAL_MS = 100;

/** A single log entry sent from NAISYS instance to hub */
export const LogWriteEntrySchema = z.object({
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  role: z.string(),
  source: z.string(),
  type: z.string(),
  message: z.string(),
  createdAt: z.string(),
  attachmentId: z.number().optional(),
});
export type LogWriteEntry = z.infer<typeof LogWriteEntrySchema>;

/** Batch of log entries sent from NAISYS instance to hub */
export const LogWriteRequestSchema = z.object({
  entries: z.array(LogWriteEntrySchema),
});
export type LogWriteRequest = z.infer<typeof LogWriteRequestSchema>;

/** A single log entry pushed from hub to supervisor (includes DB-assigned ID) */
export const LogPushEntrySchema = z.object({
  id: z.number(),
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  role: z.string(),
  source: z.string(),
  type: z.string(),
  message: z.string(),
  createdAt: z.string(),
  attachmentId: z.number().optional(),
});
export type LogPushEntry = z.infer<typeof LogPushEntrySchema>;

/** Session delta included with log pushes */
export const LogPushSessionUpdateSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  lastActive: z.string(),
  latestLogId: z.number(),
  totalLinesDelta: z.number(),
});
export type LogPushSessionUpdate = z.infer<typeof LogPushSessionUpdateSchema>;

/** Full-data log push from hub to supervisor */
export const LogPushSchema = z.object({
  entries: z.array(LogPushEntrySchema),
  sessionUpdates: z.array(LogPushSessionUpdateSchema),
});
export type LogPush = z.infer<typeof LogPushSchema>;
