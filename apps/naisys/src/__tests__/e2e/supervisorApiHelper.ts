import { sleep } from "@naisys/common";
import type { AuthUser } from "@naisys/supervisor-shared";

import type { NaisysTestProcess } from "./e2eTestHelper.js";

export interface SupervisorApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
  put: <T>(path: string, body?: Record<string, unknown>) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  /** POST multipart/form-data and parse JSON response */
  postMultipart: <T>(path: string, formData: FormData) => Promise<T>;
  /** Fetch a path relative to the host root (not the API prefix), with auth cookie */
  fetchFromHost: (pathFromRoot: string, init?: RequestInit) => Promise<Response>;
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
    put: <T>(path: string, body?: Record<string, unknown>) =>
      apiRequest<T>("PUT", path, body),
    del: <T>(path: string) => apiRequest<T>("DELETE", path),
    postMultipart: async <T>(
      path: string,
      formData: FormData,
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { cookie },
        body: formData,
      });
      return parseJsonResponse<T>(response);
    },
    fetchFromHost: (pathFromRoot: string, init: RequestInit = {}) =>
      fetch(`${hostRoot}${pathFromRoot}`, {
        ...init,
        headers: { ...(init.headers ?? {}), cookie },
      }),
  };
}

export async function loginAs(
  baseUrl: string,
  username: string,
  password: string,
): Promise<SupervisorApiClient> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await parseJsonResponse<{ user: AuthUser }>(response);

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Login response did not include a session cookie");
  }
  return createSupervisorApiClient(baseUrl, cookie);
}

export async function loginAsSuperAdmin(
  naisys: NaisysTestProcess,
  baseUrl: string,
): Promise<SupervisorApiClient> {
  const password = extractGeneratedSuperAdminPassword(naisys.getFullOutput());
  return loginAs(baseUrl, "superadmin", password);
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
