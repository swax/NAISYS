import http from "http";
import { Server } from "socket.io";
import { ZodSchema } from "zod";
import { HubServerLog } from "./hubServerLog.js";
import {
  createRunnerConnection,
  RunnerConnection,
} from "./runnerConnection.js";
import { RunnerRegistrar } from "./runnerRegistrar.js";

type EventHandler = (runnerId: string, ...args: any[]) => void;

/** Registered handler with optional schema for validation */
interface RegisteredHandler {
  handler: EventHandler;
  schema?: ZodSchema;
}

/**
 * Creates and starts the Hub WebSocket server.
 */
export async function createHubServer(
  port: number,
  accessKey: string,
  logService: HubServerLog,
  runnerRegistrar: RunnerRegistrar,
) {
  // Track connected runners
  const runnerConnections = new Map<string, RunnerConnection>();

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
  function raiseEvent(event: string, runnerId: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const { handler, schema } of handlers) {
        // If schema is provided and we have data, validate it
        if (schema && args.length > 0) {
          const result = schema.safeParse(args[0]);
          if (!result.success) {
            logService.error(
              `[Hub] Schema validation failed for event '${event}' from ${runnerId}: ${JSON.stringify(result.error.issues)}`,
            );
            continue; // Skip this handler if validation fails
          }
          // Call handler with validated data
          handler(runnerId, result.data, ...args.slice(1));
        } else {
          handler(runnerId, ...args);
        }
      }
    }
  }

  /** Callback type for acknowledgements */
  type AckCallback<T = unknown> = (response: T) => void;

  /**
   * Send an event to a specific client by runnerId.
   * If ack callback is provided, waits for client acknowledgement.
   */
  function sendMessage<T = unknown>(
    runnerId: string,
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ): boolean {
    const connection = runnerConnections.get(runnerId);
    if (!connection) {
      return false;
    }
    connection.sendMessage(event, payload, ack);
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
  io.use(async (socket, next) => {
    const {
      accessKey: clientAccessKey,
      runnerName,
    } = socket.handshake.auth;

    if (!clientAccessKey || clientAccessKey !== accessKey) {
      logService.log(
        `[Hub] Connection rejected: invalid access key from ${socket.handshake.address}`,
      );
      return next(new Error("Invalid access key"));
    }

    if (!runnerName) {
      logService.log(`[Hub] Connection rejected: missing runnerName`);
      return next(new Error("Missing runnerName"));
    }

    try {
      const runnerId = await runnerRegistrar.registerRunner(runnerName);
      socket.data.runnerId = runnerId;
      socket.data.runnerName = runnerName;
      next();
    } catch (err) {
      logService.error(
        `[Hub] Connection rejected: failed to register runner ${runnerName}: ${err}`,
      );
      return next(new Error("Runner registration failed"));
    }
  });

  // Handle new connections
  io.on("connection", (socket) => {
    const { runnerId, runnerName } = socket.data;

    // Check if this runner is already connected
    const existingConnection = runnerConnections.get(runnerId);
    if (existingConnection) {
      logService.log(
        `[Hub] Runner ${runnerName} (${runnerId}) reconnecting, replacing old connection`,
      );
      runnerConnections.delete(runnerId);
      raiseEvent("client_disconnected", runnerId);
    }

    // Create connection handler for this socket, passing our emit function
    const runnerConnection = createRunnerConnection(
      socket,
      {
        runnerId,
        runnerName,
        connectedAt: new Date(),
      },
      raiseEvent,
      logService,
    );

    runnerConnections.set(runnerId, runnerConnection);
    raiseEvent("client_connected", runnerId, runnerConnection);

    logService.log(`[Hub] Active connections: ${runnerConnections.size}`);

    // Clean up on disconnect
    socket.on("disconnect", () => {
      runnerConnections.delete(runnerId);
      raiseEvent("client_disconnected", runnerId);
      logService.log(`[Hub] Active connections: ${runnerConnections.size}`);
    });
  });

  // Start listening - await to ensure errors are thrown before returning
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      httpServer.removeListener("error", reject);
      logService.log(`[Hub] Server listening on port ${port}`);
      resolve();
    });
  });

  // Return control interface
  return {
    registerEvent,
    unregisterEvent,
    sendMessage,
    getConnectedClients: () => Array.from(runnerConnections.values()),
    getConnectionByRunnerId: (runnerId: string) => runnerConnections.get(runnerId),
    getConnectionCount: () => runnerConnections.size,
    close: () => {
      void io.close();
      httpServer.close();
    },
  };
}

export type HubServer = Awaited<ReturnType<typeof createHubServer>>;
