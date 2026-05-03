import { sleep, type StartHub } from "@naisys/common";
import {
  createDualLogger,
  ensureDotEnv,
  expandNaisysFolder,
  runSetupWizard,
} from "@naisys/common-node";
import { program } from "commander";
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
import {
  ensureAgentConfig,
  getNaisysWizardConfig,
  printOpenAiCodexSubscriptionSetupInstructions,
} from "./naisysSetup.js";
import { createHeartbeatService } from "./services/heartbeatService.js";
import { createHostService } from "./services/hostService.js";
import { createModelService } from "./services/modelService.js";
import { createUpdateService } from "./services/updateService.js";
import { createPromptNotificationService } from "./utils/promptNotificationService.js";

// dotenv.config() runs in the dispatcher (./naisys.ts) before the wrapper
// guard, so .env-set NAISYS_* vars take effect there. The spawned wrapper
// child inherits the resolved process.env — no need to reload here.

const isHubClient = process.argv.some(
  (a) => a === "--hub" || a.startsWith("--hub="),
);

let openAiCodexSubscriptionSelected = false;
const wizardConfig = getNaisysWizardConfig(isHubClient, {
  onOpenAiCodexSubscriptionSelected: () => {
    openAiCodexSubscriptionSelected = true;
  },
});
const exampleUrl = new URL(
  isHubClient ? "../.env.hub-client.example" : "../.env.example",
  import.meta.url,
);

let wizardRan = false;
if (process.argv.includes("--setup")) {
  wizardRan = await runSetupWizard(
    path.resolve(".env"),
    exampleUrl,
    wizardConfig,
  );
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

if (!isHubClient) {
  await ensureAgentConfig(program.args[0], {
    useOpenAiCodexSubscription: openAiCodexSubscriptionSelected,
  });
  if (openAiCodexSubscriptionSelected) {
    printOpenAiCodexSubscriptionSetupInstructions();
  }
}

const agentPath = program.args[0] || ".";
let hubUrl: string | undefined = program.opts().hub;
const integratedHub = Boolean(program.opts().integratedHub);
let supervisorUrl: string | undefined;
let integratedHubShutdown: (() => Promise<void>) | undefined;

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
  integratedHubShutdown = hubResult.shutdown;
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
let heartbeatService: ReturnType<typeof createHeartbeatService> | undefined;
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
    await shutdown();
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

heartbeatService = createHeartbeatService(hubClient, agentManager, userService);

// Resolve the agent path to a username (or admin if no path) and start the agent
const startupUserIds = userService.getStartupUserIds();
for (const userId of startupUserIds) {
  await agentManager.startAgent(userId);
}

const updateService = program.opts().autoUpdate
  ? createUpdateService(globalConfig, agentManager)
  : undefined;

let shuttingDown = false;
const handleShutdownSignal = (signal: "SIGINT" | "SIGTERM") => {
  if (shuttingDown) {
    console.log("\nForce exit");
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n[NAISYS] Shutting down (${signal})...`);
  agentManager.stopAll(signal).catch((err) => {
    console.error("[NAISYS] Error stopping agents:", err);
  });
};
process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));

await agentManager.waitForAllAgentsToComplete();

// Auto-update may still be running its git/npm install when agents drain
// (e.g. user signaled mid-install). Wait so we don't kill the spawned
// processes mid-step. Second Ctrl+C still force-exits via handleShutdownSignal.
if (shuttingDown && updateService?.isInProgress()) {
  console.log(
    "[NAISYS] Waiting for in-flight update to finish (Ctrl+C again to force exit)...",
  );
}
await updateService?.waitForCompletion();

await shutdown();

console.log(`[NAISYS] Exited`);
process.exit(updateService?.getExitCode() ?? 0);

// Shutdown is process-owned: process.exit() reaps timers, sockets, Fastify,
// and Socket.IO. Drain pending log/cost entries while the socket and hub are
// still alive, disconnect the hub client, then wait only for the integrated
// hub database disconnect.
async function shutdown(): Promise<void> {
  await Promise.allSettled([
    hubLogBuffer?.flushFinal(),
    hubCostBuffer?.flushFinal(),
  ]);

  heartbeatService?.cleanup();
  hubClient?.cleanup();

  if (integratedHubShutdown) {
    await Promise.race([
      integratedHubShutdown().catch((err) =>
        console.error("[NAISYS] Hub shutdown:", err),
      ),
      sleep(5_000).then(() => console.error("[NAISYS] Hub shutdown timed out")),
    ]);
  }
}
