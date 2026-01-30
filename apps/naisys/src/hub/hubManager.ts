import { GlobalConfig } from "../globalConfig.js";
import { HubClientLog } from "./hubClientLog.js";
import { createHubConnection, HubConnection } from "./hubConnection.js";

/** Hub connection status info */
export interface HubConnectionInfo {
  url: string;
  connected: boolean;
}

type EventHandler = (...args: any[]) => void;

/** Delay before rotating to the next fallback URL */
const ROTATION_DELAY_MS = 2000;

export function createHubManager(
  globalConfig: GlobalConfig,
  hubClientLog: HubClientLog,
) {
  const config = globalConfig.globalConfig();
  const hubUrls = config.hubUrls;
  let currentUrlIndex = 0;
  let activeConnection: HubConnection | null = null;
  let reconnectionDisabled = false;

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  init();

  function init() {
    if (hubUrls.length === 0) {
      hubClientLog.write(
        "[HubManager] No HUB_URLS configured, running in standalone mode",
      );
      return;
    }

    if (hubUrls.length === 1) {
      hubClientLog.write(`[HubManager] Connecting to hub: ${hubUrls[0]}`);
    } else {
      hubClientLog.write(
        `[HubManager] Connecting to hub with ${hubUrls.length} fallback URL(s)...`,
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
      handleReconnectFailed,
    );
    activeConnection.connect();
  }

  function handleReconnectFailed() {
    if (reconnectionDisabled) return;

    // Disconnect old connection cleanly
    activeConnection?.disconnect();

    // Rotate to next URL (round-robin)
    currentUrlIndex = (currentUrlIndex + 1) % hubUrls.length;
    const nextUrl = hubUrls[currentUrlIndex];
    hubClientLog.write(`[HubManager] Rotating to hub URL: ${nextUrl}`);

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

  /**
   * Send a message to the active hub connection.
   * @param event - Event name
   * @param payload - Message payload
   * @param ack - Optional callback for acknowledgement
   * @returns true if message was sent, false if not connected
   */
  function sendMessage<T = unknown>(
    event: string,
    payload: unknown,
    ack?: (response: T) => void,
  ): boolean {
    if (!activeConnection) {
      hubClientLog.write("[HubManager] No active connection for sendMessage");
      return false;
    }
    return activeConnection.sendMessage(event, payload, ack);
  }

  function getConnectionInfo(): HubConnectionInfo | null {
    if (!activeConnection) return null;
    return {
      url: activeConnection.getUrl(),
      connected: activeConnection.isConnected(),
    };
  }

  return {
    getConnectionInfo,
    isConnected,
    registerEvent,
    unregisterEvent,
    sendMessage,
  };
}

export type HubManager = ReturnType<typeof createHubManager>;
