import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  cleanupTestDir,
  createAgentYaml,
  getTestDir,
  NaisysTestProcess,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

/**
 * E2E test for ERP API key authentication.
 *
 * Creates a single NAISYS instance with:
 * - Integrated hub (--integrated-hub)
 * - Supervisor web server (--supervisor)
 * - ERP plugin (--erp)
 *
 * Tests that:
 * 1. Agent is registered with an API key in the hub database
 * 2. $api_key variable in shell commands is replaced with the actual key
 * 3. ERP API accepts the API key and auto-provisions a local user
 * 4. /api/erp/auth/me returns the correct agent identity
 */

jest.setTimeout(120000);

describe("ERP API Key Auth E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  const HUB_PORT = 5021;
  const SUPERVISOR_PORT = 5022;
  const HUB_ACCESS_KEY = "TESTKEY_ERP_E2E";

  beforeEach(() => {
    testDir = getTestDir("erp_api_key");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile(dir: string) {
    const envContent = `
NAISYS_FOLDER="${dir}"
NAISYS_HOSTNAME="TEST-ERP"
SPEND_LIMIT_DOLLARS=10
HUB_ACCESS_KEY=${HUB_ACCESS_KEY}
HUB_PORT=${HUB_PORT}
SUPERVISOR_PORT=${SUPERVISOR_PORT}
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

    // Wait for full startup (hub, supervisor, ERP, then NAISYS agent)
    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    // --- Send curl command using $api_key variable ---
    naisys.flushOutput();
    naisys.sendCommand(
      `curl -s -H "X-API-Key: $NAISYS_API_KEY" http://localhost:${SUPERVISOR_PORT}/api/erp/auth/me`,
    );
    await naisys.waitForOutput("testbot", 30000);
    await naisys.waitForPrompt();

    const output = naisys.flushOutput();

    // Verify ERP returned the auto-provisioned agent user
    expect(output).toContain("testbot");

    // The response should be JSON with id and username
    const jsonMatch = output.match(/\{[^}]*"username"\s*:\s*"testbot"[^}]*\}/);
    expect(jsonMatch).not.toBeNull();

    // --- Log errors for debugging ---
    if (naisys.stderr.length > 0) {
      console.log("NAISYS stderr:", naisys.stderr.join(""));
    }
  });
});
