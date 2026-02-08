import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { HubClientConfig } from "./hubClientConfig.js";
import { HubClientLog } from "./hubClientLog.js";
import { createHubConnection, HubConnection } from "./hubConnection.js";

/** Hub connection status info */
export interface HubConnectionInfo {
  url: string;
  connected: boolean;
}

type EventHandler = (...args: any[]) => void;

export function createHubClient(
  hubClientConfig: HubClientConfig,
  hubClientLog: HubClientLog,
  promptNotification: PromptNotificationService,
) {
  const hubUrl = hubClientConfig.hubUrl;
  let activeConnection: HubConnection | null = null;
  let hasConnectedOnce = false;
  let disconnectNotified = false;
  let connectedHandler: (() => void) | null = null;
  let connectErrorHandler: ((message: string) => void) | null = null;

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  init();

  function init() {
    hubClientLog.write(`[HubClient] Connecting to hub: ${hubUrl}`);
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
        wake: true,
        commentOutput: ["Hub connection re-established"],
      });
    }
    hasConnectedOnce = true;
    disconnectNotified = false;
  }

  function handleConnectError(message: string) {
    connectErrorHandler?.(message);
  }

  function handleDisconnected() {
    if (hasConnectedOnce && !disconnectNotified) {
      disconnectNotified = true;
      promptNotification.notify({
        wake: true,
        commentOutput: ["Hub connection lost"],
      });
    }
  }

  /** Register an event handler */
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
  function sendMessage(event: string, payload: unknown): boolean {
    if (!activeConnection) {
      hubClientLog.write("[HubClient] No active connection for sendMessage");
      return false;
    }
    activeConnection.sendMessage(event, payload);
    return true;
  }

  /** Send a message to the hub and await a response via ack */
  function sendRequest<T = unknown>(
    event: string,
    payload: unknown,
  ): Promise<T> {
    if (!activeConnection) {
      hubClientLog.write("[HubClient] No active connection for sendRequest");
      return Promise.reject(new Error("No active hub connection"));
    }

    return new Promise<T>((resolve, reject) => {
      const sent = activeConnection!.sendMessage<T>(
        event,
        payload,
        (response: T) => resolve(response),
      );

      if (!sent) {
        reject(new Error("Failed to send request - not connected"));
      }
    });
  }

  /** Auth error messages from the hub that won't be fixed by retrying */
  const AUTH_ERRORS = ["Invalid access key", "Missing hostName"];

  /** Returns a promise that resolves once a hub connection is established,
   *  or rejects if connection fails due to an auth/config error */
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

      connectErrorHandler = (message: string) => {
        if (AUTH_ERRORS.some((err) => message.includes(err))) {
          cleanup();
          activeConnection?.disconnect();
          reject(new Error(`Hub connection rejected: ${message}`));
        }
      };
    });
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
    commandName: "ns-hub",
    helpText: "Show hub connection status",
    isDebug: true,
    handleCommand: () =>
      `${hubUrl} - ${isConnected() ? "Connected" : "Disconnected"}`,

    // HubClient API
    getConnectionInfo,
    isConnected,
    waitForConnection,
    registerEvent,
    unregisterEvent,
    sendMessage,
    sendRequest,
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
