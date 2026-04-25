import {
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { loginAsTestUser } from "./auth-helper";

interface ErpFixtures {
  /**
   * Browser page whose request context is logged in as the worker's e2e
   * test user. Use in UI specs in place of `browser.newPage()` + login.
   */
  authedPage: Page;
}

interface ErpWorkerFixtures {
  /**
   * APIRequestContext authenticated as the worker's e2e test user.
   * Worker-scoped so it can be captured in `beforeAll` and reused across
   * tests within a describe block.
   */
  authedApi: APIRequestContext;
}

export const test = base.extend<ErpFixtures, ErpWorkerFixtures>({
  authedApi: [
    async ({ playwright }, use, workerInfo) => {
      const api = await playwright.request.newContext();
      await loginAsTestUser(api, workerInfo.workerIndex);
      await use(api);
      await api.dispose();
    },
    { scope: "worker" },
  ],
  authedPage: async ({ browser }, use, testInfo) => {
    const page = await browser.newPage();
    await loginAsTestUser(page.request, testInfo.workerIndex);
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
