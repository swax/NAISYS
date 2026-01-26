import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdirSync } from "fs";
import { join } from "path";
import {
  getTestDir,
  setupTestDir,
  cleanupTestDir,
  createAgentYaml,
  createHubEnvFile,
  createEnvFileWithHub,
  spawnHub,
  spawnNaisys,
  waitForExit,
  NaisysTestProcess,
  HubTestProcess,
} from "./e2eTestHelper.js";

/**
 * E2E integration test for cross-machine mail functionality via hub.
 *
 * Creates a multi-machine environment with:
 * - Hub server on localhost:5011
 * - Alex on HOST-A connected to hub
 * - Bob on HOST-B connected to hub
 *
 * Tests that:
 * 1. Both agents connect to the hub
 * 2. Users sync across machines (alex and bob visible via ns-users)
 * 3. Alex can send mail to bob through the hub
 * 4. Bob receives the mail
 */

jest.setTimeout(180000);

describe("Cross-Machine Mail E2E", () => {
  let testDir: string;
  let hubDir: string;
  let alexDir: string;
  let bobDir: string;

  let hub: HubTestProcess | null = null;
  let alex: NaisysTestProcess | null = null;
  let bob: NaisysTestProcess | null = null;

  const HUB_PORT = 5011;
  const HUB_ACCESS_KEY = "TESTKEY123";
  const HUB_URL = `http://localhost:${HUB_PORT}`;

  beforeEach(() => {
    testDir = getTestDir("cross_machine_mail");
    setupTestDir(testDir);

    // Create subdirectories for hub, alex, and bob
    hubDir = join(testDir, "hub");
    alexDir = join(testDir, "alex");
    bobDir = join(testDir, "bob");

    mkdirSync(hubDir, { recursive: true });
    mkdirSync(alexDir, { recursive: true });
    mkdirSync(bobDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup in reverse order: agents first, then hub
    if (alex) {
      await alex.cleanup();
      alex = null;
    }
    if (bob) {
      await bob.cleanup();
      bob = null;
    }
    if (hub) {
      await hub.cleanup();
      hub = null;
    }

    // Wait a bit for file handles to be released
    await new Promise((resolve) => setTimeout(resolve, 500));
    cleanupTestDir(testDir);
  });

  test("should send mail from alex to bob across machines via hub", async () => {
    // --- Setup Hub ---
    createHubEnvFile(hubDir, { port: HUB_PORT, accessKey: HUB_ACCESS_KEY });

    // Start hub server
    hub = spawnHub(hubDir);
    await hub.waitForOutput("Running on ws://localhost:", 15000);

    // Give hub a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 500));

    // --- Setup Alex on HOST-A ---
    createEnvFileWithHub(alexDir, {
      hostname: "HOST-A",
      hubUrl: HUB_URL,
      hubAccessKey: HUB_ACCESS_KEY,
    });

    createAgentYaml(alexDir, "alex.yaml", {
      username: "alex",
      title: "Test Agent Alex",
      mailEnabled: true,
    });

    // --- Setup Bob on HOST-B ---
    createEnvFileWithHub(bobDir, {
      hostname: "HOST-B",
      hubUrl: HUB_URL,
      hubAccessKey: HUB_ACCESS_KEY,
    });

    createAgentYaml(bobDir, "bob.yaml", {
      username: "bob",
      title: "Test Agent Bob",
      mailEnabled: true,
    });

    // --- Start Alex ---
    alex = spawnNaisys(alexDir, { args: ["alex.yaml"] });
    await alex.waitForOutput("AGENT STARTED", 30000);
    await alex.waitForPrompt();

    // --- Start Bob ---
    bob = spawnNaisys(bobDir, { args: ["bob.yaml"] });
    await bob.waitForOutput("AGENT STARTED", 30000);
    await bob.waitForPrompt();

    // --- Verify Hub Connection on Alex ---
    alex.flushOutput();
    alex.sendCommand("ns-hubs");
    await alex.waitForOutput("localhost", 10000);
    await alex.waitForPrompt();

    let alexOutput = alex.flushOutput();
    expect(alexOutput).toContain("Connected");

    // --- Verify Hub Connection on Bob ---
    bob.flushOutput();
    bob.sendCommand("ns-hubs");
    await bob.waitForOutput("localhost", 10000);
    await bob.waitForPrompt();

    let bobOutput = bob.flushOutput();
    expect(bobOutput).toContain("Connected");

    // --- Wait for sync to complete ---
    // The hub needs time to sync user data between runners
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // --- Verify both users are visible via ns-users on Alex ---
    alex.flushOutput();
    alex.sendCommand("ns-users");
    await alex.waitForOutput("alex", 10000);
    await alex.waitForPrompt();

    // Check for bob in the user list (may need a retry as sync can take time)
    alexOutput = alex.flushOutput();

    // If bob not visible yet, wait and try again
    if (!alexOutput.includes("bob")) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      alex.flushOutput();
      alex.sendCommand("ns-users");
      await alex.waitForOutput("bob", 15000);
      await alex.waitForPrompt();
      alexOutput = alex.flushOutput();
    }

    expect(alexOutput).toContain("alex");
    expect(alexOutput).toContain("bob");

    // --- Verify both users are visible via ns-users on Bob ---
    bob.flushOutput();
    bob.sendCommand("ns-users");
    await bob.waitForOutput("bob", 10000);
    await bob.waitForPrompt();

    bobOutput = bob.flushOutput();

    // If alex not visible yet, wait and try again
    if (!bobOutput.includes("alex")) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      bob.flushOutput();
      bob.sendCommand("ns-users");
      await bob.waitForOutput("alex", 15000);
      await bob.waitForPrompt();
      bobOutput = bob.flushOutput();
    }

    expect(bobOutput).toContain("alex");
    expect(bobOutput).toContain("bob");

    // --- Send mail from Alex to Bob ---
    const testSubject = "Cross Machine Test";
    const testMessage = "Hello Bob, this is Alex from HOST-A!";

    alex.flushOutput();
    alex.sendCommand(`ns-mail send "bob" "${testSubject}" "${testMessage}"`);
    await alex.waitForOutput("Mail sent", 10000);
    await alex.waitForPrompt();

    alexOutput = alex.flushOutput();
    expect(alexOutput).toContain("Mail sent");

    // --- Give time for mail to sync through hub ---
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // --- Trigger mail notification on Bob by sending newline ---
    bob.flushOutput();
    bob.sendNewLine();
    await bob.waitForPrompt();

    // Check if mail notification appeared
    bobOutput = bob.flushOutput();

    // The mail content should appear in the notification
    // If not immediately visible, check the mail list
    if (!bobOutput.includes(testMessage)) {
      // Wait a bit more and try checking mail list
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // --- Verify Bob received mail via ns-mail list ---
    bob.flushOutput();
    bob.sendCommand("ns-mail list");
    await bob.waitForOutput("alex", 15000);
    await bob.waitForPrompt();

    bobOutput = bob.flushOutput();
    expect(bobOutput).toContain("alex");
    expect(bobOutput).toContain(testSubject);

    // Extract the message ID from the list output (last 4 chars of ULID shown in ID column)
    // Format: "* | XXXX | alex | Cross Machine Test | <date>"
    const idMatch = bobOutput.match(/\|\s*([A-Z0-9]{4})\s*\|\s*alex/i);
    expect(idMatch).not.toBeNull();
    const messageId = idMatch![1];

    // --- Read the mail ---
    bob.flushOutput();
    bob.sendCommand(`ns-mail read ${messageId}`);
    await bob.waitForOutput(testMessage, 10000);
    await bob.waitForPrompt();

    bobOutput = bob.flushOutput();
    expect(bobOutput).toContain(testMessage);

    // --- Exit Alex cleanly ---
    alex.flushOutput();
    alex.sendCommand("exit");
    await alex.waitForOutput("AGENT EXITED", 10000);

    const alexExitCode = await waitForExit(alex.process);
    expect(alexExitCode).toBe(0);

    // --- Exit Bob cleanly ---
    bob.flushOutput();
    bob.sendCommand("exit");
    await bob.waitForOutput("AGENT EXITED", 10000);

    const bobExitCode = await waitForExit(bob.process);
    expect(bobExitCode).toBe(0);

    // Log any errors for debugging
    if (alex.stderr.length > 0) {
      console.log("Alex stderr:", alex.stderr.join(""));
    }
    if (bob.stderr.length > 0) {
      console.log("Bob stderr:", bob.stderr.join(""));
    }
    if (hub?.stderr && hub.stderr.length > 0) {
      console.log("Hub stderr:", hub.stderr.join(""));
    }
  });
});
