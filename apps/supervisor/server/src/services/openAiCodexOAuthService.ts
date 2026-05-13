import { OPENAI_CODEX_REFRESH_TOKEN_VAR } from "@naisys/common";
import { OPENAI_CODEX_CLIENT_ID } from "@naisys/common-node";
import { randomUUID } from "crypto";

import { sendOpenAiCodexAccessTokenGet } from "./hubConnectionService.js";
import { saveVariable } from "./variableService.js";

const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
const OPENAI_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";
const OPENAI_CODEX_DEVICE_CALLBACK_URL = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`;
const OPENAI_CODEX_USAGE_URL = `${OPENAI_CHATGPT_BASE_URL}/wham/usage`;
const DEVICE_CODE_TIMEOUT_MS = 15 * 60_000;
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DeviceFlow = {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
  expiresAt: number;
};

type WhamUsageWindow = {
  limit_window_seconds?: unknown;
  used_percent?: unknown;
  reset_at?: unknown;
  reset_after_seconds?: unknown;
};

const flows = new Map<string, DeviceFlow>();

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePositiveMilliseconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value * 1000);
  }
  const text = trimNonEmpty(value);
  if (!text || !/^\d+$/.test(text)) {
    return undefined;
  }
  const seconds = Number.parseInt(text, 10);
  return seconds > 0 ? seconds * 1000 : undefined;
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

function formatOpenAiError(params: {
  prefix: string;
  status: number;
  bodyText: string;
}) {
  const body = parseJsonObject(params.bodyText);
  const error = trimNonEmpty(body?.error);
  const description = trimNonEmpty(body?.error_description);
  if (error && description) {
    return `${params.prefix}: ${error} (${description})`;
  }
  if (error) {
    return `${params.prefix}: ${error}`;
  }
  const bodyText = params.bodyText.replace(/\s+/g, " ").trim();
  return bodyText
    ? `${params.prefix}: HTTP ${params.status} ${bodyText}`
    : `${params.prefix}: HTTP ${params.status}`;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = trimNonEmpty(value);
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUsageWindow(value: unknown) {
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

function summarizeUsage(limitReached: boolean | undefined) {
  if (limitReached === true) {
    return "OpenAI Codex usage limit reached.";
  }
  if (limitReached === false) {
    return "OpenAI Codex usage is available.";
  }
  return "OpenAI Codex usage check completed.";
}

async function requestDeviceCode(fetchFn: FetchLike): Promise<DeviceFlow> {
  const response = await fetchFn(
    `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        originator: "naisys",
        "User-Agent": "naisys",
      },
      body: JSON.stringify({
        client_id: OPENAI_CODEX_CLIENT_ID,
      }),
    },
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      formatOpenAiError({
        prefix: "OpenAI device code request failed",
        status: response.status,
        bodyText,
      }),
    );
  }

  const body = parseJsonObject(bodyText);
  const deviceAuthId = trimNonEmpty(body?.device_auth_id);
  const userCode =
    trimNonEmpty(body?.user_code) ?? trimNonEmpty(body?.usercode);
  if (!deviceAuthId || !userCode) {
    throw new Error("OpenAI device code response was missing required fields.");
  }

  return {
    deviceAuthId,
    userCode,
    verificationUrl: `${OPENAI_AUTH_BASE_URL}/codex/device`,
    intervalMs:
      normalizePositiveMilliseconds(body?.interval) ??
      DEVICE_CODE_DEFAULT_INTERVAL_MS,
    expiresAt: Date.now() + DEVICE_CODE_TIMEOUT_MS,
  };
}

async function pollDeviceAuthorization(
  flow: DeviceFlow,
  fetchFn: FetchLike,
): Promise<
  | { status: "pending" }
  | { status: "authorized"; authorizationCode: string; codeVerifier: string }
> {
  const response = await fetchFn(
    `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        originator: "naisys",
        "User-Agent": "naisys",
      },
      body: JSON.stringify({
        device_auth_id: flow.deviceAuthId,
        user_code: flow.userCode,
      }),
    },
  );

  const bodyText = await response.text();
  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }
  if (!response.ok) {
    throw new Error(
      formatOpenAiError({
        prefix: "OpenAI device authorization failed",
        status: response.status,
        bodyText,
      }),
    );
  }

  const body = parseJsonObject(bodyText);
  const authorizationCode = trimNonEmpty(body?.authorization_code);
  const codeVerifier = trimNonEmpty(body?.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    throw new Error(
      "OpenAI device authorization response was missing the exchange code.",
    );
  }

  return { status: "authorized", authorizationCode, codeVerifier };
}

async function exchangeDeviceAuthorization(params: {
  authorizationCode: string;
  codeVerifier: string;
  fetchFn: FetchLike;
}): Promise<{ refresh: string }> {
  const response = await params.fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      originator: "naisys",
      "User-Agent": "naisys",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.authorizationCode,
      redirect_uri: OPENAI_CODEX_DEVICE_CALLBACK_URL,
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: params.codeVerifier,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      formatOpenAiError({
        prefix: "OpenAI device token exchange failed",
        status: response.status,
        bodyText,
      }),
    );
  }

  const body = parseJsonObject(bodyText);
  const refresh = trimNonEmpty(body?.refresh_token);
  if (!refresh) {
    throw new Error(
      "OpenAI token exchange did not return an OAuth refresh token.",
    );
  }

  // Drop the initial access token — the hub mints fresh ones on demand.
  return { refresh };
}

export async function startOpenAiCodexOAuthFlow(fetchFn: FetchLike = fetch) {
  const flow = await requestDeviceCode(fetchFn);
  const flowId = randomUUID();
  flows.set(flowId, flow);
  return {
    success: true as const,
    flowId,
    verificationUrl: flow.verificationUrl,
    userCode: flow.userCode,
    expiresAt: flow.expiresAt,
    intervalMs: Math.max(flow.intervalMs, DEVICE_CODE_MIN_INTERVAL_MS),
  };
}

export async function pollOpenAiCodexOAuthFlow(params: {
  flowId: string;
  userUuid: string;
  fetchFn?: FetchLike;
}) {
  const flow = flows.get(params.flowId);
  if (!flow || flow.expiresAt <= Date.now()) {
    flows.delete(params.flowId);
    return {
      success: true as const,
      status: "expired" as const,
      message: "OpenAI authorization code expired. Start a new setup flow.",
    };
  }

  const authorization = await pollDeviceAuthorization(
    flow,
    params.fetchFn ?? fetch,
  );
  if (authorization.status === "pending") {
    return {
      success: true as const,
      status: "pending" as const,
      message: "Waiting for OpenAI authorization.",
    };
  }

  const token = await exchangeDeviceAuthorization({
    authorizationCode: authorization.authorizationCode,
    codeVerifier: authorization.codeVerifier,
    fetchFn: params.fetchFn ?? fetch,
  });

  await saveVariable(
    OPENAI_CODEX_REFRESH_TOKEN_VAR,
    token.refresh,
    false,
    true,
    params.userUuid,
  );
  flows.delete(params.flowId);

  return {
    success: true as const,
    status: "complete" as const,
    message: "OpenAI Codex OAuth refresh token saved.",
    savedKeys: [OPENAI_CODEX_REFRESH_TOKEN_VAR],
  };
}

export async function checkOpenAiCodexOAuthUsage(params: {
  fetchFn?: FetchLike;
}) {
  const fetchFn = params.fetchFn ?? fetch;
  // Route through the hub so rotation stays single-flight.
  const tokenResult = await sendOpenAiCodexAccessTokenGet();
  if (!tokenResult.success || !tokenResult.accessToken) {
    throw new Error(
      tokenResult.error ??
        `Set ${OPENAI_CODEX_REFRESH_TOKEN_VAR} before checking OpenAI Codex usage.`,
    );
  }

  const response = await fetchFn(OPENAI_CODEX_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
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
  const primaryWindow = normalizeUsageWindow(rateLimit?.primary_window);
  const secondaryWindow = normalizeUsageWindow(rateLimit?.secondary_window);
  const limitReached =
    typeof rateLimit?.limit_reached === "boolean"
      ? rateLimit.limit_reached
      : undefined;

  return {
    success: true as const,
    checkedAt: Date.now(),
    limitReached,
    primaryWindow,
    secondaryWindow,
    message: summarizeUsage(limitReached),
  };
}
