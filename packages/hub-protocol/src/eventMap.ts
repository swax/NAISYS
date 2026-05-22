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
  AgentRunCommandRequest,
  AgentRunCommandResponse,
  AgentRunPauseRequest,
  AgentRunPauseResponse,
  AgentStartDispatch,
  AgentStartInbound,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopResponse,
  RuntimeKeyReissue,
  ScheduleTriggerRequest,
  ScheduleTriggerResponse,
} from "./schemas/agents/agents.js";
import type { AgentsStatus, Heartbeat } from "./schemas/agents/heartbeat.js";
import type {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionHeartbeat,
  SessionIncrementRequest,
  SessionIncrementResponse,
} from "./schemas/agents/sessions.js";
import type {
  CostControl,
  CostPush,
  CostWriteRequest,
  CostWriteResponse,
} from "./schemas/comms/costs.js";
import type { LogPush, LogWriteRequest } from "./schemas/comms/logs.js";
import type {
  MailArchiveRequest,
  MailArchiveResponse,
  MailListRequest,
  MailListResponse,
  MailMarkReadRequest,
  MailMarkReadResponse,
  MailPeekRequest,
  MailPeekResponse,
  MailPush,
  MailReadPush,
  MailReceivedPush,
  MailSearchRequest,
  MailSearchResponse,
  MailSendRequest,
  MailSendResponse,
  MailUnreadRequest,
  MailUnreadResponse,
} from "./schemas/comms/mail.js";
import type {
  RotateAccessKeyRequest,
  RotateAccessKeyResponse,
} from "./schemas/identity/admin.js";
import type {
  CodexAccessTokenRequest,
  CodexAccessTokenResponse,
} from "./schemas/identity/codex.js";
import type { UserListResponse } from "./schemas/identity/users.js";
import type { ConfigResponse } from "./schemas/infra/config.js";
import type {
  HostList,
  HostRegistered,
  HostTerminateRequest,
  HostTerminateResponse,
} from "./schemas/infra/hosts.js";
import type { ModelsResponse } from "./schemas/infra/models.js";

// ---------------------------------------------------------------------------
// Request/response events (use sendRequest / ack callback)
// ---------------------------------------------------------------------------

/** Events that follow a request → response pattern via Socket.IO ack */
export interface HubRequestEvents {
  // Bidirectional: inbound to hub, dispatch out to host. Schemas enforce per-direction shape.
  [HubEvents.AGENT_START]: {
    request: AgentStartInbound | AgentStartDispatch;
    response: AgentStartResponse;
  };
  [HubEvents.AGENT_STOP]: {
    request: AgentStopRequest;
    response: AgentStopResponse;
  };
  [HubEvents.AGENT_RUN_PAUSE]: {
    request: AgentRunPauseRequest;
    response: AgentRunPauseResponse;
  };
  [HubEvents.AGENT_RUN_RESUME]: {
    request: AgentRunPauseRequest;
    response: AgentRunPauseResponse;
  };
  [HubEvents.AGENT_RUN_COMMAND]: {
    request: AgentRunCommandRequest;
    response: AgentRunCommandResponse;
  };
  [HubEvents.AGENT_PEEK]: {
    request: AgentPeekRequest;
    response: AgentPeekResponse;
  };
  [HubEvents.HOST_TERMINATE]: {
    request: HostTerminateRequest;
    response: HostTerminateResponse;
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
  [HubEvents.ROTATE_ACCESS_KEY]: {
    request: RotateAccessKeyRequest;
    response: RotateAccessKeyResponse;
  };
  [HubEvents.SCHEDULE_TRIGGER]: {
    request: ScheduleTriggerRequest;
    response: ScheduleTriggerResponse;
  };
  [HubEvents.COST_WRITE]: {
    request: CostWriteRequest;
    response: CostWriteResponse;
  };
  [HubEvents.CODEX_ACCESS_TOKEN_GET]: {
    request: CodexAccessTokenRequest;
    response: CodexAccessTokenResponse;
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget events (NAISYS → Hub, no ack)
// ---------------------------------------------------------------------------

/** Events sent from NAISYS to Hub with no response expected */
export interface HubFireAndForgetEvents {
  [HubEvents.HEARTBEAT]: Heartbeat;
  [HubEvents.LOG_WRITE]: LogWriteRequest;
}

// ---------------------------------------------------------------------------
// Push events (Hub → NAISYS, no ack)
// ---------------------------------------------------------------------------

/** Events pushed from Hub to NAISYS clients */
export interface HubPushEvents {
  [HubEvents.USERS_UPDATED]: UserListResponse;
  [HubEvents.HOST_REGISTERED]: HostRegistered;
  [HubEvents.HOSTS_UPDATED]: HostList;
  [HubEvents.VARIABLES_UPDATED]: ConfigResponse;
  [HubEvents.MODELS_UPDATED]: ModelsResponse;
  [HubEvents.AGENTS_STATUS]: AgentsStatus;
  [HubEvents.COST_CONTROL]: CostControl;
  [HubEvents.MAIL_RECEIVED]: MailReceivedPush;
  [HubEvents.RUNTIME_KEY_REISSUE]: RuntimeKeyReissue;
}

// ---------------------------------------------------------------------------
// Supervisor-only push events (Hub → Supervisor, no ack)
// ---------------------------------------------------------------------------

/** Events pushed from Hub to Supervisor connections only */
export interface HubSupervisorPushEvents {
  [HubEvents.LOG_PUSH]: LogPush;
  [HubEvents.MAIL_PUSH]: MailPush;
  [HubEvents.MAIL_READ_PUSH]: MailReadPush;
  [HubEvents.COST_PUSH]: CostPush;
  [HubEvents.SESSION_HEARTBEAT]: SessionHeartbeat;
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
export type HubSupervisorPushEventName = keyof HubSupervisorPushEvents;
export type HubTriggerEventName = keyof HubTriggerEvents;

// ---------------------------------------------------------------------------
// Socket.IO typed event maps for supervisor connections
// ---------------------------------------------------------------------------

/** Events the supervisor listens for (hub → supervisor push events) */
export type SupervisorListenEvents = {
  [E in HubPushEventName]: (data: HubPushEvents[E]) => void;
} & {
  [E in HubSupervisorPushEventName]: (data: HubSupervisorPushEvents[E]) => void;
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
