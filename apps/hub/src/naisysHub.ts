import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { createHubConfig } from "./hubConfig.js";
import { createHubClientLog } from "./interhub/hubClientLog.js";
import { createInterhubManager } from "./interhub/interhubManager.js";
import { createAgentRegistrar } from "./services/agentRegistrar.js";
import { createHostService } from "./services/hostService.js";
import { createHubServer } from "./services/hubServer.js";
import { createHubServerLog } from "./services/hubServerLog.js";
import { createRunnerRegistrar } from "./services/runnerRegistrar.js";

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --hub flag.
 */
export async function startHub(
  startupType: "standalone" | "hosted",
  startSupervisor?: any,
  startupAgentPath?: string,
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

    // Create hub config and host service (hub owns its host identity)
    const hubConfig = createHubConfig();
    const hostService = await createHostService(hubConfig, dbService);

    // Seed database with agent configs from yaml files
    await createAgentRegistrar(hubConfig, dbService, hostService, startupAgentPath);

    // Create runner registrar for tracking runner connections
    const runnerRegistrar = createRunnerRegistrar(dbService, hostService);

    // Create hub server
    const hubServer = await createHubServer(hubPort, hubAccessKey, logService, runnerRegistrar);

    // Start interhub client for hub-to-hub federation
    const hubClientLog = createHubClientLog();
    const interhubManager = createInterhubManager(
      hubConfig,
      hostService,
      hubClientLog,
    );

    console.log(
      `[Hub] Running on ws://localhost:${hubPort}, logs written to file`,
    );

    /**
     * There should be no dependency between supervisor and hub
     * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
     */
    if (startSupervisor) {
      // Don't import the whole fastify web server module tree unless needed
      const { startServer } = await import("@naisys-supervisor/server");
      await startServer("hosted", "monitor-hub");
    }
  } catch (err) {
    console.error("[Hub] Failed to start hub server:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });

  program
    .argument(
      "[agent-path]",
      "Path to agent configuration file to seed the database (optional)",
    )
    .option("--supervisor", "Start Supervisor web server")
    .parse();

  void startHub("standalone", program.opts().supervisor, program.args[0]);
}
