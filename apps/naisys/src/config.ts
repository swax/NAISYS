import dotenv from "dotenv";
import * as fs from "fs";
import { readFile } from "fs/promises";
import yaml from "js-yaml";
import path from "path";
import * as pathService from "./services/pathService.js";
import { NaisysPath } from "./services/pathService.js";
import { CommandProtection } from "./utils/enums.js";
import { valueFromString } from "./utils/utilities.js";

export interface AgentConfig {
  username: string;
  title: string;
  agentPrompt: string;

  /** Local spend limit for this agent */
  spendLimitDollars?: number;

  /** Time period in hours for spend limit. If not set, spend limit applies to all time */
  spendLimitHours?: number;

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

  /** The max number of subagents allowed to be started and managed. Costs by the subagent are applied to the spend limit. */
  subagentMax?: number;

  /** The directory where subagents are stored, relative to the agent config file */
  subagentDirectory?: string;

  /** Used to prevent the agent from constantly responding to mail and not getting any work done */
  mailBlackoutCycles?: number;

  /** Try to enfore smaller messages between agents to improve communication efficiency */
  mailMessageTokenMax?: number;

  /**
   * Disable multiple commands
   * + Prevents LLMs from hallucinating it's own output
   * + Prevents LLMs from issuing commands before evaluating previous command output
   * - Slower going back and forth to the LLM
   * - Costs more, but query caching reduces most of the impact
   */
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

interface UserRunSession {
  userId: number;
  /** The run ID of an agent process (there could be multiple runs for the same user). Globally unique */
  runId: number;
  /** The session number, incremented when the agent calls endsession */
  sessionId: number;
}

export async function createConfig(agentPath: string) {
  let userRunSession: UserRunSession;

  function updateUserRunSession(
    userId: number,
    runId: number,
    sessionId: number,
  ) {
    userRunSession = {
      userId,
      runId,
      sessionId,
    };
  }

  function getUserRunSession() {
    return structuredClone(userRunSession);
  }

  /** Should match version in schema_version table of latest migration script */
  const latestDbVersion = 1;

  /** The system name that shows after the @ in the command prompt */
  const hostname = "naisys";

  const shellCommand = {
    /** Limits the size of files that can be read/wrote */
    outputTokenMax: 7500,
    /** The time NAISYS will wait for new shell output before giving up */
    timeoutSeconds: 10,
    maxTimeoutSeconds: 60 * 5, // 5 minutes
  };

  /** Number of lines to buffer for hidden in/out of process agents */
  const bufferAgentLines = 5000;

  const retrySecondsMax = 30 * 60; // 30 minutes

  const agent = loadAgentConfig();

  dotenv.config({ quiet: true });

  /** Web pages loaded with llmynx will be reduced down to around this number of tokens */
  const webTokenMax = 5000;

  /** Allows the LLM to end it's own session */
  const endSessionEnabled = true;

  /** Inter agent communication */
  const mailEnabled = agent.mailEnabled || false;

  /** The LLM optimized browser */
  const webEnabled = agent.webEnabled || false;

  const completeTaskEnabled = agent.completeTaskEnabled || false;

  /** Experimental, live updating spot in the context for the LLM to put files, to avoid having to continually cat */
  const workspacesEnabled = false;

  /** Experimental, allow LLM to trim it's own session context to avoid having to restart the session */
  const trimSessionEnabled = false;

  /* .env is used for global configs across naisys, while agent configs are for the specific agent */
  const naisysFolder = getEnv("NAISYS_FOLDER", true);
  const dbFilePath = new NaisysPath(`${naisysFolder}/database/naisys.sqlite`);

  const localLlmUrl = getEnv("LOCAL_LLM_URL");
  const localLlmName = getEnv("LOCAL_LLM_NAME");

  const openaiApiKey = getEnv("OPENAI_API_KEY");
  const googleApiKey = getEnv("GOOGLE_API_KEY");
  const anthropicApiKey = getEnv("ANTHROPIC_API_KEY");

  const googleSearchEngineId = getEnv("GOOGLE_SEARCH_ENGINE_ID");

  /** Global spend limit across all agents using this .env file */
  const spendLimitDollars = sanitizeSpendLimit(getEnv("SPEND_LIMIT_DOLLARS"));

  /** Global spend limit period in hours. If not set, limit applies to all time */
  const spendLimitHours = sanitizeSpendLimit(getEnv("SPEND_LIMIT_HOURS"));

  // Validate if spend limit is defined on the agent or .env`
  if (
    agent.spendLimitDollars === undefined &&
    spendLimitDollars === undefined
  ) {
    throw `Agent config: Error, 'spendLimitDollars' needs to be defined in the .env file or agent config`;
  }

  // Pull model config from env if it's centrally defined there
  agent.shellModel = resolveConfigVars(agent.shellModel);
  agent.webModel = resolveConfigVars(agent.webModel);
  agent.dreamModel = resolveConfigVars(agent.dreamModel);
  if (agent.imageModel) {
    agent.imageModel = resolveConfigVars(agent.imageModel);
  }

  /**
   * Provide a clear way for the LLM to specify what command(s) to run as well as the reasoning for those commands
   * Decrease the chance of the LLM hallucinating output as there is no place to for that in the response
   * The disableMultipleCommands config affects the schema by only allowing a single command to be issued
   * Many commands often backfires as the LLM may issue commands before evaluating previous command output
   */
  const useToolsForLlmConsoleResponses = true;

  function loadAgentConfig() {
    const config = yaml.load(fs.readFileSync(agentPath, "utf8")) as AgentConfig;

    config.hostpath = path.resolve(agentPath);

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
    config.spendLimitHours = sanitizeSpendLimit(config.spendLimitHours);

    // Disable by default, too many screw ups. Cached tokens helps reduce the negaive
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

  const packageVersion = await getVersion();

  const binPath = getBinPath();

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

  function resolveConfigVars(templateString: string) {
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
      return undefined;
    }
    return n;
  }

  return {
    latestDbVersion,
    hostname,
    shellCommand,
    agent,
    webTokenMax,
    retrySecondsMax,
    endSessionEnabled,
    mailEnabled,
    webEnabled,
    completeTaskEnabled,
    workspacesEnabled,
    trimSessionEnabled,
    naisysFolder,
    dbFilePath,
    localLlmUrl,
    localLlmName,
    openaiApiKey,
    googleApiKey,
    anthropicApiKey,
    googleSearchEngineId,
    spendLimitDollars,
    spendLimitHours,
    useToolsForLlmConsoleResponses,
    packageVersion,
    binPath,
    getEnv,
    resolveConfigVars,
    updateUserRunSession,
    getUserRunSession,
  };
}

export type Config = Awaited<ReturnType<typeof createConfig>>;
