/**
 * Basic mail between two agents E2E.
 *
 *  1. Create two agent yamls (alex, bob) in the test directory so they
 *     auto-start as lead agents.
 *  2. Spawn naisys in the requested mode (standalone or integrated-hub).
 *  3. In integrated-hub mode only admin starts automatically, so manually
 *     start alex and bob and switch the CLI back to alex.
 *  4. Send mail from alex → bob via the CLI.
 *  5. Switch the CLI to bob and trigger a prompt cycle.
 *  6. Assert the mail notification (subject, from, to, body) appears in
 *     bob's output.
 *
 * Run twice: once standalone, once with --integrated-hub.
 */

import { appendFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  createEnvFile,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 120000 });

describe("Basic Mail E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  beforeEach(() => {
    testDir = getTestDir("basic_mail");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  async function runMailTest(naisysArgs: string[] = [], manualStart = false) {
    // Create two agent yamls in test dir root (auto-start as lead agents)
    createAgentYaml(testDir, "alex.yaml", {
      username: "alex",
      title: "Assistant",
    });

    createAgentYaml(testDir, "bob.yaml", {
      username: "bob",
      title: "Assistant",
    });

    // Spawn naisys - loads all yamls, starts lead agents, alex gets focus
    naisys = spawnNaisys(testDir, { args: naisysArgs });

    // Wait for startup and show prompt
    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    if (manualStart) {
      // In integrated-hub mode, only admin starts. Start agents manually.
      await naisys.startAgent("alex", "mail test");
      await naisys.startAgent("bob", "mail test");
      await naisys.switchAgent("alex");
    }

    await naisys.sendMail("bob", "test", "hi from alex");
    await naisys.switchAgent("bob");

    // Trigger a prompt cycle to process any pending notifications
    await naisys.pressEnter();

    // Verify the mail notification appeared somewhere in the full output
    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("Mail sent");
    expect(fullOutput).toContain("Subject: test");
    expect(fullOutput).toContain("From: alex");
    expect(fullOutput).toContain("To: bob");
    expect(fullOutput).toContain("hi from alex");

    naisys.dumpStderrIfAny();
  }

  test("standalone: send mail from alex to bob", async () => {
    createEnvFile(testDir);
    await runMailTest();
  });

  test("integrated-hub: send mail from alex to bob", async () => {
    createEnvFile(testDir);
    const serverPort = await getFreePort();
    appendFileSync(join(testDir, ".env"), `\nSERVER_PORT=${serverPort}`);
    await runMailTest(["--integrated-hub"], true);
  });
});
