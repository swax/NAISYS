import { DatabaseService } from "@naisys/database";
import {
  HubEvents,
  SyncRequestSchema,
  type SyncRequest,
  type SyncResponse,
  type SyncResponseError,
} from "@naisys/hub-protocol";
import { HubClientLog } from "./hubClientLog.js";
import { HubManager } from "./hubManager.js";

/** Status of sync client connection to a specific hub */
export type SyncClientStatus =
  | "connected"
  | "schema_mismatch"
  | "internal_error";

/** Per-hub sync status */
interface HubSyncState {
  status: SyncClientStatus;
  errorMessage?: string;
}

/**
 * Handles sync requests from connected Hub servers.
 * Receives sync_request messages and responds with local data.
 */
export async function createSyncClient(
  hubManager: HubManager,
  hubClientLog: HubClientLog,
  dbService: DatabaseService
) {
  const schemaVersion = dbService.getSchemaVersion();

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
   * Handle sync request from a hub
   */
  function handleSyncRequest(
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

    hubClientLog.write(
      `[SyncClient] Processing sync_request from ${hubUrl} (since: ${data.since})`
    );

    // TODO: Query local database for changes since data.since
    // For now, respond with empty tables
    const response: SyncResponse = {
      host_id: "", // Will be filled by actual implementation
      has_more: false,
      tables: {},
    };

    // Send response via ack callback if provided
    if (ack) {
      hubClientLog.write(
        `[SyncClient] Sending sync response to ${hubUrl} (tables: ${Object.keys(response.tables).length})`
      );
      ack(response);
    } else {
      hubClientLog.error(
        `[SyncClient] No ack callback provided for sync_request from ${hubUrl}`
      );
    }
  }

  return {
    /** Get sync status for a specific hub */
    getHubSyncStatus: (hubUrl: string): SyncClientStatus | undefined => {
      return hubSyncStates.get(hubUrl)?.status;
    },
    /** Get all hub sync states */
    getAllHubSyncStates: (): Map<string, HubSyncState> => {
      return new Map(hubSyncStates);
    },
  };
}

export type SyncClient = Awaited<ReturnType<typeof createSyncClient>>;
