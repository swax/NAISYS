import { io, Socket } from "socket.io-client";
import { HubClientConfig } from "./hubClientConfig.js";
import { HubClientLog } from "./hubClientLog.js";

/** Generic raise event function type */
export type RaiseEventFn = (event: string, ...args: unknown[]) => void;

/** Callback type for message acknowledgements */
type AckCallback<T = unknown> = (response: T) => void;

export function createHubConnection(
  hubClientConfig: HubClientConfig,
  hubClientLog: HubClientLog,
  raiseEvent: RaiseEventFn,
  onConnected: () => void,
  onDisconnected: () => void,
  onConnectError: (message: string) => void,
) {
  const hubUrl = hubClientConfig.hubUrl;

  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    hubClientLog.write(`[NAISYS:HubClient] Connecting to ${hubUrl}...`);

    socket = io(hubUrl + "/naisys", {
      auth: {
        accessKey: hubClientConfig.hubAccessKey,
        hostName: hubClientConfig.hostname,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    socket.on("connect", () => {
      connected = true;
      hubClientLog.write(`[NAISYS:HubClient] Connected to ${hubUrl}`);
      onConnected();
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      hubClientLog.write(
        `[NAISYS:HubClient] Disconnected from ${hubUrl}: ${reason}`,
      );
      onDisconnected();
    });

    socket.on("connect_error", (error) => {
      hubClientLog.write(
        `[NAISYS:HubClient] Connection error to ${hubUrl}: ${error.message}`,
      );
      onConnectError(error.message);
    });

    // Forward all socket events to hubClient's event handlers
    socket.onAny((eventName: string, ...args: unknown[]) => {
      hubClientLog.write(
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
      hubClientLog.write(`[NAISYS:HubClient] Disconnected from ${hubUrl}`);
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
