/**
 * Cross-hub mail E2E.
 *
 *  1. Set up hub directory + two host directories with their own .envs and
 *     create alex/bob agent yamls in the hub directory.
 *  2. Start the hub server and capture its access key.
 *  3. Spawn HOST-A naisys client connected to the hub via --hub.
 *  4. Start alex on HOST-A — only HOST-A is connected so the hub routes alex
 *     there.
 *  5. Spawn HOST-B naisys client connected to the same hub.
 *  6. Start bob on HOST-B — HOST-A already has admin+alex so the hub routes
 *     bob to the least-loaded HOST-B.
 *  7. Wait for heartbeat sync, then send mail from alex (HOST-A) → bob
 *     (HOST-B) through the hub.
 *  8. Read bob's inbox on HOST-B and assert the mail subject + body
 *     propagated end-to-end.
 */

import { sleep } from "@naisys/common";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { HubTestProcess, NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  createHubEnvFile,
  extractAccessKey,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnHub,
  spawnNaisys,
} from "./e2eTestHelper.js";

vi.setConfig({ testTimeout: 180000 });

describe("Cross-Hub Mail E2E", () => {
  let testDir: string;
  let hubDir: string;
  let hostADir: string;
  let hostBDir: string;

  let hub: HubTestProcess | null = null;
  let hostA: NaisysTestProcess | null = null;
  let hostB: NaisysTestProcess | null = null;

  let SERVER_PORT: number;
  let HUB_URL: string;

  beforeEach(async () => {
    testDir = getTestDir("crosshub_mail");
    setupTestDir(testDir);

    SERVER_PORT = await getFreePort();
    HUB_URL = `http://localhost:${SERVER_PORT}/hub`;

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
    createHubEnvFile(hubDir, { port: SERVER_PORT, naisysFolder: hubDir });
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
    await hub.waitForOutput("Running on http://localhost:", 30000);
    const hubAccessKey = extractAccessKey(hubDir);
    await sleep(500);

    // --- Start Host A (admin starts automatically) ---
    createClientEnvFile(hostADir, "HOST-A", hubAccessKey);
    hostA = spawnNaisys(hostADir, { args: [`--hub=${HUB_URL}`] });
    await hostA.waitForOutput("AGENT STARTED", 30000);
    await hostA.waitForPrompt();

    // --- Start alex on Host A ---
    // Only Host A is connected, so hub routes alex here
    await hostA.startAgent("alex", "cross hub mail test");
    await hostA.switchAgent("alex");

    // --- Start Host B (admin starts automatically) ---
    createClientEnvFile(hostBDir, "HOST-B", hubAccessKey);
    hostB = spawnNaisys(hostBDir, { args: [`--hub=${HUB_URL}`] });
    await hostB.waitForOutput("AGENT STARTED", 30000);
    await hostB.waitForPrompt();

    // --- Start bob on Host B ---
    // Host A has admin+alex (2 agents), Host B has admin (1 agent)
    // Hub routes bob to Host B (least loaded)
    await hostB.startAgent("bob", "cross hub mail test");
    await hostB.switchAgent("bob");

    // --- Wait for heartbeat sync ---
    await sleep(3000);

    // --- Send mail from alex to bob ---
    const testSubject = "Cross Hub Test";
    const testMessage = "Hello Bob from HOST-A!";

    const alexOutput = await hostA.sendMail("bob", testSubject, testMessage);
    expect(alexOutput).toContain("Mail sent");

    // --- Wait for mail to propagate through hub ---
    await sleep(3000);

    // --- Verify bob received mail ---
    const inboxOutput = await hostB.runCommand("ns-mail inbox", {
      waitFor: "alex",
      timeoutMs: 15000,
    });
    expect(inboxOutput).toContain("alex");
    expect(inboxOutput).toContain(testSubject);

    // Extract message ID from list output (integer ID column)
    // Format: "* | 123 | alex | Cross Hub Test | <date>"
    const idMatch = inboxOutput.match(/\|\s*(\d+)\s*\|\s*alex/i);
    expect(idMatch).not.toBeNull();
    const messageId = idMatch![1];

    // --- Read the mail ---
    const readOutput = await hostB.readMail(messageId);
    expect(readOutput).toContain(testMessage);

    // --- Log errors for debugging ---
    hostA.dumpStderrIfAny("Host A");
    hostB.dumpStderrIfAny("Host B");
    if (hub?.stderr && hub.stderr.length > 0) {
      console.log("Hub stderr:", hub.stderr.join(""));
    }
  });
});
