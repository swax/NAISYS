import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { appendFileSync } from "fs";
import { join } from "path";
import {
  cleanupTestDir,
  createAgentYaml,
  createEnvFile,
  getTestDir,
  NaisysTestProcess,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";

/**
 * E2E tests for basic mail between two agents.
 *
 * Tests both standalone (no hub) and integrated-hub modes.
 * Creates two agent yamls directly in the test directory so they
 * auto-start as lead agents. Sends mail from alex to bob,
 * switches to bob, and validates the mail notification appears.
 */

jest.setTimeout(120000);

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

  async function runMailTest(naisysArgs: string[] = []) {
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

    // Wait for alex to start and show prompt
    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    // Send mail from alex to bob
    naisys.flushOutput();
    naisys.sendCommand('ns-mail send "bob" "test" "hi from alex"');
    await naisys.waitForOutput("Mail sent", 10000);
    await naisys.waitForPrompt();

    // Switch to bob
    naisys.flushOutput();
    naisys.sendCommand("ns-agent switch bob");
    await naisys.waitForOutput("bob@", 15000);
    await naisys.waitForPrompt();

    // Trigger a prompt cycle to process any pending notifications
    naisys.flushOutput();
    naisys.sendNewLine();
    await naisys.waitForPrompt();

    // Verify the mail notification appeared somewhere in the full output
    const fullOutput = naisys.getFullOutput();
    expect(fullOutput).toContain("Mail sent");
    expect(fullOutput).toContain("Subject: test");
    expect(fullOutput).toContain("From: alex");
    expect(fullOutput).toContain("To: bob");
    expect(fullOutput).toContain("hi from alex");

    if (naisys.stderr.length > 0) {
      console.log("stderr:", naisys.stderr.join(""));
    }
  }

  test("standalone: send mail from alex to bob", async () => {
    createEnvFile(testDir);
    await runMailTest();
  });

  test("integrated-hub: send mail from alex to bob", async () => {
    createEnvFile(testDir);
    appendFileSync(join(testDir, ".env"), "\nHUB_ACCESS_KEY=TESTKEY123");
    await runMailTest(["--integrated-hub"]);
  });
});
