import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { sleep } from "@naisys/common";
import { writeFileSync } from "fs";
import { join } from "path";
import { type Browser, chromium, type Page } from "playwright";

import {
  cleanupTestDir,
  createAgentYaml,
  getTestDir,
  NaisysTestProcess,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

/**
 * E2E test for the Supervisor UI.
 *
 * Spawns NAISYS with --integrated-hub --supervisor, logs into
 * the supervisor web UI via Playwright, starts an agent through
 * the UI, then verifies it is running by switching to it via
 * the ns-agent switch CLI command.
 */

jest.setTimeout(120000);

describe("Supervisor UI E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;
  let browser: Browser | null = null;

  const HUB_PORT = 4131;
  const SUPERVISOR_PORT = 4032;

  beforeEach(() => {
    testDir = getTestDir("supervisor_ui");
    setupTestDir(testDir);
  });

  afterEach(async () => {
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
HUB_PORT=${HUB_PORT}
SUPERVISOR_PORT=${SUPERVISOR_PORT}
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
    const page: Page = await browser.newPage();

    // --- Login ---
    await page.goto(`http://localhost:${SUPERVISOR_PORT}/supervisor/`);
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
    naisys.flushOutput();
    naisys.sendCommand("ns-agent switch uibot");
    await naisys.waitForOutput("uibot@", 15000);
    await naisys.waitForPrompt();

    const switchOutput = naisys.flushOutput();
    expect(switchOutput).toContain("uibot@");
  });
});
