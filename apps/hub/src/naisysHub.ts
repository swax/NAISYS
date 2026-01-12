import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import {
  createNaisysClientService,
  NaisysClientService,
} from "./services/naisysClientService.js";

/**
 * Starts the Hub server.
 * Can be called standalone or inline from naisys with --hub flag.
 */
export async function startHub(startupType: "standalone" | "hosted") {
  console.log(`[Hub] Starting Hub server in ${startupType} mode...`);

  const hubPort = Number(process.env.HUB_PORT) || 3002;
  const hubAccessKey = process.env.HUB_ACCESS_KEY;
  if (!hubAccessKey) {
    console.error(
      "Error: HUB_ACCESS_KEY environment variable is required when using --hub"
    );
    process.exit(1);
  }

  // Track connected runners
  const connectedClients = new Map<string, NaisysClientService>();

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
    const { accessKey, hostId, hostname } = socket.handshake.auth;

    if (!accessKey || accessKey !== hubAccessKey) {
      console.log(
        `[Hub] Connection rejected: invalid access key from ${socket.handshake.address}`
      );
      return next(new Error("Invalid access key"));
    }

    if (!hostId || !hostname) {
      console.log(`[Hub] Connection rejected: missing hostId or hostname`);
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
      console.log(
        `[Hub] Host ${hostname} (${hostId}) reconnecting, replacing old connection`
      );
      connectedClients.delete(hostId);
    }

    // Create client service for this connection
    const clientService = createNaisysClientService(socket, {
      hostId,
      hostname,
      connectedAt: new Date(),
    });

    connectedClients.set(hostId, clientService);

    console.log(`[Hub] Active connections: ${connectedClients.size}`);

    // Clean up on disconnect
    socket.on("disconnect", () => {
      connectedClients.delete(hostId);
      console.log(`[Hub] Active connections: ${connectedClients.size}`);
    });
  });

  // Start listening
  httpServer.listen(hubPort, () => {
    console.log(`[Hub] Server listening on port ${hubPort}`);
  });

  // Return control interface
  return {
    getConnectedClients: () => Array.from(connectedClients.values()),
    getClientByHostId: (hostId: string) => connectedClients.get(hostId),
    getClientCount: () => connectedClients.size,
    close: () => {
      io.close();
      httpServer.close();
    },
  };
}

export type HubServer = Awaited<ReturnType<typeof startHub>>;

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config({ quiet: true });

  startHub("standalone")
    .then(() => {
      console.log("[Hub] Hub server started successfully");
    })
    .catch((err) => {
      console.error("[Hub] Failed to start hub server:", err);
      process.exit(1);
    });
}
