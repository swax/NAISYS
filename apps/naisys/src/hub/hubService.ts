import { io, Socket } from "socket.io-client";
import { HubClientLog } from "./hubClientLog.js";

export interface HubServiceConfig {
  hubUrl: string;
  hubAccessKey: string | undefined;
  hostId: string;
  hostname: string;
  logService: HubClientLog;
}

export function createHubService(config: HubServiceConfig) {
  const logService = config.logService;
  let socket: Socket | null = null;
  let connected = false;

  function connect() {
    logService.log(`[Hub] Connecting to ${config.hubUrl}...`);

    socket = io(config.hubUrl, {
      auth: {
        accessKey: config.hubAccessKey,
        hostId: config.hostId,
        hostname: config.hostname,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socket.on("connect", () => {
      connected = true;
      logService.log(`[Hub] Connected to ${config.hubUrl}`);

      // Send catch_up message on connect per the plan
      socket?.emit("catch_up", {
        host_id: config.hostId,
        // TODO: Track lastReceived timestamp from forwarded data
        lastReceived: null,
      });
    });

    socket.on("disconnect", (reason) => {
      connected = false;
      logService.log(`[Hub] Disconnected from ${config.hubUrl}: ${reason}`);
    });

    socket.on("connect_error", (error) => {
      logService.log(
        `[Hub] Connection error to ${config.hubUrl}: ${error.message}`
      );
    });

    // Hub requests sync data from runner
    socket.on(
      "sync_request",
      (data: { schema_version: number; since: string }) => {
        logService.log(
          `[Hub] Received sync_request from ${config.hubUrl} ${JSON.stringify(data)}`
        );
        // TODO: Implement sync response logic in Phase 3
      }
    );

    // Hub forwards data from other runners
    socket.on(
      "forward",
      (data: { has_more: boolean; tables: Record<string, unknown[]> }) => {
        logService.log(
          `[Hub] Received forward from ${config.hubUrl} ${Object.keys(data.tables)}`
        );
        // TODO: Implement upsert logic in Phase 4
      }
    );

    // Schema version mismatch error
    socket.on("sync_error", (data: { error: string; message: string }) => {
      logService.error(
        `[Hub] Sync error from ${config.hubUrl}: ${data.message}`
      );
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      connected = false;
      logService.log(`[Hub] Disconnected from ${config.hubUrl}`);
    }
  }

  function isConnected() {
    return connected;
  }

  function getUrl() {
    return config.hubUrl;
  }

  return {
    connect,
    disconnect,
    isConnected,
    getUrl,
  };
}

export type HubService = ReturnType<typeof createHubService>;
