import { z } from "zod";

/** Request to start an agent on its assigned host */
export const AgentStartRequestSchema = z.object({
  startUserId: z.number(),
  requesterUserId: z.number(),
  taskDescription: z.string().optional(),
  sourceHostId: z.number().optional(),
});
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>;

/** Response to agent start request */
export const AgentStartResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  hostname: z.string().optional(),
});
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;

/** Request to stop an agent on its current host */
export const AgentStopRequestSchema = z.object({
  userId: z.number(),
  reason: z.string(),
  sourceHostId: z.number().optional(),
});
export type AgentStopRequest = z.infer<typeof AgentStopRequestSchema>;

/** Response to agent stop request */
export const AgentStopResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentStopResponse = z.infer<typeof AgentStopResponseSchema>;
