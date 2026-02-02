import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { createHubAgentService } from "./handlers/hubAgentService.js";
import { createHubCostService } from "./handlers/hubCostService.js";
import { createHubHeartbeatService } from "./handlers/hubHeartbeatService.js";
import { createHubLogService } from "./handlers/hubLogService.js";
import { createHubMailService } from "./handlers/hubMailService.js";
import { createHubRunService } from "./handlers/hubRunService.js";
import { createHubUserService } from "./handlers/hubUserService.js";
import { createHubConfig } from "./hubConfig.js";
import { createAgentRegistrar } from "./services/agentRegistrar.js";
import { createHostService } from "./services/hostService.js";
import { createHubServerLog } from "./services/hubServerLog.js";
import { createHostRegistrar } from "./services/hostRegistrar.js";
import { createNaisysServer } from "./services/naisysServer.js";

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

    // Schema version for sync protocol - should match NAISYS instance
    const dbService = await createDatabaseService(
      process.env.NAISYS_FOLDER || "",
      "hub",
    );

    // Create hub config and host service (hub owns its host identity)
    const hubConfig = createHubConfig();
    const hostService = await createHostService(dbService);

    // Seed database with agent configs from yaml files
    await createAgentRegistrar(
      hubConfig,
      dbService,
      startupAgentPath,
    );

    // Create host registrar for tracking NAISYS instance connections
    const hostRegistrar = createHostRegistrar(dbService);

    // Create shared HTTP server and Socket.IO instance
    const httpServer = http.createServer();
    const io = new Server(httpServer, {
      cors: {
        origin: "*", // In production, restrict this
        methods: ["GET", "POST"],
      },
    });

    // Create NAISYS server on /naisys namespace
    const naisysServer = createNaisysServer(
      io.of("/naisys"),
      hubAccessKey,
      logService,
      hostRegistrar,
    );

    // Register hub user service for user_list requests from NAISYS instances
    createHubUserService(naisysServer, dbService, logService);

    // Register hub run service for session_create/session_increment requests
    createHubRunService(naisysServer, dbService, logService);

    // Register hub log service for log_write events from NAISYS instances
    createHubLogService(naisysServer, dbService, logService);

    // Register hub heartbeat service for NAISYS instance heartbeat tracking
    const heartbeatService = createHubHeartbeatService(naisysServer, dbService, logService);

    // Register hub agent service for agent_start requests routed to target hosts
    createHubAgentService(naisysServer, dbService, logService, heartbeatService);

    // Register hub mail service for mail events from NAISYS instances
    createHubMailService(naisysServer, dbService, logService, heartbeatService);

    // Register hub cost service for cost_write events from NAISYS instances
    createHubCostService(naisysServer, dbService, logService, heartbeatService, hubConfig);

    // Start listening
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(hubPort, () => {
        httpServer.removeListener("error", reject);
        logService.log(`[Hub] Server listening on port ${hubPort}`);
        resolve();
      });
    });

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
