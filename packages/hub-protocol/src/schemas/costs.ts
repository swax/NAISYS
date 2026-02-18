import { z } from "zod";

/** How often NAISYS instances flush buffered cost entries to the hub (ms) */
export const COST_FLUSH_INTERVAL_MS = 2000;

/** A single cost entry sent from NAISYS instance to hub */
export const CostWriteEntrySchema = z.object({
  userId: z.number(),
  runId: z.number(),
  sessionId: z.number(),
  source: z.string(),
  model: z.string(),
  cost: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheWriteTokens: z.number(),
  cacheReadTokens: z.number(),
});
export type CostWriteEntry = z.infer<typeof CostWriteEntrySchema>;

/** Batch of cost entries sent from NAISYS instance to hub */
export const CostWriteRequestSchema = z.object({
  entries: z.array(CostWriteEntrySchema),
});
export type CostWriteRequest = z.infer<typeof CostWriteRequestSchema>;

/** Pushed from hub when an agent's spending status changes */
export const CostControlSchema = z.object({
  userId: z.number(),
  enabled: z.boolean(),
  reason: z.string(),
});
export type CostControl = z.infer<typeof CostControlSchema>;
