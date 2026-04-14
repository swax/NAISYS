import type {
  HostType,
  HubFireAndForgetEventName,
  HubFireAndForgetEvents,
  HubPushEventName,
  HubPushEvents,
  HubRequestEventName,
  HubRequestEvents,
  HubSupervisorPushEventName,
  HubSupervisorPushEvents,
  HubTriggerEventName,
} from "@naisys/hub-protocol";
import type { Server } from "socket.io";
import type { ZodSchema } from "zod";

import type { HostRegistrar } from "./hostRegistrar.js";
import type { HubServerLog } from "./hubServerLog.js";
import type { NaisysConnection } from "./naisysConnection.js";
import { createNaisysConnection } from "./naisysConnection.js";

type EventHandler = (hostId: number, ...args: any[]) => void;

/** Internal hub-only events (not part of the wire protocol) */
export interface HubInternalEvents {
  client_connected: NaisysConnection;
  client_disconnected: void;
}

/** Registered handler with optional schema for validation */
interface RegisteredHandler {
  handler: EventHandler;
  schema?: ZodSchema;
}

/**
 * Creates the NAISYS namespace server that accepts NAISYS instance connections.
 */
export function createNaisysServer(
  nsp: Server,
  initialHubAccessKey: string,
  logService: HubServerLog,
  hostRegistrar: HostRegistrar,
) {
  let hubAccessKey = initialHubAccessKey;
  // Track connected NAISYS instances (keyed by hostId)
  const naisysConnections = new Map<number, NaisysConnection>();
  // Track connected supervisor instances (multiple allowed, all share one hostId)
  const supervisorConnections: NaisysConnection[] = [];

  // Generic event handlers registry - maps event name to set of registered handlers
  const eventHandlers = new Map<string, Set<RegisteredHandler>>();

  // Register an event handler with optional schema for validation
  function registerEvent<E extends HubFireAndForgetEventName>(
    event: E,
    handler: (hostId: number, data: HubFireAndForgetEvents[E]) => void,
    schema?: ZodSchema,
  ): void;
  function registerEvent<E extends HubRequestEventName>(
    event: E,
    handler: (
      hostId: number,
      data: HubRequestEvents[E]["request"],
      ack: (response: HubRequestEvents[E]["response"]) => void,
    ) => void,
    schema?: ZodSchema,
  ): void;
  function registerEvent<E extends HubTriggerEventName>(
    event: E,
    handler: (hostId: number) => void,
  ): void;
  function registerEvent<E extends keyof HubInternalEvents>(
    event: E,
    handler: HubInternalEvents[E] extends void
      ? (hostId: number) => void
      : (hostId: number, data: HubInternalEvents[E]) => void,
  ): void;
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
  function sendMessage<E extends HubPushEventName>(
    hostId: number,
    event: E,
    payload: HubPushEvents[E],
  ): boolean;
  function sendMessage<E extends HubSupervisorPushEventName>(
    hostId: number,
    event: E,
    payload: HubSupervisorPushEvents[E],
  ): boolean;
  function sendMessage<E extends HubRequestEventName>(
    hostId: number,
    event: E,
    payload: HubRequestEvents[E]["request"],
    ack: AckCallback<HubRequestEvents[E]["response"]>,
  ): boolean;
  function sendMessage(
    hostId: number,
    event: string,
    payload: unknown,
    ack?: AckCallback,
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
      hostType: rawHostType,
      clientVersion,
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
      const hostType = (
        typeof rawHostType === "string" ? rawHostType : "naisys"
      ) as HostType;
      const resolvedVersion =
        typeof clientVersion === "string" ? clientVersion : "";
      const hostId = await hostRegistrar.registerHost(
        hostName,
        hostType,
        socket.handshake.address,
        resolvedVersion,
      );

      // Reject duplicate naisys connections (supervisors may have multiple)
      if (hostType === "naisys" && naisysConnections.has(hostId)) {
        logService.log(
          `[Hub] Connection rejected: host '${hostName}' is already connected`,
        );
        return next(
          new Error(`Host '${hostName}' already has an active connection`),
        );
      }

      socket.data.hostId = hostId;
      socket.data.hostName = hostName;
      socket.data.hostType = hostType;
      socket.data.clientVersion = resolvedVersion;
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
    const { hostId, hostName, hostType, clientVersion } = socket.data;

    // Create connection handler for this socket, passing our emit function
    const connection = createNaisysConnection(
      socket,
      {
        hostId,
        hostName,
        connectedAt: new Date(),
        hostType,
        clientVersion,
      },
      raiseEvent,
      logService,
    );

    if (hostType === "supervisor") {
      supervisorConnections.push(connection);
    } else {
      naisysConnections.set(hostId, connection);
    }

    raiseEvent("client_connected", hostId, connection);

    logService.log(
      `[Hub] Active connections: naisys=${naisysConnections.size}, supervisors=${supervisorConnections.length}`,
    );

    // Clean up on disconnect
    socket.on("disconnect", () => {
      if (hostType === "supervisor") {
        const idx = supervisorConnections.indexOf(connection);
        if (idx !== -1) supervisorConnections.splice(idx, 1);
      } else {
        naisysConnections.delete(hostId);
      }
      raiseEvent("client_disconnected", hostId);
      logService.log(
        `[Hub] Active connections: naisys=${naisysConnections.size}, supervisors=${supervisorConnections.length}`,
      );
    });
  });

  /** Update the hub access key used for authenticating new connections */
  function updateHubAccessKey(newKey: string) {
    hubAccessKey = newKey;
  }

  /** Disconnect all connected clients */
  function disconnectAllClients() {
    for (const connection of naisysConnections.values()) {
      connection.disconnect();
    }
    for (const connection of supervisorConnections) {
      connection.disconnect();
    }
  }

  /** Broadcast an event to all supervisor connections */
  function broadcastToSupervisors<E extends HubSupervisorPushEventName>(
    event: E,
    payload: HubSupervisorPushEvents[E],
  ) {
    for (const conn of supervisorConnections) {
      conn.sendMessage(event, payload);
    }
  }

  /** Broadcast an event to all connections (naisys + supervisors) */
  function broadcastToAll<E extends HubPushEventName>(
    event: E,
    payload: HubPushEvents[E],
  ) {
    for (const conn of naisysConnections.values()) {
      conn.sendMessage(event, payload);
    }
    for (const conn of supervisorConnections) {
      conn.sendMessage(event, payload);
    }
  }

  // Return control interface
  return {
    registerEvent,
    unregisterEvent,
    sendMessage,
    broadcastToSupervisors,
    broadcastToAll,
    getConnectedClients: () => Array.from(naisysConnections.values()),
    getConnectionByHostId: (hostId: number) => naisysConnections.get(hostId),
    getConnectionCount: () => naisysConnections.size,
    getSupervisorConnectionCount: () => supervisorConnections.length,
    updateHubAccessKey,
    disconnectAllClients,
  };
}

export type NaisysServer = ReturnType<typeof createNaisysServer>;
