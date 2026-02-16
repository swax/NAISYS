import { sanitizeSpendLimit } from "./configUtils.js";

export interface HubLoadableConfig {
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
  useToolsForLlmConsoleResponses: boolean;
}

/**
 * Loads hub-distributable config from process.env.
 */
export function loadHubConfig(): HubLoadableConfig {
  const shellCommand = {
    outputTokenMax: 7500,
    timeoutSeconds: 10,
    maxTimeoutSeconds: 60 * 5,
  };

  const retrySecondsMax = 30 * 60;
  const webTokenMax = 5000;
  const compactSessionEnabled = true;

  const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  const spendLimitDollars = sanitizeSpendLimit(process.env.SPEND_LIMIT_DOLLARS);
  const spendLimitHours = sanitizeSpendLimit(process.env.SPEND_LIMIT_HOURS);

  const useToolsForLlmConsoleResponses = true;

  return {
    shellCommand,
    retrySecondsMax,
    webTokenMax,
    compactSessionEnabled,
    googleSearchEngineId,
    spendLimitDollars,
    spendLimitHours,
    useToolsForLlmConsoleResponses,
  };
}
