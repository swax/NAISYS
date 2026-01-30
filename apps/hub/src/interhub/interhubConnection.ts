import { HubEvents } from "@naisys/hub-protocol";
import { io, Socket } from "socket.io-client";
import { HubConfig } from "../hubConfig.js";
import { HostService } from "../services/hostService.js";
import { InterhubClientLog } from "./interhubClientLog.js";

/** Generic raise event function type - hubUrl as first arg */
export type InterhubRaiseEventFn = (
  event: string,
  hubUrl: string,
  ...args: unknown[]
) => void;

/** Callback type for message acknowledgements */
type AckCallback<T = unknown> = (response: T) => void;

export function createInterhubConnection(
  hubUrl: string,
  hubClientLog: InterhubClientLog,
  hubConfig: HubConfig,
  hostService: HostService,
  raiseEvent: InterhubRaiseEventFn,
) {
  const config = hubConfig.hubConfig();

  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    hubClientLog.write(`[Interhub] Connecting to ${hubUrl}...`);

    socket = io(hubUrl + "/interhub", {
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
      hubClientLog.write(`[Interhub] Connected to ${hubUrl}`);

      raiseEvent(HubEvents.HUB_CONNECTED, hubUrl);
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      hubClientLog.write(`[Interhub] Disconnected from ${hubUrl}: ${reason}`);
    });

    socket.on("connect_error", (error) => {
      hubClientLog.write(
        `[Interhub] Connection error to ${hubUrl}: ${error.message}`,
      );
    });

    // Forward all socket events to hubManager's event handlers
    socket.onAny((eventName: string, ...args: unknown[]) => {
      hubClientLog.write(`[Interhub] Received ${eventName} from ${hubUrl}`);
      raiseEvent(eventName, hubUrl, ...args);
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      connected = false;
      hubClientLog.write(`[Interhub] Disconnected from ${hubUrl}`);
    }
  }

  /**
   * Disable reconnection and disconnect. Used for fatal sync errors.
   */
  function disableReconnection(reason: string) {
    if (socket) {
      socket.io.opts.reconnection = false;
      socket.disconnect();
      connected = false;
      hubClientLog.write(
        `[Interhub] Disabled reconnection to ${hubUrl}: ${reason}`,
      );
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
    disableReconnection,
    isConnected,
    getUrl,
    sendMessage,
  };
}

export type InterhubConnection = ReturnType<typeof createInterhubConnection>;
