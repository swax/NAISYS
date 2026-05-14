import { OPENAI_CODEX_REFRESH_TOKEN_VAR } from "@naisys/common";
import {
  fetchOpenAiCodexUsage,
  formatOpenAiError,
  normalizePositiveMilliseconds,
  OPENAI_CODEX_CLIENT_ID,
  parseJsonObject,
  trimNonEmpty,
} from "@naisys/common-node";
import { randomUUID } from "crypto";

import { sendOpenAiCodexAccessTokenGet } from "./hubConnectionService.js";
import { saveVariable } from "./variableService.js";

const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
const OPENAI_CODEX_DEVICE_CALLBACK_URL = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`;
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

const flows = new Map<string, DeviceFlow>();

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
  // Route through the hub so rotation stays single-flight.
  const tokenResult = await sendOpenAiCodexAccessTokenGet();
  if (!tokenResult.success || !tokenResult.accessToken) {
    throw new Error(
      tokenResult.error ??
        `Set ${OPENAI_CODEX_REFRESH_TOKEN_VAR} before checking OpenAI Codex usage.`,
    );
  }

  const usage = await fetchOpenAiCodexUsage({
    accessToken: tokenResult.accessToken,
    fetchFn: params.fetchFn,
  });

  return {
    success: true as const,
    ...usage,
    message: summarizeUsage(usage.limitReached),
  };
}
