import { io, Socket } from "socket.io-client";
import { GlobalConfig } from "../globalConfig.js";
import { HubClientLog } from "./hubClientLog.js";

/** Generic raise event function type */
export type RaiseEventFn = (event: string, ...args: unknown[]) => void;

/** Callback type for message acknowledgements */
type AckCallback<T = unknown> = (response: T) => void;

/** Number of reconnection attempts before giving up on current URL */
const RECONNECTION_ATTEMPTS = 5;

export function createHubConnection(
  hubUrl: string,
  hubClientLog: HubClientLog,
  globalConfig: GlobalConfig,
  raiseEvent: RaiseEventFn,
  onConnected: () => void,
  onReconnectFailed: () => void,
  onConnectError: (message: string) => void,
) {
  const config = globalConfig.globalConfig();

  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    hubClientLog.write(`[Hub] Connecting to ${hubUrl}...`);

    socket = io(hubUrl + "/runners", {
      auth: {
        accessKey: config.hubAccessKey,
        runnerName: config.hostname,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: RECONNECTION_ATTEMPTS,
    });

    socket.on("connect", () => {
      connected = true;
      hubClientLog.write(`[Hub] Connected to ${hubUrl}`);
      onConnected();
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      hubClientLog.write(`[Hub] Disconnected from ${hubUrl}: ${reason}`);
    });

    socket.on("connect_error", (error) => {
      hubClientLog.write(
        `[Hub] Connection error to ${hubUrl}: ${error.message}`,
      );
      onConnectError(error.message);
    });

    // Notify manager when all reconnection attempts exhausted
    socket.io.on("reconnect_failed", () => {
      hubClientLog.write(
        `[Hub] Reconnection to ${hubUrl} failed after ${RECONNECTION_ATTEMPTS} attempts`,
      );
      onReconnectFailed();
    });

    // Forward all socket events to hubClient's event handlers
    socket.onAny((eventName: string, ...args: unknown[]) => {
      hubClientLog.write(`[Hub] Received ${eventName} from ${hubUrl}`);
      raiseEvent(eventName, ...args);
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      connected = false;
      hubClientLog.write(`[Hub] Disconnected from ${hubUrl}`);
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
