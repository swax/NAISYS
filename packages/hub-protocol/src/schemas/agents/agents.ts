import { z } from "zod";

import { LogSourceEnum } from "../comms/logs.js";

/** Client (supervisor / NAISYS host) → hub. runtimeApiKey is intentionally absent. */
export const AgentStartInboundSchema = z.object({
  startUserId: z.number(),
  taskDescription: z.string().optional(),
  requesterUserId: z.number(),
});
export type AgentStartInbound = z.infer<typeof AgentStartInboundSchema>;

/** Attachment metadata carried on a ResumeEntry. Only image/audio attachments
 *  on console-source entries are shipped — the host downloads via publicId
 *  and injects them into context via appendImage/appendAudio. Replay doesn't
 *  re-log, so no need to carry the existing attachment id. */
export const ResumeAttachmentSchema = z.object({
  publicId: z.string(),
  filename: z.string(),
});
export type ResumeAttachment = z.infer<typeof ResumeAttachmentSchema>;

/** One prior-run context_log entry, slimmed for replay into a new run. */
export const ResumeEntrySchema = z.object({
  source: LogSourceEnum,
  message: z.string(),
  attachment: ResumeAttachmentSchema.optional(),
});
export type ResumeEntry = z.infer<typeof ResumeEntrySchema>;

/** AGENT_START resume bundle. The tail ships as-is; `summary` always carries
 *  the compact's text when a compact exists. The host scans the tail for the
 *  post-compact restore echo and only prepends `summary` if missing.
 *  Valid shapes:
 *  - `{ summary, cursor }`                  → continuity=summary current,
 *                                             or continuity=full with no
 *                                             post-compact activity yet
 *  - `{ summary, entries, stale, cursor }`  → continuity=summary, tail past
 *                                             snapshot — replay then
 *                                             retroactively compact
 *  - `{ summary, entries, cursor }`         → continuity=full, replay tail
 *  - `{ entries, stale }`                   → continuity=summary, no
 *                                             snapshot yet — replay then
 *                                             compact to seed the first one
 *  - `{ entries }`                          → continuity=full, no compact
 *                                             ever — replay all history
 *  `cursor` is the (runId, sessionId) of the compact log entry the tail
 *  starts past — used for the host's resume notice on startup. */
export const RestoreDataSchema = z.object({
  summary: z.string().optional(),
  entries: z.array(ResumeEntrySchema).optional(),
  stale: z.boolean().optional(),
  cursor: z.object({ runId: z.number(), sessionId: z.number() }).optional(),
});
export type RestoreData = z.infer<typeof RestoreDataSchema>;

/** Files for the host to materialize into the agent's home folder before
 *  the shell starts. fileHash lets the host skip ones already on disk. */
export const StartupAttachmentDispatchSchema = z.object({
  publicId: z.string(),
  filename: z.string(),
  fileSize: z.number(),
  fileHash: z.string(),
  path: z.string(),
});
export type StartupAttachmentDispatch = z.infer<
  typeof StartupAttachmentDispatchSchema
>;

/** Hub → target host. Runtime key is minted up front so the agent's
 *  authenticated from its first command; RUNTIME_KEY_REISSUE handles
 *  later hash mismatches. runId/sessionId are pre-allocated by the hub so
 *  the agent skips an initial SESSION_CREATE round-trip. */
export const AgentStartDispatchSchema = z.object({
  startUserId: z.number(),
  taskDescription: z.string().optional(),
  runtimeApiKey: z.string(),
  runId: z.number(),
  sessionId: z.number(),
  sourceHostId: z.number().optional(),
  startupAttachments: z.array(StartupAttachmentDispatchSchema).optional(),
  /** Resume bundle (summary, entries, stale flag) — see RestoreDataSchema. */
  restoreData: RestoreDataSchema.optional(),
});
export type AgentStartDispatch = z.infer<typeof AgentStartDispatchSchema>;

/** modelName is set by the host so the hub can fill in the run_session
 *  row it pre-allocated. runId/sessionId are echoed back to the supervisor. */
export const AgentStartResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  hostname: z.string().optional(),
  runId: z.number().optional(),
  sessionId: z.number().optional(),
  modelName: z.string().optional(),
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

/** Supervisor → hub: fire a named schedule on demand. */
export const ScheduleTriggerRequestSchema = z.object({
  userId: z.number(),
  scheduleName: z.string(),
});
export type ScheduleTriggerRequest = z.infer<
  typeof ScheduleTriggerRequestSchema
>;

/** `ok` covers delivered-or-already-pending; `reason` is UI-ready text. */
export const ScheduleTriggerResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.string(),
});
export type ScheduleTriggerResponse = z.infer<
  typeof ScheduleTriggerResponseSchema
>;
