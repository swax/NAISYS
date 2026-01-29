import {
  AgentLogRequest,
  AgentLogResponse,
  AgentStartRequest,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubManager } from "./hubManager.js";

/** Timeout for remote agent operations (30 seconds) */
const REMOTE_OPERATION_TIMEOUT_MS = 30000;

/** Base response type for remote operations */
interface RemoteResponse {
  success: boolean;
  error?: string;
}

/**
 * Sends remote agent control requests through the hub.
 * This service handles the request side of remote agent operations.
 */
export function createRemoteAgentRequester(hubManager: HubManager) {
  /**
   * Generic helper to send a request through the hub and await response.
   */
  async function sendRequest<TReq, TRes extends RemoteResponse, TResult>(
    event: string,
    request: TReq,
    targetUsername: string,
    operation: string,
    onSuccess: (response: TRes) => TResult,
  ): Promise<TResult> {
    if (!hubManager.isConnected()) {
      throw new Error(
        `Cannot ${operation} remote agent '${targetUsername}' - no hub connection available`,
      );
    }

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout: ${operation} remote agent '${targetUsername}'`),
        );
      }, REMOTE_OPERATION_TIMEOUT_MS);

      const sent = hubManager.sendMessage<TRes>(
        event,
        request,
        (response) => {
          clearTimeout(timeout);
          if (response.success) {
            resolve(onSuccess(response));
          } else {
            reject(
              new Error(
                response.error ||
                  `Failed to ${operation} remote agent '${targetUsername}'`,
              ),
            );
          }
        },
      );

      if (!sent) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Failed to send ${operation} request for remote agent '${targetUsername}'`,
          ),
        );
      }
    });
  }

  /**
   * Start an agent on a remote host.
   */
  async function startAgent(
    targetUserId: string,
    targetHostId: string,
    requesterId: string,
    task: string,
    targetUsername: string,
    targetHostName: string | null,
  ): Promise<string> {
    const request: AgentStartRequest = {
      targetUserId,
      targetHostId,
      requesterId,
      task,
    };

    const hostSuffix = targetHostName ? `@${targetHostName}` : "";
    return sendRequest<AgentStartRequest, AgentStartResponse, string>(
      HubEvents.AGENT_START,
      request,
      targetUsername,
      "start",
      () => `Remote agent '${targetUsername}${hostSuffix}' started`,
    );
  }

  /**
   * Stop an agent on a remote host.
   */
  async function stopAgent(
    targetUserId: string,
    targetHostId: string,
    requesterId: string,
    reason: string,
    targetUsername: string,
    targetHostName: string | null,
  ): Promise<string> {
    const request: AgentStopRequest = {
      targetUserId,
      targetHostId,
      requesterId,
      reason,
    };

    const hostSuffix = targetHostName ? `@${targetHostName}` : "";
    return sendRequest<AgentStopRequest, AgentStopResponse, string>(
      HubEvents.AGENT_STOP,
      request,
      targetUsername,
      "stop",
      () => `Remote agent '${targetUsername}${hostSuffix}' stop requested`,
    );
  }

  /**
   * Get log lines from an agent on a remote host.
   */
  async function getAgentLog(
    targetUserId: string,
    targetHostId: string,
    lines: number,
    targetUsername: string,
  ): Promise<string[]> {
    const request: AgentLogRequest = {
      targetUserId,
      targetHostId,
      lines,
    };

    return sendRequest<AgentLogRequest, AgentLogResponse, string[]>(
      HubEvents.AGENT_LOG,
      request,
      targetUsername,
      "get logs for",
      (response) => response.lines || [],
    );
  }

  /**
   * Check if hub connections are available for remote operations.
   */
  function isAvailable(): boolean {
    return hubManager.isConnected();
  }

  return {
    startAgent,
    stopAgent,
    getAgentLog,
    isAvailable,
  };
}

export type RemoteAgentRequester = ReturnType<
  typeof createRemoteAgentRequester
>;
