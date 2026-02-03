import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agent/agentManager.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import { HubClient, createHubClient } from "./hub/hubClient.js";
import { createHubClientConfig } from "./hub/hubClientConfig.js";
import { createHubClientLog } from "./hub/hubClientLog.js";
import { createHeartbeatService } from "./services/heartbeatService.js";

dotenv.config({ quiet: true });

program
  .argument(
    "[agent-path]",
    "Path to agent configuration file (optional, defaults to admin agent)",
  )
  .option(
    "--hub <url>",
    "Connect to a Hub server at the given URL (e.g. --hub=http://localhost:3002)",
  )
  .option(
    "--integrated-hub",
    "Start a hub in the same process space as this NAISYS instance (saves memory)",
  )
  .option("--supervisor", "Start integrated Supervisor website (integrated hub required)")
  .parse();

const agentPath = program.args[0];

let hubUrl: string | undefined = program.opts().hub;
if (program.opts().integratedHub) {
  // Don't import the hub module tree unless needed, sharing the same process space is to save memory on small servers
  const { startHub } = await import("@naisys/hub");
  const hubPort = await startHub("hosted", program.opts().supervisor, agentPath);
  hubUrl = `http://localhost:${hubPort}`;
}

let hubClient: HubClient | undefined;
if (hubUrl) {
  const hubClientConfig = createHubClientConfig(hubUrl);
  const hubClientLog = createHubClientLog();
  hubClient = createHubClient(hubClientConfig, hubClientLog);
}

const globalConfig = createGlobalConfig(hubClient);
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

await globalConfig.waitForConfig();

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
