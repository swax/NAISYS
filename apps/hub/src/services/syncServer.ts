import {
  HubEvents,
  SyncResponseSchema,
  SyncResponseErrorSchema,
  type SyncResponse,
  type SyncResponseError,
} from "@naisys/hub-protocol";
import { HubServer } from "./hubServer.js";
import { HubServerLog } from "./hubServerLog.js";

/** Sync error types */
type SyncErrorType = "schema_mismatch" | "internal_error";

/** Per-client sync state */
interface ClientSyncState {
  /** Timestamp of last sync request sent */
  lastSyncTime: number;
  /** Is there a pending sync request? */
  inFlight: boolean;
  /** Last sync timestamp to send in sync_request */
  since: string;
  /** Sync error - if set, client won't be polled for sync updates */
  syncError: { type: SyncErrorType; message: string } | null;
}

export interface SyncServerConfig {
  /** Maximum concurrent in-flight sync requests (default: 3) */
  maxConcurrentRequests?: number;
  /** Polling interval in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Schema version for sync protocol */
  schemaVersion: number;
  /** Log service for output */
  logService: HubServerLog;
}

const DEFAULT_CONFIG = {
  maxConcurrentRequests: 3,
  pollIntervalMs: 1000,
};

/**
 * Manages sync polling to connected NAISYS runners.
 * Sends sync_request messages on a staggered schedule and handles responses.
 */
export function createSyncServer(
  hubServer: HubServer,
  config: SyncServerConfig
) {
  const {
    maxConcurrentRequests = DEFAULT_CONFIG.maxConcurrentRequests,
    pollIntervalMs = DEFAULT_CONFIG.pollIntervalMs,
    schemaVersion,
    logService,
  } = config;

  // Per-client sync state
  const clientStates = new Map<string, ClientSyncState>();

  // Count of currently in-flight requests
  let inFlightCount = 0;

  // Polling interval handle
  let intervalId: NodeJS.Timeout | null = null;

  start();

  /**
   * Clear in-flight state for a client and decrement counter
   */
  function clearInFlight(state: ClientSyncState) {
    if (state.inFlight) {
      state.inFlight = false;
      inFlightCount = Math.max(0, inFlightCount - 1);
    }
  }

  /**
   * Get or create sync state for a client
   */
  function getOrCreateState(hostId: string): ClientSyncState {
    let state = clientStates.get(hostId);
    if (!state) {
      state = {
        lastSyncTime: 0,
        inFlight: false,
        since: new Date(0).toISOString(),
        syncError: null,
      };
      clientStates.set(hostId, state);
    }
    return state;
  }

  /**
   * Select the next client to sync.
   * Returns the hostId of the client that has gone longest without a sync,
   * excluding clients that are in-flight or have sync errors.
   */
  function selectNextClient(): string | null {
    const clients = hubServer.getConnectedClients();

    let bestHostId: string | null = null;
    let oldestSyncTime = Infinity;

    for (const client of clients) {
      const hostId = client.getHostId();
      const state = getOrCreateState(hostId);

      // Skip if already has an in-flight request
      if (state.inFlight) continue;

      // Skip clients with sync errors (e.g., schema mismatch)
      if (state.syncError) continue;

      // Find the client with the oldest last sync time
      if (state.lastSyncTime < oldestSyncTime) {
        oldestSyncTime = state.lastSyncTime;
        bestHostId = hostId;
      }
    }

    return bestHostId;
  }

  /**
   * Send a sync request to a specific client
   */
  function sendSyncRequest(hostId: string) {
    const state = getOrCreateState(hostId);

    // Mark as in-flight before sending
    state.inFlight = true;
    state.lastSyncTime = Date.now();
    inFlightCount++;

    logService.log(
      `[SyncServer] Sending sync_request to ${hostId} (since: ${state.since}, in-flight: ${inFlightCount})`
    );

    const sent = hubServer.sendMessage(
      hostId,
      "sync_request",
      {
        schema_version: schemaVersion,
        since: state.since,
      },
      (rawResponse: unknown) => {
        // First check if it's an error response
        const errorResult = SyncResponseErrorSchema.safeParse(rawResponse);
        if (errorResult.success) {
          handleSyncError(hostId, errorResult.data);
          clearInFlight(state);
          return;
        }

        // Validate as success response
        const result = SyncResponseSchema.safeParse(rawResponse);
        if (!result.success) {
          logService.error(
            `[SyncServer] Invalid sync response from ${hostId}: ${JSON.stringify(result.error.issues)}`
          );
          clearInFlight(state);
          return;
        }

        handleSyncResponse(hostId, result.data);
      }
    );

    if (!sent) {
      // Client disconnected before we could send
      clearInFlight(state);
      logService.log(
        `[SyncServer] Client ${hostId} no longer connected, skipping sync`
      );
    }
  }

  /**
   * Handle sync error response from a client
   */
  function handleSyncError(hostId: string, error: SyncResponseError) {
    logService.error(
      `[SyncServer] Sync error from ${hostId}: ${error.error} - ${error.message}`
    );

    // Mark the client state as having a sync error
    const state = getOrCreateState(hostId);
    state.syncError = { type: error.error, message: error.message };
  }

  /**
   * Handle sync response from a client
   */
  function handleSyncResponse(hostId: string, data: SyncResponse) {
    const state = clientStates.get(hostId);
    if (!state) {
      logService.log(
        `[SyncServer] Received response from unknown client ${hostId}`
      );
      return;
    }

    clearInFlight(state);

    // Count total rows received
    const rowCount = Object.values(data.tables).reduce(
      (sum, rows) => sum + rows.length,
      0
    );

    logService.log(
      `[SyncServer] Received ${rowCount} rows from ${hostId}, has_more: ${data.has_more}`
    );

    if (rowCount > 0) {
      // Update 'since' to the max timestamp from received data
      // TODO: Extract max timestamp from tables and update state.since
    }

    // If there's more data, immediately request it
    if (data.has_more) {
      logService.log(
        `[SyncServer] More data available, sending immediate follow-up`
      );
      sendSyncRequest(hostId);
    }
  }

  /**
   * Handle client connection - initialize state
   */
  function handleClientConnected(hostId: string, _connection: unknown) {
    const state = getOrCreateState(hostId);
    // Reset state for new connection - will be selected on next tick
    state.lastSyncTime = 0;
    state.inFlight = false;
    state.syncError = null; // Clear any previous sync error on reconnect
    logService.log(`[SyncServer] Client ${hostId} connected, ready to sync`);
  }

  /**
   * Handle client disconnection - clean up state
   */
  function handleClientDisconnected(hostId: string) {
    const state = clientStates.get(hostId);
    if (state) {
      clearInFlight(state);
    }
    clientStates.delete(hostId);
    logService.log(
      `[SyncServer] Client ${hostId} disconnected, state cleaned up`
    );
  }

  /**
   * Polling tick - called every pollIntervalMs
   */
  function tick() {
    // Check if we have capacity for another request
    if (inFlightCount >= maxConcurrentRequests) {
      return;
    }

    // Find the next client to sync
    const hostId = selectNextClient();
    if (!hostId) {
      return;
    }

    sendSyncRequest(hostId);
  }

  /**
   * Start the sync polling loop and register event handlers
   */
  function start() {
    if (intervalId) {
      logService.log(`[SyncServer] Already running`);
      return;
    }

    // Register event handlers for connection lifecycle
    // Note: sync_response is handled via ack callback in sendSyncRequest
    hubServer.registerEvent(HubEvents.CLIENT_CONNECTED, handleClientConnected);
    hubServer.registerEvent(
      HubEvents.CLIENT_DISCONNECTED,
      handleClientDisconnected
    );

    logService.log(
      `[SyncServer] Starting sync polling (interval: ${pollIntervalMs}ms, max concurrent: ${maxConcurrentRequests})`
    );
    intervalId = setInterval(tick, pollIntervalMs);
  }

  /**
   * Stop the sync polling loop and unregister event handlers
   */
  function stop() {
    // Unregister event handlers
    hubServer.unregisterEvent(
      HubEvents.CLIENT_CONNECTED,
      handleClientConnected
    );
    hubServer.unregisterEvent(
      HubEvents.CLIENT_DISCONNECTED,
      handleClientDisconnected
    );

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logService.log(`[SyncServer] Stopped sync polling`);
    }
  }

  return {
    start,
    stop,
    // Expose for testing/debugging
    getClientState: (hostId: string) => clientStates.get(hostId),
    getInFlightCount: () => inFlightCount,
  };
}

export type SyncServer = ReturnType<typeof createSyncServer>;
