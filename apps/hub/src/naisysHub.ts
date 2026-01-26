import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { createHubForwardService } from "./services/hubForwardService.js";
import { createRemoteAgentRouter } from "./services/remoteAgentRouter.js";
import { createHubServer } from "./services/hubServer.js";
import { createHubServerLog } from "./services/hubServerLog.js";
import { createHubSyncServer } from "./services/hubSyncServer.js";

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --hub flag.
 */
export async function startHub(
  startupType: "standalone" | "hosted",
): Promise<void> {
  try {
    // Create log service first
    const logService = createHubServerLog(startupType);

    logService.log(`[Hub] Starting Hub server in ${startupType} mode...`);

    const hubPort = Number(process.env.HUB_PORT) || 3002;
    const hubAccessKey = process.env.HUB_ACCESS_KEY;
    if (!hubAccessKey) {
      const errorStr =
        "Error: HUB_ACCESS_KEY environment variable is required when using --hub";
      console.log(errorStr);
      logService.error(errorStr);
      process.exit(1);
    }

    // Schema version for sync protocol - should match runner
    const dbService = await createDatabaseService(
      process.env.NAISYS_FOLDER || "",
      "hub",
    );

    // Create hub server
    const hubServer = await createHubServer(hubPort, hubAccessKey, logService);

    // Create forward service for managing forward queues
    const forwardService = createHubForwardService(logService);

    // Create hub sync server - it will register its event handlers on start()
    const hubSyncServer = createHubSyncServer(
      hubServer,
      dbService,
      logService,
      forwardService,
      {
        maxConcurrentRequests: 3,
        pollIntervalMs: 1000,
      },
    );

    // Create remote agent router for agent start/stop/log across machines
    createRemoteAgentRouter(hubServer, logService);

    console.log(
      `[Hub] Running on ws://localhost:${hubPort}, logs written to file`,
    );
  } catch (err) {
    console.error("[Hub] Failed to start hub server:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });

  program.option("--supervisor", "Start Supervisor web server").parse();

  /**
   * --supervisor flag is provided, start Supervisor server
   * There should be no dependency between supervisor and hub
   * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
   */
  if (program.opts().supervisor) {
    // Don't import the whole fastify web server module tree unless needed
    const { startServer } = await import("@naisys-supervisor/server");
    await startServer("hosted", "monitor-hub");
  }

  void startHub("standalone");
}
