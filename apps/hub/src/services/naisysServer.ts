import { Namespace } from "socket.io";
import { ZodSchema } from "zod";
import { HubServerLog } from "./hubServerLog.js";
import {
  createNaisysConnection,
  NaisysConnection,
} from "./naisysConnection.js";
import { HostRegistrar } from "./hostRegistrar.js";

type EventHandler = (hostId: number, ...args: any[]) => void;

/** Registered handler with optional schema for validation */
interface RegisteredHandler {
  handler: EventHandler;
  schema?: ZodSchema;
}

/**
 * Creates the NAISYS namespace server that accepts NAISYS instance connections.
 */
export function createNaisysServer(
  nsp: Namespace,
  hubAccessKey: string,
  logService: HubServerLog,
  hostRegistrar: HostRegistrar,
) {
  // Track connected NAISYS instances
  const naisysConnections = new Map<number, NaisysConnection>();

  // Generic event handlers registry - maps event name to set of registered handlers
  const eventHandlers = new Map<string, Set<RegisteredHandler>>();

  // Register an event handler with optional schema for validation
  function registerEvent(
    event: string,
    handler: EventHandler,
    schema?: ZodSchema,
  ) {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    eventHandlers.get(event)!.add({ handler, schema });
  }

  // Unregister an event handler
  function unregisterEvent(event: string, handler: EventHandler) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const registered of handlers) {
        if (registered.handler === handler) {
          handlers.delete(registered);
          break;
        }
      }
    }
  }

  // Emit an event to all registered handlers, validating data if schema provided
  function raiseEvent(event: string, hostId: number, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const { handler, schema } of handlers) {
        // If schema is provided and we have data, validate it
        if (schema && args.length > 0) {
          const result = schema.safeParse(args[0]);
          if (!result.success) {
            logService.error(
              `[Hub] Schema validation failed for event '${event}' from ${hostId}: ${JSON.stringify(result.error.issues)}`,
            );
            continue; // Skip this handler if validation fails
          }
          // Call handler with validated data
          handler(hostId, result.data, ...args.slice(1));
        } else {
          handler(hostId, ...args);
        }
      }
    }
  }

  /** Callback type for acknowledgements */
  type AckCallback<T = unknown> = (response: T) => void;

  /**
   * Send an event to a specific client by hostId.
   * If ack callback is provided, waits for client acknowledgement.
   */
  function sendMessage<P, T = unknown>(
    hostId: number,
    event: string,
    payload: P,
    ack?: AckCallback<T>,
  ): boolean {
    const connection = naisysConnections.get(hostId);
    if (!connection) {
      return false;
    }
    connection.sendMessage(event, payload, ack);
    return true;
  }

  // Authentication middleware
  nsp.use(async (socket, next) => {
    const {
      hubAccessKey: clientAccessKey,
      hostName,
      canRunAgents,
    } = socket.handshake.auth;

    if (!clientAccessKey || clientAccessKey !== hubAccessKey) {
      logService.log(
        `[Hub] Connection rejected: invalid access key from ${socket.handshake.address}`,
      );
      return next(new Error("Invalid access key"));
    }

    if (!hostName) {
      logService.log(`[Hub] Connection rejected: missing hostName`);
      return next(new Error("Missing hostName"));
    }

    try {
      const hostId = await hostRegistrar.registerHost(hostName);

      // Reject if this host already has an active connection
      if (naisysConnections.has(hostId)) {
        logService.log(
          `[Hub] Connection rejected: host '${hostName}' is already connected`,
        );
        return next(
          new Error(`Host '${hostName}' already has an active connection`),
        );
      }

      socket.data.hostId = hostId;
      socket.data.hostName = hostName;
      socket.data.canRunAgents = canRunAgents !== false;
      next();
    } catch (err) {
      logService.error(
        `[Hub] Connection rejected: failed to register host ${hostName}: ${err}`,
      );
      return next(new Error("NAISYS instance registration failed"));
    }
  });

  // Handle new connections
  nsp.on("connection", (socket) => {
    const { hostId, hostName } = socket.data;

    // Create connection handler for this socket, passing our emit function
    const naisysConnection = createNaisysConnection(
      socket,
      {
        hostId,
        hostName,
        connectedAt: new Date(),
        canRunAgents: socket.data.canRunAgents,
      },
      raiseEvent,
      logService,
    );

    naisysConnections.set(hostId, naisysConnection);
    raiseEvent("client_connected", hostId, naisysConnection);

    logService.log(`[Hub] Active connections: ${naisysConnections.size}`);

    // Clean up on disconnect
    socket.on("disconnect", () => {
      naisysConnections.delete(hostId);
      raiseEvent("client_disconnected", hostId);
      logService.log(`[Hub] Active connections: ${naisysConnections.size}`);
    });
  });

  // Return control interface
  return {
    registerEvent,
    unregisterEvent,
    sendMessage,
    getConnectedClients: () => Array.from(naisysConnections.values()),
    getConnectionByHostId: (hostId: number) => naisysConnections.get(hostId),
    getConnectionCount: () => naisysConnections.size,
  };
}

export type NaisysServer = ReturnType<typeof createNaisysServer>;
