import { z } from "zod";

/** How often NAISYS instances flush buffered cost entries to the hub (ms) */
export const COST_FLUSH_INTERVAL_MS = 100;

export const CostSourceEnum = z.enum([
  "console",
  "write_protection",
  "compact",
  "lynx",
  "look",
  "listen",
  "genimg",
  "websearch",
]);
export type CostSource = z.infer<typeof CostSourceEnum>;

/** A single cost entry sent from NAISYS instance to hub */
export const CostWriteEntrySchema = z.object({
  userId: z.number(),
  runId: z.number(),
  subagentId: z.number().nullable().optional(),
  sessionId: z.number(),
  source: CostSourceEnum,
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

/** Per-user budget entry in the COST_WRITE response */
export const CostWriteBudgetEntrySchema = z.object({
  userId: z.number(),
  /** Remaining budget for this agent, or null if no per-agent limit */
  budgetLeft: z.number().nullable(),
});

/** Response to COST_WRITE — returns per-agent budget info for each user in the batch */
export const CostWriteResponseSchema = z.object({
  budgets: z.array(CostWriteBudgetEntrySchema),
});
export type CostWriteResponse = z.infer<typeof CostWriteResponseSchema>;

/** Cost delta pushed from hub to supervisor after DB write */
export const CostPushEntrySchema = z.object({
  userId: z.number(),
  runId: z.number(),
  subagentId: z.number().nullable().optional(),
  sessionId: z.number(),
  costDelta: z.number(),
});
export type CostPushEntry = z.infer<typeof CostPushEntrySchema>;

export const CostPushSchema = z.object({
  entries: z.array(CostPushEntrySchema),
});
export type CostPush = z.infer<typeof CostPushSchema>;

/** Pushed from hub when an agent's spending status changes */
export const CostControlSchema = z.object({
  userId: z.number(),
  enabled: z.boolean(),
  reason: z.string(),
});
export type CostControl = z.infer<typeof CostControlSchema>;
