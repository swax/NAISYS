import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agent/agentManager.js";
import { createAgentRegistrar } from "./agent/agentRegistrar.js";
import { createGlobalConfig } from "./globalConfig.js";
import { createHubClientLog } from "./hub/hubClientLog.js";
import { createHubManager } from "./hub/hubManager.js";
import { createRemoteAgentHandler } from "./hub/remoteAgentHandler.js";
import { createRemoteAgentRequester } from "./hub/remoteAgentRequester.js";
import { createHubSyncClient } from "./hub/hubSyncClient.js";
import { createHostService } from "./services/hostService.js";

dotenv.config({ quiet: true });

program
  .argument("[agent-path]", "Path to agent configuration file (optional, defaults to admin agent)")
  .option(
    "--hub",
    "Start Hub server for NAISYS instances running across machines",
  )
  .option("--supervisor", "Start Supervisor web server")
  .parse();

const globalConfig = await createGlobalConfig();
const dbService = await createDatabaseService(
  globalConfig.globalConfig().naisysFolder,
  "naisys",
);
const hostService = await createHostService(globalConfig, dbService);

/**
 * --hub flag is provided, start Hub server for NAISYS instances running across machines
 * There should be no dependency between hub and naisys
 * Sharing the same process space is to save memory on small servers
 */
let hubStarted = false;
if (program.opts().hub) {
  // Don't import the hub module tree unless needed
  const { startHub } = await import("@naisys/hub");
  await startHub("hosted");
  hubStarted = true;
}

/**
 * --supervisor flag is provided, start Supervisor server
 * There should be no dependency between supervisor and naisys
 * Sharing the same process space is to save 150 mb of node.js runtime memory on small servers
 */
if (program.opts().supervisor) {
  // Don't import the whole fastify web server module tree unless needed
  const { startServer } = await import("@naisys-supervisor/server");
  await startServer("hosted", hubStarted ? "monitor-hub" : "monitor-naisys");
}

// Start hub client manager used for cross-machine communication
const hubClientLog = createHubClientLog();
const hubManager = createHubManager(
  globalConfig,
  hostService,
  hubClientLog,
);
const hubSyncClient = createHubSyncClient(hubManager, hubClientLog, dbService, hostService);
const remoteAgentRequester = createRemoteAgentRequester(hubManager);

console.log(`NAISYS STARTED`);

const agentPath = program.args[0];

const agentRegistrar = await createAgentRegistrar(
  globalConfig,
  dbService,
  hostService,
  agentPath,
);
const agentManager = new AgentManager(
  dbService,
  globalConfig,
  hostService,
  remoteAgentRequester,
  agentRegistrar,
  hubSyncClient,
);

// Create handler for incoming remote agent control requests
createRemoteAgentHandler(hubManager, hubClientLog, dbService, hostService, agentManager);



// Resolve the agent path to a user ID (or admin if no path) and start the agent
const userId = await agentRegistrar.getStartupUserId(agentPath);
await agentManager.startAgent(userId);

await agentManager.waitForAllAgentsToComplete();

hostService.cleanup();

console.log(`NAISYS EXITED`);

process.exit(0);
