import type { StartHub } from "@naisys/common";
import {
  createDualLogger,
  cwdWithTilde,
  ensureDotEnv,
  expandNaisysFolder,
  runSetupWizard,
  type WizardConfig,
} from "@naisys/common-node";
import { program } from "commander";
import dotenv from "dotenv";
import os from "os";
import path from "path";

import { AgentManager } from "./agent/agentManager.js";
import { createUserService } from "./agent/userService.js";
import { createGlobalConfig } from "./globalConfig.js";
import type { HubClient } from "./hub/hubClient.js";
import { createHubClient } from "./hub/hubClient.js";
import { createHubClientConfig } from "./hub/hubClientConfig.js";
import type { HubCostBuffer } from "./hub/hubCostBuffer.js";
import { createHubCostBuffer } from "./hub/hubCostBuffer.js";
import type { HubLogBuffer } from "./hub/hubLogBuffer.js";
import { createHubLogBuffer } from "./hub/hubLogBuffer.js";
import { createHeartbeatService } from "./services/heartbeatService.js";
import { createHostService } from "./services/hostService.js";
import { createModelService } from "./services/modelService.js";
import { createUpdateService } from "./services/updateService.js";
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

if (process.argv.includes("--setup")) {
  await runSetupWizard(path.resolve(".env"), exampleUrl, wizardConfig);
  process.exit(0);
}

await ensureDotEnv(exampleUrl, wizardConfig);

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

const agentPath = program.args[0];

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
    agentPath || ".",
  );
  hubUrl = `http://localhost:${hubResult.serverPort}/hub`;
  if (program.opts().supervisor) {
    supervisorUrl = `http://localhost:${hubResult.serverPort}/supervisor`;
  }
}

const promptNotification = createPromptNotificationService();

let hubClient: HubClient | undefined;
let hubCostBuffer: HubCostBuffer | undefined;
let hubLogBuffer: HubLogBuffer | undefined;
if (hubUrl) {
  const hubClientConfig = createHubClientConfig(hubUrl);
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
const hostService = createHostService(hubClient, globalConfig);
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

function getNaisysWizardConfig(hubClient: boolean): WizardConfig {
  if (hubClient) {
    return {
      title: "NAISYS Setup (Hub Client)",
      sections: [
        {
          type: "fields",
          comment:
            "Copy value from Supervisor admin page or hub server's NAISYS_FOLDER/cert/hub-access-key",
          fields: [{ key: "HUB_ACCESS_KEY", label: "Hub Access Key" }],
        },
        {
          type: "fields",
          comment: "Local configuration",
          fields: [
            { key: "NAISYS_FOLDER", label: "NAISYS Data Folder", defaultValue: cwdWithTilde() },
            {
              key: "NAISYS_HOSTNAME",
              label: "Hostname",
              defaultValue: os.hostname(),
            },
          ],
        },
      ],
    };
  }

  return {
    title: "NAISYS Setup",
    sections: [
      {
        type: "fields",
        comment:
          "Agent home files and NAISYS specific databases will be stored here",
        fields: [
          { key: "NAISYS_FOLDER", label: "NAISYS Data Folder", defaultValue: cwdWithTilde() },
          {
            key: "NAISYS_HOSTNAME",
            label: "Hostname",
            defaultValue: os.hostname(),
          },
        ],
      },
      {
        type: "providers",
        comment: "Leave API keys blank if not using the service",
        label: "AI Providers",
        options: [
          {
            name: "OpenAI",
            fields: [{ key: "OPENAI_API_KEY", label: "OpenAI API Key" }],
          },
          {
            name: "Google",
            fields: [
              { key: "GOOGLE_API_KEY", label: "Google API Key" },
              {
                key: "GOOGLE_SEARCH_ENGINE_ID",
                label: "Google Search Engine ID",
              },
            ],
          },
          {
            name: "Anthropic",
            fields: [{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" }],
          },
          {
            name: "XAI",
            fields: [{ key: "XAI_API_KEY", label: "XAI API Key" }],
          },
          {
            name: "OpenRouter",
            fields: [
              { key: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
            ],
          },
        ],
      },
      {
        type: "fields",
        comment: "Spend limits apply to all agents using this .env file",
        fields: [
          { key: "SPEND_LIMIT_DOLLARS", label: "Spend Limit (dollars)" },
          { key: "SPEND_LIMIT_HOURS", label: "Spend Limit Period (hours)" },
        ],
      },
      {
        type: "fields",
        comment:
          "Integrated server configuration if the --integrated-hub option is used on startup",
        fields: [
          { key: "SERVER_PORT", label: "Server Port" },
          { key: "PUBLIC_READ", label: "Public Read Access" },
        ],
      },
    ],
  };
}
