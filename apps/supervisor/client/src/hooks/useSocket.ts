import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/api/supervisor/ws",
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      // No backoff, we need to know asap when the server is back up
    });
  }
  return socket;
}
