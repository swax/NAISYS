import {
  buildDefaultAgentConfig,
  builtInLlmModels,
  LlmApiType,
  OPENAI_CODEX_REFRESH_TOKEN_VAR,
} from "@naisys/common";
import {
  askQuestion,
  cwdWithTilde,
  loadAgentConfigs,
  type WizardConfig,
} from "@naisys/common-node";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import path from "path";

const OPENAI_CODEX_SUBSCRIPTION_PROVIDER_NAME = "OpenAI Codex Subscription";

interface NaisysWizardConfigOptions {
  onOpenAiCodexSubscriptionSelected?: () => void;
}

export function getNaisysWizardConfig(
  hubClient: boolean,
  options: NaisysWizardConfigOptions = {},
): WizardConfig {
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
            {
              key: "NAISYS_FOLDER",
              label: "NAISYS Data Folder",
              defaultValue: cwdWithTilde(),
            },
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
          {
            key: "NAISYS_FOLDER",
            label: "NAISYS Data Folder",
            defaultValue: cwdWithTilde(),
          },
          {
            key: "NAISYS_HOSTNAME",
            label: "Hostname",
            defaultValue: os.hostname(),
          },
        ],
      },
      {
        type: "providers",
        comment:
          "Leave API keys blank if not using the service. OpenAI Codex Subscription is connected later through Supervisor Variables.",
        label: "AI Providers",
        options: [
          {
            name: "OpenAI",
            fields: [{ key: "OPENAI_API_KEY", label: "OpenAI API Key" }],
          },
          {
            name: OPENAI_CODEX_SUBSCRIPTION_PROVIDER_NAME,
            fields: [],
            onSelected: options.onOpenAiCodexSubscriptionSelected,
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
          { key: "ALLOW_PASSWORD_LOGIN", label: "Allow Password Sign-in" },
        ],
      },
    ],
  };
}

/** Available models ordered by preference (excludes none/mock) */
const availableModels = builtInLlmModels.filter(
  (m) =>
    m.apiKeyVar &&
    m.apiType !== LlmApiType.None &&
    m.apiType !== LlmApiType.Mock,
);

const preferredCodexModel = availableModels.find(
  (m) => m.apiType === LlmApiType.OpenAIOAuth,
);

function hasConfiguredCredentials(model: (typeof availableModels)[number]) {
  return Boolean(
    process.env[model.apiKeyVar] ||
      (model.apiType === LlmApiType.OpenAIOAuth &&
        process.env[OPENAI_CODEX_REFRESH_TOKEN_VAR]),
  );
}

export function printOpenAiCodexSubscriptionSetupInstructions() {
  console.log(
    "\n  OpenAI Codex Subscription selected. After Supervisor opens, go to Variables and click OpenAI Codex OAuth Setup.",
  );
  console.log(
    "  Finish that flow to connect your subscription and save the required variables.\n",
  );
}

/**
 * If no agent path was provided and no agent configs exist in cwd,
 * offer to create a default assistant.yaml. Prefer a configured provider, but
 * use OpenAI Codex when the subscription provider was selected so first-time
 * users can complete subscription setup from Supervisor's Variables page after
 * startup.
 */
export async function ensureAgentConfig(
  agentPath: string | undefined,
  options: { useOpenAiCodexSubscription?: boolean } = {},
): Promise<void> {
  if (agentPath) return;

  // Check if there are any non-admin agents that would load from cwd
  try {
    const users = loadAgentConfigs("");
    const hasNonAdmin = Array.from(users.values()).some(
      (u) => u.username !== "admin",
    );
    if (hasNonAdmin) return;
  } catch {
    // No configs found, fall through to offer creation
  }

  const configuredModel = availableModels.find(hasConfiguredCredentials);
  const model =
    (options.useOpenAiCodexSubscription ? preferredCodexModel : undefined) ??
    configuredModel;

  if (!model) {
    console.log(
      "\n  No agent configs found and no AI provider configured. Run with --setup to configure one.",
    );
    return;
  }

  if (!process.stdin.isTTY) return;

  const answer = await askQuestion(
    `\n  No agent config found. Create a default assistant using ${model.label}? (Y/n) `,
  );

  if (answer && !answer.toLowerCase().startsWith("y")) {
    return;
  }

  const config = buildDefaultAgentConfig("andy");
  config.shellModel = model.key;

  const filePath = path.resolve("assistant.yaml");
  fs.writeFileSync(filePath, yaml.dump(config));
  console.log(`  Created ${filePath} using ${model.key}\n`);
}
