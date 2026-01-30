import { z } from "zod";

/**
 * Hub Protocol Message Schemas
 *
 * This package defines the shared message types between NAISYS runners (clients)
 * and the Hub server for multi-machine synchronization.
 */

// =============================================================================
// Client -> Hub Messages
// =============================================================================

/** Sent by client on connect to request missed data */
export const CatchUpRequestSchema = z.object({
  host_id: z.string(),
  schema_version: z.number(),
  /** ISO timestamp - when client last received forwarded data from this hub */
  lastSyncedFromHub: z.string(),
});
export type CatchUpRequest = z.infer<typeof CatchUpRequestSchema>;

/** Sent by hub in response to catch_up with missed forwarded data */
export const CatchUpResponseSchema = z.object({
  /** Whether there's more data to send (for pagination) */
  has_more: z.boolean(),
  /** Forwarded tables with records */
  tables: z.record(z.string(), z.array(z.unknown())),
});
export type CatchUpResponse = z.infer<typeof CatchUpResponseSchema>;

/** Error response for catch_up when schema mismatch or other error */
export const CatchUpResponseErrorSchema = z.object({
  error: z.enum(["schema_mismatch", "internal_error"]),
  message: z.string(),
});
export type CatchUpResponseError = z.infer<typeof CatchUpResponseErrorSchema>;

/** Sent by client in response to sync_request */
export const SyncResponseSchema = z.object({
  host_id: z.string(),
  has_more: z.boolean(),
  tables: z.record(z.string(), z.array(z.unknown())),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

/** Sent by client when sync cannot proceed (e.g., schema mismatch) */
export const SyncResponseErrorSchema = z.object({
  error: z.enum(["schema_mismatch", "internal_error"]),
  message: z.string(),
});
export type SyncResponseError = z.infer<typeof SyncResponseErrorSchema>;

// =============================================================================
// Hub -> Client Messages
// =============================================================================

/** Sent by hub to request sync data from a runner */
export const SyncRequestSchema = z.object({
  schema_version: z.number(),
  since: z.string(),
  /** Optional forwarded data from other runners (piggybacked on sync request) */
  forwards: z.record(z.string(), z.array(z.unknown())).optional(),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

/** Sent by hub to forward data from other runners */
export const ForwardDataSchema = z.object({
  has_more: z.boolean(),
  tables: z.record(z.string(), z.array(z.unknown())),
});
export type ForwardData = z.infer<typeof ForwardDataSchema>;

/** Sent by hub when there's a sync error (e.g., schema version mismatch) */
export const SyncErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type SyncError = z.infer<typeof SyncErrorSchema>;

// =============================================================================
// Remote Agent Control Messages
// =============================================================================

/** Request to start an agent on a remote host */
export const AgentStartRequestSchema = z.object({
  targetUserId: z.string(), // user_id to start
  targetHostId: z.string(), // resolved from user's host_id
  requesterId: z.string(), // user_id of requester
  task: z.string(), // task description added to context
});
export type AgentStartRequest = z.infer<typeof AgentStartRequestSchema>;

/** Response to agent start request */
export const AgentStartResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;

/** Request to stop an agent on a remote host */
export const AgentStopRequestSchema = z.object({
  targetUserId: z.string(), // user_id to stop
  targetHostId: z.string(), // resolved from user's host_id
  requesterId: z.string(), // user_id of requester (must be lead or higher)
  reason: z.string(),
});
export type AgentStopRequest = z.infer<typeof AgentStopRequestSchema>;

/** Response to agent stop request */
export const AgentStopResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type AgentStopResponse = z.infer<typeof AgentStopResponseSchema>;

/** Request to get agent logs from a remote host */
export const AgentLogRequestSchema = z.object({
  targetUserId: z.string(), // user_id to get logs for
  targetHostId: z.string(), // resolved from user's host_id
  lines: z.number().default(50), // How many lines to return
});
export type AgentLogRequest = z.infer<typeof AgentLogRequestSchema>;

/** Response to agent log request */
export const AgentLogResponseSchema = z.object({
  success: z.boolean(),
  lines: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type AgentLogResponse = z.infer<typeof AgentLogResponseSchema>;

// =============================================================================
// Runner -> Hub Request/Response Messages
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
  // Client -> Hub
  CATCH_UP: "catch_up",
  SYNC_RESPONSE: "sync_response",
  USER_LIST: "user_list",

  // Hub -> Client
  SYNC_REQUEST: "sync_request",
  FORWARD: "forward",
  SYNC_ERROR: "sync_error",

  // Internal hub events (not sent over wire)
  CLIENT_CONNECTED: "client_connected",
  CLIENT_DISCONNECTED: "client_disconnected",

  // Internal runner events (not sent over wire, local only)
  /** Raised when runner connects to a hub (before catch_up is sent) */
  HUB_CONNECTED: "hub_connected",

  // Remote agent control events (bidirectional via hub)
  AGENT_START: "agent_start",
  AGENT_STOP: "agent_stop",
  AGENT_LOG: "agent_log",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
