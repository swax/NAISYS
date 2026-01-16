import { io, Socket } from "socket.io-client";
import { HubEvents } from "@naisys/hub-protocol";
import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";

/** Generic raise event function type - hubUrl as first arg */
export type RaiseEventFn = (
  event: string,
  hubUrl: string,
  ...args: unknown[]
) => void;

/** Callback type for message acknowledgements */
type AckCallback<T = unknown> = (response: T) => void;

export function createHubConnection(
  hubUrl: string,
  hubClientLog: HubClientLog,
  globalConfig: GlobalConfig,
  hostService: HostService,
  raiseEvent: RaiseEventFn
) {
  const config = globalConfig.globalConfig();
  
  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    hubClientLog.write(`[Hub] Connecting to ${hubUrl}...`);

    socket = io(hubUrl, {
      auth: {
        accessKey: config.hubAccessKey,
        hostId: hostService.localHostId,
        hostname: hostService.localHostname,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socket.on("connect", () => {
      connected = true;
      hubClientLog.write(`[Hub] Connected to ${hubUrl}`);

      // Raise local event so hubSyncClient can send catch_up with proper timestamp
      raiseEvent(HubEvents.HUB_CONNECTED, hubUrl);
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      hubClientLog.write(`[Hub] Disconnected from ${hubUrl}: ${reason}`);
    });

    socket.on("connect_error", (error) => {
      hubClientLog.write(
        `[Hub] Connection error to ${hubUrl}: ${error.message}`
      );
    });

    // Forward all socket events to hubManager's event handlers
    socket.onAny((eventName: string, ...args: unknown[]) => {
      hubClientLog.write(`[Hub] Received ${eventName} from ${hubUrl}`);
      raiseEvent(eventName, hubUrl, ...args);
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
    ack?: AckCallback<T>
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
