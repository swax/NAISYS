import { z } from "zod";

/**
 * Hub Protocol Message Schemas
 *
 * This package defines the shared message types between NAISYS instances (clients)
 * and the Hub server for multi-machine synchronization.
 */

// =============================================================================
// Session Messages (NAISYS -> Hub request/response)
// =============================================================================

/** Request to create a new run session */
export const SessionCreateRequestSchema = z.object({
  userId: z.string(),
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
  userId: z.string(),
  runId: z.number(),
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

// =============================================================================
// Log Messages (NAISYS -> Hub, fire-and-forget)
// =============================================================================

/** A single log entry sent from NAISYS instance to hub */
export const LogWriteEntrySchema = z.object({
  userId: z.string(),
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

// =============================================================================
// Cost Messages (NAISYS -> Hub, fire-and-forget batch)
// =============================================================================

/** How often NAISYS instances flush buffered cost entries to the hub (ms) */
export const COST_FLUSH_INTERVAL_MS = 2000;

/** A single cost entry sent from NAISYS instance to hub */
export const CostWriteEntrySchema = z.object({
  userId: z.string(),
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

// =============================================================================
// Cost Control Messages (Hub -> NAISYS, push)
// =============================================================================

/** Pushed from hub to NAISYS when an agent's cost-based spending status changes */
export const CostControlSchema = z.object({
  userId: z.string(),
  enabled: z.boolean(),
  reason: z.string(),
});
export type CostControl = z.infer<typeof CostControlSchema>;

// =============================================================================
// Heartbeat Messages
// =============================================================================

/** How often NAISYS instances send heartbeats to the hub (ms) */
export const HEARTBEAT_INTERVAL_MS = 2000;

/** How often NAISYS instances flush buffered log entries to the hub (ms) */
export const LOG_FLUSH_INTERVAL_MS = 1000;

/** Sent by NAISYS instance to hub with active user IDs (fire-and-forget) */
export const HeartbeatSchema = z.object({
  activeUserIds: z.array(z.string()),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

/** Sent by hub to NAISYS instances with aggregate active user IDs */
export const HeartbeatStatusSchema = z.object({
  activeUserIds: z.array(z.string()),
});
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusSchema>;

// =============================================================================
// Agent Start Messages (NAISYS -> Hub -> target NAISYS, request/response)
// =============================================================================

/** Request to start an agent on its assigned host */
export const AgentStartRequestSchema = z.object({
  userId: z.string(),
  taskDescription: z.string(),
});
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>;

/** Response to agent start request */
export const AgentStartResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;

/** Request to stop an agent on its current host */
export const AgentStopRequestSchema = z.object({
  userId: z.string(),
  reason: z.string(),
});
export type AgentStopRequest = z.infer<typeof AgentStopRequestSchema>;

/** Response to agent stop request */
export const AgentStopResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentStopResponse = z.infer<typeof AgentStopResponseSchema>;

// =============================================================================
// NAISYS -> Hub Request/Response Messages
// =============================================================================

/** Response to user_list request - returns all users registered on the hub */
export const UserListResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  users: z
    .array(
      z.object({
        userId: z.string(),
        username: z.string(),
        leadUserId: z.string().optional(),
        configYaml: z.string(),
        agentPath: z.string(),
      }),
    )
    .optional(),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// =============================================================================
// Event Names (for type-safe event handling)
// =============================================================================

export const HubEvents = {
  // Hub -> Client
  USER_LIST: "user_list",

  // Internal hub events (not sent over wire)
  CLIENT_CONNECTED: "client_connected",
  CLIENT_DISCONNECTED: "client_disconnected",

  // Internal NAISYS events (not sent over wire, local only)
  /** Raised when NAISYS instance connects to a hub (before catch_up is sent) */
  HUB_CONNECTED: "hub_connected",

  // Session events (NAISYS -> hub request/response)
  SESSION_CREATE: "session_create",
  SESSION_INCREMENT: "session_increment",

  // Agent management events (NAISYS -> hub -> target NAISYS, request/response)
  AGENT_START: "agent_start",
  AGENT_STOP: "agent_stop",

  // Log events (NAISYS -> hub, fire-and-forget)
  LOG_WRITE: "log_write",

  // Cost events (NAISYS -> hub, fire-and-forget)
  COST_WRITE: "cost_write",

  // Cost control events (hub -> NAISYS, push)
  COST_CONTROL: "cost_control",

  // Heartbeat events
  HEARTBEAT: "heartbeat",
  HEARTBEAT_STATUS: "heartbeat_status",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
