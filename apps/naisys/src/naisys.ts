import type { StartHub } from "@naisys/common";
import {
  createDualLogger,
  ensureDotEnv,
  expandNaisysFolder,
  runSetupWizard,
} from "@naisys/common-node";
import { program } from "commander";
import dotenv from "dotenv";
import path from "path";

import { AgentManager } from "./agent/agentManager.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import type { HubClient } from "./hub/hubClient.js";
import { createHubClient } from "./hub/hubClient.js";
import type { HubClientConfig } from "./hub/hubClientConfig.js";
import { createHubClientConfig } from "./hub/hubClientConfig.js";
import type { HubCostBuffer } from "./hub/hubCostBuffer.js";
import { createHubCostBuffer } from "./hub/hubCostBuffer.js";
import type { HubLogBuffer } from "./hub/hubLogBuffer.js";
import { createHubLogBuffer } from "./hub/hubLogBuffer.js";
import { createHeartbeatService } from "./services/heartbeatService.js";
import { createHostService } from "./services/hostService.js";
import { createModelService } from "./services/modelService.js";
import { createUpdateService } from "./services/updateService.js";
import { ensureAgentConfig, getNaisysWizardConfig } from "./naisysSetup.js";
import { createPromptNotificationService } from "./utils/promptNotificationService.js";

dotenv.config({ quiet: true });

const isHubClient = process.argv.some(
  (a) => a === "--hub" || a.startsWith("--hub="),
);

const wizardConfig = getNaisysWizardConfig(isHubClient);
const exampleUrl = new URL(
  isHubClient ? "../.env.hub-client.example" : "../.env.example",
  import.meta.url,
);

let wizardRan = false;
if (process.argv.includes("--setup")) {
  wizardRan = await runSetupWizard(path.resolve(".env"), exampleUrl, wizardConfig);
  expandNaisysFolder();
}

wizardRan = (await ensureDotEnv(exampleUrl, wizardConfig)) || wizardRan;
expandNaisysFolder();

program
  .argument(
    "[agent-path]",
    "Path to agent configuration file (optional, defaults to admin agent)",
  )
  .option(
    "--hub <url>",
    "Connect to a Hub server at the given URL (e.g. --hub=http://localhost:3300)",
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
  .option("--no-auto-update", "Disable automatic version updates")
  .option("--setup", "Run interactive setup wizard")
  .parse();

if (wizardRan) {
  await ensureAgentConfig(program.args[0]);
}

const agentPath = program.args[0] || ".";
let hubUrl: string | undefined = program.opts().hub;
const integratedHub = Boolean(program.opts().integratedHub);
let supervisorUrl: string | undefined;

if (integratedHub) {
  // Don't import the hub module tree unless needed, sharing the same process space is to save memory on small servers
  // Use variable to avoid compile-time type dependency on @naisys/hub (allows parallel builds)
  const hubModule = "@naisys/hub";
  const { startHub } = (await import(hubModule)) as { startHub: StartHub };
  const plugins: "erp"[] = [];
  if (program.opts().erp) plugins.push("erp");
  const hubResult = await startHub(
    "hosted",
    program.opts().supervisor,
    plugins,
    agentPath,
    wizardRan,
  );
  hubUrl = `http://localhost:${hubResult.serverPort}/hub`;
  if (program.opts().supervisor) {
    supervisorUrl = `http://localhost:${hubResult.serverPort}/supervisor`;
  }
}

const promptNotification = createPromptNotificationService();

let hubClient: HubClient | undefined;
let hubClientConfig: HubClientConfig | undefined;
let hubCostBuffer: HubCostBuffer | undefined;
let hubLogBuffer: HubLogBuffer | undefined;
if (hubUrl) {
  hubClientConfig = createHubClientConfig(hubUrl);
  const hubClientLog = createDualLogger("hub-client.log");
  hubClient = createHubClient(
    hubClientConfig,
    hubClientLog,
    promptNotification,
  );
  hubCostBuffer = createHubCostBuffer(hubClient);
  hubLogBuffer = createHubLogBuffer(hubClient);
}

const globalConfig = createGlobalConfig(hubClient, supervisorUrl);
const hostService = createHostService(
  hubClient,
  hubClientConfig,
  globalConfig,
  promptNotification,
);
const userService = createUserService(
  hubClient,
  promptNotification,
  hostService,
  agentPath,
);
const modelService = createModelService(hubClient);

if (hubClient) {
  try {
    await hubClient.waitForConnection();
    await userService.waitForUsers();
    await modelService.waitForModels();
  } catch (error) {
    console.error(`Failed to connect to hub: ${error}`);
    process.exit(1);
  }
}

await globalConfig.waitForConfig();

console.log(`[NAISYS] Started`);
const agentManager = new AgentManager(
  globalConfig,
  hubClient,
  hubCostBuffer,
  hubLogBuffer,
  hostService,
  userService,
  modelService,
  promptNotification,
);

const heartbeatService = createHeartbeatService(
  hubClient,
  agentManager,
  userService,
);

const updateService = program.opts().autoUpdate
  ? createUpdateService(globalConfig, agentManager)
  : undefined;

// Resolve the agent path to a username (or admin if no path) and start the agent
const startupUserIds = userService.getStartupUserIds();
for (const userId of startupUserIds) {
  await agentManager.startAgent(userId);
}

let shuttingDown = false;
process.on("SIGINT", () => {
  if (shuttingDown) {
    console.log("\nForce exit");
    process.exit(1);
  }
  shuttingDown = true;
  console.log("\n[NAISYS] Shutting down...");
  agentManager.stopAll("SIGINT").catch(() => {});
});

await agentManager.waitForAllAgentsToComplete();

hubLogBuffer?.cleanup();
hubCostBuffer?.cleanup();
heartbeatService.cleanup();

if (updateService?.isUpdateInProgress()) {
  // Update handler will call process.exit(0) after install and PM2 setup complete
  await new Promise(() => {});
}

console.log(`[NAISYS] Exited`);

process.exit(0);
