import { Namespace, Socket } from "socket.io";
import { HubServerLog } from "../services/hubServerLog.js";

type EventHandler = (hostId: string, ...args: any[]) => void;

/**
 * Creates the interhub namespace server that accepts incoming hub-to-hub connections.
 */
export function createInterhubServer(
  nsp: Namespace,
  accessKey: string,
  logService: HubServerLog,
) {
  // Track connected hubs by hostId
  const hubConnections = new Map<string, Socket>();

  // Generic event handlers registry
  const eventHandlers = new Map<string, Set<EventHandler>>();

  function registerEvent(event: string, handler: EventHandler) {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    eventHandlers.get(event)!.add(handler);
  }

  function unregisterEvent(event: string, handler: EventHandler) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  function raiseEvent(event: string, hostId: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(hostId, ...args);
      }
    }
  }

  /** Callback type for acknowledgements */
  type AckCallback<T = unknown> = (response: T) => void;

  /**
   * Send a message to a specific hub by hostId.
   */
  function sendMessage<T = unknown>(
    hostId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ): boolean {
    const socket = hubConnections.get(hostId);
    if (!socket) {
      return false;
    }
    if (ack) {
      socket.emit(event, payload, ack);
    } else {
      socket.emit(event, payload);
    }
    return true;
  }

  // Authentication middleware
  nsp.use((socket, next) => {
    const {
      accessKey: clientAccessKey,
      hostId,
      hostname,
    } = socket.handshake.auth;

    if (!clientAccessKey || clientAccessKey !== accessKey) {
      logService.log(
        `[InterhubServer] Connection rejected: invalid access key from ${socket.handshake.address}`,
      );
      return next(new Error("Invalid access key"));
    }

    if (!hostId) {
      logService.log(`[InterhubServer] Connection rejected: missing hostId`);
      return next(new Error("Missing hostId"));
    }

    if (!hostname) {
      logService.log(`[InterhubServer] Connection rejected: missing hostname`);
      return next(new Error("Missing hostname"));
    }

    socket.data.hostId = hostId;
    socket.data.hostname = hostname;
    next();
  });

  // Handle new connections
  nsp.on("connection", (socket) => {
    const { hostId, hostname } = socket.data;

    logService.log(`[InterhubServer] Hub connected: ${hostname} (${hostId})`);

    // Replace existing connection if reconnecting
    const existing = hubConnections.get(hostId);
    if (existing) {
      logService.log(
        `[InterhubServer] Hub ${hostname} (${hostId}) reconnecting, replacing old connection`,
      );
      hubConnections.delete(hostId);
      raiseEvent("hub_disconnected", hostId);
    }

    hubConnections.set(hostId, socket);
    raiseEvent("hub_connected", hostId);

    // Forward all socket events
    socket.onAny((eventName: string, ...args: unknown[]) => {
      logService.log(`[InterhubServer] Received ${eventName} from ${hostname}`);
      raiseEvent(eventName, hostId, ...args);
    });

    logService.log(
      `[InterhubServer] Active hub connections: ${hubConnections.size}`,
    );

    // Clean up on disconnect
    socket.on("disconnect", (reason) => {
      logService.log(
        `[InterhubServer] Hub disconnected: ${hostname} (${hostId}) - ${reason}`,
      );
      hubConnections.delete(hostId);
      raiseEvent("hub_disconnected", hostId);
      logService.log(
        `[InterhubServer] Active hub connections: ${hubConnections.size}`,
      );
    });
  });

  return {
    registerEvent,
    unregisterEvent,
    sendMessage,
    getConnectedHubs: () => Array.from(hubConnections.keys()),
    getConnectionCount: () => hubConnections.size,
  };
}

export type InterhubServer = ReturnType<typeof createInterhubServer>;
