import { DatabaseService } from "@naisys/database";
import {
  HubEvents,
  SyncRequestSchema,
  type SyncRequest,
  type SyncResponse,
} from "@naisys/hub-protocol";
import { HubClientLog } from "./hubClientLog.js";
import { HubManager } from "./hubManager.js";

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

  await init();

  async function init() {
    hubManager.registerEvent(HubEvents.SYNC_REQUEST, handleSyncRequest);
  }

  /**
   * Handle sync request from a hub
   */
  function handleSyncRequest(
    hubUrl: string,
    rawData: unknown,
    ack?: (response: SyncResponse) => void
  ) {
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
      hubClientLog.error(
        `[SyncClient] Schema version mismatch from ${hubUrl}: expected ${schemaVersion}, got ${data.schema_version}`
      );
      // Don't respond - hub will handle timeout
      return;
    }

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

  return {};
}

export type SyncClient = ReturnType<typeof createSyncClient>;
