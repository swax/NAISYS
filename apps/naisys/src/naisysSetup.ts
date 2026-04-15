import { buildDefaultAgentConfig, builtInLlmModels, LlmApiType } from "@naisys/common";
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

export function getNaisysWizardConfig(hubClient: boolean): WizardConfig {
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

/** Available models ordered by preference (excludes none/mock) */
const availableModels = builtInLlmModels.filter(
  (m) =>
    m.apiKeyVar &&
    m.apiType !== LlmApiType.None &&
    m.apiType !== LlmApiType.Mock,
);

/**
 * If no agent path was provided and no agent configs exist in cwd,
 * offer to create a default assistant.yaml using the first model
 * that has an API key configured.
 */
export async function ensureAgentConfig(
  agentPath: string | undefined,
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

  const model = availableModels.find((m) => process.env[m.apiKeyVar]);

  if (!model) {
    console.log(
      "\n  No agent configs found and no API keys configured. Run with --setup to configure.",
    );
    return;
  }

  if (!process.stdin.isTTY) return;

  const answer = await askQuestion(
    `\n  No agent config found. Create a default assistant? (Y/n) `,
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
