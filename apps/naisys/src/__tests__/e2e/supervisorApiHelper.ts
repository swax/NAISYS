import { sleep } from "@naisys/common";
import type { AuthUser } from "@naisys/supervisor-shared";

import type { NaisysTestProcess } from "./e2eTestHelper.js";

export interface SupervisorApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
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

export function extractGeneratedSuperAdminPassword(output: string): string {
  const match = output.match(/superadmin user created\. Password: (\S+)/);
  if (!match) {
    throw new Error(
      "Could not find generated superadmin password in NAISYS output",
    );
  }
  return match[1];
}

export function createSupervisorApiClient(
  baseUrl: string,
  cookie: string,
): SupervisorApiClient {
  async function apiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie,
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
  };
}

export async function loginAsSuperAdmin(
  naisys: NaisysTestProcess,
  baseUrl: string,
): Promise<SupervisorApiClient> {
  const password = extractGeneratedSuperAdminPassword(naisys.getFullOutput());
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "superadmin", password }),
  });
  await parseJsonResponse<{ user: AuthUser }>(response);

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Login response did not include a session cookie");
  }
  return createSupervisorApiClient(baseUrl, cookie);
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
