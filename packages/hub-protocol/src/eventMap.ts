/**
 * Typed event map for hub protocol events.
 *
 * Maps each event name to its payload types so that registerEvent, sendMessage,
 * and sendRequest can enforce correct signatures at compile time.
 */

import type { HubEvents } from "./events.js";
import type {
  AgentPeekRequest,
  AgentPeekResponse,
  AgentStartRequest,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopResponse,
} from "./schemas/agents.js";
import type { ConfigResponse } from "./schemas/config.js";
import type { CostControl,CostWriteRequest } from "./schemas/costs.js";
import type { AgentsStatus,Heartbeat } from "./schemas/heartbeat.js";
import type { HostList } from "./schemas/hosts.js";
import type { LogWriteRequest } from "./schemas/logs.js";
import type {
  MailArchiveRequest,
  MailArchiveResponse,
  MailListRequest,
  MailListResponse,
  MailMarkReadRequest,
  MailMarkReadResponse,
  MailPeekRequest,
  MailPeekResponse,
  MailSearchRequest,
  MailSearchResponse,
  MailSendRequest,
  MailSendResponse,
  MailUnreadRequest,
  MailUnreadResponse,
} from "./schemas/mail.js";
import type { MailReceivedPush } from "./schemas/mail.js";
import type { ModelsResponse } from "./schemas/models.js";
import type {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionIncrementRequest,
  SessionIncrementResponse,
} from "./schemas/sessions.js";
import type { UserListResponse } from "./schemas/users.js";

// ---------------------------------------------------------------------------
// Request/response events (use sendRequest / ack callback)
// ---------------------------------------------------------------------------

/** Events that follow a request → response pattern via Socket.IO ack */
export interface HubRequestEvents {
  [HubEvents.AGENT_START]: {
    request: AgentStartRequest;
    response: AgentStartResponse;
  };
  [HubEvents.AGENT_STOP]: {
    request: AgentStopRequest;
    response: AgentStopResponse;
  };
  [HubEvents.AGENT_PEEK]: {
    request: AgentPeekRequest;
    response: AgentPeekResponse;
  };
  [HubEvents.SESSION_CREATE]: {
    request: SessionCreateRequest;
    response: SessionCreateResponse;
  };
  [HubEvents.SESSION_INCREMENT]: {
    request: SessionIncrementRequest;
    response: SessionIncrementResponse;
  };
  [HubEvents.MAIL_SEND]: {
    request: MailSendRequest;
    response: MailSendResponse;
  };
  [HubEvents.MAIL_LIST]: {
    request: MailListRequest;
    response: MailListResponse;
  };
  [HubEvents.MAIL_PEEK]: {
    request: MailPeekRequest;
    response: MailPeekResponse;
  };
  [HubEvents.MAIL_MARK_READ]: {
    request: MailMarkReadRequest;
    response: MailMarkReadResponse;
  };
  [HubEvents.MAIL_ARCHIVE]: {
    request: MailArchiveRequest;
    response: MailArchiveResponse;
  };
  [HubEvents.MAIL_SEARCH]: {
    request: MailSearchRequest;
    response: MailSearchResponse;
  };
  [HubEvents.MAIL_UNREAD]: {
    request: MailUnreadRequest;
    response: MailUnreadResponse;
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget events (NAISYS → Hub, no ack)
// ---------------------------------------------------------------------------

/** Events sent from NAISYS to Hub with no response expected */
export interface HubFireAndForgetEvents {
  [HubEvents.HEARTBEAT]: Heartbeat;
  [HubEvents.LOG_WRITE]: LogWriteRequest;
  [HubEvents.COST_WRITE]: CostWriteRequest;
}

// ---------------------------------------------------------------------------
// Push events (Hub → NAISYS, no ack)
// ---------------------------------------------------------------------------

/** Events pushed from Hub to NAISYS clients */
export interface HubPushEvents {
  [HubEvents.USERS_UPDATED]: UserListResponse;
  [HubEvents.HOSTS_UPDATED]: HostList;
  [HubEvents.VARIABLES_UPDATED]: ConfigResponse;
  [HubEvents.MODELS_UPDATED]: ModelsResponse;
  [HubEvents.AGENTS_STATUS]: AgentsStatus;
  [HubEvents.COST_CONTROL]: CostControl;
  [HubEvents.MAIL_RECEIVED]: MailReceivedPush;
}

// ---------------------------------------------------------------------------
// Trigger events (Supervisor → Hub, no payload, triggers broadcast)
// ---------------------------------------------------------------------------

/** Events from Supervisor that trigger hub-side refresh + broadcast */
export interface HubTriggerEvents {
  [HubEvents.USERS_CHANGED]: void;
  [HubEvents.VARIABLES_CHANGED]: void;
  [HubEvents.MODELS_CHANGED]: void;
  [HubEvents.HOSTS_CHANGED]: void;
}

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

export type HubRequestEventName = keyof HubRequestEvents;
export type HubFireAndForgetEventName = keyof HubFireAndForgetEvents;
export type HubPushEventName = keyof HubPushEvents;
export type HubTriggerEventName = keyof HubTriggerEvents;

// ---------------------------------------------------------------------------
// Socket.IO typed event maps for supervisor connections
// ---------------------------------------------------------------------------

/** Events the supervisor listens for (hub → supervisor push events) */
export type SupervisorListenEvents = {
  [E in HubPushEventName]: (data: HubPushEvents[E]) => void;
};

/** Events the supervisor emits (supervisor → hub) */
export type SupervisorEmitEvents = {
  [E in HubRequestEventName]: (
    data: HubRequestEvents[E]["request"],
    ack: (response: HubRequestEvents[E]["response"]) => void,
  ) => void;
} & {
  [E in HubTriggerEventName]: () => void;
};
