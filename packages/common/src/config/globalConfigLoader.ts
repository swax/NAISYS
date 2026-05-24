import { sanitizeSpendLimit } from "./configUtils.js";

/** Returns the input if it's a valid IANA TZ (e.g. "America/Los_Angeles");
 *  otherwise undefined. Empty/missing → undefined so callers can fall back. */
export function validateTimezone(tz: string | undefined): string | undefined {
  if (!tz?.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export interface ClientConfig {
  shellCommand: {
    outputTokenMax: number;
    timeoutSeconds: number;
    maxTimeoutSeconds: number;
  };
  retrySecondsBase: number;
  retrySecondsMax: number;
  compactSessionEnabled: boolean;
  preemptiveCompactEnabled: boolean;
  googleSearchEngineId?: string;
  spendLimitDollars?: number;
  spendLimitHours?: number;
  /** Suspend OpenAI Codex OAuth agents when account usage reaches this percent. */
  codexUsageLimitPercent?: number;
  /** How often the hub polls OpenAI Codex account usage, in minutes. */
  codexUsageCheckMinutes?: number;
  variableMap: Record<string, string>;
  shellVariableMap: Record<string, string>;
  useToolsForLlmConsoleResponses: boolean;
  autoStartAgentsOnMessage: boolean;
  mailServiceEnabled: boolean;
  /** IANA TZ the hub process resolves crons in. */
  hubTimezone: string;
}

/** Keys that should never be distributed to clients */
const EXCLUDED_KEYS = [
  "HOST_ACCESS_KEY",
  // Kept after the HUB_ACCESS_KEY → HOST_ACCESS_KEY rename: upgraded installs
  // may still have the old key in .env, and it must not leak via client config.
  "HUB_ACCESS_KEY",
  "NAISYS_FOLDER",
  "NAISYS_HOSTNAME",
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
    outputTokenMax: 2000,
    timeoutSeconds: 10,
    maxTimeoutSeconds: 60 * 5,
  };

  const retrySecondsBase = 5;
  const retrySecondsMax = 30 * 60;
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

  // Reuse the spend-limit sanitizer: both must be positive finite numbers.
  const codexUsageLimitPercent = sanitizeSpendLimit(
    variableMap.CODEX_USAGE_LIMIT_PERCENT,
  );
  const codexUsageCheckMinutes = sanitizeSpendLimit(
    variableMap.CODEX_USAGE_CHECK_MINUTES,
  );

  const mailServiceEnabled = variableMap.MAIL_ENABLED === "true";

  const useToolsForLlmConsoleResponses = true;
  const autoStartAgentsOnMessage = true;

  // Operator override via TIMEZONE var; falls back to the hub process's TZ.
  // Invalid IANA names are rejected via Intl validation rather than failing
  // later in cron-parser or date formatters.
  const hubTimezone =
    validateTimezone(variableMap.TIMEZONE) ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";

  return {
    shellCommand,
    retrySecondsBase,
    retrySecondsMax,
    compactSessionEnabled,
    preemptiveCompactEnabled,
    variableMap,
    shellVariableMap,
    googleSearchEngineId,
    spendLimitDollars,
    spendLimitHours,
    codexUsageLimitPercent,
    codexUsageCheckMinutes,
    useToolsForLlmConsoleResponses,
    autoStartAgentsOnMessage,
    mailServiceEnabled,
    hubTimezone,
  };
}
