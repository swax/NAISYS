/**
 * Supervisor UI E2E.
 *
 *  1. Set up an .env and a single agent yaml (uibot).
 *  2. Spawn naisys with --integrated-hub --supervisor and wait for the
 *     admin agent to start.
 *  3. Capture the superadmin password printed during startup.
 *  4. Launch headless Chromium via Playwright and navigate to the
 *     supervisor web UI.
 *  5. Login as superadmin with the captured password and wait for the
 *     post-login navigation to complete.
 *  6. Click uibot in the sidebar, wait for the agent detail page to load,
 *     and poll until the Start button becomes enabled.
 *  7. Click Start and wait for the "Agent Started" notification.
 *  8. Switch to uibot via the NAISYS CLI and assert the prompt shows
 *     uibot@, confirming the UI-triggered start actually started the
 *     agent.
 */

import { sleep } from "@naisys/common";
import { writeFileSync } from "fs";
import { join } from "path";
import { type Browser, chromium, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  dumpClientCoverage,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 120000 });

describe("Supervisor UI E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;

  const SERVER_PORT = 4404;

  beforeEach(() => {
    testDir = getTestDir("supervisor_ui");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (page) {
      await dumpClientCoverage(page);
      page = null;
    }
    if (browser) {
      await browser.close();
      browser = null;
    }
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="TEST-SUPERVISOR-UI"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("should login, start agent via UI, and switch to it via CLI", async () => {
    // --- Setup ---
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "uibot.yaml", {
      username: "uibot",
      title: "UI Test Bot",
    });

    const agentYamlPath = join(testDir, "uibot.yaml");
    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", agentYamlPath],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    // Wait for full startup
    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    // --- Capture admin password from startup output ---
    const fullOutput = naisys.getFullOutput();
    const passwordMatch = fullOutput.match(
      /superadmin user created\. Password: (\S+)/,
    );
    expect(passwordMatch).not.toBeNull();
    const adminPassword = passwordMatch![1];

    // --- Launch Playwright ---
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // --- Login ---
    await page.goto(`http://localhost:${SERVER_PORT}/supervisor/`);
    await page.getByLabel("Username").fill("superadmin");
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: "Login" }).click();

    // Wait for post-login navigation (Login button disappears once authenticated)
    await page
      .getByRole("button", { name: "Login" })
      .waitFor({ state: "hidden", timeout: 15000 });

    // Wait for sidebar to load with agent list
    await page.getByText("uibot").first().waitFor({ timeout: 15000 });

    // --- Navigate to agent detail ---
    await page.getByText("uibot").first().click();

    // --- Wait for Start button to become enabled ---
    const startButton = page.getByRole("button", { name: "Start" });
    await startButton.waitFor({ state: "visible", timeout: 15000 });

    // Poll until the Start button is enabled (actions loaded)
    const startTime = Date.now();
    while (await startButton.isDisabled()) {
      if (Date.now() - startTime > 15000) {
        throw new Error("Start button did not become enabled within 15s");
      }
      await sleep(500);
    }

    // --- Start the agent via UI ---
    await startButton.click();

    // Wait for the "Agent Started" notification
    await page
      .getByText("Agent Started", { exact: true })
      .waitFor({ timeout: 30000 });

    // --- Verify via CLI: switch to uibot ---
    const switchOutput = await naisys.switchAgent("uibot");
    expect(switchOutput).toContain("uibot@");
  });
});
