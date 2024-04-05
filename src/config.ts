import { program } from "commander";
import dotenv from "dotenv";
import * as fs from "fs";
import { readFile } from "fs/promises";
import yaml from "js-yaml";
import path from "path";
import { fileURLToPath } from "url";
import { CommandProtection } from "./utils/enums.js";
import { hostToUnixPath, valueFromString } from "./utils/utilities.js";

program.argument("<agent-path>", "Path to agent configuration file").parse();

dotenv.config();

/** The system name that shows after the @ in the command prompt */
export const hostname = "naisys";

/** Limits the size of files that can be read/wrote */
export const shellOutputTokenMax = 3000;

/** The number of seconds NAISYS will wait for a shell command to complete */
export const shellCommmandTimeoutSeconds = 15;
export const webTokenMax = 3000;

export const endSessionEnabled = true;

export const mailEnabled = true;
/** Used to prevent the agent from constantly responding to mail and not getting any work done */
export const mailBlackoutCycles = 0;
export const mailMessageTokenMax = 400;

/** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
export const workspacesEnabled = false;

/** Experimental, allow LLM to trim prompts from it's own session context */
export const trimSessionEnabled = false;

/* .env is used for global configs across naisys, while agent configs are for the specific agent */
export const naisysFolder = getEnv("NAISYS_FOLDER", true);
export const websiteFolder = getEnv("WEBSITE_FOLDER");

export const localLlmUrl = getEnv("LOCAL_LLM_URL");
export const localLlmName = getEnv("LOCAL_LLM_NAME");

export const openaiApiKey = getEnv("OPENAI_API_KEY");
export const googleApiKey = getEnv("GOOGLE_API_KEY");
export const anthropicApiKey = getEnv("ANTHROPIC_API_KEY");

export const agent = loadAgentConfig();

export interface AgentConfig {
  path: string;
  directory: string;
  username: string;
  title: string;
  shellModel: string;
  webModel: string;
  dreamModel: string;
  imageModel?: string;
  agentPrompt: string;
  spendLimitDollars: number;
  tokenMax: number;
  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds: number;
  wakeOnMessage: boolean;
  commandProtection: CommandProtection;
  initialCommands: string[];
  /** The max number of subagents allowed to be started and managed. Costs by the subagent are applied to the spend limit. */
  subagentMax?: number;
  /** ONLY used by agent start process. Indicates that this is a subagent, and this is the lead agent */
  leadAgent?: string;
  /** ONLY used by agent start process. The task given to the subagent */
  taskDescription?: string;
}

function loadAgentConfig() {
  const config = yaml.load(
    fs.readFileSync(program.args[0], "utf8"),
  ) as AgentConfig;

  config.path = hostToUnixPath(path.resolve(program.args[0]));
  config.directory = config.path.substring(0, config.path.lastIndexOf("/"));

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
    /* Removed for compatibility with https://bundlephobia.com/package/naisys
    const packageJson = await import(packageJsonUrl.href, {
      assert: { type: "json" },
    });*/

    const packageJsonUrl = new URL("../package.json", import.meta.url);
    const packageJsonPath = fileURLToPath(packageJsonUrl);
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return packageJson.version;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
