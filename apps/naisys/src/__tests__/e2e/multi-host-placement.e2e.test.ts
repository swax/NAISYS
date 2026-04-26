/**
 * Multi-Host Agent Placement and Failover E2E.
 *
 *  1. Boot integrated hub + supervisor (HOST-INTEGRATED) seeded with three
 *     custom agents (alex, bob, charlie).
 *  2. Spawn two standalone NAISYS clients (HOST-A, HOST-B) connected to the
 *     same hub via --hub.
 *  3. Login as superadmin and wait until both standalone hosts register as
 *     online with the supervisor.
 *  4. Restrict HOST-A and HOST-INTEGRATED so HOST-B is the only unrestricted
 *     online NAISYS host. Assign alex to HOST-A.
 *  5. Start alex via the supervisor API and assert it lands on HOST-A —
 *     assigned agents bypass the restricted flag.
 *  6. Start bob via the supervisor API and assert it lands on HOST-B —
 *     unassigned agents must skip restricted hosts.
 *  7. Kill HOST-B and wait for the supervisor to mark it offline.
 *  8. Attempt to start charlie and assert the call fails — no unrestricted
 *     online host is available.
 *  9. Restart HOST-B and wait for it to come back online.
 * 10. Start charlie and assert it lands on HOST-B once it has recovered.
 */

import { sleep } from "@naisys/common";
import type {
  AgentListResponse,
  AgentStartResult,
  HostDetailResponse,
  HostListResponse,
} from "@naisys/supervisor-shared";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { NaisysTestProcess } from "./e2eTestHelper.js";
import {
  cleanupTestDir,
  createAgentYaml,
  extractAccessKey,
  getFreePort,
  getTestDir,
  setupTestDir,
  spawnNaisys,
} from "./e2eTestHelper.js";
import { loginAsSuperAdmin, waitFor } from "./supervisorApiHelper.js";

vi.setConfig({ testTimeout: 240000 });

interface SuccessResponse {
  success: boolean;
  message: string;
}

describe("Multi-Host Agent Placement and Failover E2E", () => {
  let testDir: string;
  let integratedDir: string;
  let hostADir: string;
  let hostBDir: string;

  let integrated: NaisysTestProcess | null = null;
  let hostA: NaisysTestProcess | null = null;
  let hostB: NaisysTestProcess | null = null;

  const SUPERVISOR_HOST = "HOST-INTEGRATED";
  let SERVER_PORT: number;
  let HUB_URL: string;
  let API_BASE: string;

  beforeEach(async () => {
    testDir = getTestDir("multi_host_placement");
    setupTestDir(testDir);

    SERVER_PORT = await getFreePort();
    HUB_URL = `http://localhost:${SERVER_PORT}/hub`;
    API_BASE = `http://localhost:${SERVER_PORT}/supervisor/api`;

    integratedDir = join(testDir, "integrated");
    hostADir = join(testDir, "hostA");
    hostBDir = join(testDir, "hostB");

    mkdirSync(integratedDir, { recursive: true });
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
    if (integrated) {
      await integrated.cleanup();
      integrated = null;
    }
    await sleep(500);
    cleanupTestDir(testDir);
  });

  function createIntegratedEnvFile() {
    const envContent = `
NAISYS_FOLDER="${integratedDir}"
NAISYS_HOSTNAME="${SUPERVISOR_HOST}"
SPEND_LIMIT_DOLLARS=10
SERVER_PORT=${SERVER_PORT}
`.trim();
    writeFileSync(join(integratedDir, ".env"), envContent);
  }

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

  function spawnClient(dir: string): NaisysTestProcess {
    return spawnNaisys(dir, { args: [`--hub=${HUB_URL}`] });
  }

  test("routes assigned vs. unassigned agents and recovers after a host disconnects", async () => {
    // ---- Step 1: Integrated hub + supervisor with three custom agents ----
    createIntegratedEnvFile();
    for (const username of ["alex", "bob", "charlie"]) {
      createAgentYaml(integratedDir, `${username}.yaml`, {
        username,
        title: `Placement agent ${username}`,
      });
    }

    integrated = spawnNaisys(integratedDir, {
      args: ["--integrated-hub", "--supervisor", integratedDir],
      env: { NODE_ENV: "production", NAISYS_FOLDER: integratedDir },
    });
    await integrated.waitForOutput("AGENT STARTED", 60000);
    await integrated.waitForPrompt();

    const hubAccessKey = extractAccessKey(integratedDir);
    const admin = await loginAsSuperAdmin(integrated, API_BASE);

    // ---- Step 2: Standalone NAISYS clients ----
    createClientEnvFile(hostADir, "HOST-A", hubAccessKey);
    hostA = spawnClient(hostADir);
    await hostA.waitForOutput("AGENT STARTED", 30000);
    await hostA.waitForPrompt();

    createClientEnvFile(hostBDir, "HOST-B", hubAccessKey);
    hostB = spawnClient(hostBDir);
    await hostB.waitForOutput("AGENT STARTED", 30000);
    await hostB.waitForPrompt();

    // ---- Step 3: Wait for both clients to register as online ----
    await waitFor(
      "HOST-A and HOST-B online",
      () => admin.get<HostListResponse>("/hosts"),
      (response) =>
        ["HOST-A", "HOST-B"].every((name) =>
          response.items.some((h) => h.name === name && h.online === true),
        ),
    );

    const initialHosts = await admin.get<HostListResponse>("/hosts");
    expect(initialHosts.items.map((h) => h.name)).toEqual(
      expect.arrayContaining([SUPERVISOR_HOST, "HOST-A", "HOST-B"]),
    );

    // ---- Step 4: Restrict HOST-A and HOST-INTEGRATED; assign alex to HOST-A ----
    const restrictA = await admin.put<SuccessResponse>("/hosts/HOST-A", {
      restricted: true,
    });
    expect(restrictA.success).toBe(true);

    const restrictSupervisor = await admin.put<SuccessResponse>(
      `/hosts/${SUPERVISOR_HOST}`,
      { restricted: true },
    );
    expect(restrictSupervisor.success).toBe(true);

    const agents = await admin.get<AgentListResponse>("/agents");
    const alex = agents.items.find((a) => a.name === "alex");
    expect(alex).toBeDefined();

    const assigned = await admin.post<SuccessResponse>(
      "/hosts/HOST-A/agents",
      { agentId: alex!.id },
    );
    expect(assigned.success).toBe(true);

    const hostAAfterAssign = await admin.get<HostDetailResponse>(
      "/hosts/HOST-A",
    );
    expect(hostAAfterAssign.restricted).toBe(true);
    expect(hostAAfterAssign.assignedAgents.some((a) => a.name === "alex")).toBe(
      true,
    );

    // Give the hub a beat to absorb host/restriction changes before routing.
    await sleep(1000);

    // ---- Step 5: alex is assigned -> lands on HOST-A even though restricted ----
    const alexStart = await admin.post<AgentStartResult>(
      "/agents/alex/start",
      { task: "placement: assigned host" },
    );
    expect(alexStart.success).toBe(true);
    expect(alexStart.hostname).toBe("HOST-A");

    // ---- Step 6: bob is unassigned -> only HOST-B is unrestricted+online ----
    const bobStart = await admin.post<AgentStartResult>(
      "/agents/bob/start",
      { task: "placement: unrestricted only" },
    );
    expect(bobStart.success).toBe(true);
    expect(bobStart.hostname).toBe("HOST-B");

    // ---- Step 7: kill HOST-B and wait for supervisor to mark it offline ----
    await hostB.cleanup();
    hostB = null;

    await waitFor(
      "HOST-B to be marked offline",
      () => admin.get<HostDetailResponse>("/hosts/HOST-B"),
      (host) => host.online === false,
      30000,
    );

    // ---- Step 8: charlie has no candidate host -> start must fail ----
    await expect(
      admin.post<AgentStartResult>("/agents/charlie/start", {
        task: "placement: should fail",
      }),
    ).rejects.toThrow();

    // ---- Step 9: bring HOST-B back ----
    hostB = spawnClient(hostBDir);
    await hostB.waitForOutput("AGENT STARTED", 30000);
    await hostB.waitForPrompt();

    await waitFor(
      "HOST-B to be marked online again",
      () => admin.get<HostDetailResponse>("/hosts/HOST-B"),
      (host) => host.online === true,
      30000,
    );

    // ---- Step 10: charlie now routes to HOST-B ----
    const charlieStart = await admin.post<AgentStartResult>(
      "/agents/charlie/start",
      { task: "placement: recovered" },
    );
    expect(charlieStart.success).toBe(true);
    expect(charlieStart.hostname).toBe("HOST-B");

    integrated.dumpStderrIfAny("Integrated");
    hostA.dumpStderrIfAny("Host A");
    hostB.dumpStderrIfAny("Host B");
  });
});
