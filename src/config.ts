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

export const shellOutputTokenMax = 2500; // Limits the size of files that can be read/wrote
export const shellCommmandTimeoutSeconds = 15; // The number of seconds NAISYS will wait for a shell command to complete
export const webTokenMax = 2500;
export const mailMessageTokenMax = 400;

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
  dreamModel: string;
  agentPrompt: string;
  spendLimitDollars: number;
  tokenMax: number;
  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds: number;
  wakeOnMessage: boolean;
  commandProtection: CommandProtection;
  initialCommands: string[];
}

function loadAgentConfig() {
  const agentPath = program.args[0];

  const config = yaml.load(fs.readFileSync(agentPath, "utf8")) as AgentConfig;

  // throw if any property is undefined
  for (const key of [
    "username",
    "title",
    "shellModel",
    "agentPrompt",
    "spendLimitDollars",
    "tokenMax",
    // other properties can be undefined
  ]) {
    if (!valueFromString(config, key)) {
      throw `Agent config: Error, ${key} is not defined`;
    }
  }

  // Sanitize input
  if (!config.initialCommands) {
    config.initialCommands = [];
  } else if (!Array.isArray(config.initialCommands)) {
    throw `Agent config: Error, 'initialCommands' is not an array`;
  }

  config.debugPauseSeconds = config.debugPauseSeconds
    ? Number(config.debugPauseSeconds)
    : 0;

  config.wakeOnMessage = Boolean(config.wakeOnMessage);

  config.webModel ||= config.shellModel;
  config.dreamModel ||= config.shellModel;

  if (!config.commandProtection) {
    config.commandProtection = CommandProtection.None;
  }

  if (!Object.values(CommandProtection).includes(config.commandProtection)) {
    throw `Agent config: Error, 'commandProtection' is not a valid value`;
  }

  return config;
}

export const packageVersion = await getVersion();

export const binPath = getBinPath();

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

export function resolveConfigVars(templateString: string) {
  let resolvedString = templateString;
  resolvedString = resolveTemplateVars(resolvedString, "agent", agent);
  resolvedString = resolveTemplateVars(resolvedString, "env", process.env);
  return resolvedString;
}

function resolveTemplateVars(
  templateString: string,
  allowedVarString: string,
  mappedVar: any,
) {
  const pattern = new RegExp(`\\$\\{${allowedVarString}\\.([^}]+)\\}`, "g");

  return templateString.replace(pattern, (match, key) => {
    const value = valueFromString(mappedVar, key);
    if (value === undefined) {
      throw `Agent config: Error, ${key} is not defined`;
    }
    return value;
  });
}

function getBinPath() {
  // C:/git/naisys/dist/config.js
  let binPath = new URL("../bin", import.meta.url).pathname;

  if (binPath.startsWith("/C:")) {
    binPath = "/mnt/c" + binPath.substring(3);
  }

  return binPath;
}
