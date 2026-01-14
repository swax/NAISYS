import { createDatabaseService } from "@naisys/database";
import dotenv from "dotenv";
import { createHubServer } from "./services/hubServer.js";
import {
  createHubServerLog,
  type HubServerLog,
} from "./services/hubServerLog.js";
import { createSyncServer } from "./services/syncServer.js";

export interface HubInstance {
  logService: HubServerLog;
  shutdown: () => void;
}

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --hub flag.
 */
export async function startHub(
  startupType: "standalone" | "hosted"
): Promise<HubInstance> {
  // Create log service first
  const logService = createHubServerLog(startupType);

  logService.log(`[Hub] Starting Hub server in ${startupType} mode...`);

  const hubPort = Number(process.env.HUB_PORT) || 3002;
  const hubAccessKey = process.env.HUB_ACCESS_KEY;
  if (!hubAccessKey) {
    logService.error(
      "Error: HUB_ACCESS_KEY environment variable is required when using --hub"
    );
    process.exit(1);
  }

  if (startupType === "hosted") {
    console.log(
      `[Hub] Running on ws://localhost:${hubPort}, logs written to file`
    );
  }

  // Schema version for sync protocol - should match runner
  const dbService = await createDatabaseService(
    process.env.NAISYS_FOLDER || "",
    "hub"
  );

  // Create hub server
  const hubServer = await createHubServer(hubPort, hubAccessKey, logService);

  // Create sync server - it will register its event handlers on start()
  const syncServer = createSyncServer(hubServer, dbService, logService, {
    maxConcurrentRequests: 3,
    pollIntervalMs: 1000,
  });

  return {
    logService,
    shutdown: () => {
      syncServer.stop();
      hubServer.close();
    },
  };
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config({ quiet: true });

  startHub("standalone")
    .then(({ logService }) => {
      logService.log("[Hub] Hub server started successfully");
    })
    .catch((err) => {
      console.error("[Hub] Failed to start hub server:", err);
      process.exit(1);
    });
}
