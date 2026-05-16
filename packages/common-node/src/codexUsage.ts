// Fetches OpenAI Codex usage windows for the account behind an access token.
// Pure HTTP + parse — callers supply the token (the hub mints one locally, the
// supervisor routes through the hub).

import type { FetchLike } from "./codexAccessToken.js";
import {
  formatOpenAiError,
  normalizeFiniteNumber,
  parseJsonObject,
} from "./codexHttp.js";

const OPENAI_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_USAGE_URL = `${OPENAI_CHATGPT_BASE_URL}/wham/usage`;

type WhamUsageWindow = {
  limit_window_seconds?: unknown;
  used_percent?: unknown;
  reset_at?: unknown;
  reset_after_seconds?: unknown;
};

export interface CodexUsageWindow {
  limitWindowSeconds?: number;
  usedPercent?: number;
  resetAt?: number;
  resetAfterSeconds?: number;
}

export interface CodexUsage {
  /** Unix epoch milliseconds when usage was fetched. */
  checkedAt: number;
  limitReached?: boolean;
  primaryWindow?: CodexUsageWindow;
  secondaryWindow?: CodexUsageWindow;
}

function normalizeUsageWindow(
  value: unknown,
): CodexUsageWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const window = value as WhamUsageWindow;
  const normalized = {
    limitWindowSeconds: normalizeFiniteNumber(window.limit_window_seconds),
    usedPercent: normalizeFiniteNumber(window.used_percent),
    resetAt: normalizeFiniteNumber(window.reset_at),
    resetAfterSeconds: normalizeFiniteNumber(window.reset_after_seconds),
  };
  return Object.values(normalized).some((v) => v !== undefined)
    ? normalized
    : undefined;
}

/** GET the Codex usage windows for the account behind `accessToken`. */
export async function fetchCodexUsage(params: {
  accessToken: string;
  fetchFn?: FetchLike;
}): Promise<CodexUsage> {
  const fetchFn = params.fetchFn ?? fetch;
  const response = await fetchFn(CODEX_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
    },
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      formatOpenAiError({
        prefix: "OpenAI Codex usage check failed",
        status: response.status,
        bodyText,
      }),
    );
  }

  const body = parseJsonObject(bodyText);
  const rateLimit =
    body?.rate_limit &&
    typeof body.rate_limit === "object" &&
    !Array.isArray(body.rate_limit)
      ? (body.rate_limit as Record<string, unknown>)
      : undefined;

  return {
    checkedAt: Date.now(),
    limitReached:
      typeof rateLimit?.limit_reached === "boolean"
        ? rateLimit.limit_reached
        : undefined,
    primaryWindow: normalizeUsageWindow(rateLimit?.primary_window),
    secondaryWindow: normalizeUsageWindow(rateLimit?.secondary_window),
  };
}
