import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agent/agentManager.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import { HubClient, createHubClient } from "./hub/hubClient.js";
import { createHubClientLog } from "./hub/hubClientLog.js";
import { createHeartbeatService } from "./services/heartbeatService.js";

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

/**
 * --hub flag is provided, start Hub server for NAISYS instances running across machines
 * There should be no dependency between hub and naisys
 * Sharing the same process space is to save memory on small servers
 */
if (program.opts().hub) {
  // Don't import the hub module tree unless needed
  const { startHub } = await import("@naisys/hub");
  await startHub("hosted", program.opts().supervisor, agentPath);
}

// Start hub client manager used for cross-machine communication
let hubClient: HubClient | undefined;
if (globalConfig.globalConfig().isHubMode) {
  const hubClientLog = createHubClientLog();
  hubClient = createHubClient(globalConfig, hubClientLog);
}

const userService = createUserService(hubClient, agentPath);

if (hubClient) {
  try {
    await hubClient.waitForConnection();
    await userService.waitForUsers();
  } catch (error) {
    console.error(`Failed to connect to hub: ${error}`);
    process.exit(1);
  }
}

console.log(`NAISYS STARTED`);
const agentManager = new AgentManager(globalConfig, hubClient, userService);

const heartbeatService = createHeartbeatService(
  hubClient,
  agentManager,
  userService,
);

// Resolve the agent path to a username (or admin if no path) and start the agent
const startupUserId = userService.getStartupUserId(agentPath);
await agentManager.startAgent(startupUserId);

await agentManager.waitForAllAgentsToComplete();

heartbeatService.cleanup();

console.log(`NAISYS EXITED`);

process.exit(0);
