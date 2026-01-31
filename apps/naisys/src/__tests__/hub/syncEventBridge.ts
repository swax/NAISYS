import { ZodSchema } from "zod";

/**
 * Mock transport layer for integration testing the sync system.
 * Routes messages between mock HubClient (NAISYS instance side) and mock HubServer (hub side)
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
  getHostName: () => string;
}

/**
 * Mock HubClient interface (NAISYS instance side)
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
    hostId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ) => boolean;
  getConnectedClients: () => MockClientConnection[];
  getConnectionByHostId: (
    hostId: string,
  ) => MockClientConnection | undefined;
  getConnectionCount: () => number;
  close: () => void;
  /** Internal: raise an event (called by the bridge) */
  _raiseEvent: (event: string, hostId: string, ...args: unknown[]) => void;
}

/**
 * A NAISYS instance endpoint in the sync bridge.
 */
export interface NaisysEndpoint {
  hostId: string;
  hostName: string;
  hubClient: MockHubClient;
}

/**
 * SyncEventBridge connects mock HubClients and a mock HubServer.
 * Allows testing the full sync flow without actual network.
 */
export function createSyncEventBridge() {
  const naisysInstances = new Map<string, NaisysEndpoint>();
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
        hostId: string,
        event: string,
        payload: unknown,
        ack?: AckCallback<T>,
      ): boolean => {
        const naisysInstance = naisysInstances.get(hostId);
        if (!naisysInstance) {
          return false;
        }

        // Wrap ack to be async-safe
        const wrappedAck = ack
          ? (response: unknown) => {
              // Use setImmediate to simulate async network response
              setImmediate(() => ack(response as T));
            }
          : undefined;

        // Deliver to NAISYS instance's HubClient
        naisysInstance.hubClient._raiseEvent(event, payload, wrappedAck);
        return true;
      },

      getConnectedClients: (): MockClientConnection[] => {
        return Array.from(naisysInstances.values()).map((r) => ({
          getHostId: () => r.hostId,
          getHostName: () => r.hostName,
        }));
      },

      getConnectionByHostId: (
        hostId: string,
      ): MockClientConnection | undefined => {
        const naisysInstance = naisysInstances.get(hostId);
        if (!naisysInstance) return undefined;
        return {
          getHostId: () => naisysInstance.hostId,
          getHostName: () => naisysInstance.hostName,
        };
      },

      getConnectionCount: (): number => naisysInstances.size,

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
   * Create a mock HubClient for a NAISYS instance.
   */
  function createMockHubClient(
    hostId: string,
    hostName: string,
  ): MockHubClient {
    if (naisysInstances.has(hostId)) {
      throw new Error(`NAISYS instance ${hostId} already exists`);
    }

    // NAISYS instance's event handlers registry
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
        hubServer._raiseEvent(event, hostId, payload, wrappedAck);
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

    const endpoint: NaisysEndpoint = {
      hostId,
      hostName,
      hubClient: client,
    };
    naisysInstances.set(hostId, endpoint);

    // Notify hub of connection
    if (hubServer) {
      hubServer._raiseEvent("client_connected", hostId, {
        getHostId: () => hostId,
        getHostName: () => hostName,
      });
    }

    return client;
  }

  /**
   * Disconnect a NAISYS instance from the bridge.
   */
  function disconnectNaisysInstance(hostId: string): void {
    if (!naisysInstances.has(hostId)) return;

    naisysInstances.delete(hostId);

    // Notify hub of disconnection
    if (hubServer) {
      hubServer._raiseEvent("client_disconnected", hostId);
    }
  }

  /**
   * Get all connected NAISYS instance IDs.
   */
  function getConnectedNaisysInstances(): string[] {
    return Array.from(naisysInstances.keys());
  }

  /**
   * Reset the bridge - disconnect all NAISYS instances and clear hub.
   */
  function reset(): void {
    for (const hostId of naisysInstances.keys()) {
      disconnectNaisysInstance(hostId);
    }
    naisysInstances.clear();
    hubEventHandlers.clear();
    hubServer = null;
  }

  return {
    createMockHubServer,
    createMockHubClient,
    disconnectNaisysInstance,
    getConnectedNaisysInstances,
    reset,
  };
}

export type SyncEventBridge = ReturnType<typeof createSyncEventBridge>;
