import type { DualLogger } from "@naisys/common-node";
import type {
  HubFireAndForgetEventName,
  HubFireAndForgetEvents,
  HubPushEventName,
  HubPushEvents,
  HubRequestEventName,
  HubRequestEvents,
} from "@naisys/hub-protocol";

import { hubCmd } from "../command/commandDefs.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import type { HubClientConfig } from "./hubClientConfig.js";
import type { HubConnectErrorInfo, HubConnection } from "./hubConnection.js";
import { createHubConnection } from "./hubConnection.js";

/** Hub connection status info */
export interface HubConnectionInfo {
  url: string;
  connected: boolean;
}

type EventHandler = (...args: any[]) => void;

/** Upper bound on any request/response round-trip. Without this, a socket
 *  drop mid-request leaves the ack callback dangling and the promise hangs
 *  forever — the agent stalls instead of erroring out and retrying. */
const REQUEST_TIMEOUT_MS = 30_000;

export function createHubClient(
  hubClientConfig: HubClientConfig,
  hubClientLog: DualLogger,
  promptNotification: PromptNotificationService,
) {
  const hubUrl = hubClientConfig.hubUrl;
  let activeConnection: HubConnection | null = null;
  let hasConnectedOnce = false;
  let disconnectNotified = false;
  let connectedHandler: (() => void) | null = null;
  let connectErrorHandler: ((error: HubConnectErrorInfo) => void) | null = null;

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  init();

  function init() {
    connect();
  }

  function connect() {
    activeConnection = createHubConnection(
      hubClientConfig,
      hubClientLog,
      raiseEvent,
      handleConnected,
      handleDisconnected,
      handleConnectError,
    );
    activeConnection.connect();
  }

  function handleConnected() {
    // Output to the console on startup that we're connecting, suppress further logs, we'll use the prompt service for that
    hubClientLog.disableConsole();
    connectedHandler?.();

    if (hasConnectedOnce) {
      promptNotification.notify({
        wake: "always",
        commentOutput: ["Hub connection re-established"],
      });
    }
    hasConnectedOnce = true;
    disconnectNotified = false;
  }

  function handleConnectError(error: HubConnectErrorInfo) {
    connectErrorHandler?.(error);

    if (error.data?.fatal) {
      activeConnection?.disconnect();

      if (hasConnectedOnce) {
        promptNotification.notify({
          wake: "always",
          errorOutput: [getUserFacingConnectError(error)],
        });
      }
    }
  }

  function handleDisconnected() {
    if (hasConnectedOnce && !disconnectNotified) {
      disconnectNotified = true;
      promptNotification.notify({
        wake: "always",
        errorOutput: ["Hub connection lost"],
      });
    }
  }

  /** Register an event handler */
  function registerEvent<E extends HubPushEventName>(
    event: E,
    handler: (data: HubPushEvents[E]) => void,
  ): void;
  function registerEvent<E extends HubRequestEventName>(
    event: E,
    handler: (
      data: HubRequestEvents[E]["request"],
      ack: (response: HubRequestEvents[E]["response"]) => void,
    ) => void,
  ): void;
  function registerEvent(event: string, handler: EventHandler) {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    eventHandlers.get(event)!.add(handler);
  }

  /** Unregister an event handler */
  function unregisterEvent(event: string, handler: EventHandler) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /** Raise an event to all registered handlers */
  function raiseEvent(event: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  function isConnected() {
    return activeConnection?.isConnected() ?? false;
  }

  /** Send a fire-and-forget message to the hub */
  function sendMessage<E extends HubFireAndForgetEventName>(
    event: E,
    payload: HubFireAndForgetEvents[E],
  ): boolean;
  function sendMessage(event: string, payload: unknown): boolean {
    if (!activeConnection) {
      hubClientLog.log(
        "[NAISYS:HubClient] No active connection for sendMessage",
      );
      return false;
    }
    activeConnection.sendMessage(event, payload);
    return true;
  }

  /** Send a message to the hub and await a response via ack */
  function sendRequest<E extends HubRequestEventName>(
    event: E,
    payload: HubRequestEvents[E]["request"],
  ): Promise<HubRequestEvents[E]["response"]>;
  function sendRequest(event: string, payload: unknown): Promise<unknown> {
    if (!activeConnection) {
      hubClientLog.log(
        "[NAISYS:HubClient] No active connection for sendRequest",
      );
      return Promise.reject(new Error("No active hub connection"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `Hub request '${event}' timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      const sent = activeConnection!.sendMessage(
        event,
        payload,
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(response);
        },
      );

      if (!sent && !settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Failed to send request - not connected"));
      }
    });
  }

  /** Returns a promise that resolves once a hub connection is established,
   *  or rejects if the handshake fails with a fatal structured connect error */
  function waitForConnection(): Promise<void> {
    if (isConnected()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      function cleanup() {
        connectedHandler = null;
        connectErrorHandler = null;
      }

      connectedHandler = () => {
        cleanup();
        resolve();
      };

      connectErrorHandler = (error: HubConnectErrorInfo) => {
        if (error.data?.fatal) {
          cleanup();
          reject(new Error(getUserFacingConnectError(error)));
        }
      };
    });
  }

  function getUserFacingConnectError(error: HubConnectErrorInfo): string {
    switch (error.data?.code) {
      case "superseded_by_newer_instance":
        return "This NAISYS instance was superseded by a newer local process.";
      case "invalid_access_key":
        return "Hub access key was rejected by the server.";
      case "missing_host_name":
        return "Hub connection rejected: missing host name.";
      case "registration_failed":
        return `Hub rejected host registration: ${error.message}`;
      default:
        return `Hub connection failed: ${error.message}`;
    }
  }

  function getConnectionInfo(): HubConnectionInfo | null {
    if (!activeConnection) return null;
    return {
      url: activeConnection.getUrl(),
      connected: activeConnection.isConnected(),
    };
  }

  return {
    // RegistrableCommand
    command: hubCmd,
    handleCommand: () =>
      `${hubUrl} - ${isConnected() ? "Connected" : "Disconnected"}`,

    // HubClient API
    getConnectionInfo,
    getHubUrl: () => hubUrl,
    isConnected,
    waitForConnection,
    registerEvent,
    unregisterEvent,
    sendMessage,
    sendRequest,
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
