import type { APIRequestContext } from "@playwright/test";

export const ERP_API_BASE = "http://localhost:3302/erp/api";
const TEST_PASSWORD = "testpass123";

export function getTestCredentials(workerIndex: number) {
  return {
    username: `e2e-test-${workerIndex}`,
    password: TEST_PASSWORD,
  };
}

export async function loginAsTestUser(
  request: APIRequestContext,
  workerIndex: number,
) {
  const { username, password } = getTestCredentials(workerIndex);
  const res = await request.post(`${ERP_API_BASE}/auth/login`, {
    data: { username, password },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  }
  return res;
}
