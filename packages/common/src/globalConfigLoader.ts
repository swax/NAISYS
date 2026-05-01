import { sanitizeSpendLimit } from "./configUtils.js";

export interface ClientConfig {
  shellCommand: {
    outputTokenMax: number;
    timeoutSeconds: number;
    maxTimeoutSeconds: number;
  };
  retrySecondsBase: number;
  retrySecondsMax: number;
  webTokenMax: number;
  compactSessionEnabled: boolean;
  preemptiveCompactEnabled: boolean;
  googleSearchEngineId?: string;
  spendLimitDollars?: number;
  spendLimitHours?: number;
  variableMap: Record<string, string>;
  shellVariableMap: Record<string, string>;
  useToolsForLlmConsoleResponses: boolean;
  autoStartAgentsOnMessage: boolean;
  mailServiceEnabled: boolean;
}

/** Keys that should never be distributed to clients */
const EXCLUDED_KEYS = [
  "HUB_ACCESS_KEY",
  "NAISYS_FOLDER",
  "NAISYS_HOSTNAME",
  "NAISYS_MACHINE_ID",
  "NODE_ENV",
  "SERVER_PORT",
];

/**
 * Builds hub-distributable config from the provided env vars.
 * @param variables - Env var source: process.env (ephemeral) or DB-sourced map (hub).
 * @param shellExportKeys - Set of variable keys that should be exported to the shell.
 *   When undefined (e.g. .env fallback), all variables are exported for backwards compat.
 */
export function buildClientConfig(
  variables: Record<string, string | undefined>,
  shellExportKeys?: Set<string>,
): ClientConfig {
  const shellCommand = {
    outputTokenMax: 7500,
    timeoutSeconds: 10,
    maxTimeoutSeconds: 60 * 5,
  };

  const retrySecondsBase = 5;
  const retrySecondsMax = 30 * 60;
  const webTokenMax = 5000;
  const compactSessionEnabled = true;
  const preemptiveCompactEnabled = true;

  // Build variableMap, filtering out excluded keys and undefined values
  const variableMap: Record<string, string> = {};
  const shellVariableMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined && !EXCLUDED_KEYS.includes(key)) {
      variableMap[key] = value;
      // When shellExportKeys is undefined (standalone .env mode), export all
      if (!shellExportKeys || shellExportKeys.has(key)) {
        shellVariableMap[key] = value;
      }
    }
  }

  const googleSearchEngineId = variableMap.GOOGLE_SEARCH_ENGINE_ID;

  const spendLimitDollars = sanitizeSpendLimit(variableMap.SPEND_LIMIT_DOLLARS);
  const spendLimitHours = sanitizeSpendLimit(variableMap.SPEND_LIMIT_HOURS);

  const mailServiceEnabled = variableMap.MAIL_ENABLED === "true";

  const useToolsForLlmConsoleResponses = true;
  const autoStartAgentsOnMessage = true;

  return {
    shellCommand,
    retrySecondsBase,
    retrySecondsMax,
    webTokenMax,
    compactSessionEnabled,
    preemptiveCompactEnabled,
    variableMap,
    shellVariableMap,
    googleSearchEngineId,
    spendLimitDollars,
    spendLimitHours,
    useToolsForLlmConsoleResponses,
    autoStartAgentsOnMessage,
    mailServiceEnabled,
  };
}
