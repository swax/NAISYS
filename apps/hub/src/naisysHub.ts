import dotenv from "dotenv";
import { createHubServer, HubServer } from "./services/hubServer.js";
import { createSyncService, SyncService } from "./services/syncService.js";

export { HubServer, SyncService };

export interface HubInstance {
  hubServer: HubServer;
  syncService: SyncService;
  shutdown: () => void;
}

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --hub flag.
 */
export async function startHub(
  startupType: "standalone" | "hosted"
): Promise<HubInstance> {
  console.log(`[Hub] Starting Hub server in ${startupType} mode...`);

  const hubPort = Number(process.env.HUB_PORT) || 3002;
  const hubAccessKey = process.env.HUB_ACCESS_KEY;
  if (!hubAccessKey) {
    console.error(
      "Error: HUB_ACCESS_KEY environment variable is required when using --hub"
    );
    process.exit(1);
  }

  // Schema version for sync protocol - should match runner
  const schemaVersion = 1; // TODO: Read from database schema_version table

  // Create hub server
  const hubServer = await createHubServer({
    port: hubPort,
    accessKey: hubAccessKey,
  });

  // Create sync service - it will register its event handlers on start()
  const syncService = createSyncService(hubServer, {
    schemaVersion,
    maxConcurrentRequests: 3,
    pollIntervalMs: 1000,
  });

  // Start the sync polling loop (also registers event handlers)
  syncService.start();

  return {
    hubServer,
    syncService,
    shutdown: () => {
      syncService.stop();
      hubServer.close();
    },
  };
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config({ quiet: true });

  startHub("standalone")
    .then(() => {
      console.log("[Hub] Hub server started successfully");
    })
    .catch((err) => {
      console.error("[Hub] Failed to start hub server:", err);
      process.exit(1);
    });
}
