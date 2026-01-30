import { createDatabaseService } from "@naisys/database";
import { program } from "commander";
import dotenv from "dotenv";
import { AgentRunner } from "./agent/agentRunner.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import { createHubClientLog } from "./hub/hubClientLog.js";
import { createHubClient } from "./hub/hubClient.js";
import { createRemoteAgentHandler } from "./hub/remoteAgentHandler.js";
import { createRemoteAgentRequester } from "./hub/remoteAgentRequester.js";
import { createHostService } from "./services/hostService.js";

dotenv.config({ quiet: true });

program
  .argument(
    "[agent-path]",
    "Path to agent configuration file (optional, defaults to admin agent)",
  )
  .option(
    "--hub",
    "Start Hub server for NAISYS instances running across machines",
  )
  .option("--supervisor", "Start Supervisor web server (hub required)")
  .parse();

const agentPath = program.args[0];

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
  await startHub("hosted", program.opts().supervisor, agentPath);
  hubStarted = true;
}

// Start hub client manager used for cross-machine communication
const hubClientLog = createHubClientLog();
const hubClient = createHubClient(globalConfig, hubClientLog);
const remoteAgentRequester = createRemoteAgentRequester(hubClient);
const userService = createUserService(globalConfig, hubClient, agentPath);

if (globalConfig.globalConfig().isHubMode) {
  try {
    await hubClient.waitForConnection();
    await userService.waitForUsers();
  } catch (error) {
    console.error(`Failed to connect to hub: ${error}`);
    process.exit(1);
  }
}

console.log(`NAISYS STARTED`);
const agentRunner = new AgentRunner(
  dbService,
  globalConfig,
  hostService,
  remoteAgentRequester,
  userService,
);

// Create handler for incoming remote agent control requests
createRemoteAgentHandler(
  hubClient,
  hubClientLog,
  dbService,
  hostService,
  agentRunner,
);

// Resolve the agent path to a username (or admin if no path) and start the agent
const startupUsername = userService.getStartupUserId(agentPath);
await agentRunner.startAgent(startupUsername);

await agentRunner.waitForAllAgentsToComplete();

hostService.cleanup();

console.log(`NAISYS EXITED`);

process.exit(0);
