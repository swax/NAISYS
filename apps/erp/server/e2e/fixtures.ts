import {
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loginAsTestUser } from "./auth-helper";

/**
 * Dump the browser's `window.__coverage__` (set by vite-plugin-istanbul
 * when the erp client is built with COVERAGE=1) to the directory the
 * root coverage script merges in. No-op when the env var isn't set.
 */
async function dumpClientCoverage(page: Page): Promise<void> {
  const outDir = process.env.COVERAGE_CLIENT_RAW_DIR;
  if (!outDir) return;

  const coverage = await page.evaluate(
    () => (globalThis as { __coverage__?: unknown }).__coverage__ ?? null,
  );
  if (!coverage) return;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, `${randomUUID()}.json`),
    JSON.stringify(coverage),
  );
}

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
    await dumpClientCoverage(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
