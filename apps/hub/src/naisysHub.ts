import type { HostedSupervisorModule, StartHub } from "@naisys/common";
import {
  createDualLogger,
  cwdWithTilde,
  ensureDotEnv,
  expandNaisysFolder,
  promptResetSuperAdminAccount,
  runSetupWizard,
  type WizardConfig,
} from "@naisys/common-node";
import { createHubDatabaseService } from "@naisys/hub-database";
import { program } from "commander";
import dotenv from "dotenv";
import Fastify from "fastify";
import { Server } from "socket.io";
import { fileURLToPath } from "url";

import { createHubAccessKeyService } from "./handlers/hubAccessKeyService.js";
import { createHubAgentService } from "./handlers/hubAgentService.js";
import { createHubAttachmentService } from "./handlers/hubAttachmentService.js";
import { createHubConfigService } from "./handlers/hubConfigService.js";
import { createHubCostService } from "./handlers/hubCostService.js";
import { createHubHeartbeatService } from "./handlers/hubHeartbeatService.js";
import { createHubHostService } from "./handlers/hubHostService.js";
import { createHubLogService } from "./handlers/hubLogService.js";
import { createHubMailService } from "./handlers/hubMailService.js";
import { createHubModelsService } from "./handlers/hubModelsService.js";
import { createHubRedactionService } from "./handlers/hubRedactionService.js";
import { createHubRunService } from "./handlers/hubRunService.js";
import { createHubRuntimeKeyService } from "./handlers/hubRuntimeKeyService.js";
import { createHubSendMailService } from "./handlers/hubSendMailService.js";
import { createHubUserService } from "./handlers/hubUserService.js";
import { loadOrCreateAccessKey } from "./services/accessKeyService.js";
import { seedAgentConfigs } from "./services/agentRegistrar.js";
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
  wizardRan,
) => {
  try {
    const agentPath = startupAgentPath || ".";
    let cleanupSupervisor:
      | HostedSupervisorModule["cleanupSupervisor"]
      | undefined;

    // Create log service first
    const logService = createDualLogger("hub-server.log");

    logService.log(`[Hub] Starting Hub server in ${startupType} mode...`);

    const serverPort = Number(process.env.SERVER_PORT) || 3300;

    // Load or generate hub access key for client authentication
    const hubAccessKey = loadOrCreateAccessKey();
    const naisysFolder = process.env.NAISYS_FOLDER || "";
    logService.log(
      `[Hub] Hub access key located at: ${naisysFolder}/cert/hub-access-key`,
    );

    // Schema version for sync protocol - should match NAISYS instance
    const hubDatabaseService = await createHubDatabaseService();

    // Seed database with agent configs from yaml files (one-time, skips if non-empty)
    await seedAgentConfigs(hubDatabaseService, logService, agentPath);

    // Create host registrar for tracking NAISYS instance connections
    const hostRegistrar = await createHostRegistrar(hubDatabaseService);

    // trustProxy: TLS terminates at the reverse proxy, so honor X-Forwarded-*
    // headers — otherwise request.protocol reads the internal http hop.
    const fastify = Fastify({ pluginTimeout: 60_000, trustProxy: true });

    // Register HTTP attachment upload/download routes
    createHubAttachmentService(fastify, hubDatabaseService, logService);

    // Attach Socket.IO to the underlying HTTP server.
    // No CORS config: only Node socket.io-clients (NAISYS instance, supervisor server)
    // connect here, and they aren't subject to CORS. Omitting the header keeps
    // browsers from initiating handshakes.
    const io = new Server(fastify.server, {
      path: "/hub/socket.io",
    });

    const naisysServer = createNaisysServer(
      io,
      hubAccessKey,
      logService,
      hostRegistrar,
    );

    // Register hub access key rotation handler
    createHubAccessKeyService(naisysServer, logService);

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

    // Register redaction service so log/mail ingest can scrub sensitive values
    // before they hit the DB or get rebroadcast. Must come after the models
    // service since that upgrades built-in model API key variables to sensitive
    // — initializing the redactor earlier would snapshot them as non-sensitive.
    const redactionService = await createHubRedactionService(
      naisysServer,
      hubDatabaseService,
      logService,
    );

    // Shared mint/revoke for runtime API keys (agent service + heartbeat).
    const runtimeKeyService = createHubRuntimeKeyService(
      hubDatabaseService,
      redactionService,
    );

    // Register hub host service for broadcasting connected host list
    createHubHostService(naisysServer, hostRegistrar, logService);

    // Register hub run service for session_create/session_increment requests
    createHubRunService(naisysServer, hubDatabaseService, logService);

    // Register hub heartbeat service for NAISYS instance heartbeat tracking
    const heartbeatService = createHubHeartbeatService(
      naisysServer,
      hubDatabaseService,
      logService,
      redactionService,
      runtimeKeyService,
    );

    // Register hub log service for log_write events from NAISYS instances
    createHubLogService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      redactionService,
    );

    // Register hub cost service for cost_write events from NAISYS instances
    const costService = createHubCostService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      configService,
    );

    // Register hub send mail service (pure mail sending, no auto-start logic)
    const sendMailService = createHubSendMailService(
      naisysServer,
      hubDatabaseService,
      heartbeatService,
      redactionService,
    );

    // Register hub agent service for agent_start requests routed to target hosts
    const agentService = createHubAgentService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      sendMailService,
      hostRegistrar,
      runtimeKeyService,
    );

    // Register hub mail service for mail events from NAISYS instances
    const mailService = createHubMailService(
      naisysServer,
      hubDatabaseService,
      logService,
      heartbeatService,
      sendMailService,
      agentService,
      costService,
      configService,
    );

    /**
     * There should be no dependency between supervisor and hub
     * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
     */
    if (startSupervisor) {
      // Don't import the whole fastify web server module tree unless needed
      // Use variable to avoid compile-time type dependency on @naisys/supervisor (allows parallel builds)
      const supervisorModule = "@naisys/supervisor";
      const hostedSupervisor = (await import(
        supervisorModule
      )) as HostedSupervisorModule;
      const { supervisorPlugin, bootstrapSupervisor } = hostedSupervisor;
      cleanupSupervisor = hostedSupervisor.cleanupSupervisor;
      const resetSuperAdminAccount = wizardRan
        ? await promptResetSuperAdminAccount("Supervisor Setup", {
            defaultReset: !process.argv.includes("--setup"),
          })
        : false;

      // Bootstrap before plugin register so the operator prompt isn't bounded by pluginTimeout and doesn't interleave with hub connection logs.
      await bootstrapSupervisor({ resetSuperAdminAccount });

      await fastify.register(supervisorPlugin, {
        plugins,
        serverPort,
        hosted: true,
      });
    }

    // Start listening
    await fastify.listen({ port: serverPort, host: "0.0.0.0" });

    logService.log(
      `[Hub] Running on http://localhost:${serverPort}/hub, logs written to file`,
    );
    if (startupType === "hosted") {
      logService.disableConsole();
    }

    let shutdownPromise: Promise<void> | null = null;
    // Like NAISYS: process exit reaps sockets and Fastify. Clear known timers
    // synchronously, but only wait for the DB disconnect.
    async function runShutdown(): Promise<void> {
      try {
        cleanupSupervisor?.();
        heartbeatService.cleanup();
        costService.cleanup();
        mailService.cleanup();
      } finally {
        await hubDatabaseService.disconnect();
      }
    }

    const shutdown = (): Promise<void> => {
      shutdownPromise ??= runShutdown();
      return shutdownPromise;
    };

    // Hosted mode: parent process owns signal handling
    if (startupType === "standalone") {
      let shuttingDown = false;
      const handleShutdown = async (signal: "SIGINT" | "SIGTERM") => {
        if (shuttingDown) {
          console.log("[Hub] Force exit");
          process.exit(1);
        }
        shuttingDown = true;
        logService.log(`[Hub] Shutting down (${signal})...`);
        try {
          await shutdown();
        } catch (err) {
          console.error("[Hub] Error during shutdown:", err);
        }
        process.exit(0);
      };
      process.on("SIGTERM", () => void handleShutdown("SIGTERM"));
      process.on("SIGINT", () => void handleShutdown("SIGINT"));
    }

    return { serverPort, shutdown };
  } catch (err) {
    console.error("[Hub] Failed to start hub server:", err);
    process.exit(1);
  }
};

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });

  const hubWizardConfig: WizardConfig = {
    title: "NAISYS Hub Setup",
    sections: [
      {
        type: "fields",
        comment: "Hub server configuration",
        fields: [
          {
            key: "NAISYS_FOLDER",
            label: "NAISYS Data Folder",
            defaultValue: cwdWithTilde(),
          },
          { key: "SERVER_PORT", label: "Server Port" },
        ],
      },
    ],
  };

  const hubExampleUrl = new URL("../.env.example", import.meta.url);

  let wizardRan = false;
  if (process.argv.includes("--setup")) {
    const { default: path } = await import("path");
    wizardRan = await runSetupWizard(
      path.resolve(".env"),
      hubExampleUrl,
      hubWizardConfig,
    );
    expandNaisysFolder();
  }

  wizardRan = (await ensureDotEnv(hubExampleUrl, hubWizardConfig)) || wizardRan;
  expandNaisysFolder();

  program
    .argument(
      "[agent-path]",
      "Path to agent configuration file to seed the database (optional)",
    )
    .option("--supervisor", "Start Supervisor web server")
    .option("--erp", "Start ERP web app (requires --supervisor)")
    .option("--setup", "Run interactive setup wizard")
    .parse();

  const plugins: "erp"[] = [];
  if (program.opts().erp) plugins.push("erp");

  void startHub(
    "standalone",
    program.opts().supervisor,
    plugins,
    program.args[0],
    wizardRan,
  );
}
