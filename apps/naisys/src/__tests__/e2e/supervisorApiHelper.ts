import { sleep } from "@naisys/common";
import { hashToken } from "@naisys/common-node";
import { createPrismaClient } from "@naisys/supervisor-database";
import { randomBytes } from "crypto";
import { join } from "path";
import type { Page } from "playwright";

import type { NaisysTestProcess } from "./e2eTestHelper.js";

export interface SupervisorApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
  put: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  /** POST multipart/form-data and parse JSON response */
  postMultipart: <T>(path: string, formData: FormData) => Promise<T>;
  /** Fetch a path relative to the host root (not the API prefix), with auth headers */
  fetchFromHost: (
    pathFromRoot: string,
    init?: RequestInit,
  ) => Promise<Response>;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}: ${text}`,
    );
  }
  return JSON.parse(text) as T;
}

export function extractSuperAdminRegistrationUrl(output: string): string {
  const match = output.match(
    /Copy:\s+(http:\/\/\S+\/supervisor\/register\?token=\S+)/,
  );
  if (!match) {
    throw new Error(
      "Could not find superadmin registration URL in NAISYS output",
    );
  }
  return match[1];
}

function createSupervisorApiClientWithHeaders(
  baseUrl: string,
  authHeaders: Record<string, string>,
): SupervisorApiClient {
  // baseUrl looks like http://host:port/supervisor/api — derive the host root
  // for endpoints that already include the API prefix (e.g. attachment download URLs).
  const hostRoot = new URL(baseUrl).origin;

  async function apiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...authHeaders,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseJsonResponse<T>(response);
  }
  return {
    get: <T>(path: string) => apiRequest<T>("GET", path),
    post: <T>(path: string, body?: Record<string, unknown>) =>
      apiRequest<T>("POST", path, body),
    put: <T>(path: string, body?: Record<string, unknown>) =>
      apiRequest<T>("PUT", path, body),
    del: <T>(path: string) => apiRequest<T>("DELETE", path),
    postMultipart: async <T>(path: string, formData: FormData): Promise<T> => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      return parseJsonResponse<T>(response);
    },
    fetchFromHost: (pathFromRoot: string, init: RequestInit = {}) =>
      fetch(`${hostRoot}${pathFromRoot}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...authHeaders },
      }),
  };
}

export function createSupervisorApiClient(
  baseUrl: string,
  cookie: string,
): SupervisorApiClient {
  return createSupervisorApiClientWithHeaders(baseUrl, { cookie });
}

export function createSupervisorApiKeyClient(
  baseUrl: string,
  apiKey: string,
): SupervisorApiClient {
  return createSupervisorApiClientWithHeaders(baseUrl, {
    authorization: `Bearer ${apiKey}`,
  });
}

export async function generateSupervisorUserApiKey(
  naisys: NaisysTestProcess,
  username: string,
): Promise<string> {
  const apiKey = randomBytes(32).toString("hex");
  const db = await createPrismaClient(
    join(naisys.testDir, "database", "supervisor.db"),
  );
  try {
    const user = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!user) {
      throw new Error(`Supervisor user ${username} does not exist`);
    }
    await db.user.update({
      where: { id: user.id },
      data: { apiKeyHash: hashToken(apiKey) },
    });
    return apiKey;
  } finally {
    await db.$disconnect();
  }
}

export async function loginAsSuperAdmin(
  naisys: NaisysTestProcess,
  baseUrl: string,
): Promise<SupervisorApiClient> {
  const apiKey = await generateSupervisorUserApiKey(naisys, "superadmin");
  return createSupervisorApiKeyClient(baseUrl, apiKey);
}

export async function installVirtualPasskeyAuthenticator(
  page: Page,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

export async function registerSuperAdminPasskeyViaUi(
  naisys: NaisysTestProcess,
  page: Page,
): Promise<void> {
  await installVirtualPasskeyAuthenticator(page);
  await page.goto(extractSuperAdminRegistrationUrl(naisys.getFullOutput()));
  await page
    .getByRole("button", { name: "Register passkey" })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Device label").fill("E2E virtual authenticator");
  await page.getByRole("button", { name: "Register passkey" }).click();
  await page.getByText("Passkey registered").waitFor({ timeout: 15000 });
  await page.waitForURL(/\/supervisor\/agents/, { timeout: 15000 });
}

export async function waitFor<T>(
  description: string,
  load: () => Promise<T>,
  isReady: (value: T) => boolean,
  timeoutMs = 30000,
): Promise<T> {
  const startTime = Date.now();
  let lastValue: T | undefined;

  while (Date.now() - startTime < timeoutMs) {
    lastValue = await load();
    if (isReady(lastValue)) {
      return lastValue;
    }
    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`,
  );
}
