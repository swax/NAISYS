import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { createHubAgentService } from "./handlers/hubAgentService.js";
import { createHubConfigService } from "./handlers/hubConfigService.js";
import { createHubCostService } from "./handlers/hubCostService.js";
import { createHubHeartbeatService } from "./handlers/hubHeartbeatService.js";
import { createHubHostService } from "./handlers/hubHostService.js";
import { createHubLogService } from "./handlers/hubLogService.js";
import { createHubMailService } from "./handlers/hubMailService.js";
import { createHubRunService } from "./handlers/hubRunService.js";
import { createHubUserService } from "./handlers/hubUserService.js";
import { createHubConfig } from "./hubConfig.js";
import { createAgentRegistrar } from "./services/agentRegistrar.js";
import { createHubServerLog } from "./services/hubServerLog.js";
import { createHostRegistrar } from "./services/hostRegistrar.js";
import { createNaisysServer } from "./services/naisysServer.js";

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --integrated-hub flag.
 */
export async function startHub(
  startupType: "standalone" | "hosted",
  startSupervisor?: any,
  plugins?: ("erp")[],
  startupAgentPath?: string,
): Promise<number> {
  try {
    // Create log service first
    const logService = createHubServerLog(startupType);

    logService.log(`[Hub] Starting Hub server in ${startupType} mode...`);

    const hubPort = Number(process.env.HUB_PORT) || 3002;
    const hubAccessKey = process.env.HUB_ACCESS_KEY;
    if (!hubAccessKey) {
      const errorStr = "Error: HUB_ACCESS_KEY environment variable is required";
      console.log(errorStr);
      logService.error(errorStr);
      process.exit(1);
    }

    // Schema version for sync protocol - should match NAISYS instance
    const dbService = await createDatabaseService(
      process.env.NAISYS_FOLDER || "",
    );

    // Create hub config and host service (hub owns its host identity)
    const hubConfig = createHubConfig();

    // Seed database with agent configs from yaml files
    await createAgentRegistrar(dbService, startupAgentPath);

    // Create host registrar for tracking NAISYS instance connections
    const hostRegistrar = await createHostRegistrar(dbService);

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

    // Register hub config service for config_get requests from NAISYS instances
    createHubConfigService(naisysServer, logService);

    // Register hub user service for user_list requests from NAISYS instances
    createHubUserService(naisysServer, dbService, logService);

    // Register hub host service for broadcasting connected host list
    createHubHostService(naisysServer, hostRegistrar, logService);

    // Register hub run service for session_create/session_increment requests
    createHubRunService(naisysServer, dbService, logService);

    // Register hub log service for log_write events from NAISYS instances
    createHubLogService(naisysServer, dbService, logService);

    // Register hub heartbeat service for NAISYS instance heartbeat tracking
    const heartbeatService = createHubHeartbeatService(
      naisysServer,
      dbService,
      logService,
    );

    // Register hub agent service for agent_start requests routed to target hosts
    createHubAgentService(
      naisysServer,
      dbService,
      logService,
      heartbeatService,
    );

    // Register hub mail service for mail events from NAISYS instances
    createHubMailService(naisysServer, dbService, logService, heartbeatService);

    // Register hub cost service for cost_write events from NAISYS instances
    createHubCostService(
      naisysServer,
      dbService,
      logService,
      heartbeatService,
      hubConfig,
    );

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
      await startServer("hosted", plugins);
    }

    return hubPort;
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
    .option("--erp", "Start ERP web app (requires --supervisor)")
    .parse();

  const plugins: ("erp")[] = [];
  if (program.opts().erp) plugins.push("erp");

  void startHub("standalone", program.opts().supervisor, plugins, program.args[0]);
}
