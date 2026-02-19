import type { StartHub, StartServer } from "@naisys/common";
import { createDatabaseService } from "@naisys/hub-database";
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
import { seedAgentConfigs } from "./services/agentRegistrar.js";
import { createHubModelsService } from "./handlers/hubModelsService.js";
import { createHubServerLog } from "./services/hubServerLog.js";
import { createHostRegistrar } from "./services/hostRegistrar.js";
import { createNaisysServer } from "./services/naisysServer.js";

/**
 * Starts the Hub server with sync service.
 * Can be called standalone or inline from naisys with --integrated-hub flag.
 */
export const startHub: StartHub = async (
  startupType,
  startSupervisor,
  plugins,
  startupAgentPath,
) => {
  try {
    // Create log service first
    const logService = createHubServerLog(startupType);

    logService.log(`[Hub] Starting Hub server in ${startupType} mode...`);

    const hubPort = Number(process.env.HUB_PORT) || 3101;
    const hubAccessKey = process.env.HUB_ACCESS_KEY;
    if (!hubAccessKey) {
      const errorStr = "Error: HUB_ACCESS_KEY environment variable is required";
      console.log(errorStr);
      logService.error(errorStr);
      process.exit(1);
    }

    // Schema version for sync protocol - should match NAISYS instance
    const dbService = await createDatabaseService();

    // Seed database with agent configs from yaml files (one-time, skips if non-empty)
    await seedAgentConfigs(dbService, logService, startupAgentPath);

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
    const configService = await createHubConfigService(
      naisysServer,
      dbService,
      logService,
    );

    // Register hub user service for user_list requests from NAISYS instances
    createHubUserService(naisysServer, dbService, logService);

    // Register hub models service for seeding and broadcasting models
    await createHubModelsService(naisysServer, dbService, logService);

    // Register hub host service for broadcasting connected host list
    createHubHostService(naisysServer, hostRegistrar, logService);

    // Register hub run service for session_create/session_increment requests
    createHubRunService(naisysServer, dbService, logService);

    // Register hub heartbeat service for NAISYS instance heartbeat tracking
    const heartbeatService = createHubHeartbeatService(
      naisysServer,
      dbService,
      logService,
    );

    // Register hub log service for log_write events from NAISYS instances
    createHubLogService(naisysServer, dbService, logService, heartbeatService);

    // Register hub mail service for mail events from NAISYS instances
    const mailService = createHubMailService(
      naisysServer,
      dbService,
      logService,
      heartbeatService,
    );

    // Register hub agent service for agent_start requests routed to target hosts
    createHubAgentService(
      naisysServer,
      dbService,
      logService,
      heartbeatService,
      mailService,
    );

    // Register hub cost service for cost_write events from NAISYS instances
    createHubCostService(
      naisysServer,
      dbService,
      logService,
      heartbeatService,
      configService,
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

    logService.log(
      `[Hub] Running on ws://localhost:${hubPort}, logs written to file`,
    );
    logService.disableConsole();

    /**
     * There should be no dependency between supervisor and hub
     * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
     */
    let supervisorPort: number | undefined;
    if (startSupervisor) {
      // Don't import the whole fastify web server module tree unless needed
      // Use variable to avoid compile-time type dependency on @naisys-supervisor/server (allows parallel builds)
      const supervisorModule = "@naisys-supervisor/server";
      const { startServer } = (await import(supervisorModule)) as {
        startServer: StartServer;
      };
      supervisorPort = await startServer("hosted", plugins, hubPort);
    }

    return { hubPort, supervisorPort };
  } catch (err) {
    console.error("[Hub] Failed to start hub server:", err);
    process.exit(1);
  }
};

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

  const plugins: "erp"[] = [];
  if (program.opts().erp) plugins.push("erp");

  void startHub(
    "standalone",
    program.opts().supervisor,
    plugins,
    program.args[0],
  );
}
