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
// NAISYS -> Hub Request/Response Messages
// =============================================================================

/** Response to user_list request - returns all users registered on the hub */
export const UserListResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  users: z
    .array(
      z.object({
        username: z.string(),
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

  // Log events (NAISYS -> hub, fire-and-forget)
  LOG_WRITE: "log_write",

  // Heartbeat events
  HEARTBEAT: "heartbeat",
  HEARTBEAT_STATUS: "heartbeat_status",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
