import { z } from "zod";

/** Client (supervisor / NAISYS host) → hub. runtimeApiKey is intentionally absent. */
export const AgentStartInboundSchema = z.object({
  startUserId: z.number(),
  taskDescription: z.string().optional(),
  requesterUserId: z.number(),
});
export type AgentStartInbound = z.infer<typeof AgentStartInboundSchema>;

/** Hub → target host. Runtime key is minted up front so the agent's
 *  authenticated from its first command; RUNTIME_KEY_REISSUE handles
 *  later hash mismatches. */
export const AgentStartDispatchSchema = z.object({
  startUserId: z.number(),
  taskDescription: z.string().optional(),
  runtimeApiKey: z.string(),
  sourceHostId: z.number().optional(),
});
export type AgentStartDispatch = z.infer<typeof AgentStartDispatchSchema>;

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

/** Request to pause or resume a run's active session */
export const AgentRunPauseRequestSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  // Synthetic subagent ids are always negative; rejecting 0/positive values
  // keeps `subagentId ?? userId` resolution from aliasing onto a real userId.
  subagentId: z.number().negative().nullable().optional(),
  sessionId: z.number(),
  sourceHostId: z.number().optional(),
});
export type AgentRunPauseRequest = z.infer<typeof AgentRunPauseRequestSchema>;

/** Response to pause/resume request */
export const AgentRunPauseResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  /** True if the request changed the state; false if it was already in that state. */
  changed: z.boolean().optional(),
});
export type AgentRunPauseResponse = z.infer<typeof AgentRunPauseResponseSchema>;

/** Request to send a command to a run's active session */
export const AgentRunCommandRequestSchema = z.object({
  userId: z.number(),
  runId: z.number(),
  // See AgentRunPauseRequestSchema — synthetic subagent ids must be negative.
  subagentId: z.number().negative().nullable().optional(),
  sessionId: z.number(),
  command: z.string(),
  sourceHostId: z.number().optional(),
});
export type AgentRunCommandRequest = z.infer<
  typeof AgentRunCommandRequestSchema
>;

/** Response to a run command request */
export const AgentRunCommandResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentRunCommandResponse = z.infer<
  typeof AgentRunCommandResponseSchema
>;

/** Request to peek at an agent's output buffer */
export const AgentPeekRequestSchema = z.object({
  userId: z.number(),
  skip: z.number().optional(),
  take: z.number().optional(),
  sourceHostId: z.number().optional(),
});
export type AgentPeekRequest = z.infer<typeof AgentPeekRequestSchema>;

/** Response to agent peek request */
export const AgentPeekResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  lines: z.array(z.string()).optional(),
  totalLines: z.number().optional(),
});
export type AgentPeekResponse = z.infer<typeof AgentPeekResponseSchema>;

/** Hub → host push: hand the host a freshly minted runtime key. Fired when
 *  a heartbeat plaintext doesn't match the stored hash. */
export const RuntimeKeyReissueSchema = z.object({
  userId: z.number(),
  runtimeApiKey: z.string(),
});
export type RuntimeKeyReissue = z.infer<typeof RuntimeKeyReissueSchema>;
