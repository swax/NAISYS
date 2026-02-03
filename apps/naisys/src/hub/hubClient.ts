import table from "text-table";
import { GlobalConfig } from "../globalConfig.js";
import { HubClientLog } from "./hubClientLog.js";
import { createHubConnection, HubConnection } from "./hubConnection.js";

/** Hub connection status info */
export interface HubConnectionInfo {
  url: string;
  connected: boolean;
}

/** Per-URL status for the ns-hubs debug command */
export interface HubUrlStatus {
  url: string;
  active: boolean;
  connected: boolean;
  lastError?: string;
}

type EventHandler = (...args: any[]) => void;

/** Delay before rotating to the next fallback URL */
const ROTATION_DELAY_MS = 2000;

export function createHubClient(
  globalConfig: GlobalConfig,
  hubClientLog: HubClientLog,
) {
  const config = globalConfig.globalConfig();
  const hubUrls = config.hubUrls;
  let currentUrlIndex = 0;
  let activeConnection: HubConnection | null = null;
  let reconnectionDisabled = false;
  let connectedHandler: (() => void) | null = null;
  let connectErrorHandler: ((message: string) => void) | null = null;

  // Track last error per URL index for status reporting
  const urlErrors = new Map<number, string>();

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  init();

  function init() {
    if (hubUrls.length === 0) {
      hubClientLog.write(
        "[HubClient] No HUB_URLS configured, running in standalone mode",
      );
      return;
    }

    if (hubUrls.length === 1) {
      hubClientLog.write(`[HubClient] Connecting to hub: ${hubUrls[0]}`);
    } else {
      hubClientLog.write(
        `[HubClient] Connecting to hub with ${hubUrls.length} fallback URL(s)...`,
      );
    }

    connectToUrl(hubUrls[currentUrlIndex]);
  }

  function connectToUrl(url: string) {
    activeConnection = createHubConnection(
      url,
      hubClientLog,
      globalConfig,
      raiseEvent,
      handleConnected,
      handleReconnectFailed,
      handleConnectError,
    );
    activeConnection.connect();
  }

  function handleConnected() {
    hubClientLog.disableConsole();
    urlErrors.delete(currentUrlIndex);
    connectedHandler?.();
  }

  function handleConnectError(message: string) {
    urlErrors.set(currentUrlIndex, message);
    connectErrorHandler?.(message);
  }

  function handleReconnectFailed() {
    if (reconnectionDisabled) return;

    // Disconnect old connection cleanly
    activeConnection?.disconnect();

    // Rotate to next URL (round-robin)
    currentUrlIndex = (currentUrlIndex + 1) % hubUrls.length;
    const nextUrl = hubUrls[currentUrlIndex];
    hubClientLog.write(`[HubClient] Rotating to hub URL: ${nextUrl}`);

    setTimeout(() => {
      if (!reconnectionDisabled) {
        connectToUrl(nextUrl);
      }
    }, ROTATION_DELAY_MS);
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
    if (hubUrls.length === 0) {
      return Promise.resolve();
    }
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
          reconnectionDisabled = true;
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

  function getHubsStatus(): HubUrlStatus[] {
    return hubUrls.map((url, index) => ({
      url,
      active: index === currentUrlIndex,
      connected: index === currentUrlIndex && isConnected(),
      lastError: urlErrors.get(index),
    }));
  }

  return {
    // RegistrableCommand
    commandName: "ns-hubs",
    helpText: "Show hub connection status",
    isDebug: true,
    handleCommand: async () => {
      const statuses = getHubsStatus();
      if (statuses.length === 0) {
        return "No hub URLs configured.";
      }

      const headers = ["URL", "Active", "Connected", "Last Error"];
      const rows = statuses.map((s) => [
        s.url,
        s.active ? "*" : "",
        s.connected ? "Yes" : "No",
        s.lastError || "",
      ]);

      return table([headers, ...rows], { hsep: " | " });
    },

    // HubClient API
    getConnectionInfo,
    getHubsStatus,
    isConnected,
    waitForConnection,
    registerEvent,
    unregisterEvent,
    sendMessage,
    sendRequest,
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
