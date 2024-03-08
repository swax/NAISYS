import { program } from "commander";
import dotenv from "dotenv";
import * as fs from "fs";
import yaml from "js-yaml";
import { CommandProtection } from "./utils/enums.js";
import { valueFromString } from "./utils/utilities.js";

program.argument("<agent-path>", "Path to agent configuration file").parse();

dotenv.config();

/** The system name that shows after the @ in the command prompt */
export const hostname = "naisys";

export const shellOutputTokenMax = 2500;
export const shellCommmandTimeoutSeconds = 10;

/* .env is used for global configs across naisys, while agent configs are for the specific agent */
export const naisysFolder = getEnv("NAISYS_FOLDER", true);
export const websiteFolder = getEnv("WEBSITE_FOLDER");

export const localLlmUrl = getEnv("LOCAL_LLM_URL");
export const localLlmName = getEnv("LOCAL_LLM_NAME");

export const openaiApiKey = getEnv("OPENAI_API_KEY");
export const googleApiKey = getEnv("GOOGLE_API_KEY");
export const anthropicApiKey = getEnv("ANTHROPIC_API_KEY");

export const agent = loadAgentConfig();

interface AgentConfig {
  username: string;
  title: string;
  shellModel: string;
  webModel: string;
  agentPrompt: string;
  spendLimitDollars: number;
  tokenMax: number;
  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds?: number;
  wakeOnMessage?: boolean;
  commandProtection?: CommandProtection;
}

function loadAgentConfig() {
  const agentPath = program.args[0];

  const checkAgentConfig = yaml.load(
    fs.readFileSync(agentPath, "utf8"),
  ) as AgentConfig;

  // throw if any property is undefined
  for (const key of [
    "username",
    "title",
    "shellModel",
    "webModel",
    "agentPrompt",
    "spendLimitDollars",
    "tokenMax",
    // other properties can be undefined
  ]) {
    if (!valueFromString(checkAgentConfig, key)) {
      throw `Agent config: Error, ${key} is not defined`;
    }
  }

  if (!checkAgentConfig.commandProtection) {
    checkAgentConfig.commandProtection = CommandProtection.None;
  }

  if (
    !Object.values(CommandProtection).includes(
      checkAgentConfig.commandProtection,
    )
  ) {
    throw `Agent config: Error, 'commandProtection' is not a valid value`;
  }

  return checkAgentConfig;
}

export const packageVersion = await getVersion();

/** Can only get version from env variable when naisys is started with npm,
 * otherwise need to rip it from the package ourselves relative to where this file is located */
async function getVersion() {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const packageJson = await import(packageJsonPath.href, {
      assert: { type: "json" },
    });
    return packageJson.default.version;
  } catch (e) {
    return "0.1";
  }
}

function getEnv(key: string, required?: boolean) {
  const value = process.env[key];
  if (!value && required) {
    throw `Config: Error, .env ${key} is not defined`;
  }
  return value;
}
