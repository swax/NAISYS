import {
  countRecordsInTables,
  DatabaseService,
  findMaxUpdatedAt,
  loadSyncState,
  queryCatchUpRecords,
  saveSyncState,
  SYNCABLE_TABLE_CONFIG,
  SYNCABLE_TABLES,
  upsertRecords,
  type SyncableTable,
} from "@naisys/database";
import {
  CatchUpRequestSchema,
  HubEvents,
  SyncResponseErrorSchema,
  SyncResponseSchema,
  type CatchUpRequest,
  type CatchUpResponse,
  type CatchUpResponseError,
  type SyncResponse,
  type SyncResponseError,
} from "@naisys/hub-protocol";
import { HubForwardService } from "./hubForwardService.js";
import { HubServer } from "./hubServer.js";
import { HubServerLog } from "./hubServerLog.js";

/** Sync error types */
type SyncErrorType =
  | "schema_mismatch"
  | "internal_error"
  | "ownership_violation";

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
  /** True while client is catching up - don't include in sync polling until complete */
  catchingUp: boolean;
}

export interface HubSyncServerConfig {
  /** Maximum concurrent in-flight sync requests (default: 3) */
  maxConcurrentRequests?: number;
  /** Polling interval in ms (default: 1000) */
  pollIntervalMs?: number;
}

const DEFAULT_CONFIG = {
  maxConcurrentRequests: 3,
  pollIntervalMs: 1000,
};

/**
 * Manages sync polling to connected NAISYS runners.
 * Sends sync_request messages on a staggered schedule and handles responses.
 */
export function createHubSyncServer(
  hubServer: HubServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  forwardService: HubForwardService,
  config: HubSyncServerConfig
) {
  const {
    maxConcurrentRequests = DEFAULT_CONFIG.maxConcurrentRequests,
    pollIntervalMs = DEFAULT_CONFIG.pollIntervalMs,
  } = config;

  const schemaVersion = dbService.getSchemaVersion();

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
   * Get or create sync state for a client (synchronous, uses in-memory cache)
   */
  function getOrCreateState(hostId: string): ClientSyncState {
    let state = clientStates.get(hostId);
    if (!state) {
      state = {
        lastSyncTime: 0,
        inFlight: false,
        since: new Date(0).toISOString(),
        syncError: null,
        catchingUp: true, // New clients start in catching-up mode
      };
      clientStates.set(hostId, state);
    }
    return state;
  }

  /**
   * Load persisted sync state from database for a client
   */
  async function loadPersistedSyncState(hostId: string): Promise<void> {
    const state = getOrCreateState(hostId);
    try {
      const since = await dbService.usingDatabase((prisma) =>
        loadSyncState(prisma, hostId)
      );
      if (since) {
        state.since = since;
        logService.log(
          `[SyncServer] Loaded persisted sync state for ${hostId}: since=${state.since}`
        );
      }
    } catch (error) {
      logService.error(
        `[SyncServer] Error loading persisted sync state for ${hostId}: ${error}`
      );
    }
  }

  /**
   * Persist sync state to database
   */
  async function persistSyncState(hostId: string, since: string): Promise<void> {
    try {
      await dbService.usingDatabase((prisma) =>
        saveSyncState(prisma, hostId, since)
      );
    } catch (error) {
      logService.error(
        `[SyncServer] Error persisting sync state for ${hostId}: ${error}`
      );
    }
  }

  /**
   * Select the next client to sync.
   * Returns the hostId of the client that has gone longest without a sync,
   * excluding clients that are in-flight, catching up, or have sync errors.
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

      // Skip clients still catching up (wait for catch_up to complete first)
      if (state.catchingUp) continue;

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

    // Dequeue any pending forwards for this client
    const forwards = forwardService.dequeueForClient(hostId);

    logService.log(
      `[SyncServer] Sending sync_request to ${hostId} (since: ${state.since}, forwards: ${forwards ? "yes" : "no"}, in-flight: ${inFlightCount})`
    );

    const sent = hubServer.sendMessage(
      hostId,
      "sync_request",
      {
        schema_version: schemaVersion,
        since: state.since,
        ...(forwards && { forwards }),
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
    const rowCount = countRecordsInTables(data.tables);

    logService.log(
      `[SyncServer] Received ${rowCount} rows from ${hostId}, has_more: ${data.has_more}`
    );

    // Process data asynchronously
    processSyncData(hostId, state, data).then((success) => {
      // If there's more data, immediately request it
      if (success && data.has_more) {
        logService.log(
          `[SyncServer] More data available, sending immediate follow-up`
        );
        sendSyncRequest(hostId);
      }
    });
  }

  /**
   * Process sync data - upsert to database and update since timestamp.
   * Since schema versions match, we trust the data structure.
   * Returns true if processing succeeded, false otherwise.
   */
  async function processSyncData(
    hostId: string,
    state: ClientSyncState,
    data: SyncResponse
  ): Promise<boolean> {
    // Validate ownership - all records must have host_id matching the sender
    for (const [tableName, records] of Object.entries(data.tables)) {
      if (!SYNCABLE_TABLE_CONFIG[tableName]) continue;
      for (const record of records as Record<string, unknown>[]) {
        if (record.host_id !== hostId) {
          const recordId = String(record.id ?? record.host_id ?? "unknown");
          const errorMsg = `${tableName} record ${recordId} does not belong to host ${hostId}`;
          logService.error(`[SyncServer] Ownership violation from ${hostId}: ${errorMsg}`);

          hubServer.sendMessage(hostId, HubEvents.SYNC_ERROR, {
            error: "ownership_violation",
            message: errorMsg,
          });

          state.syncError = { type: "ownership_violation", message: errorMsg };
          return false;
        }
      }
    }

    let maxTimestamp: Date | null = null;

    // Process each syncable table present in the response
    // IMPORTANT: SYNCABLE_TABLES order matters for foreign key dependencies
    // (e.g., hosts must be synced before users)
    for (const table of SYNCABLE_TABLES) {
      const tableData = data.tables[table] as
        | Record<string, unknown>[]
        | undefined;
      if (!tableData || tableData.length === 0) continue;

      try {
        // Upsert records using generic utility
        // Hub sets its own updated_at for catch-up queries (stale joiner problem)
        await dbService.usingDatabase((prisma) =>
          upsertRecords(prisma, table as SyncableTable, tableData, {
            overrideUpdatedAt: true,
          })
        );

        logService.log(
          `[SyncServer] Upserted ${tableData.length} ${table} from ${hostId}`
        );
      } catch (error) {
        // Log which table and first record's primary key for debugging
        const pkCols = SYNCABLE_TABLE_CONFIG[table]?.primaryKey ?? ["id"];
        const firstRecord = tableData[0];
        const pkValues = pkCols
          .map((col: string) => firstRecord?.[col] ?? "?")
          .join(", ");
        logService.error(
          `[SyncServer] Error upserting ${table} (first pk: ${pkValues}) from ${hostId}: ${error}`
        );
        return false;
      }

      // Track max timestamp from updated_at field
      const tableMax = findMaxUpdatedAt(tableData);
      if (tableMax && (!maxTimestamp || tableMax > maxTimestamp)) {
        maxTimestamp = tableMax;
      }
    }

    // Update 'since' to the max timestamp from received data
    if (maxTimestamp) {
      state.since = maxTimestamp.toISOString();
      logService.log(
        `[SyncServer] Updated since timestamp for ${hostId} to ${state.since}`
      );

      // Persist sync state to database for restart recovery
      await persistSyncState(hostId, state.since);
    }

    // Queue forwardable tables for other connected clients
    // The forward service filters to shared tables only
    forwardService.enqueueForOtherClients(
      hostId,
      data.tables as Record<string, Record<string, unknown>[]>
    );

    return true;
  }

  /**
   * Handle catch_up request from a reconnecting client.
   * Queries all forwardable records (from other hosts) since the client's lastSyncedFromHub.
   */
  async function handleCatchUp(
    hostId: string,
    rawData: unknown,
    ack?: (response: CatchUpResponse | CatchUpResponseError) => void
  ) {
    // Validate request with schema
    const result = CatchUpRequestSchema.safeParse(rawData);
    if (!result.success) {
      logService.error(
        `[SyncServer] Invalid catch_up request from ${hostId}: ${JSON.stringify(result.error.issues)}`
      );
      return;
    }

    const data: CatchUpRequest = result.data;

    // Verify host_id matches
    if (data.host_id !== hostId) {
      logService.error(
        `[SyncServer] Catch-up host_id mismatch from ${hostId}: claimed ${data.host_id}`
      );
      if (ack) {
        const errorResponse: CatchUpResponseError = {
          error: "internal_error",
          message: `Host ID mismatch: connection ${hostId}, claimed ${data.host_id}`,
        };
        ack(errorResponse);
      }
      return;
    }

    // Check schema version
    if (data.schema_version !== schemaVersion) {
      const errorMessage = `Schema version mismatch: hub has ${schemaVersion}, client has ${data.schema_version}`;
      logService.error(`[SyncServer] ${errorMessage} from ${hostId}`);

      // Update client state to reflect the error
      const state = getOrCreateState(hostId);
      state.syncError = { type: "schema_mismatch", message: errorMessage };

      if (ack) {
        const errorResponse: CatchUpResponseError = {
          error: "schema_mismatch",
          message: errorMessage,
        };
        ack(errorResponse);
      }
      return;
    }

    logService.log(
      `[SyncServer] Processing catch_up from ${hostId} (lastSyncedFromHub: ${data.lastSyncedFromHub})`
    );

    try {
      // Query all forwardable records from other hosts since the client's lastSyncedFromHub
      // Hub uses its own updated_at for catch-up queries (handles stale joiner problem)
      const since = new Date(data.lastSyncedFromHub);
      const { tables, hasMore } = await dbService.usingDatabase((prisma) =>
        queryCatchUpRecords(prisma, since, hostId)
      );

      const recordCount = countRecordsInTables(tables);

      logService.log(
        `[SyncServer] Sending catch_up response to ${hostId} (${recordCount} records, has_more: ${hasMore})`
      );

      // If no more data, mark client as done catching up - ready for normal sync polling
      if (!hasMore) {
        const state = getOrCreateState(hostId);
        state.catchingUp = false;
        logService.log(
          `[SyncServer] Client ${hostId} catch-up complete, ready for sync polling`
        );
      }

      if (ack) {
        const response: CatchUpResponse = {
          has_more: hasMore,
          tables,
        };
        ack(response);
      }
    } catch (error) {
      logService.error(
        `[SyncServer] Error processing catch_up from ${hostId}: ${error}`
      );
      if (ack) {
        const errorResponse: CatchUpResponseError = {
          error: "internal_error",
          message: `Failed to query catch-up data: ${error}`,
        };
        ack(errorResponse);
      }
    }
  }

  /**
   * Handle client connection - initialize state and load persisted sync timestamp
   */
  function handleClientConnected(hostId: string, _connection: unknown) {
    const state = getOrCreateState(hostId);
    // Reset state for new connection
    state.lastSyncTime = 0;
    state.inFlight = false;
    state.syncError = null; // Clear any previous sync error on reconnect
    state.catchingUp = true; // Wait for catch_up to complete before sync polling

    // Initialize forward queue for this client
    forwardService.initClient(hostId);

    // Load persisted sync state from database (async, but state will be updated before first sync)
    loadPersistedSyncState(hostId);

    logService.log(`[SyncServer] Client ${hostId} connected, waiting for catch_up`);
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

    // Remove forward queue for this client (no memory pressure from disconnected clients)
    forwardService.removeClient(hostId);

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

    // Register handler for catch_up requests (reconnecting clients)
    hubServer.registerEvent(HubEvents.CATCH_UP, handleCatchUp);

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
    hubServer.unregisterEvent(HubEvents.CATCH_UP, handleCatchUp);

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

export type HubSyncServer = ReturnType<typeof createHubSyncServer>;
