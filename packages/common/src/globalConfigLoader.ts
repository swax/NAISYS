import { sanitizeSpendLimit } from "./configUtils.js";

export interface ClientConfig {
  shellCommand: {
    outputTokenMax: number;
    timeoutSeconds: number;
    maxTimeoutSeconds: number;
  };
  retrySecondsMax: number;
  webTokenMax: number;
  compactSessionEnabled: boolean;
  googleSearchEngineId?: string;
  spendLimitDollars?: number;
  spendLimitHours?: number;
  variableMap: Record<string, string>;
  useToolsForLlmConsoleResponses: boolean;
}

/** Keys that should never be distributed to clients */
const EXCLUDED_KEYS = [
  "HUB_ACCESS_KEY",
  "HUB_PORT",
  "NAISYS_FOLDER",
  "NAISYS_HOSTNAME",
  "NODE_ENV",
  "SUPERVISOR_PORT",
];

/**
 * Builds hub-distributable config from the provided env vars.
 * @param variables - Env var source: process.env (ephemeral) or DB-sourced map (hub).
 */
export function buildClientConfig(
  variables: Record<string, string | undefined>,
): ClientConfig {
  const shellCommand = {
    outputTokenMax: 7500,
    timeoutSeconds: 10,
    maxTimeoutSeconds: 60 * 5,
  };

  const retrySecondsMax = 30 * 60;
  const webTokenMax = 5000;
  const compactSessionEnabled = true;

  // Build variableMap, filtering out excluded keys and undefined values
  const variableMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined && !EXCLUDED_KEYS.includes(key)) {
      variableMap[key] = value;
    }
  }

  const googleSearchEngineId = variableMap.GOOGLE_SEARCH_ENGINE_ID;

  const spendLimitDollars = sanitizeSpendLimit(variableMap.SPEND_LIMIT_DOLLARS);
  const spendLimitHours = sanitizeSpendLimit(variableMap.SPEND_LIMIT_HOURS);

  const useToolsForLlmConsoleResponses = true;

  return {
    shellCommand,
    retrySecondsMax,
    webTokenMax,
    compactSessionEnabled,
    variableMap,
    googleSearchEngineId,
    spendLimitDollars,
    spendLimitHours,
    useToolsForLlmConsoleResponses,
  };
}
