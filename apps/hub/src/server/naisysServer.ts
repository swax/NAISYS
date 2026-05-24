import type { DualLogger } from "@naisys/common-node";
import type {
  HostRegistered,
  HubConnectErrorCode,
  HubConnectErrorData,
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
import { HubEvents } from "@naisys/hub-protocol";
import type { Server } from "socket.io";
import type { ZodSchema } from "zod";

import type { HostRegistrar } from "../lifecycle/hostRegistrar.js";
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
  logService: DualLogger,
  hostRegistrar: HostRegistrar,
) {
  // Track connected NAISYS instances (keyed by hostId)
  const naisysConnections = new Map<number, NaisysConnection>();
  // Track connected supervisor instances (multiple allowed, all share one hostId)
  const supervisorConnections: NaisysConnection[] = [];

  type ConnectErrorWithData = Error & { data?: HubConnectErrorData };

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

  function createConnectError(
    message: string,
    code: HubConnectErrorCode,
    fatal = true,
  ): ConnectErrorWithData {
    const error = new Error(message) as ConnectErrorWithData;
    error.data = { code, fatal };
    return error;
  }

  // Authentication middleware
  nsp.use(async (socket, next) => {
    const {
      accessKey: rawAccessKey,
      instanceId: rawInstanceId,
      startedAt: rawStartedAt,
      clientVersion,
      environment: rawEnvironment,
    } = socket.handshake.auth;

    const accessKey =
      typeof rawAccessKey === "string" && rawAccessKey ? rawAccessKey : null;
    if (!accessKey) {
      logService.log(
        `[Hub] Connection rejected: missing access key from ${socket.handshake.address}`,
      );
      // Non-fatal: lets a client retry if a key was just rotated mid-flight.
      return next(
        createConnectError("Access key required", "invalid_access_key", false),
      );
    }

    try {
      const resolvedVersion =
        typeof clientVersion === "string" ? clientVersion : "";
      const instanceId =
        typeof rawInstanceId === "string" && rawInstanceId
          ? rawInstanceId
          : socket.id;
      const processStartedAt =
        typeof rawStartedAt === "number" && Number.isFinite(rawStartedAt)
          ? rawStartedAt
          : Date.now();
      const environment =
        rawEnvironment && typeof rawEnvironment === "object"
          ? (rawEnvironment as Record<string, unknown>)
          : undefined;

      const resolved = await hostRegistrar.resolveByAccessKey(accessKey);
      if (!resolved) {
        logService.log(
          `[Hub] Connection rejected: access key did not match any host (${socket.handshake.address})`,
        );
        return next(
          createConnectError(
            "Invalid access key",
            "invalid_access_key",
            false,
          ),
        );
      }

      await hostRegistrar.markActive(
        resolved,
        socket.handshake.address,
        resolvedVersion,
        environment,
      );

      // Supersede any existing naisys connection for this host (supervisors may have multiple).
      // The disconnect handler is identity-aware, so the old socket's cleanup
      // will not wipe the new connection once it registers.
      if (resolved.hostType === "naisys") {
        const existing = naisysConnections.get(resolved.hostId);
        if (existing) {
          if (existing.getInstanceId() === instanceId) {
            logService.log(
              `[Hub] Replacing existing socket for host '${resolved.hostName}' from the same process instance`,
            );
            existing.disconnect();
          } else if (processStartedAt >= existing.getProcessStartedAt()) {
            logService.log(
              `[Hub] Superseding existing connection for host '${resolved.hostName}' — newer process instance connected`,
            );
            existing.disconnect();
          } else {
            logService.log(
              `[Hub] Connection rejected: older process attempted to reclaim host '${resolved.hostName}'`,
            );
            return next(
              createConnectError(
                "Superseded by newer NAISYS instance",
                "superseded_by_newer_instance",
              ),
            );
          }
        }
      }

      socket.data.hostId = resolved.hostId;
      socket.data.hostName = resolved.hostName;
      socket.data.instanceId = instanceId;
      socket.data.processStartedAt = processStartedAt;
      socket.data.hostType = resolved.hostType;
      socket.data.clientVersion = resolvedVersion;
      next();
    } catch (err) {
      logService.error(
        `[Hub] Connection rejected: registration failed: ${err}`,
      );
      // Non-fatal: registration touches the DB and can hit transient failures
      // (pool timeout, deadlock); let the client keep retrying.
      return next(
        createConnectError(
          "NAISYS instance registration failed",
          "registration_failed",
          false,
        ),
      );
    }
  });

  // Handle new connections
  nsp.on("connection", (socket) => {
    const {
      hostId,
      hostName,
      instanceId,
      processStartedAt,
      hostType,
      clientVersion,
    } = socket.data;

    // Send the client its resolved identity so it can label itself in topology updates
    const registered: HostRegistered = { hostId, hostName };
    socket.emit(HubEvents.HOST_REGISTERED, registered);

    // Create connection handler for this socket, passing our emit function
    const connection = createNaisysConnection(
      socket,
      {
        hostId,
        hostName,
        connectedAt: new Date(),
        instanceId,
        processStartedAt,
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
      let superseded = false;
      if (hostType === "supervisor") {
        const idx = supervisorConnections.indexOf(connection);
        if (idx !== -1) supervisorConnections.splice(idx, 1);
      } else if (naisysConnections.get(hostId) === connection) {
        naisysConnections.delete(hostId);
      } else {
        // A newer connection replaced us; skip the disconnect broadcast so
        // downstream services don't clear state belonging to the live socket.
        superseded = true;
      }

      if (!superseded) {
        raiseEvent("client_disconnected", hostId);
      }
      logService.log(
        `[Hub] Active connections: naisys=${naisysConnections.size}, supervisors=${supervisorConnections.length}`,
      );
    });
  });

  /** Disconnect every connection currently bound to the given host id */
  function disconnectHost(hostId: number) {
    const naisys = naisysConnections.get(hostId);
    naisys?.disconnect();
    for (const conn of supervisorConnections) {
      if (conn.getHostId() === hostId) {
        conn.disconnect();
      }
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
    getSupervisorConnections: () => supervisorConnections.slice(),
    getConnectionByHostId: (hostId: number) => naisysConnections.get(hostId),
    getConnectionCount: () => naisysConnections.size,
    getSupervisorConnectionCount: () => supervisorConnections.length,
    disconnectHost,
  };
}

export type NaisysServer = ReturnType<typeof createNaisysServer>;
