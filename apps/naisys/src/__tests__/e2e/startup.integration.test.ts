/**
 * NAISYS startup integration E2E.
 *
 *  1. Create a fresh test directory with an .env and an agent.yaml
 *     (username: ryan).
 *  2. Spawn naisys pointed at the agent yaml; wait for AGENT STARTED and
 *     the prompt.
 *  3. Run `ns-users` and wait until ryan appears in the output.
 *  4. Send `exit` and wait for AGENT EXITED (no prompt after exit).
 *  5. Wait for the process to exit; assert exit code 0 and that the
 *     captured output contains the expected startup/agent/exit markers.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  createEnvFile,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 60000 });

describe("NAISYS Startup E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  beforeEach(() => {
    testDir = getTestDir("startup_integration");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("should start naisys, run ns-users, show ryan, and exit", async () => {
    // Create .env file
    createEnvFile(testDir);

    // Create agent.yaml with shellModel: none so we can manually input commands
    createAgentYaml(testDir, "assistant.yaml", {
      username: "ryan",
      title: "Assistant",
    });

    // Spawn naisys process
    naisys = spawnNaisys(testDir, { args: ["assistant.yaml"] });

    // Wait for naisys to start and show the prompt
    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    // Send ns-users command and wait for the agent user to appear
    await naisys.runCommand("ns-users", { waitFor: "ryan" });

    // Send exit command and wait for clean exit (no prompt after exit)
    await naisys.runCommand("exit", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
    });

    // Wait for process to exit
    const exitCode = await waitForExit(naisys.process);

    // Validate output
    const fullOutput = naisys.getFullOutput();

    expect(fullOutput).toContain("NAISYS");
    expect(fullOutput).toContain("AGENT STARTED");
    expect(fullOutput).toContain("ryan");
    expect(fullOutput).toContain("Assistant");
    expect(fullOutput).toContain("AGENT EXITED");

    // Check exit code (0 = success)
    expect(exitCode).toBe(0);

    naisys.dumpStderrIfAny();
  });
});
