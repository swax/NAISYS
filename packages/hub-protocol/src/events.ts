/**
 * Hub Protocol Event Names
 *
 * Participants:
 *   NAISYS      – AI agent host instances (Socket.IO clients)
 *   Hub         – Central coordination server (Socket.IO server)
 *   Supervisor  – Web admin backend (Socket.IO client, canRunAgents: false)
 */

export const HubEvents = {
  // ---------------------------------------------------------------------------
  // Internal hub events (not sent over the wire)
  // ---------------------------------------------------------------------------

  /** Raised inside the hub when a Socket.IO client connects */
  CLIENT_CONNECTED: "client_connected",
  /** Raised inside the hub when a Socket.IO client disconnects */
  CLIENT_DISCONNECTED: "client_disconnected",

  // ---------------------------------------------------------------------------
  // Hub -> NAISYS push (broadcast to all connected clients)
  // ---------------------------------------------------------------------------

  /** Full user list, pushed on connect and when users change */
  USERS_UPDATED: "users_updated",
  /** Connected host topology, pushed on connect and on host changes */
  HOSTS_UPDATED: "hosts_updated",
  /** Global config (shell limits, variables, spend limits), pushed on connect and on variable changes */
  VARIABLES_UPDATED: "variables_updated",
  /** LLM and image model definitions, pushed on connect and on model changes */
  MODELS_UPDATED: "models_updated",
  /** Aggregate active-agent map and notification counters, pushed periodically and on agent changes */
  AGENTS_STATUS: "agents_status",

  // ---------------------------------------------------------------------------
  // Hub -> NAISYS push (targeted to specific host)
  // ---------------------------------------------------------------------------

  /** Spending limit enforcement, pushed to the host running the affected agent */
  COST_CONTROL: "cost_control",
  /** New mail notification, pushed to hosts running recipient agents */
  MAIL_RECEIVED: "mail_received",

  // ---------------------------------------------------------------------------
  // NAISYS -> Hub (fire-and-forget)
  // ---------------------------------------------------------------------------

  /** Periodic heartbeat with active agent user IDs */
  HEARTBEAT: "heartbeat",
  /** Batched log entries */
  LOG_WRITE: "log_write",
  /** Batched cost/token entries */
  COST_WRITE: "cost_write",

  // ---------------------------------------------------------------------------
  // NAISYS -> Hub (request/response)
  // ---------------------------------------------------------------------------

  /** Create a new run session */
  SESSION_CREATE: "session_create",
  /** Increment session within an existing run */
  SESSION_INCREMENT: "session_increment",

  // ---------------------------------------------------------------------------
  // NAISYS/Supervisor -> Hub -> target NAISYS (request/response, two-hop relay)
  // ---------------------------------------------------------------------------

  /** Start an agent on its assigned host */
  AGENT_START: "agent_start",
  /** Stop an agent on its current host */
  AGENT_STOP: "agent_stop",

  // ---------------------------------------------------------------------------
  // NAISYS/Supervisor -> Hub (request/response) – Mail
  // ---------------------------------------------------------------------------

  /** Send a mail message */
  MAIL_SEND: "mail_send",
  /** List recent mail messages */
  MAIL_LIST: "mail_list",
  /** Read a specific mail message */
  MAIL_READ: "mail_read",
  /** Archive mail messages */
  MAIL_ARCHIVE: "mail_archive",
  /** Full-text search of mail */
  MAIL_SEARCH: "mail_search",
  /** Get unread message IDs */
  MAIL_UNREAD: "mail_unread",

  // ---------------------------------------------------------------------------
  // Supervisor -> Hub (fire-and-forget, triggers broadcast)
  // ---------------------------------------------------------------------------

  /** Users changed — hub re-queries DB and broadcasts USERS_UPDATED */
  USERS_CHANGED: "users_changed",
  /** Variables changed — hub rebuilds config and broadcasts VARIABLES_UPDATED */
  VARIABLES_CHANGED: "variables_changed",
  /** Models changed — hub re-reads models and broadcasts MODELS_UPDATED */
  MODELS_CHANGED: "models_changed",
} as const;

export type HubEventName = (typeof HubEvents)[keyof typeof HubEvents];
