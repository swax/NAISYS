/**
 * ERP API key authentication E2E.
 *
 *  1. Set up an .env and a single agent yaml (testbot).
 *  2. Spawn naisys with --integrated-hub --supervisor --erp so the hub,
 *     supervisor, and ERP plugin all run in-process.
 *  3. Wait for the implicit admin agent to start (registers an API key for
 *     each agent in the hub database).
 *  4. Start testbot via the CLI and switch to its prompt.
 *  5. From the testbot shell, curl /erp/api/auth/me using the
 *     $NAISYS_API_KEY variable in the Authorization header.
 *  6. Assert the response is JSON containing the auto-provisioned testbot
 *     user identity, proving the ERP accepted the API key.
 */

import { sleep } from "@naisys/common";
import { writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  formatDotenvValue,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 120000 });

describe("ERP API Key Auth E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  let SERVER_PORT: number;

  beforeEach(async () => {
    testDir = getTestDir("erp_api_key");
    setupTestDir(testDir);
    SERVER_PORT = await getFreePort();
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    const envContent = `
NAISYS_FOLDER=${formatDotenvValue(dir)}
NAISYS_HOSTNAME="TEST-ERP"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("should authenticate agent via API key to ERP", async () => {
    // --- Setup agent config ---
    createIntegratedEnvFile(testDir);
    createAgentYaml(testDir, "testbot.yaml", {
      username: "testbot",
      title: "Test Bot",
    });

    // --- Start NAISYS with integrated hub + supervisor + erp ---
    const agentYamlPath = join(testDir, "testbot.yaml");
    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", "--erp", agentYamlPath],
      env: { NODE_ENV: "production", NAISYS_FOLDER: testDir },
    });

    // Wait for full startup (hub, supervisor, ERP, then admin agent)
    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    // --- Start and switch to testbot (integrated-hub only starts admin) ---
    await naisys.startAgent("testbot", "erp api key test");
    await naisys.switchAgent("testbot");

    // --- Send curl command using the shell's API key environment variable ---
    const responseStart = "__ERP_AUTH_ME_START__";
    const responseEnd = "__ERP_AUTH_ME_END__";
    const curlCommand =
      process.platform === "win32"
        ? `Write-Output "${responseStart}"; curl.exe -s -H "Authorization: Bearer $env:NAISYS_API_KEY" http://localhost:${SERVER_PORT}/erp/api/auth/me; Write-Output "${responseEnd}"`
        : `printf '%s\\n' "${responseStart}"; curl -s -H "Authorization: Bearer $NAISYS_API_KEY" http://localhost:${SERVER_PORT}/erp/api/auth/me; printf '\\n%s\\n' "${responseEnd}"`;
    const output = await naisys.runCommand(
      curlCommand,
      { waitFor: responseEnd, timeoutMs: 30000 },
    );

    const responseMatch = output.match(
      new RegExp(`${responseStart}\\s*([\\s\\S]*?)\\s*${responseEnd}`),
    );
    expect(responseMatch).not.toBeNull();

    const me = JSON.parse(responseMatch![1]) as { username?: string };
    expect(me.username).toBe("testbot");

    // --- Log errors for debugging ---
    naisys.dumpStderrIfAny("NAISYS");
  });
});
