import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";
import { createHubConnection, HubConnection } from "./hubConnection.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (hubUrl: string, ...args: any[]) => void;

export async function createHubManager(
  globalConfig: GlobalConfig,
  hostService: HostService,
  hubClientLog: HubClientLog
) {
  const config = globalConfig.globalConfig();
  const hubConnections: HubConnection[] = [];

  // Generic event handlers registry - maps event name to set of handlers
  const eventHandlers = new Map<string, Set<EventHandler>>();

  await init();

  async function init() {
    if (config.hubUrls.length === 0) {
      hubClientLog.write(
        "[HubManager] No HUB_URLS configured, running in standalone mode"
      );
      return;
    }

    hubClientLog.write(
      `[HubManager] Starting connections to ${config.hubUrls.length} hub(s)...`
    );
    for (const hubUrl of config.hubUrls) {
      const hubConnection = createHubConnection(
        hubUrl,
        hubClientLog,
        globalConfig,
        hostService,
        raiseEvent
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

  function isMultiMachineMode() {
    return config.hubUrls.length > 0;
  }

  return {
    getConnectedHubs,
    isMultiMachineMode,
    registerEvent,
    unregisterEvent,
  };
}

export type HubManager = Awaited<ReturnType<typeof createHubManager>>;
