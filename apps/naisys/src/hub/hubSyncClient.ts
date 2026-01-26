import {
  countRecordsInTables,
  DatabaseService,
  findMaxUpdatedAtFromTables,
  FORWARDABLE_TABLES,
  loadSyncState,
  queryChangedRecords,
  saveSyncState,
  serializeRecords,
  SYNCABLE_TABLES,
  upsertRecords,
  type SyncableTable,
} from "@naisys/database";
import {
  CatchUpResponseErrorSchema,
  CatchUpResponseSchema,
  HubEvents,
  SyncErrorSchema,
  SyncRequestSchema,
  type CatchUpRequest,
  type CatchUpResponse,
  type CatchUpResponseError,
  type SyncRequest,
  type SyncResponse,
  type SyncResponseError,
} from "@naisys/hub-protocol";
import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";
import { HubManager } from "./hubManager.js";

/** Maximum rows to return per table per sync request */
const SYNC_BATCH_SIZE = 1000;

/** Status of hub sync client connection to a specific hub */
export type HubSyncClientStatus =
  | "connected"
  | "schema_mismatch"
  | "internal_error"
  | "disabled";

/** Per-hub sync status */
interface HubSyncState {
  status: HubSyncClientStatus;
  errorMessage?: string;
  /** Last timestamp we received forwarded data from this hub (for catch_up on reconnect) */
  lastSyncedFromHub: string;
}

/**
 * Handles sync requests from connected Hub servers.
 * Receives sync_request messages and responds with local data.
 */
export function createHubSyncClient(
  hubManager: HubManager,
  hubClientLog: HubClientLog,
  dbService: DatabaseService,
  hostService: HostService,
) {
  const schemaVersion = dbService.getSchemaVersion();
  const { localHostId } = hostService;

  /** Track sync status per hub URL */
  const hubSyncStates = new Map<string, HubSyncState>();

  init();

  function init() {
    hubManager.registerEvent(HubEvents.SYNC_REQUEST, handleSyncRequest);
    hubManager.registerEvent(HubEvents.HUB_CONNECTED, handleHubConnected);
    hubManager.registerEvent(HubEvents.SYNC_ERROR, handleSyncError);
  }

  /**
   * Handle sync error from hub - disable reconnection and set error state
   */
  function handleSyncError(hubUrl: string, rawData: unknown) {
    const result = SyncErrorSchema.safeParse(rawData);
    if (!result.success) {
      hubClientLog.error(
        `[SyncClient] Invalid sync_error from ${hubUrl}: ${JSON.stringify(result.error.issues)}`,
      );
      return;
    }

    const { error, message } = result.data;
    hubClientLog.error(
      `[SyncClient] Sync error from ${hubUrl}: ${error} - ${message}`,
    );

    // Update state to reflect the fatal error
    const state = getOrCreateState(hubUrl);
    state.status = "disabled";
    state.errorMessage = `${error}: ${message}`;

    // Disable reconnection for this hub
    hubManager.disableReconnection(hubUrl, message);
  }

  /**
   * Handle hub connection - load persisted state and send catch_up
   */
  async function handleHubConnected(hubUrl: string) {
    hubClientLog.write(
      `[SyncClient] Hub ${hubUrl} connected, initiating catch_up`,
    );

    // Load persisted sync state first
    await loadPersistedSyncState(hubUrl);

    const state = getOrCreateState(hubUrl);

    // Build catch_up request
    const catchUpRequest: CatchUpRequest = {
      host_id: localHostId,
      schema_version: schemaVersion,
      lastSyncedFromHub: state.lastSyncedFromHub,
    };

    hubClientLog.write(
      `[SyncClient] Sending catch_up to ${hubUrl} (lastSyncedFromHub: ${state.lastSyncedFromHub})`,
    );

    // Send catch_up with ack callback
    const sent = hubManager.sendMessage<CatchUpResponse | CatchUpResponseError>(
      hubUrl,
      HubEvents.CATCH_UP,
      catchUpRequest,
      (response) => handleCatchUpResponse(hubUrl, response),
    );

    if (!sent) {
      hubClientLog.error(
        `[SyncClient] Failed to send catch_up to ${hubUrl} - not connected`,
      );
    }
  }

  /**
   * Handle catch_up response from hub
   */
  async function handleCatchUpResponse(
    hubUrl: string,
    rawResponse: CatchUpResponse | CatchUpResponseError,
  ) {
    // First check if it's an error response
    const errorResult = CatchUpResponseErrorSchema.safeParse(rawResponse);
    if (errorResult.success) {
      const error = errorResult.data;
      hubClientLog.error(
        `[SyncClient] Catch-up error from ${hubUrl}: ${error.error} - ${error.message}`,
      );

      const state = getOrCreateState(hubUrl);
      state.status =
        error.error === "schema_mismatch"
          ? "schema_mismatch"
          : "internal_error";
      state.errorMessage = error.message;
      return;
    }

    // Validate as success response
    const result = CatchUpResponseSchema.safeParse(rawResponse);
    if (!result.success) {
      hubClientLog.error(
        `[SyncClient] Invalid catch_up response from ${hubUrl}: ${JSON.stringify(result.error.issues)}`,
      );
      return;
    }

    const response = result.data;
    const recordCount = countRecordsInTables(response.tables);

    hubClientLog.write(
      `[SyncClient] Received catch_up response from ${hubUrl} (${recordCount} records, has_more: ${response.has_more})`,
    );

    if (recordCount > 0) {
      // Process the forwarded data (same as processForwards)
      const success = await processForwards(hubUrl, response.tables);
      if (!success) {
        hubClientLog.error(
          `[SyncClient] Failed to process catch_up data from ${hubUrl}`,
        );
        return;
      }
    }

    // If there's more data, request it
    if (response.has_more) {
      hubClientLog.write(
        `[SyncClient] More catch_up data available from ${hubUrl}, sending follow-up request`,
      );

      const state = getOrCreateState(hubUrl);
      const catchUpRequest: CatchUpRequest = {
        host_id: localHostId,
        schema_version: schemaVersion,
        lastSyncedFromHub: state.lastSyncedFromHub,
      };

      hubManager.sendMessage<CatchUpResponse | CatchUpResponseError>(
        hubUrl,
        HubEvents.CATCH_UP,
        catchUpRequest,
        (response) => handleCatchUpResponse(hubUrl, response),
      );
    } else {
      hubClientLog.write(`[SyncClient] Catch-up complete for ${hubUrl}`);
    }
  }

  /**
   * Get or create sync state for a hub
   */
  function getOrCreateState(hubUrl: string): HubSyncState {
    let state = hubSyncStates.get(hubUrl);
    if (!state) {
      state = {
        status: "connected",
        lastSyncedFromHub: new Date(0).toISOString(),
      };
      hubSyncStates.set(hubUrl, state);
    }
    return state;
  }

  /**
   * Load persisted sync state from database for a hub
   */
  async function loadPersistedSyncState(hubUrl: string): Promise<void> {
    const state = getOrCreateState(hubUrl);
    try {
      const since = await dbService.usingDatabase((prisma) =>
        loadSyncState(prisma, hubUrl),
      );
      if (since) {
        state.lastSyncedFromHub = since;
        hubClientLog.write(
          `[SyncClient] Loaded persisted sync state for ${hubUrl}: lastSyncedFromHub=${state.lastSyncedFromHub}`,
        );
      }
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error loading persisted sync state for ${hubUrl}: ${error}`,
      );
    }
  }

  /**
   * Persist sync state to database for a hub
   */
  async function persistSyncState(
    hubUrl: string,
    lastSyncedFromHub: string,
  ): Promise<void> {
    try {
      await dbService.usingDatabase((prisma) =>
        saveSyncState(prisma, hubUrl, lastSyncedFromHub),
      );
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error persisting sync state for ${hubUrl}: ${error}`,
      );
    }
  }

  /**
   * Process forwarded data from a sync request.
   * Upserts records to local database, preserving original timestamps.
   * Updates and persists lastSyncedFromHub timestamp on success.
   * Returns true if successful, false on error.
   */
  async function processForwards(
    hubUrl: string,
    forwards: Record<string, unknown[]>,
  ): Promise<boolean> {
    // Count total records
    const totalRecords = countRecordsInTables(forwards);

    if (totalRecords === 0) {
      return true;
    }

    hubClientLog.write(
      `[SyncClient] Processing ${totalRecords} forwarded records from ${hubUrl}`,
    );

    try {
      // Find max timestamp from forwarded records before processing
      const maxTimestamp = findMaxUpdatedAtFromTables(forwards);

      await dbService.usingDatabase(async (prisma) => {
        // Process in FORWARDABLE_TABLES order for FK dependencies
        for (const table of FORWARDABLE_TABLES) {
          const tableData = forwards[table] as
            | Record<string, unknown>[]
            | undefined;
          if (!tableData || tableData.length === 0) continue;

          await upsertRecords(prisma, table as SyncableTable, tableData);

          hubClientLog.write(
            `[SyncClient] Upserted ${tableData.length} forwarded ${table} records`,
          );
        }
      });

      // Update and persist lastSyncedFromHub timestamp
      if (maxTimestamp) {
        const state = getOrCreateState(hubUrl);
        state.lastSyncedFromHub = maxTimestamp.toISOString();
        await persistSyncState(hubUrl, state.lastSyncedFromHub);
        hubClientLog.write(
          `[SyncClient] Updated lastSyncedFromHub for ${hubUrl} to ${state.lastSyncedFromHub}`,
        );
      }

      return true;
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error processing forwarded data from ${hubUrl}: ${error}`,
      );
      return false;
    }
  }

  /**
   * Handle sync request from a hub
   */
  async function handleSyncRequest(
    hubUrl: string,
    rawData: unknown,
    ack?: (response: SyncResponse | SyncResponseError) => void,
  ) {
    // Check if this is a new hub we haven't seen before
    const isNewHub = !hubSyncStates.has(hubUrl);
    const state = getOrCreateState(hubUrl);

    // Load persisted state for new hubs (async but state will be used for catch_up later)
    if (isNewHub) {
      await loadPersistedSyncState(hubUrl);
    }

    // Validate request with schema
    const result = SyncRequestSchema.safeParse(rawData);
    if (!result.success) {
      hubClientLog.error(
        `[SyncClient] Invalid sync request from ${hubUrl}: ${JSON.stringify(result.error.issues)}`,
      );
      return;
    }

    const data: SyncRequest = result.data;

    // Check schema version
    if (data.schema_version !== schemaVersion) {
      const errorMessage = `Schema version mismatch: expected ${schemaVersion}, got ${data.schema_version}`;
      hubClientLog.error(`[SyncClient] ${errorMessage} from ${hubUrl}`);

      // Update state to reflect the error
      state.status = "schema_mismatch";
      state.errorMessage = errorMessage;

      // Send error response so hub knows we can't sync
      if (ack) {
        const errorResponse: SyncResponseError = {
          error: "schema_mismatch",
          message: errorMessage,
        };
        ack(errorResponse);
      }
      return;
    }

    // Connection is healthy - ensure state reflects this
    state.status = "connected";
    state.errorMessage = undefined;

    // Process any forwarded data first (before responding with our own data)
    if (data.forwards) {
      const forwardSuccess = await processForwards(hubUrl, data.forwards);
      if (!forwardSuccess) {
        // Log error but continue with sync response - forwards are best-effort
        hubClientLog.error(
          `[SyncClient] Failed to process some forwarded data from ${hubUrl}, continuing with sync response`,
        );
      }
    }

    hubClientLog.write(
      `[SyncClient] Processing sync_request from ${hubUrl} (since: ${data.since})`,
    );

    try {
      // Query local database for changes since data.since
      const sinceDate = new Date(data.since);

      // Query all syncable tables
      const tables: Record<string, unknown[]> = {};
      let hasMore = false;
      let totalRows = 0;

      await dbService.usingDatabase(async (prisma) => {
        for (const table of SYNCABLE_TABLES) {
          const result = await queryChangedRecords(
            prisma,
            table as SyncableTable,
            sinceDate,
            SYNC_BATCH_SIZE,
            localHostId,
          );

          if (result.records.length > 0) {
            tables[table] = serializeRecords(result.records);
            totalRows += result.records.length;
          }

          if (result.hasMore) {
            hasMore = true;
          }
        }
      });

      // Build response
      const response: SyncResponse = {
        host_id: localHostId,
        has_more: hasMore,
        tables,
      };

      // Send response via ack callback if provided
      if (ack) {
        hubClientLog.write(
          `[SyncClient] Sending sync response to ${hubUrl} (${totalRows} rows across ${Object.keys(tables).length} tables, has_more: ${hasMore})`,
        );
        ack(response);
      } else {
        hubClientLog.error(
          `[SyncClient] No ack callback provided for sync_request from ${hubUrl}`,
        );
      }
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error processing sync request from ${hubUrl}: ${error}`,
      );

      if (ack) {
        const errorResponse: SyncResponseError = {
          error: "internal_error",
          message: `Failed to query database: ${error}`,
        };
        ack(errorResponse);
      }
    }
  }

  function handleCommand(): Promise<string> {
    const hubs = hubManager.getAllHubs();

    if (hubs.length === 0) {
      return Promise.resolve("No hubs configured. Running in standalone mode.");
    }

    const rows: string[][] = [
      ["URL", "Connected", "Sync Status", "Last Synced"],
    ];
    const errors: string[] = [];

    for (const hub of hubs) {
      const connected = hub.connected ? "Yes" : "No";
      const state = hubSyncStates.get(hub.url);
      const syncStatus = state?.status ?? "pending";

      // Collect error messages to show separately
      if (state?.status === "disabled" && state.errorMessage) {
        errors.push(`${hub.url}: ${state.errorMessage}`);
      }

      let lastSynced = "N/A";
      if (state?.lastSyncedFromHub) {
        const date = new Date(state.lastSyncedFromHub);
        // Show "never" for epoch time (no sync yet)
        lastSynced = date.getTime() === 0 ? "never" : date.toLocaleString();
      }

      rows.push([hub.url, connected, syncStatus, lastSynced]);
    }

    let output = table(rows, { hsep: " | " });

    if (errors.length > 0) {
      output += "\n\nErrors:\n" + errors.join("\n");
    }

    return Promise.resolve(output);
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-hubs",
    helpText: "Show hub connection and sync status",
    handleCommand,
  };

  return {
    ...registrableCommand,
    /** Get sync status for a specific hub */
    getHubSyncStatus: (hubUrl: string): HubSyncClientStatus | undefined => {
      return hubSyncStates.get(hubUrl)?.status;
    },
    /** Get lastSyncedFromHub timestamp for a specific hub (for catch_up) */
    getLastSyncedFromHub: (hubUrl: string): string | undefined => {
      return hubSyncStates.get(hubUrl)?.lastSyncedFromHub;
    },
    /** Get all hub sync states */
    getAllHubSyncStates: (): Map<string, HubSyncState> => {
      return new Map(hubSyncStates);
    },
  };
}

export type HubSyncClient = ReturnType<typeof createHubSyncClient>;
