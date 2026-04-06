import type http from "node:http";

import { extractBearerToken } from "@naisys/common-node";
import { Server as SocketIOServer } from "socket.io";

import {
  resolveUserFromApiKey,
  resolveUserFromToken,
} from "../auth-middleware.js";
import { isHubConnected } from "./hubConnectionService.js";

let io: SocketIOServer | null = null;

export function initBrowserSocket(httpServer: http.Server, isProd: boolean) {
  io = new SocketIOServer(httpServer, {
    path: "/supervisor/api/ws",
    cors: isProd
      ? undefined
      : { origin: ["http://localhost:3002"], credentials: true },
  });

  // Auth middleware: validate session cookie or API key on handshake
  io.use(async (socket, next) => {
    // Try cookie auth
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const token = parseCookie(cookieHeader, "naisys_session");
      if (token) {
        const user = await resolveUserFromToken(token);
        if (user) {
          socket.data.user = user;
          return next();
        }
      }
    }

    // Try API key auth
    const apiKey = extractBearerToken(socket.handshake.headers.authorization);
    if (apiKey) {
      const user = await resolveUserFromApiKey(apiKey);
      if (user) {
        socket.data.user = user;
        return next();
      }
    }

    next(new Error("Authentication required"));
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (data: { room: string }) => {
      if (typeof data?.room === "string" && isRoomAllowed(data.room)) {
        void socket.join(data.room);

        // Send initial hub status when the client subscribes to the room
        // (not on connect, because the client listener isn't ready yet)
        if (data.room === "hub-status") {
          socket.emit("hub-status", { hubConnected: isHubConnected() });
        }
      }
    });

    socket.on("unsubscribe", (data: { room: string }) => {
      if (typeof data?.room === "string") {
        void socket.leave(data.room);
      }
    });
  });
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

function parseCookie(header: string, name: string): string | undefined {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

const ALLOWED_ROOM_PREFIXES = [
  "agent-status",
  "host-status",
  "hub-status",
  "runs:",
  "logs:",
  "mail:",
  "chat-conversations:",
  "chat-messages:",
];

function isRoomAllowed(room: string): boolean {
  return ALLOWED_ROOM_PREFIXES.some(
    (prefix) => room === prefix || room.startsWith(prefix),
  );
}
