import { ZodSchema } from "zod";

/**
 * Mock transport layer for integration testing the sync system.
 * Routes messages between mock HubManager (runner side) and mock HubServer (hub side)
 * without actual WebSocket connections.
 */

 
type EventHandler = (...args: any[]) => void;
type AckCallback<T = unknown> = (response: T) => void;

/** Registered handler with optional schema for validation */
interface RegisteredHandler {
  handler: EventHandler;
  schema?: ZodSchema;
}

/**
 * Mock client connection info (used by HubServer)
 */
export interface MockClientConnection {
  getHostId: () => string;
  getHostname: () => string;
}

/**
 * Mock HubManager interface (runner side)
 * Receives events from the hub and allows registering handlers.
 */
export interface MockHubManager {
  registerEvent: (event: string, handler: EventHandler) => void;
  unregisterEvent: (event: string, handler: EventHandler) => void;
  getConnectedHubs: () => { hubUrl: string }[];
  isMultiMachineMode: () => boolean;
  /** Send a message to a hub (for catch_up, etc.) */
  sendMessage: <T = unknown>(
    hubUrl: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>
  ) => boolean;
  /** Internal: raise an event (called by the bridge) */
  _raiseEvent: (event: string, hubUrl: string, ...args: unknown[]) => void;
  /** Internal: trigger HUB_CONNECTED event (simulates socket connect) */
  _triggerHubConnected: () => void;
}

/**
 * Mock HubServer interface (hub side)
 * Sends messages to clients and manages connections.
 */
export interface MockHubServer {
  registerEvent: (
    event: string,
    handler: EventHandler,
    schema?: ZodSchema
  ) => void;
  unregisterEvent: (event: string, handler: EventHandler) => void;
  sendMessage: <T = unknown>(
    hostId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>
  ) => boolean;
  getConnectedClients: () => MockClientConnection[];
  getConnectionByHostId: (hostId: string) => MockClientConnection | undefined;
  getConnectionCount: () => number;
  close: () => void;
  /** Internal: raise an event (called by the bridge) */
  _raiseEvent: (event: string, hostId: string, ...args: unknown[]) => void;
}

/**
 * A runner endpoint in the sync bridge.
 */
export interface RunnerEndpoint {
  hostId: string;
  hostname: string;
  hubManager: MockHubManager;
}

/**
 * SyncEventBridge connects mock HubManagers and a mock HubServer.
 * Allows testing the full sync flow without actual network.
 */
export function createSyncEventBridge() {
  const runners = new Map<string, RunnerEndpoint>();
  let hubServer: MockHubServer | null = null;

  // Hub event handlers registry
  const hubEventHandlers = new Map<string, Set<RegisteredHandler>>();

  /**
   * Create the mock HubServer (hub side)
   */
  function createMockHubServer(): MockHubServer {
    if (hubServer) {
      throw new Error("HubServer already created");
    }

    const server: MockHubServer = {
      registerEvent: (
        event: string,
        handler: EventHandler,
        schema?: ZodSchema
      ) => {
        if (!hubEventHandlers.has(event)) {
          hubEventHandlers.set(event, new Set());
        }
        hubEventHandlers.get(event)!.add({ handler, schema });
      },

      unregisterEvent: (event: string, handler: EventHandler) => {
        const handlers = hubEventHandlers.get(event);
        if (handlers) {
          for (const registered of handlers) {
            if (registered.handler === handler) {
              handlers.delete(registered);
              break;
            }
          }
        }
      },

      sendMessage: <T = unknown>(
        hostId: string,
        event: string,
        payload: unknown,
        ack?: AckCallback<T>
      ): boolean => {
        const runner = runners.get(hostId);
        if (!runner) {
          return false;
        }

        // Wrap ack to be async-safe
        const wrappedAck = ack
          ? (response: unknown) => {
              // Use setImmediate to simulate async network response
              setImmediate(() => ack(response as T));
            }
          : undefined;

        // Deliver to runner's HubManager
        runner.hubManager._raiseEvent(event, "mock-hub", payload, wrappedAck);
        return true;
      },

      getConnectedClients: (): MockClientConnection[] => {
        return Array.from(runners.values()).map((r) => ({
          getHostId: () => r.hostId,
          getHostname: () => r.hostname,
        }));
      },

      getConnectionByHostId: (
        hostId: string
      ): MockClientConnection | undefined => {
        const runner = runners.get(hostId);
        if (!runner) return undefined;
        return {
          getHostId: () => runner.hostId,
          getHostname: () => runner.hostname,
        };
      },

      getConnectionCount: (): number => runners.size,

      close: () => {
        hubEventHandlers.clear();
      },

      _raiseEvent: (event: string, hostId: string, ...args: unknown[]) => {
        const handlers = hubEventHandlers.get(event);
        if (handlers) {
          for (const { handler, schema } of handlers) {
            if (schema && args.length > 0) {
              const result = schema.safeParse(args[0]);
              if (!result.success) continue;
              handler(hostId, result.data, ...args.slice(1));
            } else {
              handler(hostId, ...args);
            }
          }
        }
      },
    };

    hubServer = server;
    return server;
  }

  /**
   * Create a mock HubManager for a runner.
   */
  function createMockHubManager(
    hostId: string,
    hostname: string
  ): MockHubManager {
    if (runners.has(hostId)) {
      throw new Error(`Runner ${hostId} already exists`);
    }

    // Runner's event handlers registry
    const eventHandlers = new Map<string, Set<EventHandler>>();

    const manager: MockHubManager = {
      registerEvent: (event: string, handler: EventHandler) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(handler);
      },

      unregisterEvent: (event: string, handler: EventHandler) => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          handlers.delete(handler);
        }
      },

      getConnectedHubs: () => {
        return hubServer ? [{ hubUrl: "mock-hub" }] : [];
      },

      isMultiMachineMode: () => true,

      sendMessage: <T = unknown>(
        _hubUrl: string,
        event: string,
        payload: unknown,
        ack?: AckCallback<T>
      ): boolean => {
        if (!hubServer) {
          return false;
        }

        // Wrap ack to be async-safe
        const wrappedAck = ack
          ? (response: unknown) => {
              setImmediate(() => ack(response as T));
            }
          : undefined;

        // Deliver to hub's event handlers
        hubServer._raiseEvent(event, hostId, payload, wrappedAck);
        return true;
      },

      _raiseEvent: (event: string, hubUrl: string, ...args: unknown[]) => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          for (const handler of handlers) {
            handler(hubUrl, ...args);
          }
        }
      },

      _triggerHubConnected: () => {
        // Raise the HUB_CONNECTED event to trigger catch_up flow
        manager._raiseEvent("hub_connected", "mock-hub");
      },
    };

    const endpoint: RunnerEndpoint = { hostId, hostname, hubManager: manager };
    runners.set(hostId, endpoint);

    // Notify hub of connection
    if (hubServer) {
      hubServer._raiseEvent("client_connected", hostId, {
        getHostId: () => hostId,
        getHostname: () => hostname,
      });
    }

    return manager;
  }

  /**
   * Disconnect a runner from the bridge.
   */
  function disconnectRunner(hostId: string): void {
    if (!runners.has(hostId)) return;

    runners.delete(hostId);

    // Notify hub of disconnection
    if (hubServer) {
      hubServer._raiseEvent("client_disconnected", hostId);
    }
  }

  /**
   * Get all connected runner host IDs.
   */
  function getConnectedRunners(): string[] {
    return Array.from(runners.keys());
  }

  /**
   * Reset the bridge - disconnect all runners and clear hub.
   */
  function reset(): void {
    for (const hostId of runners.keys()) {
      disconnectRunner(hostId);
    }
    runners.clear();
    hubEventHandlers.clear();
    hubServer = null;
  }

  return {
    createMockHubServer,
    createMockHubManager,
    disconnectRunner,
    getConnectedRunners,
    reset,
  };
}

export type SyncEventBridge = ReturnType<typeof createSyncEventBridge>;
