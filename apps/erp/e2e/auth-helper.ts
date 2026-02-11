import type { APIRequestContext } from "@playwright/test";

const API = "http://localhost:3002/api/erp";
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
  const res = await request.post(`${API}/auth/login`, {
    data: { username, password },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  }
  return res;
}
