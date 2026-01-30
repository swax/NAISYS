import { ZodSchema } from "zod";

/**
 * Mock transport layer for integration testing the sync system.
 * Routes messages between mock HubClient (runner side) and mock HubServer (hub side)
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
  getRunnerId: () => string;
  getRunnerName: () => string;
}

/**
 * Mock HubClient interface (runner side)
 * Receives events from the hub and allows registering handlers.
 */
export interface MockHubClient {
  registerEvent: (event: string, handler: EventHandler) => void;
  unregisterEvent: (event: string, handler: EventHandler) => void;
  isConnected: () => boolean;
  /** Send a message to the hub */
  sendMessage: <T = unknown>(
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ) => boolean;
  /** Internal: raise an event (called by the bridge) */
  _raiseEvent: (event: string, ...args: unknown[]) => void;
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
    schema?: ZodSchema,
  ) => void;
  unregisterEvent: (event: string, handler: EventHandler) => void;
  sendMessage: <T = unknown>(
    runnerId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ) => boolean;
  getConnectedClients: () => MockClientConnection[];
  getConnectionByRunnerId: (
    runnerId: string,
  ) => MockClientConnection | undefined;
  getConnectionCount: () => number;
  close: () => void;
  /** Internal: raise an event (called by the bridge) */
  _raiseEvent: (event: string, runnerId: string, ...args: unknown[]) => void;
}

/**
 * A runner endpoint in the sync bridge.
 */
export interface RunnerEndpoint {
  runnerId: string;
  runnerName: string;
  hubClient: MockHubClient;
}

/**
 * SyncEventBridge connects mock HubClients and a mock HubServer.
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
        schema?: ZodSchema,
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
        runnerId: string,
        event: string,
        payload: unknown,
        ack?: AckCallback<T>,
      ): boolean => {
        const runner = runners.get(runnerId);
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

        // Deliver to runner's HubClient
        runner.hubClient._raiseEvent(event, payload, wrappedAck);
        return true;
      },

      getConnectedClients: (): MockClientConnection[] => {
        return Array.from(runners.values()).map((r) => ({
          getRunnerId: () => r.runnerId,
          getRunnerName: () => r.runnerName,
        }));
      },

      getConnectionByRunnerId: (
        runnerId: string,
      ): MockClientConnection | undefined => {
        const runner = runners.get(runnerId);
        if (!runner) return undefined;
        return {
          getRunnerId: () => runner.runnerId,
          getRunnerName: () => runner.runnerName,
        };
      },

      getConnectionCount: (): number => runners.size,

      close: () => {
        hubEventHandlers.clear();
      },

      _raiseEvent: (event: string, runnerId: string, ...args: unknown[]) => {
        const handlers = hubEventHandlers.get(event);
        if (handlers) {
          for (const { handler, schema } of handlers) {
            if (schema && args.length > 0) {
              const result = schema.safeParse(args[0]);
              if (!result.success) continue;
              handler(runnerId, result.data, ...args.slice(1));
            } else {
              handler(runnerId, ...args);
            }
          }
        }
      },
    };

    hubServer = server;
    return server;
  }

  /**
   * Create a mock HubClient for a runner.
   */
  function createMockHubClient(
    runnerId: string,
    runnerName: string,
  ): MockHubClient {
    if (runners.has(runnerId)) {
      throw new Error(`Runner ${runnerId} already exists`);
    }

    // Runner's event handlers registry
    const eventHandlers = new Map<string, Set<EventHandler>>();

    const client: MockHubClient = {
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

      isConnected: () => {
        return hubServer !== null;
      },

      sendMessage: <T = unknown>(
        event: string,
        payload: unknown,
        ack?: AckCallback<T>,
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
        hubServer._raiseEvent(event, runnerId, payload, wrappedAck);
        return true;
      },

      _raiseEvent: (event: string, ...args: unknown[]) => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          for (const handler of handlers) {
            handler(...args);
          }
        }
      },

      _triggerHubConnected: () => {
        // Raise the HUB_CONNECTED event to trigger catch_up flow
        client._raiseEvent("hub_connected");
      },
    };

    const endpoint: RunnerEndpoint = {
      runnerId,
      runnerName,
      hubClient: client,
    };
    runners.set(runnerId, endpoint);

    // Notify hub of connection
    if (hubServer) {
      hubServer._raiseEvent("client_connected", runnerId, {
        getRunnerId: () => runnerId,
        getRunnerName: () => runnerName,
      });
    }

    return client;
  }

  /**
   * Disconnect a runner from the bridge.
   */
  function disconnectRunner(runnerId: string): void {
    if (!runners.has(runnerId)) return;

    runners.delete(runnerId);

    // Notify hub of disconnection
    if (hubServer) {
      hubServer._raiseEvent("client_disconnected", runnerId);
    }
  }

  /**
   * Get all connected runner IDs.
   */
  function getConnectedRunners(): string[] {
    return Array.from(runners.keys());
  }

  /**
   * Reset the bridge - disconnect all runners and clear hub.
   */
  function reset(): void {
    for (const runnerId of runners.keys()) {
      disconnectRunner(runnerId);
    }
    runners.clear();
    hubEventHandlers.clear();
    hubServer = null;
  }

  return {
    createMockHubServer,
    createMockHubClient,
    disconnectRunner,
    getConnectedRunners,
    reset,
  };
}

export type SyncEventBridge = ReturnType<typeof createSyncEventBridge>;
