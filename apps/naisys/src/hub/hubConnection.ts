import { io, Socket } from "socket.io-client";
import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";

/** Generic raise event function type - hubUrl as first arg */
export type RaiseEventFn = (
  event: string,
  hubUrl: string,
  ...args: unknown[]
) => void;

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

      // Send catch_up message on connect per the plan
      socket?.emit("catch_up", {
        host_id: hostService.localHostId,
        // TODO: Track lastReceived timestamp from forwarded data
        lastReceived: null,
      });
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

  return {
    connect,
    disconnect,
    isConnected,
    getUrl,
  };
}

export type HubConnection = ReturnType<typeof createHubConnection>;
