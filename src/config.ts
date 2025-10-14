import { program } from "commander";
import dotenv from "dotenv";
import * as fs from "fs";
import { readFile } from "fs/promises";
import yaml from "js-yaml";
import path from "path";
import { CommandProtection } from "./utils/enums.js";
import * as pathService from "./services/pathService.js";
import { valueFromString } from "./utils/utilities.js";
import { NaisysPath } from "./services/pathService.js";

program.argument("<agent-path>", "Path to agent configuration file").parse();

/** The system name that shows after the @ in the command prompt */
export const hostname = "naisys";

export const shellCommand = {
  /** Limits the size of files that can be read/wrote */
  outputTokenMax: 5000,
  /** The time NAISYS will wait for new shell output before giving up */
  timeoutSeconds: 10,
  maxTimeoutSeconds: 60 * 5, // 5 minutes
};

export const agent = loadAgentConfig();

const envPath = agent.envPath || '.env';
dotenv.config({ path: envPath });

/** Web pages loaded with llmynx will be reduced down to around this number of tokens */
export const webTokenMax = 3000;

/** Allows the LLM to end it's own session */
export const endSessionEnabled = true;

/** Inter agent communication */
export const mailEnabled = agent.mailEnabled || false;

/** The LLM optimized browser */
export const webEnabled = agent.webEnabled || false;

export const completeTaskEnabled = agent.completeTaskEnabled || false;

/** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
export const workspacesEnabled = false;

/** Experimental, allow LLM to trim it's own session context to avoid having to restart the session */
export const trimSessionEnabled = false;

/* .env is used for global configs across naisys, while agent configs are for the specific agent */
export const naisysFolder = getEnv("NAISYS_FOLDER", true);
export const websiteFolder = getEnv("WEBSITE_FOLDER");
export const dbFilePath = new NaisysPath(`${naisysFolder}/database/naisys.sqlite`);

export const localLlmUrl = getEnv("LOCAL_LLM_URL");
export const localLlmName = getEnv("LOCAL_LLM_NAME");

export const openaiApiKey = getEnv("OPENAI_API_KEY");
export const googleApiKey = getEnv("GOOGLE_API_KEY");
export const anthropicApiKey = getEnv("ANTHROPIC_API_KEY");
export const openRouterApiKey = getEnv("OPENROUTER_API_KEY");

export const googleSearchEngineId = getEnv("GOOGLE_SEARCH_ENGINE_ID");

/** Global spend limit across all agents using this .env file */
export const spendLimitDollars = sanitizeSpendLimit(getEnv("SPEND_LIMIT_DOLLARS"));

// Validate if spend limit is defined on the agent or .env`
if (agent.spendLimitDollars === undefined && spendLimitDollars === undefined) {
  throw `Agent config: Error, 'spendLimitDollars' needs to be defined in the .env file or agent config`;
}

export interface AgentConfig {
  username: string;
  title: string;
  agentPrompt: string;

  /** Local spend limit for this agent */
  spendLimitDollars?: number;
  tokenMax: number;

  shellModel: string;
  webModel: string;
  dreamModel: string;
  imageModel?: string;

  mailEnabled?: boolean;
  webEnabled?: boolean;

  /** Allows agent a way to stop running completely unless a message is received. In subagent mode the app is exited */
  completeTaskEnabled?: boolean;

  /** Seconds to pause on the debug prompt before continuing LLM. No value or zero implies indefinite wait (debug driven) */
  debugPauseSeconds: number;
  wakeOnMessage: boolean;
  commandProtection: CommandProtection;
  initialCommands: string[];

  /** Custom or non-standard env path */
  envPath?: string;

  /** The max number of subagents allowed to be started and managed. Costs by the subagent are applied to the spend limit. */
  subagentMax?: number;

  /** The directory where subagents are stored, relative to the agent config file */
  subagentDirectory?: string;

  /** Used to prevent the agent from constantly responding to mail and not getting any work done */
  mailBlackoutCycles?: number;

  /** Try to enfore smaller messages between agents to improve communication efficiency */
  mailMessageTokenMax?: number;

  /** Disable multiple commands. Breaks the chain of LLMs hallucinating command output, the next prompt, and so on  */
  disableMultipleCommands?: boolean;

  /** ONLY used by agent start process. Indicates that this is a subagent, and this is the lead agent */
  leadAgent?: string;

  /** ONLY used by agent start process. The task given to the subagent */
  taskDescription?: string;

  /** The path of the config file. Set automatically on load */
  hostpath: string;

  /** Currently just persists the agent's end session notes, but TODO persist the context to reload if the process is terminated */
  persistAcrossRuns?: boolean;
}

function loadAgentConfig() {
  const config = yaml.load(
    fs.readFileSync(program.args[0], "utf8"),
  ) as AgentConfig;

  config.hostpath = path.resolve(program.args[0]);

  // throw if any property is undefined
  for (const key of [
    "username",
    "title",
    "shellModel",
    "agentPrompt",
    "tokenMax",
    // other properties can be undefined
  ]) {
    if (!valueFromString(config, key)) {
      throw `Agent config: Error, ${key} is not defined`;
    }
  }

  config.spendLimitDollars = sanitizeSpendLimit(config.spendLimitDollars);

  // Disable by default, too many screw ups. Cached tokens means the effects of this isn't so bad.
  if (config.disableMultipleCommands === undefined) {
    config.disableMultipleCommands = true;
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

    const installPath = pathService.getInstallPath();
    const packageJsonPath = path.join(
      installPath.getHostPath(),
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return packageJson.version;
  } catch (e) {
    return "Error getting NAISYS verison";
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

function sanitizeSpendLimit(num: any) {
  if (num === undefined) return undefined;
  const n = Number(num);
  if (isNaN(n) || n <= 0) {
    return undefined
  }
  return n;
}
