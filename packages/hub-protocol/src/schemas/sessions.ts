import { z } from "zod";

/** Full session data pushed from hub to supervisor after creation */
export const SessionPushSchema = z.object({
  session: z.object({
    userId: z.number(),
    runId: z.number(),
    sessionId: z.number(),
    modelName: z.string(),
    createdAt: z.string(),
    lastActive: z.string(),
    latestLogId: z.number(),
    totalLines: z.number(),
    totalCost: z.number(),
  }),
});
export type SessionPush = z.infer<typeof SessionPushSchema>;

/** Request to create a new run session */
export const SessionCreateRequestSchema = z.object({
  userId: z.number(),
  modelName: z.string(),
});
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

/** Response to session create request */
export const SessionCreateResponseSchema = z.object({
  success: z.boolean(),
  runId: z.number().optional(),
  sessionId: z.number().optional(),
  error: z.string().optional(),
});
export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>;

/** Request to increment session for an existing run */
export const SessionIncrementRequestSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  modelName: z.string(),
});
export type SessionIncrementRequest = z.infer<
  typeof SessionIncrementRequestSchema
>;

/** Response to session increment request */
export const SessionIncrementResponseSchema = z.object({
  success: z.boolean(),
  sessionId: z.number().optional(),
  error: z.string().optional(),
});
export type SessionIncrementResponse = z.infer<
  typeof SessionIncrementResponseSchema
>;
