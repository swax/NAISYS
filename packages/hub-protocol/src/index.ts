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
  userId: z.number(),
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

// =============================================================================
// Cost Control Messages (Hub -> NAISYS, push)
// =============================================================================

/** Pushed from hub to NAISYS when an agent's cost-based spending status changes */
export const CostControlSchema = z.object({
  userId: z.number(),
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
  activeUserIds: z.array(z.number()),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

/** Sent by hub to NAISYS instances with aggregate active user IDs */
export const HeartbeatStatusSchema = z.object({
  hostActiveAgents: z.record(z.string(), z.array(z.number())),
});
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusSchema>;

// =============================================================================
// Host List Messages (Hub -> NAISYS, push on connect/disconnect changes)
// =============================================================================

/** Pushed from hub to all NAISYS instances when the set of known hosts changes */
export const HostListSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.number(),
      hostName: z.string(),
      online: z.boolean(),
    }),
  ),
});
export type HostList = z.infer<typeof HostListSchema>;

// =============================================================================
// Agent Start Messages (NAISYS -> Hub -> target NAISYS, request/response)
// =============================================================================

/** Request to start an agent on its assigned host */
export const AgentStartRequestSchema = z.object({
  userId: z.number(),
  taskDescription: z.string(),
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
        userId: z.number(),
        username: z.string(),
        leadUserId: z.number().optional(),
        configYaml: z.string(),
        assignedHostIds: z.array(z.number()).optional(),
      }),
    )
    .optional(),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// =============================================================================
// Mail Messages (NAISYS -> Hub request/response)
// =============================================================================

/** Request to send a mail message */
export const MailSendRequestSchema = z.object({
  fromUserId: z.number(),
  toUsernames: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
});
export type MailSendRequest = z.infer<typeof MailSendRequestSchema>;

/** Response to mail send request */
export const MailSendResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type MailSendResponse = z.infer<typeof MailSendResponseSchema>;

/** Request to list mail messages */
export const MailListRequestSchema = z.object({
  userId: z.number(),
  filter: z.enum(["received", "sent"]).optional(),
});
export type MailListRequest = z.infer<typeof MailListRequestSchema>;

/** A single message in a mail list response */
export const MailListMessageDataSchema = z.object({
  id: z.number(),
  fromUsername: z.string(),
  recipientUsernames: z.array(z.string()),
  subject: z.string(),
  createdAt: z.string(),
  isUnread: z.boolean(),
});
export type MailListMessageData = z.infer<typeof MailListMessageDataSchema>;

/** Response to mail list request */
export const MailListResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(MailListMessageDataSchema).optional(),
  error: z.string().optional(),
});
export type MailListResponse = z.infer<typeof MailListResponseSchema>;

/** Request to read a specific mail message */
export const MailReadRequestSchema = z.object({
  userId: z.number(),
  messageId: z.number(),
});
export type MailReadRequest = z.infer<typeof MailReadRequestSchema>;

/** Full message data returned when reading a message */
export const MailReadMessageDataSchema = z.object({
  id: z.number(),
  subject: z.string(),
  fromUsername: z.string(),
  fromTitle: z.string(),
  recipientUsernames: z.array(z.string()),
  createdAt: z.string(),
  body: z.string(),
});
export type MailReadMessageData = z.infer<typeof MailReadMessageDataSchema>;

/** Response to mail read request */
export const MailReadResponseSchema = z.object({
  success: z.boolean(),
  message: MailReadMessageDataSchema.optional(),
  error: z.string().optional(),
});
export type MailReadResponse = z.infer<typeof MailReadResponseSchema>;

/** Request to archive mail messages */
export const MailArchiveRequestSchema = z.object({
  userId: z.number(),
  messageIds: z.array(z.number()),
});
export type MailArchiveRequest = z.infer<typeof MailArchiveRequestSchema>;

/** Response to mail archive request */
export const MailArchiveResponseSchema = z.object({
  success: z.boolean(),
  archivedIds: z.array(z.number()).optional(),
  error: z.string().optional(),
});
export type MailArchiveResponse = z.infer<typeof MailArchiveResponseSchema>;

/** Request to search mail messages */
export const MailSearchRequestSchema = z.object({
  userId: z.number(),
  terms: z.string(),
  includeArchived: z.boolean().optional(),
  subjectOnly: z.boolean().optional(),
});
export type MailSearchRequest = z.infer<typeof MailSearchRequestSchema>;

/** A single message in a mail search response */
export const MailSearchMessageDataSchema = z.object({
  id: z.number(),
  subject: z.string(),
  fromUsername: z.string(),
  createdAt: z.string(),
});
export type MailSearchMessageData = z.infer<typeof MailSearchMessageDataSchema>;

/** Response to mail search request */
export const MailSearchResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(MailSearchMessageDataSchema).optional(),
  error: z.string().optional(),
});
export type MailSearchResponse = z.infer<typeof MailSearchResponseSchema>;

/** Request to get unread message IDs */
export const MailUnreadRequestSchema = z.object({
  userId: z.number(),
});
export type MailUnreadRequest = z.infer<typeof MailUnreadRequestSchema>;

/** Response to unread message request */
export const MailUnreadResponseSchema = z.object({
  success: z.boolean(),
  messageIds: z.array(z.number()).optional(),
  error: z.string().optional(),
});
export type MailUnreadResponse = z.infer<typeof MailUnreadResponseSchema>;

/** Push notification from hub to NAISYS when mail is received */
export const MailReceivedPushSchema = z.object({
  recipientUserIds: z.array(z.number()),
});
export type MailReceivedPush = z.infer<typeof MailReceivedPushSchema>;

// =============================================================================
// Config Messages (Hub -> NAISYS, push on connect)
// =============================================================================

/** Pushed from hub to NAISYS instances on connect with global config */
export const ConfigResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  config: z
    .object({
      shellCommand: z.object({
        outputTokenMax: z.number(),
        timeoutSeconds: z.number(),
        maxTimeoutSeconds: z.number(),
      }),
      retrySecondsMax: z.number(),
      webTokenMax: z.number(),
      compactSessionEnabled: z.boolean(),
      localLlmUrl: z.string().optional(),
      localLlmName: z.string().optional(),
      openaiApiKey: z.string().optional(),
      googleApiKey: z.string().optional(),
      anthropicApiKey: z.string().optional(),
      googleSearchEngineId: z.string().optional(),
      spendLimitDollars: z.number().optional(),
      spendLimitHours: z.number().optional(),
      useToolsForLlmConsoleResponses: z.boolean(),
    })
    .optional(),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

// =============================================================================
// Event Names (for type-safe event handling)
// =============================================================================

export const HubEvents = {
  // Hub -> Client
  USER_LIST: "user_list",
  HOST_LIST: "host_list",
  CONFIG: "config",

  // Internal hub events (not sent over wire)
  CLIENT_CONNECTED: "client_connected",
  CLIENT_DISCONNECTED: "client_disconnected",

  // Internal NAISYS events (not sent over wire, local only)
  /** Raised when NAISYS instance connects to a hub */
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

  // Mail events (NAISYS -> Hub request/response)
  MAIL_SEND: "mail_send",
  MAIL_LIST: "mail_list",
  MAIL_READ: "mail_read",
  MAIL_ARCHIVE: "mail_archive",
  MAIL_SEARCH: "mail_search",
  MAIL_UNREAD: "mail_unread",

  // Mail events (Hub -> NAISYS, push)
  MAIL_RECEIVED: "mail_received",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
