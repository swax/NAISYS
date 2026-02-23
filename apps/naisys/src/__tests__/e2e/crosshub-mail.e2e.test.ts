import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { sleep } from "@naisys/common";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import {
  cleanupTestDir,
  createAgentYaml,
  createHubEnvFile,
  extractAccessKey,
  getTestDir,
  HubTestProcess,
  NaisysTestProcess,
  setupTestDir,
  spawnHub,
  spawnNaisys,
} from "./e2eTestHelper.js";

/**
 * E2E test for cross-hub mail functionality.
 *
 * Creates a multi-process environment with:
 * - Hub server with alex and bob agent configs
 * - Host A (naisys client) connected to hub via --hub flag, running alex
 * - Host B (naisys client) connected to hub via --hub flag, running bob
 *
 * Tests that:
 * 1. Both hosts connect to the hub
 * 2. Agents are started on their respective hosts via ns-agent start
 * 3. Alex can send mail to bob through the hub
 * 4. Bob receives the mail
 */

jest.setTimeout(180000);

describe("Cross-Hub Mail E2E", () => {
  let testDir: string;
  let hubDir: string;
  let hostADir: string;
  let hostBDir: string;

  let hub: HubTestProcess | null = null;
  let hostA: NaisysTestProcess | null = null;
  let hostB: NaisysTestProcess | null = null;

  const HUB_PORT = 4101;
  const HUB_URL = `https://localhost:${HUB_PORT}`;

  beforeEach(() => {
    testDir = getTestDir("crosshub_mail");
    setupTestDir(testDir);

    hubDir = join(testDir, "hub");
    hostADir = join(testDir, "hostA");
    hostBDir = join(testDir, "hostB");

    mkdirSync(hubDir, { recursive: true });
    mkdirSync(hostADir, { recursive: true });
    mkdirSync(hostBDir, { recursive: true });
  });

  afterEach(async () => {
    if (hostA) {
      await hostA.cleanup();
      hostA = null;
    }
    if (hostB) {
      await hostB.cleanup();
      hostB = null;
    }
    if (hub) {
      await hub.cleanup();
      hub = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createClientEnvFile(
    dir: string,
    hostname: string,
    hubAccessKey: string,
  ) {
    const envContent = `
NAISYS_FOLDER=""
NAISYS_HOSTNAME="${hostname}"
SPEND_LIMIT_DOLLARS=10
HUB_ACCESS_KEY=${hubAccessKey}
`.trim();
    writeFileSync(join(dir, ".env"), envContent);
  }

  test("should send mail from alex on HOST-A to bob on HOST-B via hub", async () => {
    // --- Setup Hub with agent configs ---
    createHubEnvFile(hubDir, { port: HUB_PORT, naisysFolder: hubDir });
    createAgentYaml(hubDir, "alex.yaml", {
      username: "alex",
      title: "Test Agent Alex",
    });
    createAgentYaml(hubDir, "bob.yaml", {
      username: "bob",
      title: "Test Agent Bob",
    });

    // --- Start Hub ---
    hub = spawnHub(hubDir);
    await hub.waitForOutput("Running on wss://localhost:", 30000);
    const hubAccessKey = extractAccessKey(hub.getFullOutput());
    await sleep(500);

    // --- Start Host A (admin starts automatically) ---
    createClientEnvFile(hostADir, "HOST-A", hubAccessKey);
    hostA = spawnNaisys(hostADir, { args: [`--hub=${HUB_URL}`] });
    await hostA.waitForOutput("AGENT STARTED", 30000);
    await hostA.waitForPrompt();

    // --- Start alex on Host A ---
    // Only Host A is connected, so hub routes alex here
    hostA.flushOutput();
    hostA.sendCommand('ns-agent start alex "cross hub mail test"');
    await hostA.waitForOutput("started", 15000);
    await hostA.waitForPrompt();

    // --- Switch to alex on Host A ---
    hostA.flushOutput();
    hostA.sendCommand("ns-agent switch alex");
    await hostA.waitForOutput("alex@", 15000);
    await hostA.waitForPrompt();

    // --- Start Host B (admin starts automatically) ---
    createClientEnvFile(hostBDir, "HOST-B", hubAccessKey);
    hostB = spawnNaisys(hostBDir, { args: [`--hub=${HUB_URL}`] });
    await hostB.waitForOutput("AGENT STARTED", 30000);
    await hostB.waitForPrompt();

    // --- Start bob on Host B ---
    // Host A has admin+alex (2 agents), Host B has admin (1 agent)
    // Hub routes bob to Host B (least loaded)
    hostB.flushOutput();
    hostB.sendCommand('ns-agent start bob "cross hub mail test"');
    await hostB.waitForOutput("started", 15000);
    await hostB.waitForPrompt();

    // --- Switch to bob on Host B ---
    hostB.flushOutput();
    hostB.sendCommand("ns-agent switch bob");
    await hostB.waitForOutput("bob@", 15000);
    await hostB.waitForPrompt();

    // --- Wait for heartbeat sync ---
    await sleep(3000);

    // --- Send mail from alex to bob ---
    const testSubject = "Cross Hub Test";
    const testMessage = "Hello Bob from HOST-A!";

    hostA.flushOutput();
    hostA.sendCommand(`ns-mail send "bob" "${testSubject}" "${testMessage}"`);
    await hostA.waitForOutput("Mail sent", 15000);
    await hostA.waitForPrompt();

    const alexOutput = hostA.flushOutput();
    expect(alexOutput).toContain("Mail sent");

    // --- Wait for mail to propagate through hub ---
    await sleep(3000);

    // --- Verify bob received mail ---
    hostB.flushOutput();
    hostB.sendCommand("ns-mail list");
    await hostB.waitForOutput("alex", 15000);
    await hostB.waitForPrompt();

    let bobOutput = hostB.flushOutput();
    expect(bobOutput).toContain("alex");
    expect(bobOutput).toContain(testSubject);

    // Extract message ID from list output (integer ID column)
    // Format: "* | 123 | alex | Cross Hub Test | <date>"
    const idMatch = bobOutput.match(/\|\s*(\d+)\s*\|\s*alex/i);
    expect(idMatch).not.toBeNull();
    const messageId = idMatch![1];

    // --- Read the mail ---
    hostB.flushOutput();
    hostB.sendCommand(`ns-mail read ${messageId}`);
    await hostB.waitForOutput(testMessage, 10000);
    await hostB.waitForPrompt();

    bobOutput = hostB.flushOutput();
    expect(bobOutput).toContain(testMessage);

    // --- Log errors for debugging ---
    if (hostA.stderr.length > 0) {
      console.log("Host A stderr:", hostA.stderr.join(""));
    }
    if (hostB.stderr.length > 0) {
      console.log("Host B stderr:", hostB.stderr.join(""));
    }
    if (hub?.stderr && hub.stderr.length > 0) {
      console.log("Hub stderr:", hub.stderr.join(""));
    }
  });
});
