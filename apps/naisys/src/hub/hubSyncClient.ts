import {
  DatabaseService,
  FORWARDABLE_TABLES,
  queryChangedRecords,
  serializeRecords,
  SYNCABLE_TABLES,
  upsertRecords,
  type SyncableTable,
} from "@naisys/database";
import {
  HubEvents,
  SyncRequestSchema,
  type SyncRequest,
  type SyncResponse,
  type SyncResponseError,
} from "@naisys/hub-protocol";
import { HostService } from "../services/hostService.js";
import { HubClientLog } from "./hubClientLog.js";
import { HubManager } from "./hubManager.js";

/** Maximum rows to return per table per sync request */
const SYNC_BATCH_SIZE = 1000;

/** Status of hub sync client connection to a specific hub */
export type HubSyncClientStatus =
  | "connected"
  | "schema_mismatch"
  | "internal_error";

/** Per-hub sync status */
interface HubSyncState {
  status: HubSyncClientStatus;
  errorMessage?: string;
}

/**
 * Handles sync requests from connected Hub servers.
 * Receives sync_request messages and responds with local data.
 */
export async function createHubSyncClient(
  hubManager: HubManager,
  hubClientLog: HubClientLog,
  dbService: DatabaseService,
  hostService: HostService
) {
  const schemaVersion = dbService.getSchemaVersion();
  const { localHostId } = hostService;

  /** Track sync status per hub URL */
  const hubSyncStates = new Map<string, HubSyncState>();

  await init();

  async function init() {
    hubManager.registerEvent(HubEvents.SYNC_REQUEST, handleSyncRequest);
  }

  /**
   * Get or create sync state for a hub
   */
  function getOrCreateState(hubUrl: string): HubSyncState {
    let state = hubSyncStates.get(hubUrl);
    if (!state) {
      state = { status: "connected" };
      hubSyncStates.set(hubUrl, state);
    }
    return state;
  }

  /**
   * Process forwarded data from a sync request.
   * Upserts records to local database, preserving original timestamps.
   * Returns true if successful, false on error.
   */
  async function processForwards(
    hubUrl: string,
    forwards: Record<string, unknown[]>
  ): Promise<boolean> {
    // Count total records
    const totalRecords = Object.values(forwards).reduce(
      (sum, records) => sum + records.length,
      0
    );

    if (totalRecords === 0) {
      return true;
    }

    hubClientLog.write(
      `[SyncClient] Processing ${totalRecords} forwarded records from ${hubUrl}`
    );

    try {
      await dbService.usingDatabase(async (prisma) => {
        // Process in FORWARDABLE_TABLES order for FK dependencies
        for (const table of FORWARDABLE_TABLES) {
          const tableData = forwards[table] as Record<string, unknown>[] | undefined;
          if (!tableData || tableData.length === 0) continue;

          await upsertRecords(prisma, table as SyncableTable, tableData);

          hubClientLog.write(
            `[SyncClient] Upserted ${tableData.length} forwarded ${table} records`
          );
        }
      });

      return true;
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error processing forwarded data from ${hubUrl}: ${error}`
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
    ack?: (response: SyncResponse | SyncResponseError) => void
  ) {
    const state = getOrCreateState(hubUrl);

    // Validate request with schema
    const result = SyncRequestSchema.safeParse(rawData);
    if (!result.success) {
      hubClientLog.error(
        `[SyncClient] Invalid sync request from ${hubUrl}: ${JSON.stringify(result.error.issues)}`
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
          `[SyncClient] Failed to process some forwarded data from ${hubUrl}, continuing with sync response`
        );
      }
    }

    hubClientLog.write(
      `[SyncClient] Processing sync_request from ${hubUrl} (since: ${data.since})`
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
            localHostId
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
          `[SyncClient] Sending sync response to ${hubUrl} (${totalRows} rows across ${Object.keys(tables).length} tables, has_more: ${hasMore})`
        );
        ack(response);
      } else {
        hubClientLog.error(
          `[SyncClient] No ack callback provided for sync_request from ${hubUrl}`
        );
      }
    } catch (error) {
      hubClientLog.error(
        `[SyncClient] Error processing sync request from ${hubUrl}: ${error}`
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

  return {
    /** Get sync status for a specific hub */
    getHubSyncStatus: (hubUrl: string): HubSyncClientStatus | undefined => {
      return hubSyncStates.get(hubUrl)?.status;
    },
    /** Get all hub sync states */
    getAllHubSyncStates: (): Map<string, HubSyncState> => {
      return new Map(hubSyncStates);
    },
  };
}

export type HubSyncClient = Awaited<ReturnType<typeof createHubSyncClient>>;
