import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ulid } from "@naisys/database";
import type { HubServerLog } from "@naisys/hub/services/hubServerLog";
import type { HubServer } from "@naisys/hub/services/hubServer";
import {
  createHubSyncServer,
  type HubSyncServer,
} from "@naisys/hub/services/hubSyncServer";
import {
  createHubForwardService,
  type HubForwardService,
} from "@naisys/hub/services/hubForwardService";
import { createHubSyncClient, type HubSyncClient } from "../../hub/hubSyncClient.js";
import type { HubClientLog } from "../../hub/hubClientLog.js";
import type { HubManager } from "../../hub/hubManager.js";
import type { HostService } from "../../services/hostService.js";
import { createTestDatabase, seedHost, seedUser, type TestDatabase } from "./testDbHelper.js";
import { createSyncEventBridge, type MockHubServer, type MockHubManager } from "./syncEventBridge.js";

/**
 * Integration tests for hub catch-up functionality.
 *
 * Tests the catch-up flow when a runner connects/reconnects:
 * 1. Hub already has data from other runners
 * 2. New runner connects and sends catch_up request
 * 3. Hub responds with missed data
 * 4. Runner upserts the data locally
 *
 * Uses isolated test databases and mock transport layer (no real network).
 */

jest.setTimeout(30000);

describe("Hub Catch-Up Integration Tests", () => {
  let runnerADb: TestDatabase;
  let runnerBDb: TestDatabase;
  let hubDb: TestDatabase;

  let hostAId: string;
  let hostBId: string;
  const hostAName = "runner-a-host";
  const hostBName = "runner-b-host";

  let bridge: ReturnType<typeof createSyncEventBridge>;
  let mockHubServer: MockHubServer;
  let mockHubManagerA: MockHubManager;
  let mockHubManagerB: MockHubManager;

  let hubSyncServer: HubSyncServer;
  let hubForwardService: HubForwardService;
  let syncClientA: HubSyncClient;
  let syncClientB: HubSyncClient;

  const logs: string[] = [];
  const mockHubServerLog: HubServerLog = {
    log: (msg) => logs.push(`[HUB] ${msg}`),
    error: (msg) => logs.push(`[HUB ERROR] ${msg}`),
  };
  const mockClientLogA: HubClientLog = {
    write: (msg) => logs.push(`[RUNNER-A] ${msg}`),
    error: (msg) => logs.push(`[RUNNER-A ERROR] ${msg}`),
  };
  const mockClientLogB: HubClientLog = {
    write: (msg) => logs.push(`[RUNNER-B] ${msg}`),
    error: (msg) => logs.push(`[RUNNER-B ERROR] ${msg}`),
  };

  beforeEach(async () => {
    logs.length = 0;

    [runnerADb, runnerBDb, hubDb] = await Promise.all([
      createTestDatabase("runner-a", "naisys"),
      createTestDatabase("runner-b", "naisys"),
      createTestDatabase("hub", "hub"),
    ]);

    hostAId = ulid();
    hostBId = ulid();

    // Seed hosts in all databases
    await Promise.all([
      seedHost(runnerADb.prisma, hostAId, hostAName),
      seedHost(runnerBDb.prisma, hostBId, hostBName),
      seedHost(hubDb.prisma, hostAId, hostAName),
      seedHost(hubDb.prisma, hostBId, hostBName),
    ]);

    bridge = createSyncEventBridge();
    mockHubServer = bridge.createMockHubServer();

    hubForwardService = createHubForwardService(mockHubServerLog);
    hubSyncServer = createHubSyncServer(
      mockHubServer as unknown as HubServer,
      hubDb.dbService,
      mockHubServerLog,
      hubForwardService,
      { pollIntervalMs: 100, maxConcurrentRequests: 2 }
    );
  });

  afterEach(() => {
    hubSyncServer.stop();
    runnerADb.cleanup();
    runnerBDb.cleanup();
    hubDb.cleanup();
    bridge.reset();
  });

  async function waitForSync(ms: number = 500): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  function connectRunnerA(): void {
    mockHubManagerA = bridge.createMockHubManager(hostAId, hostAName);

    const hostServiceA: HostService = {
      cleanup: () => {},
      localHostId: hostAId,
      localHostname: hostAName,
      commandName: "ns-hosts",
      handleCommand: () => Promise.resolve(""),
    };

    syncClientA = createHubSyncClient(
      mockHubManagerA as unknown as HubManager,
      mockClientLogA,
      runnerADb.dbService,
      hostServiceA
    );

    // Trigger the HUB_CONNECTED event to initiate catch_up
    mockHubManagerA._triggerHubConnected();
  }

  function connectRunnerB(): void {
    mockHubManagerB = bridge.createMockHubManager(hostBId, hostBName);

    const hostServiceB: HostService = {
      cleanup: () => {},
      localHostId: hostBId,
      localHostname: hostBName,
      commandName: "ns-hosts",
      handleCommand: () => Promise.resolve(""),
    };

    syncClientB = createHubSyncClient(
      mockHubManagerB as unknown as HubManager,
      mockClientLogB,
      runnerBDb.dbService,
      hostServiceB
    );

    // Trigger the HUB_CONNECTED event to initiate catch_up
    mockHubManagerB._triggerHubConnected();
  }

  test("should catch up runner B with data from runner A via hub", async () => {
    // Step 1: Connect runner A and create a user
    connectRunnerA();

    const userIdA = ulid();
    const usernameA = "alice-from-runner-a";
    await seedUser(runnerADb.prisma, userIdA, usernameA, hostAId);

    // Wait for runner A's data to sync to hub
    await waitForSync(500);

    // Verify hub has the user from runner A
    const hubUserBeforeCatchUp = await hubDb.prisma.users.findUnique({
      where: { id: userIdA },
    });
    expect(hubUserBeforeCatchUp).not.toBeNull();
    expect(hubUserBeforeCatchUp?.username).toBe(usernameA);

    // Step 2: Connect runner B (should receive catch_up with runner A's data)
    connectRunnerB();

    // Wait for catch_up to complete
    await waitForSync(500);

    // Step 3: Verify runner B received the user from runner A via catch_up
    const runnerBUser = await runnerBDb.prisma.users.findUnique({
      where: { id: userIdA },
    });
    expect(runnerBUser).not.toBeNull();
    expect(runnerBUser?.username).toBe(usernameA);
    expect(runnerBUser?.host_id).toBe(hostAId);
  });

  test("should not include runner's own data in catch_up response", async () => {
    // Step 1: Connect runner A and create users
    connectRunnerA();

    const userIdA = ulid();
    await seedUser(runnerADb.prisma, userIdA, "alice", hostAId);

    // Wait for sync
    await waitForSync(500);

    // Step 2: Create a user on runner B's database before connecting
    const userIdB = ulid();
    await seedUser(runnerBDb.prisma, userIdB, "bob", hostBId);
    // Also add to hub (simulating previous sync)
    await seedUser(hubDb.prisma, userIdB, "bob", hostBId);

    // Step 3: Connect runner B
    connectRunnerB();

    // Wait for catch_up
    await waitForSync(500);

    // Runner B should have received alice (from runner A)
    const aliceOnB = await runnerBDb.prisma.users.findUnique({
      where: { id: userIdA },
    });
    expect(aliceOnB).not.toBeNull();
    expect(aliceOnB?.username).toBe("alice");

    // Verify bob still exists on runner B (not overwritten or duplicated)
    const bobOnB = await runnerBDb.prisma.users.findUnique({
      where: { id: userIdB },
    });
    expect(bobOnB).not.toBeNull();
    expect(bobOnB?.username).toBe("bob");
  });

  test("should exclude client from sync polling while catching up", async () => {
    // Connect runner A and create data
    connectRunnerA();

    const userIdA = ulid();
    await seedUser(runnerADb.prisma, userIdA, "alice", hostAId);

    await waitForSync(500);

    // Check that runner A is not in catchingUp state after catch_up completes
    const stateA = hubSyncServer.getClientState(hostAId);
    expect(stateA).toBeDefined();
    expect(stateA?.catchingUp).toBe(false);

    // Connect runner B - it should start in catchingUp state
    mockHubManagerB = bridge.createMockHubManager(hostBId, hostBName);

    const hostServiceB: HostService = {
      cleanup: () => {},
      localHostId: hostBId,
      localHostname: hostBName,
      commandName: "ns-hosts",
      handleCommand: () => Promise.resolve(""),
    };

    syncClientB = createHubSyncClient(
      mockHubManagerB as unknown as HubManager,
      mockClientLogB,
      runnerBDb.dbService,
      hostServiceB
    );

    // Before triggering HUB_CONNECTED, runner B should be in catchingUp state
    const stateBBeforeCatchUp = hubSyncServer.getClientState(hostBId);
    expect(stateBBeforeCatchUp).toBeDefined();
    expect(stateBBeforeCatchUp?.catchingUp).toBe(true);

    // Trigger catch_up
    mockHubManagerB._triggerHubConnected();

    // Wait for catch_up to complete
    await waitForSync(500);

    // After catch_up, runner B should no longer be in catchingUp state
    const stateBAfterCatchUp = hubSyncServer.getClientState(hostBId);
    expect(stateBAfterCatchUp).toBeDefined();
    expect(stateBAfterCatchUp?.catchingUp).toBe(false);
  });

  test("should handle catch_up with multiple tables", async () => {
    // Connect runner A
    connectRunnerA();

    // Create user and host data on runner A
    const userIdA = ulid();
    await seedUser(runnerADb.prisma, userIdA, "alice", hostAId);

    // Wait for sync to hub
    await waitForSync(500);

    // Connect runner B
    connectRunnerB();

    // Wait for catch_up
    await waitForSync(500);

    // Verify runner B received both hosts and users
    const hostsOnB = await runnerBDb.prisma.hosts.findMany();
    expect(hostsOnB.length).toBeGreaterThanOrEqual(2); // At least hostA and hostB

    const aliceOnB = await runnerBDb.prisma.users.findUnique({
      where: { id: userIdA },
    });
    expect(aliceOnB).not.toBeNull();
  });

  test("should handle empty catch_up when no data to send", async () => {
    // Connect runner A (no data created yet)
    connectRunnerA();

    // Wait for catch_up to complete (should be empty but not error)
    await waitForSync(300);

    // Runner A should be ready for sync polling
    const stateA = hubSyncServer.getClientState(hostAId);
    expect(stateA).toBeDefined();
    expect(stateA?.catchingUp).toBe(false);
  });

  test("should catch up with data created after initial sync", async () => {
    // Connect runner A
    connectRunnerA();

    // Create initial user
    const userId1 = ulid();
    await seedUser(runnerADb.prisma, userId1, "alice", hostAId);

    await waitForSync(500);

    // Connect runner B
    connectRunnerB();

    await waitForSync(500);

    // Runner B should have alice
    const aliceOnB = await runnerBDb.prisma.users.findUnique({
      where: { id: userId1 },
    });
    expect(aliceOnB).not.toBeNull();

    // Now create another user on runner A
    const userId2 = ulid();
    await seedUser(runnerADb.prisma, userId2, "charlie", hostAId);

    // Wait for normal sync (not catch_up) to forward to runner B
    await waitForSync(1000);

    // Runner B should have charlie via normal forwarding
    const charlieOnB = await runnerBDb.prisma.users.findUnique({
      where: { id: userId2 },
    });
    expect(charlieOnB).not.toBeNull();
    expect(charlieOnB?.username).toBe("charlie");
  });
});
