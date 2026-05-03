import {
  OPENAI_CODEX_ACCESS_TOKEN_VAR,
  OPENAI_CODEX_EXPIRES_AT_VAR,
  OPENAI_CODEX_REFRESH_TOKEN_VAR,
} from "@naisys/common";

import type { LlmMessage } from "../llmDtos.js";
import { sendWithOpenAiStandard } from "./openai-standard.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_SKEW_MS = 5 * 60_000;

type OpenAiCodexToken = {
  access: string;
  refresh: string;
  expires: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseEpochMilliseconds(value: unknown): number | undefined {
  const text = trimNonEmpty(value);
  if (!text || !/^\d+$/.test(text)) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeLifetimeMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value * 1000);
  }
  const text = trimNonEmpty(value);
  if (!text || !/^\d+$/.test(text)) {
    return undefined;
  }
  return Number.parseInt(text, 10) * 1000;
}

export function resolveOpenAiCodexAccessTokenExpiry(
  token: string,
): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) {
    return undefined;
  }

  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof body.exp === "number" && Number.isFinite(body.exp)
      ? Math.trunc(body.exp * 1000)
      : undefined;
  } catch {
    return undefined;
  }
}

function formatRefreshError(status: number, bodyText: string): string {
  const body = parseJsonObject(bodyText);
  const error = trimNonEmpty(body?.error);
  const description = trimNonEmpty(body?.error_description);
  if (error && description) {
    return `OpenAI OAuth refresh failed: ${error} (${description})`;
  }
  if (error) {
    return `OpenAI OAuth refresh failed: ${error}`;
  }
  const bodySummary = bodyText.replace(/\s+/g, " ").trim();
  return bodySummary
    ? `OpenAI OAuth refresh failed: HTTP ${status} ${bodySummary}`
    : `OpenAI OAuth refresh failed: HTTP ${status}`;
}

export async function refreshOpenAiCodexToken(
  refreshToken: string,
  fetchFn: FetchLike = fetch,
): Promise<OpenAiCodexToken> {
  const response = await fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OPENAI_CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(formatRefreshError(response.status, bodyText));
  }

  const body = parseJsonObject(bodyText);
  const access = trimNonEmpty(body?.access_token);
  const refresh = trimNonEmpty(body?.refresh_token) ?? refreshToken;
  if (!access || !refresh) {
    throw new Error(
      "OpenAI OAuth refresh succeeded but did not return usable tokens.",
    );
  }

  const expiresInMs = normalizeLifetimeMs(body?.expires_in);
  return {
    access,
    refresh,
    expires:
      expiresInMs !== undefined
        ? Date.now() + expiresInMs
        : (resolveOpenAiCodexAccessTokenExpiry(access) ?? Date.now()),
  };
}

function persistOauthValue(
  variables: Record<string, string>,
  updateVariable: ((key: string, value: string) => void) | undefined,
  key: string,
  value: string,
) {
  variables[key] = value;
  updateVariable?.(key, value);
}

export async function resolveOpenAiOauthAccessToken(params: {
  accessToken?: string;
  variables: Record<string, string>;
  updateVariable?: (key: string, value: string) => void;
  fetchFn?: FetchLike;
  now?: number;
}): Promise<string | undefined> {
  const accessToken =
    trimNonEmpty(params.accessToken) ??
    trimNonEmpty(params.variables[OPENAI_CODEX_ACCESS_TOKEN_VAR]);
  const refreshToken = trimNonEmpty(
    params.variables[OPENAI_CODEX_REFRESH_TOKEN_VAR],
  );
  const expires =
    parseEpochMilliseconds(params.variables[OPENAI_CODEX_EXPIRES_AT_VAR]) ??
    (accessToken
      ? resolveOpenAiCodexAccessTokenExpiry(accessToken)
      : undefined);
  const now = params.now ?? Date.now();

  if (
    !refreshToken ||
    (accessToken && expires !== undefined && expires > now + REFRESH_SKEW_MS)
  ) {
    return accessToken;
  }

  const refreshed = await refreshOpenAiCodexToken(
    refreshToken,
    params.fetchFn ?? fetch,
  );
  persistOauthValue(
    params.variables,
    params.updateVariable,
    OPENAI_CODEX_ACCESS_TOKEN_VAR,
    refreshed.access,
  );
  persistOauthValue(
    params.variables,
    params.updateVariable,
    OPENAI_CODEX_REFRESH_TOKEN_VAR,
    refreshed.refresh,
  );
  persistOauthValue(
    params.variables,
    params.updateVariable,
    OPENAI_CODEX_EXPIRES_AT_VAR,
    String(refreshed.expires),
  );

  return refreshed.access;
}

export async function sendWithOpenAiOauth(
  deps: VendorDeps,
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: QuerySources,
  apiKey?: string,
  abortSignal?: AbortSignal,
): Promise<QueryResult> {
  const variables = deps.globalConfig.globalConfig().variableMap;
  const accessToken = await resolveOpenAiOauthAccessToken({
    accessToken: apiKey,
    variables,
    updateVariable: (key, value) =>
      deps.globalConfig.setVariableValue(key, value, { exportToShell: false }),
  });

  return sendWithOpenAiStandard(
    deps,
    modelKey,
    systemMessage,
    context,
    source,
    accessToken,
    abortSignal,
  );
}
