import { HubConfig } from "../hubConfig.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";
import { createHubConnection, HubConnection } from "./hubConnection.js";

/** Hub connection status info */
export interface HubConnectionInfo {
  url: string;
  connected: boolean;
}

type EventHandler = (hubUrl: string, ...args: any[]) => void;

export function createInterhubManager(
  hubConfig: HubConfig,
  hostService: HostService,
  hubClientLog: HubClientLog,
) {
  const config = hubConfig.hubConfig();
  const hubConnections: HubConnection[] = [];

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  init();

  function init() {
    if (config.interhubUrls.length === 0) {
      hubClientLog.write(
        "[HubManager] No INTERHUB_URLS configured, running without hub-to-hub federation",
      );
      return;
    }

    hubClientLog.write(
      `[HubManager] Starting connections to ${config.interhubUrls.length} hub(s)...`,
    );
    for (const hubUrl of config.interhubUrls) {
      const hubConnection = createHubConnection(
        hubUrl,
        hubClientLog,
        hubConfig,
        hostService,
        raiseEvent,
      );

      hubConnections.push(hubConnection);
      hubConnection.connect();
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
  function raiseEvent(event: string, hubUrl: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(hubUrl, ...args);
      }
    }
  }

  function getConnectedHubs() {
    return hubConnections.filter((c) => c.isConnected());
  }

  function isInterhubMode() {
    return config.interhubUrls.length > 0;
  }

  /**
   * Send a message to a specific hub by URL.
   * @param hubUrl - Hub URL to send to
   * @param event - Event name
   * @param payload - Message payload
   * @param ack - Optional callback for acknowledgement
   * @returns true if message was sent, false if hub not found or not connected
   */
  function sendMessage<T = unknown>(
    hubUrl: string,
    event: string,
    payload: unknown,
    ack?: (response: T) => void,
  ): boolean {
    const connection = hubConnections.find((c) => c.getUrl() === hubUrl);
    if (!connection) {
      hubClientLog.write(
        `[HubManager] Hub ${hubUrl} not found for sendMessage`,
      );
      return false;
    }
    return connection.sendMessage(event, payload, ack);
  }

  function getAllHubs(): HubConnectionInfo[] {
    return hubConnections.map((c) => ({
      url: c.getUrl(),
      connected: c.isConnected(),
    }));
  }

  /**
   * Disable reconnection for a specific hub. Used for fatal sync errors.
   */
  function disableReconnection(hubUrl: string, reason: string): boolean {
    const connection = hubConnections.find((c) => c.getUrl() === hubUrl);
    if (!connection) {
      return false;
    }
    connection.disableReconnection(reason);
    return true;
  }

  return {
    getAllHubs,
    getConnectedHubs,
    isInterhubMode,
    registerEvent,
    unregisterEvent,
    sendMessage,
    disableReconnection,
  };
}

export type InterhubManager = ReturnType<typeof createInterhubManager>;
