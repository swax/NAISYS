import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  getTestDir,
  setupTestDir,
  cleanupTestDir,
  createEnvFile,
  createAgentYamlInDir,
  spawnNaisys,
  waitForExit,
  NaisysTestProcess,
} from "./e2eTestHelper.js";

/**
 * E2E integration test for naisys mail functionality.
 *
 * Creates a multi-agent environment with alex and bob,
 * starts both agents, sends mail from alex to bob,
 * and validates bob receives the mail.
 */

jest.setTimeout(120000);

describe("NAISYS Mail E2E", () => {
  let testDir: string;
  let naisys: NaisysTestProcess | null = null;

  beforeEach(() => {
    testDir = getTestDir("mail_integration");
    setupTestDir(testDir);
  });

  afterEach(async () => {
    if (naisys) {
      await naisys.cleanup();
      naisys = null;
    }
    cleanupTestDir(testDir);
  });

  test("should send mail from alex to bob and bob receives it", async () => {
    // Create .env file
    createEnvFile(testDir);

    // Create admin agent with subagentMax: 2 to allow starting both alex and bob
    createAgentYamlInDir(testDir, "agents", "admin_agent.yaml", {
      username: "admin",
      title: "Administrator",
      agentPrompt: "Admin agent for monitoring and control.",
      tokenMax: 100000,
      mailEnabled: true,
      subagentMax: 2,  // Allow running 2 subagents at once
    });

    // Create agent yaml files in agents/ subdirectory
    createAgentYamlInDir(testDir, "agents", "alex.yaml", {
      username: "alex",
      title: "Test Agent Alex",
      mailEnabled: true,
    });

    createAgentYamlInDir(testDir, "agents", "bob.yaml", {
      username: "bob",
      title: "Test Agent Bob",
      mailEnabled: true,
    });

    // Spawn naisys without args - this auto-loads agents and drops into admin shell
    naisys = spawnNaisys(testDir);

    // Wait for naisys to start and enter admin shell
    await naisys.waitForOutput("AGENT STARTED", 30000);
    await naisys.waitForPrompt();

    // List agents to see what's available
    naisys.flushOutput();
    naisys.sendCommand("ns-agent list");
    await naisys.waitForOutput("alex", 10000);
    await naisys.waitForOutput("bob", 10000);
    await naisys.waitForPrompt();

    // Start alex agent
    naisys.flushOutput();
    naisys.sendCommand('ns-agent start alex "Testing mail functionality"');
    await naisys.waitForOutput("started", 15000);
    await naisys.waitForPrompt();

    // Start bob agent
    naisys.flushOutput();
    naisys.sendCommand('ns-agent start bob "Testing mail functionality"');
    await naisys.waitForOutput("started", 15000);
    await naisys.waitForPrompt();

    // Switch to alex - wait for alex's prompt to appear
    naisys.flushOutput();
    naisys.sendCommand("ns-agent switch alex");
    await naisys.waitForOutput("alex@", 10000);
    await naisys.waitForPrompt();

    // Send mail from alex to bob
    const testSubject = "Test Mail Subject";
    const testMessage = "Hello Bob, this is a test message from Alex!";
    naisys.flushOutput();
    naisys.sendCommand(`ns-mail send "bob" "${testSubject}" "${testMessage}"`);
    await naisys.waitForOutput("Mail sent", 10000);
    await naisys.waitForPrompt();

    // Verify mail was sent successfully
    let output = naisys.flushOutput();
    expect(output).toContain("Mail sent");

    // Switch to bob - give time for switch event detection (500ms interval)
    naisys.sendCommand("ns-agent switch bob");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await naisys.waitForOutput("bob@", 15000);
    await naisys.waitForPrompt();

    // Send a new line to trigger mail notification
    naisys.flushOutput();
    naisys.sendNewLine();
    await naisys.waitForPrompt();

    // Verify bob received new message notification
    output = naisys.flushOutput();
    expect(output).toContain("Hello Bob, this is a test message from Alex!");

    // List mail to verify bob received it
    naisys.sendCommand("ns-mail list");
    await naisys.waitForOutput("alex", 10000); // Should show alex as sender
    await naisys.waitForPrompt();

    // Verify mail list shows the mail from alex with correct subject
    output = naisys.flushOutput();
    expect(output).toMatch(/\| alex\s+\| Test Mail Subject\s+\|/);

    // Switch back to admin and exit
    naisys.flushOutput();
    naisys.sendCommand("ns-agent switch admin");
    await naisys.waitForPrompt();

    naisys.flushOutput();
    naisys.sendCommand("exit");
    await naisys.waitForOutput("AGENT EXITED", 10000);

    // Wait for process to exit
    const exitCode = await waitForExit(naisys.process);
    expect(exitCode).toBe(0);

    // Log stderr for debugging if any
    if (naisys.stderr.length > 0) {
      console.log("stderr:", naisys.stderr.join(""));
    }
  });
});
