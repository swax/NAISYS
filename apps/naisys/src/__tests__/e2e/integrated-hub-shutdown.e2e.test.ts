/**
 * Integrated-hub shutdown regression E2E.
 *
 * Verifies the admin-only `exit all` path exits the process after printing
 * AGENT EXITED. This catches reconnect timers or server-side intervals that
 * keep the integrated hub process alive after shutdown.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createEnvFile,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
  waitForExit,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 60000 });

describe("Integrated Hub Shutdown E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;
  let serverPort: number;

  beforeEach(async () => {
    testDir = getTestDir("integrated_hub_shutdown");
    setupTestDir(testDir);
    serverPort = await getFreePort();
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("exit all with only admin stops the integrated hub and exits", async () => {
    createEnvFile(testDir);
    appendFileSync(join(testDir, ".env"), `\nSERVER_PORT=${serverPort}`);

    naisys = spawnNaisys(testDir, { args: ["--integrated-hub"] });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    await naisys.runCommand("exit all", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("Stopped 0 agent(s)");
    expect(fullOutput).toContain("[NAISYS] Exited");

    naisys.dumpStderrIfAny("Integrated hub shutdown");
  });

  test("exit with embedded supervisor and ERP stops reconnecting clients", async () => {
    createEnvFile(testDir, { naisysFolder: testDir });
    appendFileSync(join(testDir, ".env"), `\nSERVER_PORT=${serverPort}`);

    naisys = spawnNaisys(testDir, {
      args: ["--integrated-hub", "--supervisor", "--erp"],
    });

    await naisys.waitForOutput("AGENT STARTED", 60000);
    await naisys.waitForPrompt();

    await naisys.runCommand("exit", {
      waitFor: "AGENT EXITED",
      waitForPrompt: false,
      timeoutMs: 30000,
    });

    const exitCode = await waitForExit(naisys.process, 10000);
    expect(exitCode).toBe(0);

    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("[NAISYS] Exited");

    naisys.dumpStderrIfAny("Integrated hub supervisor/ERP shutdown");
  });
});
