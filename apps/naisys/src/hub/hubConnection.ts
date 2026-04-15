import type { DualLogger } from "@naisys/common-node";
import { resolveHubAccessKey } from "@naisys/common-node";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

import type { HubClientConfig } from "./hubClientConfig.js";

/** Generic raise event function type */
export type RaiseEventFn = (event: string, ...args: unknown[]) => void;

/** Callback type for message acknowledgements */
type AckCallback<T = unknown> = (response: T) => void;

export function createHubConnection(
  hubClientConfig: HubClientConfig,
  hubClientLog: DualLogger,
  raiseEvent: RaiseEventFn,
  onConnected: () => void,
  onDisconnected: () => void,
  onConnectError: (message: string) => void,
) {
  const hubUrl = hubClientConfig.hubUrl;

  // Extract origin and base path from hub URL (e.g. "http://localhost:3300/hub" → origin + "/hub")
  // Socket.IO needs origin for connection and base path for its transport path
  const hubUrlParsed = new URL(hubUrl);
  const hubOrigin = hubUrlParsed.origin;
  const hubBasePath = hubUrlParsed.pathname.replace(/\/$/, "");

  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    hubClientLog.log(`[NAISYS:HubClient] Connecting to ${hubUrl}...`);

    const hubAccessKey = resolveHubAccessKey();
    if (!hubAccessKey) {
      onConnectError("No hub access key available");
      return;
    }

    socket = io(hubOrigin, {
      path: hubBasePath + "/socket.io",
      extraHeaders: {
        "ngrok-skip-browser-warning": "true",
      },
      auth: (cb) => {
        // Re-read access key on each connection attempt so rotated keys are picked up
        cb({
          hubAccessKey: resolveHubAccessKey(),
          hostName: hubClientConfig.hostname,
          hostType: "naisys",
          clientVersion: hubClientConfig.clientVersion,
        });
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    socket.on("connect", () => {
      connected = true;
      hubClientLog.log(`[NAISYS:HubClient] Connected to ${hubUrl}`);
      onConnected();
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      hubClientLog.log(
        `[NAISYS:HubClient] Disconnected from ${hubUrl}: ${reason}`,
      );
      onDisconnected();

      // Server-initiated disconnects don't auto-reconnect in Socket.IO
      if (reason === "io server disconnect") {
        socket?.connect();
      }
    });

    socket.on("connect_error", (error) => {
      hubClientLog.log(
        `[NAISYS:HubClient] Connection error to ${hubUrl}: ${error.message}`,
      );
      onConnectError(error.message);
    });

    // Forward all socket events to hubClient's event handlers
    socket.onAny((eventName: string, ...args: unknown[]) => {
      hubClientLog.log(
        `[NAISYS:HubClient] Received ${eventName} from ${hubUrl}`,
      );
      raiseEvent(eventName, ...args);
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      connected = false;
      hubClientLog.log(`[NAISYS:HubClient] Disconnected from ${hubUrl}`);
    }
  }

  function isConnected() {
    return connected;
  }

  function getUrl() {
    return hubUrl;
  }

  /**
   * Send a message to the hub with optional acknowledgement callback.
   * @param event - Event name
   * @param payload - Message payload
   * @param ack - Optional callback for acknowledgement
   * @returns true if message was sent, false if not connected
   */
  function sendMessage<T = unknown>(
    event: string,
    payload: unknown,
    ack?: AckCallback<T>,
  ): boolean {
    if (!socket || !connected) {
      return false;
    }
    if (ack) {
      socket.emit(event, payload, ack);
    } else {
      socket.emit(event, payload);
    }
    return true;
  }

  return {
    connect,
    disconnect,
    isConnected,
    getUrl,
    sendMessage,
  };
}

export type HubConnection = ReturnType<typeof createHubConnection>;
