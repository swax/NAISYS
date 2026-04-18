import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/supervisor/api/ws",
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      // No backoff, we need to know asap when the server is back up
    });
  }
  return socket;
}

/**
 * Force the socket to (re)connect. Used after login to retry with the
 * freshly-issued session cookie, since Socket.IO's reconnection manager
 * doesn't kick in for middleware-level auth rejects.
 */
export function reconnectSocket(): void {
  const s = getSocket();
  if (!s.connected) s.connect();
}

/**
 * Disconnect the socket. Used on logout so the server drops all room
 * memberships and the next login opens a fresh, correctly-authed socket.
 */
export function disconnectSocket(): void {
  if (socket) socket.disconnect();
}
