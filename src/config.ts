import { program } from "commander";
import dotenv from "dotenv";
import * as fs from "fs";
import yaml from "js-yaml";
import { valueFromString } from "./utilities.js";

interface AgentConfig {
  username: string;
  title: string;
  consoleModel: string;
  webModel: string;
  agentPrompt: string;
}

program.argument("<agent-path>", "Path to agent configuration file").parse();

dotenv.config();

export const WAKE_ON_MSG = -1; // Should not be changed

export const hostname = "system-01";

export const tokenMax = 4000; // gpt4 has a 8k token max, but also $0.03 per 1k tokens

/* .env is used for global configs across naisys, while agent configs for the specific agent */

export const rootFolder = getEnv("ROOT_FOLDER");

export const localWebsite = getEnv("LOCAL_WEBSITE");

export const localLlmUrl = getEnv("LOCAL_LLM_URL");

export const openaiApiKey = getEnv("OPENAI_API_KEY");

export const googleApiKey = getEnv("GOOGLE_API_KEY");

export const debugPauseSeconds = loadPauseSeconds();

export const agent = loadAgentConfig();

function getEnv(key: string) {
  const value = process.env[key];
  if (!value) {
    throw `Config: Error, .env ${key} is not defined`;
  }
  return value;
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
    "consoleModel",
    "webModel",
    "agentPrompt",
  ]) {
    if (!valueFromString(checkAgentConfig, key)) {
      throw `Agent config: Error, ${key} is not defined`;
    }
  }

  return checkAgentConfig;
}

/** Seconds to pause on the debug prompt before continuing LLM. undefined for indefinte. -1 to wake on new mail only */
function loadPauseSeconds() {
  const pauseSeconds = process.env.DEBUG_PAUSE_SECONDS;

  return !pauseSeconds
    ? undefined
    : pauseSeconds == "-1"
      ? WAKE_ON_MSG
      : parseInt(pauseSeconds);
}
