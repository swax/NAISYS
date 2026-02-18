import { z } from "zod";

/** How often NAISYS instances flush buffered log entries to the hub (ms) */
export const LOG_FLUSH_INTERVAL_MS = 1000;

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
});
export type LogWriteEntry = z.infer<typeof LogWriteEntrySchema>;

/** Batch of log entries sent from NAISYS instance to hub */
export const LogWriteRequestSchema = z.object({
  entries: z.array(LogWriteEntrySchema),
});
export type LogWriteRequest = z.infer<typeof LogWriteRequestSchema>;
