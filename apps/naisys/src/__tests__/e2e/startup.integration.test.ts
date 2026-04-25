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

/**
 * E2E integration test for naisys startup flow.
 *
 * Creates a fresh environment with .env and agent.yaml,
 * spawns naisys, runs ns-mail users command, validates output,
 * and exits cleanly.
 */

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
