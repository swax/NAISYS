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
  lastReceived: z.string().nullable(),
});
export type CatchUpRequest = z.infer<typeof CatchUpRequestSchema>;

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
// Event Names (for type-safe event handling)
// =============================================================================

export const HubEvents = {
  // Client -> Hub
  CATCH_UP: "catch_up",
  SYNC_RESPONSE: "sync_response",

  // Hub -> Client
  SYNC_REQUEST: "sync_request",
  FORWARD: "forward",
  SYNC_ERROR: "sync_error",

  // Internal hub events (not sent over wire)
  CLIENT_CONNECTED: "client_connected",
  CLIENT_DISCONNECTED: "client_disconnected",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
