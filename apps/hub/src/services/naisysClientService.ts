import { Socket } from "socket.io";

export interface NaisysClientInfo {
  hostId: string;
  hostname: string;
  connectedAt: Date;
}

/**
 * Handles the lifecycle of a single NAISYS runner connection to the hub.
 * Each connected runner gets its own naisysClientService instance.
 */
export function createNaisysClientService(socket: Socket, clientInfo: NaisysClientInfo) {
  const { hostId, hostname, connectedAt } = clientInfo;

  console.log(`[NaisysClient] Runner connected: ${hostname} (${hostId})`);

  // Handle catch_up message from runner (sent on connect/reconnect)
  socket.on("catch_up", (data: { host_id: string; lastReceived: string | null }) => {
    console.log(`[NaisysClient] Received catch_up from ${hostname}:`, data);
    // TODO: Phase 3-4 - Send missed forwarded data based on lastReceived
  });

  // Handle sync_response from runner (response to our sync_request)
  socket.on("sync_response", (data: { host_id: string; has_more: boolean; tables: Record<string, unknown[]> }) => {
    console.log(`[NaisysClient] Received sync_response from ${hostname}:`, {
      tables: Object.keys(data.tables),
      has_more: data.has_more,
    });
    // TODO: Phase 3 - Store synced data in hub database
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log(`[NaisysClient] Runner disconnected: ${hostname} (${hostId}) - ${reason}`);
  });

  // Send a sync_request to the runner
  function sendSyncRequest(schemaVersion: number, since: string) {
    socket.emit("sync_request", {
      schema_version: schemaVersion,
      since,
    });
  }

  // Forward data to this runner
  function sendForward(data: { has_more: boolean; tables: Record<string, unknown[]> }) {
    socket.emit("forward", data);
  }

  // Send sync error to runner
  function sendSyncError(error: string, message: string) {
    socket.emit("sync_error", { error, message });
  }

  function getHostId() {
    return hostId;
  }

  function getHostname() {
    return hostname;
  }

  function getConnectedAt() {
    return connectedAt;
  }

  function getSocketId() {
    return socket.id;
  }

  return {
    sendSyncRequest,
    sendForward,
    sendSyncError,
    getHostId,
    getHostname,
    getConnectedAt,
    getSocketId,
  };
}

export type NaisysClientService = ReturnType<typeof createNaisysClientService>;
