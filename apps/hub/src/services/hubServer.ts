import http from "http";
import { Server } from "socket.io";
import { ZodSchema } from "zod";
import { HubServerLog } from "./hubServerLog.js";
import { createNaisysClient, NaisysClient } from "./naisysClient.js";

export interface HubServerConfig {
  port: number;
  accessKey: string;
  logService: HubServerLog;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (hostId: string, ...args: any[]) => void;

/** Registered handler with optional schema for validation */
interface RegisteredHandler {
  handler: EventHandler;
  schema?: ZodSchema;
}

/**
 * Creates and starts the Hub WebSocket server.
 */
export async function createHubServer(config: HubServerConfig) {
  const { port, accessKey, logService } = config;

  // Track connected runners
  const connectedClients = new Map<string, NaisysClient>();

  // Generic event handlers registry - maps event name to set of registered handlers
  const eventHandlers = new Map<string, Set<RegisteredHandler>>();

  // Register an event handler with optional schema for validation
  function registerEvent(
    event: string,
    handler: EventHandler,
    schema?: ZodSchema
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
  function raiseEvent(event: string, hostId: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const { handler, schema } of handlers) {
        // If schema is provided and we have data, validate it
        if (schema && args.length > 0) {
          const result = schema.safeParse(args[0]);
          if (!result.success) {
            logService.error(
              `[Hub] Schema validation failed for event '${event}' from ${hostId}: ${JSON.stringify(result.error.issues)}`
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
  function sendMessage<T = unknown>(
    hostId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>
  ): boolean {
    const client = connectedClients.get(hostId);
    if (!client) {
      return false;
    }
    client.sendMessage(event, payload, ack);
    return true;
  }

  // Create HTTP server for Socket.IO
  const httpServer = http.createServer();

  const io = new Server(httpServer, {
    cors: {
      origin: "*", // In production, restrict this
      methods: ["GET", "POST"],
    },
  });

  // Authentication middleware
  io.use((socket, next) => {
    const {
      accessKey: clientAccessKey,
      hostId,
      hostname,
    } = socket.handshake.auth;

    if (!clientAccessKey || clientAccessKey !== accessKey) {
      logService.log(
        `[Hub] Connection rejected: invalid access key from ${socket.handshake.address}`
      );
      return next(new Error("Invalid access key"));
    }

    if (!hostId || !hostname) {
      logService.log(`[Hub] Connection rejected: missing hostId or hostname`);
      return next(new Error("Missing hostId or hostname"));
    }

    // Attach auth data to socket for use in connection handler
    socket.data.hostId = hostId;
    socket.data.hostname = hostname;

    next();
  });

  // Handle new connections
  io.on("connection", (socket) => {
    const { hostId, hostname } = socket.data;

    // Check if this host is already connected
    const existingClient = connectedClients.get(hostId);
    if (existingClient) {
      logService.log(
        `[Hub] Host ${hostname} (${hostId}) reconnecting, replacing old connection`
      );
      connectedClients.delete(hostId);
      raiseEvent("client_disconnected", hostId);
    }

    // Create client service for this connection, passing our emit function
    const clientService = createNaisysClient(
      socket,
      {
        hostId,
        hostname,
        connectedAt: new Date(),
      },
      raiseEvent,
      logService
    );

    connectedClients.set(hostId, clientService);
    raiseEvent("client_connected", hostId, clientService);

    logService.log(`[Hub] Active connections: ${connectedClients.size}`);

    // Clean up on disconnect
    socket.on("disconnect", () => {
      connectedClients.delete(hostId);
      raiseEvent("client_disconnected", hostId);
      logService.log(`[Hub] Active connections: ${connectedClients.size}`);
    });
  });

  // Start listening
  httpServer.listen(port, () => {
    logService.log(`[Hub] Server listening on port ${port}`);
  });

  // Return control interface
  return {
    registerEvent,
    unregisterEvent,
    sendMessage,
    getConnectedClients: () => Array.from(connectedClients.values()),
    getClientByHostId: (hostId: string) => connectedClients.get(hostId),
    getClientCount: () => connectedClients.size,
    close: () => {
      io.close();
      httpServer.close();
    },
  };
}

export type HubServer = Awaited<ReturnType<typeof createHubServer>>;
