import type { StartHub } from "@naisys/common";
import { program } from "commander";
import dotenv from "dotenv";
import { AgentManager } from "./agent/agentManager.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import { HubClient, createHubClient } from "./hub/hubClient.js";
import { createHubClientConfig } from "./hub/hubClientConfig.js";
import { createHubClientLog } from "./hub/hubClientLog.js";
import { createHeartbeatService } from "./services/heartbeatService.js";
import { createHostService } from "./services/hostService.js";
import { createPromptNotificationService } from "./utils/promptNotificationService.js";

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
  .option(
    "--supervisor",
    "Start integrated Supervisor website (integrated hub required)",
  )
  .option("--erp", "Start ERP web app (requires --supervisor)")
  .parse();

const agentPath = program.args[0];

let hubUrl: string | undefined = program.opts().hub;
const integratedHub = Boolean(program.opts().integratedHub);

if (integratedHub) {
  // Don't import the hub module tree unless needed, sharing the same process space is to save memory on small servers
  // Use variable to avoid compile-time type dependency on @naisys/hub (allows parallel builds)
  const hubModule = "@naisys/hub";
  const { startHub } = (await import(hubModule)) as { startHub: StartHub };
  const plugins: "erp"[] = [];
  if (program.opts().erp) plugins.push("erp");
  const hubPort = await startHub(
    "hosted",
    program.opts().supervisor,
    plugins,
    agentPath,
  );
  hubUrl = `http://localhost:${hubPort}`;
}

const promptNotification = createPromptNotificationService();

let hubClient: HubClient | undefined;
if (hubUrl) {
  const hubClientConfig = createHubClientConfig(hubUrl);
  const hubClientLog = createHubClientLog();
  hubClient = createHubClient(
    hubClientConfig,
    hubClientLog,
    promptNotification,
  );
}

const globalConfig = createGlobalConfig(hubClient);
const hostService = createHostService(hubClient, globalConfig);
const userService = createUserService(
  hubClient,
  promptNotification,
  hostService,
  agentPath,
);

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
const agentManager = new AgentManager(
  globalConfig,
  hubClient,
  hostService,
  userService,
  promptNotification,
);

const heartbeatService = createHeartbeatService(
  hubClient,
  agentManager,
  userService,
);

// Resolve the agent path to a username (or admin if no path) and start the agent
const startupUserIds = userService.getStartupUserIds();
for (const userId of startupUserIds) {
  await agentManager.startAgent(userId);
}

await agentManager.waitForAllAgentsToComplete();

heartbeatService.cleanup();

console.log(`NAISYS EXITED`);

process.exit(0);
