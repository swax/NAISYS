import type { StartHub, StartServer } from "@naisys/common";
import { createHubDatabaseService } from "@naisys/hub-database";
import { program } from "commander";
import dotenv from "dotenv";
import https from "https";
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
import { loadOrCreateCert } from "./services/certService.js";
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

    // Load or generate self-signed TLS cert and access key
    const certInfo = await loadOrCreateCert();
    logService.log(`[Hub] Hub access key: ${certInfo.hubAccessKey}`);

    // Schema version for sync protocol - should match NAISYS instance
    const hubDatabaseService = await createHubDatabaseService();

    // Seed database with agent configs from yaml files (one-time, skips if non-empty)
    await seedAgentConfigs(hubDatabaseService, logService, startupAgentPath);

    // Create host registrar for tracking NAISYS instance connections
    const hostRegistrar = await createHostRegistrar(hubDatabaseService);

    // Create shared HTTPS server and Socket.IO instance
    const httpsServer = https.createServer({
      key: certInfo.key,
      cert: certInfo.cert,
    });
    const io = new Server(httpsServer, {
      cors: {
        origin: "*", // In production, restrict this
        methods: ["GET", "POST"],
      },
    });

    // Create NAISYS server on /naisys namespace
    const naisysServer = createNaisysServer(
      io.of("/naisys"),
      certInfo.hubAccessKey,
      logService,
      hostRegistrar,
    );

    // Register hub config service for config_get requests from NAISYS instances
    const configService = await createHubConfigService(
      naisysServer,
      hubDatabaseService,
      logService,
    );

    // Register hub user service for user_list requests from NAISYS instances
    createHubUserService(naisysServer, hubDatabaseService, logService);

    // Register hub models service for seeding and broadcasting models
    await createHubModelsService(naisysServer, hubDatabaseService, logService);

    // Register hub host service for broadcasting connected host list
    createHubHostService(naisysServer, hostRegistrar, logService);

    // Register hub run service for session_create/session_increment requests
    createHubRunService(naisysServer, hubDatabaseService, logService);

    // Register hub heartbeat service for NAISYS instance heartbeat tracking
    const heartbeatService = createHubHeartbeatService(
      naisysServer,
      hubDatabaseService,
      logService,
    );

    // Register hub log service for log_write events from NAISYS instances
    createHubLogService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
    );

    // Register hub mail service for mail events from NAISYS instances
    const mailService = createHubMailService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
    );

    // Register hub agent service for agent_start requests routed to target hosts
    createHubAgentService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      mailService,
    );

    // Register hub cost service for cost_write events from NAISYS instances
    createHubCostService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      configService,
    );

    // Start listening
    await new Promise<void>((resolve, reject) => {
      httpsServer.once("error", reject);
      httpsServer.listen(hubPort, () => {
        httpsServer.removeListener("error", reject);
        logService.log(`[Hub] Server listening on port ${hubPort}`);
        resolve();
      });
    });

    logService.log(
      `[Hub] Running on wss://localhost:${hubPort}, logs written to file`,
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
      supervisorPort = await startServer(
        "hosted",
        plugins,
        hubPort,
        certInfo.hubAccessKey,
      );
    }

    return { hubPort, hubAccessKey: certInfo.hubAccessKey, supervisorPort };
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
