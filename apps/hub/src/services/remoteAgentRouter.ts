import {
  AgentLogRequestSchema,
  AgentLogResponseSchema,
  AgentStartRequestSchema,
  AgentStartResponseSchema,
  AgentStopRequestSchema,
  AgentStopResponseSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubServer } from "./hubServer.js";
import { HubServerLog } from "./hubServerLog.js";

/** Base type for requests with target host info */
interface RemoteRequest {
  targetUserId: string;
  targetHostId: string;
}

/** Base type for responses */
interface RemoteResponse {
  success: boolean;
  error?: string;
}

/**
 * Handles remote agent control requests.
 * Routes start/stop/log requests from one runner to another via the hub.
 */
export function createRemoteAgentRouter(
  hubServer: HubServer,
  logService: HubServerLog
) {
  init();

  function init() {
    hubServer.registerEvent(HubEvents.AGENT_START, (hostId, data, ack) =>
      forwardRequest("start", hostId, data, ack, AgentStartRequestSchema, AgentStartResponseSchema, HubEvents.AGENT_START)
    );
    hubServer.registerEvent(HubEvents.AGENT_STOP, (hostId, data, ack) =>
      forwardRequest("stop", hostId, data, ack, AgentStopRequestSchema, AgentStopResponseSchema, HubEvents.AGENT_STOP)
    );
    hubServer.registerEvent(HubEvents.AGENT_LOG, (hostId, data, ack) =>
      forwardRequest("log", hostId, data, ack, AgentLogRequestSchema, AgentLogResponseSchema, HubEvents.AGENT_LOG)
    );

    logService.log("[RemoteAgent] Remote control service started");
  }

  /**
   * Generic handler that validates, routes, and forwards remote control requests.
   */
  function forwardRequest<TRes extends RemoteResponse>(
    operation: string,
    sourceHostId: string,
    rawData: unknown,
    ack: ((response: TRes) => void) | undefined,
    requestSchema: { safeParse: (data: unknown) => { success: boolean; data?: RemoteRequest; error?: { issues: unknown } } },
    responseSchema: { safeParse: (data: unknown) => { success: boolean; data?: TRes; error?: { issues: unknown } } },
    event: string
  ) {
    const errorResponse = { success: false } as TRes;

    // Validate request
    const result = requestSchema.safeParse(rawData);
    if (!result.success) {
      logService.error(
        `[RemoteAgent] Invalid agent ${operation} request from ${sourceHostId}: ${JSON.stringify(result.error?.issues)}`
      );
      ack?.({ ...errorResponse, error: "Invalid request format" });
      return;
    }

    const data = result.data!;

    logService.log(
      `[RemoteAgent] Agent ${operation} request from ${sourceHostId} for user ${data.targetUserId} on host ${data.targetHostId}`
    );

    // Check if target host is the same as source
    if (data.targetHostId === sourceHostId) {
      logService.log(`[RemoteAgent] Target host is source host, should be handled locally`);
      ack?.({ ...errorResponse, error: "Target host is source host - handle locally" });
      return;
    }

    // Check if target host is connected
    if (!hubServer.getConnectionByHostId(data.targetHostId)) {
      logService.log(`[RemoteAgent] Target host ${data.targetHostId} not connected`);
      ack?.({ ...errorResponse, error: `Target host ${data.targetHostId} not connected` });
      return;
    }

    // Forward the request to the target host
    const sent = hubServer.sendMessage<TRes>(
      data.targetHostId,
      event,
      data,
      (rawResponse: unknown) => {
        const respResult = responseSchema.safeParse(rawResponse);
        if (!respResult.success) {
          logService.error(
            `[RemoteAgent] Invalid agent ${operation} response from ${data.targetHostId}: ${JSON.stringify(respResult.error?.issues)}`
          );
          ack?.({ ...errorResponse, error: "Invalid response from target host" });
          return;
        }

        logService.log(
          `[RemoteAgent] Agent ${operation} response from ${data.targetHostId}: success=${respResult.data!.success}`
        );
        ack?.(respResult.data!);
      }
    );

    if (!sent) {
      logService.log(`[RemoteAgent] Failed to send agent ${operation} request to ${data.targetHostId}`);
      ack?.({ ...errorResponse, error: "Failed to send request to target host" });
    }
  }

  return {};
}

export type RemoteAgentRouter = ReturnType<typeof createRemoteAgentRouter>;
