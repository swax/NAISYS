import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ulid } from "@naisys/database";
import { HubEvents, type SyncResponse } from "@naisys/hub-protocol";
import {
  createHubSyncServer,
  type HubSyncServer,
} from "@naisys/hub/services/hubSyncServer";
import {
  createHubForwardService,
  type HubForwardService,
} from "@naisys/hub/services/hubForwardService";
import type { HubServerLog } from "@naisys/hub/services/hubServerLog";
import type { HubServer } from "@naisys/hub/services/hubServer";
import { createHubSyncClient, type HubSyncClient } from "../../hub/hubSyncClient.js";
import type { HubClientLog } from "../../hub/hubClientLog.js";
import type { HubManager } from "../../hub/hubManager.js";
import type { HostService } from "../../services/hostService.js";
import { createTestDatabase, seedHost, seedUser, type TestDatabase } from "./testDbHelper.js";
import { createSyncEventBridge, type MockHubServer, type MockHubManager } from "./syncEventBridge.js";

/**
 * End-to-end integration tests for the sync system.
 *
 * Tests the full flow:
 * 1. Runner A creates data locally
 * 2. Hub pulls data from Runner A via sync_request
 * 3. Hub stores data and queues for forwarding
 * 4. Hub forwards data to Runner B via piggybacked sync_request
 * 5. Runner B upserts forwarded data
 *
 * Uses isolated test databases and mock transport layer (no real network).
 * Uses REAL HubSyncClient and HubSyncServer implementations.
 */

// Test timeout for database operations
jest.setTimeout(30000);

describe("Sync E2E Integration Tests", () => {
  // Test databases
  let runnerADb: TestDatabase;
  let runnerBDb: TestDatabase;
  let hubDb: TestDatabase;

  // Host IDs
  let hostAId: string;
  let hostBId: string;
  const hostAName = "runner-a-host";
  const hostBName = "runner-b-host";

  // Mock transport
  let bridge: ReturnType<typeof createSyncEventBridge>;
  let mockHubServer: MockHubServer;
  let mockHubManagerA: MockHubManager;
  let mockHubManagerB: MockHubManager;

  // Sync services
  let hubSyncServer: HubSyncServer;
  let hubForwardService: HubForwardService;
  let syncClientA: HubSyncClient;
  let syncClientB: HubSyncClient;

  // Mock loggers
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

    // Create isolated test databases
    [runnerADb, runnerBDb, hubDb] = await Promise.all([
      createTestDatabase("runner-a", "naisys"),
      createTestDatabase("runner-b", "naisys"),
      createTestDatabase("hub", "hub"),
    ]);

    // Generate host IDs
    hostAId = ulid();
    hostBId = ulid();

    // Seed host records in all databases
    await Promise.all([
      seedHost(runnerADb.prisma, hostAId, hostAName),
      seedHost(runnerBDb.prisma, hostBId, hostBName),
      seedHost(hubDb.prisma, hostAId, hostAName),
      seedHost(hubDb.prisma, hostBId, hostBName),
    ]);

    // Create mock transport bridge
    bridge = createSyncEventBridge();
    mockHubServer = bridge.createMockHubServer();

    // Create hub services
    hubForwardService = createHubForwardService(mockHubServerLog);
    hubSyncServer = createHubSyncServer(
      mockHubServer as unknown as HubServer,
      hubDb.dbService,
      mockHubServerLog,
      hubForwardService,
      { pollIntervalMs: 100, maxConcurrentRequests: 2 }
    );

    // Create mock HubManagers for runners (triggers client_connected)
    mockHubManagerA = bridge.createMockHubManager(hostAId, hostAName);
    mockHubManagerB = bridge.createMockHubManager(hostBId, hostBName);

    // Create host services
    const hostServiceA: HostService = {
      localHostId: hostAId,
      localHostname: hostAName,
    };
    const hostServiceB: HostService = {
      localHostId: hostBId,
      localHostname: hostBName,
    };

    // Create REAL sync clients for runners
    syncClientA = await createHubSyncClient(
      mockHubManagerA as unknown as HubManager,
      mockClientLogA,
      runnerADb.dbService,
      hostServiceA
    );
    syncClientB = await createHubSyncClient(
      mockHubManagerB as unknown as HubManager,
      mockClientLogB,
      runnerBDb.dbService,
      hostServiceB
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

  test("should sync user from runner A to hub", async () => {
    // Create a user on runner A
    const userId = ulid();
    const username = "test-user-alice";
    await seedUser(runnerADb.prisma, userId, username, hostAId);

    // Wait for sync
    await waitForSync(500);

    // Verify user exists in hub database
    const hubUser = await hubDb.prisma.users.findUnique({
      where: { id: userId },
    });

    expect(hubUser).not.toBeNull();
    expect(hubUser?.username).toBe(username);
    expect(hubUser?.host_id).toBe(hostAId);
  });

  test("should forward user from runner A through hub to runner B", async () => {
    // Create a user on runner A
    const userId = ulid();
    const username = "test-user-bob";
    await seedUser(runnerADb.prisma, userId, username, hostAId);

    // Wait for sync and forwarding
    await waitForSync(1000);

    // Verify user exists in runner B's database (forwarded from hub)
    const runnerBUser = await runnerBDb.prisma.users.findUnique({
      where: { id: userId },
    });

    expect(runnerBUser).not.toBeNull();
    expect(runnerBUser?.username).toBe(username);
    expect(runnerBUser?.host_id).toBe(hostAId);
  });

  test("should not create sync loop - forwarded data should not be re-synced", async () => {
    // Create a user on runner A
    const userId = ulid();
    await seedUser(runnerADb.prisma, userId, "no-loop-user", hostAId);

    // Wait for sync and forward
    await waitForSync(1000);

    // The forwarded user should be in runner B's database
    const runnerBUser = await runnerBDb.prisma.users.findUnique({
      where: { id: userId },
    });
    expect(runnerBUser).not.toBeNull();

    // Wait for another sync cycle
    await waitForSync(500);

    // The hub should NOT receive the user back from runner B
    // because the user's host_id = hostAId, not hostBId
    // Verify by checking that the forward queue for A is empty
    const forwardCountForA = hubForwardService.getPendingCount(hostAId);
    expect(forwardCountForA).toBe(0);
  });

  test("should sync mail thread from runner A to hub and forward to runner B", async () => {
    // Create user first (for FK constraint)
    // Need to seed hostA in runnerB since alice's host_id references hostAId
    const userAId = ulid();
    await seedHost(runnerBDb.prisma, hostAId, hostAName);
    await Promise.all([
      seedUser(runnerADb.prisma, userAId, "alice", hostAId),
      seedUser(hubDb.prisma, userAId, "alice", hostAId),
      seedUser(runnerBDb.prisma, userAId, "alice", hostAId),
    ]);

    // Create a mail thread on runner A
    const threadId = ulid();
    await runnerADb.prisma.mail_threads.create({
      data: {
        id: threadId,
        subject: "Test Thread",
        updated_by: userAId,
      },
    });

    // Wait for sync
    await waitForSync(1000);

    // Verify thread in hub
    const hubThread = await hubDb.prisma.mail_threads.findUnique({
      where: { id: threadId },
    });
    expect(hubThread).not.toBeNull();
    expect(hubThread?.subject).toBe("Test Thread");

    // Verify thread forwarded to runner B
    const runnerBThread = await runnerBDb.prisma.mail_threads.findUnique({
      where: { id: threadId },
    });
    expect(runnerBThread).not.toBeNull();
    expect(runnerBThread?.subject).toBe("Test Thread");
  });

  test("should handle bidirectional sync - users from both runners", async () => {
    // Create user on runner A
    const userAId = ulid();
    await seedUser(runnerADb.prisma, userAId, "from-runner-a", hostAId);

    // Create user on runner B
    const userBId = ulid();
    await seedUser(runnerBDb.prisma, userBId, "from-runner-b", hostBId);

    // Wait for sync
    await waitForSync(1500);

    // Both users should be in hub
    const hubUserA = await hubDb.prisma.users.findUnique({ where: { id: userAId } });
    const hubUserB = await hubDb.prisma.users.findUnique({ where: { id: userBId } });
    expect(hubUserA?.username).toBe("from-runner-a");
    expect(hubUserB?.username).toBe("from-runner-b");

    // Runner A should have user from runner B (forwarded)
    const runnerAUserB = await runnerADb.prisma.users.findUnique({ where: { id: userBId } });
    expect(runnerAUserB).not.toBeNull();
    expect(runnerAUserB?.username).toBe("from-runner-b");

    // Runner B should have user from runner A (forwarded)
    const runnerBUserA = await runnerBDb.prisma.users.findUnique({ where: { id: userAId } });
    expect(runnerBUserA).not.toBeNull();
    expect(runnerBUserA?.username).toBe("from-runner-a");
  });

  test("should handle runner disconnect and state cleanup", async () => {
    // Create user on runner A
    const userId = ulid();
    await seedUser(runnerADb.prisma, userId, "disconnect-test", hostAId);

    // Wait for initial sync
    await waitForSync(500);

    // Disconnect runner A
    bridge.disconnectRunner(hostAId);

    await waitForSync(200);

    // Verify state is cleaned up
    const clientState = hubSyncServer.getClientState(hostAId);
    expect(clientState).toBeUndefined();

    // Forward queue should be removed
    expect(hubForwardService.getPendingCount(hostAId)).toBe(0);
  });

  test("should handle multiple records in single sync batch", async () => {
    // Create multiple users on runner A
    const userIds = [ulid(), ulid(), ulid()];
    const usernames = ["user1", "user2", "user3"];

    for (let i = 0; i < userIds.length; i++) {
      await seedUser(runnerADb.prisma, userIds[i], usernames[i], hostAId);
    }

    // Wait for sync
    await waitForSync(1000);

    // Verify all users in hub
    for (let i = 0; i < userIds.length; i++) {
      const hubUser = await hubDb.prisma.users.findUnique({
        where: { id: userIds[i] },
      });
      expect(hubUser).not.toBeNull();
      expect(hubUser?.username).toBe(usernames[i]);
    }

    // Verify all users forwarded to runner B
    for (let i = 0; i < userIds.length; i++) {
      const runnerBUser = await runnerBDb.prisma.users.findUnique({
        where: { id: userIds[i] },
      });
      expect(runnerBUser).not.toBeNull();
      expect(runnerBUser?.username).toBe(usernames[i]);
    }
  });

  test("should sync context_log (append-only, hub-only)", async () => {
    // Create user and run_session for FK constraints
    const userId = ulid();
    await seedUser(runnerADb.prisma, userId, "log-user", hostAId);
    await seedUser(hubDb.prisma, userId, "log-user", hostAId);

    const now = new Date();
    await runnerADb.prisma.run_session.create({
      data: {
        user_id: userId,
        run_id: 1,
        session_id: 1,
        start_date: now,
        last_active: now,
        model_name: "test-model",
      },
    });
    await hubDb.prisma.run_session.create({
      data: {
        user_id: userId,
        run_id: 1,
        session_id: 1,
        start_date: now,
        last_active: now,
        model_name: "test-model",
      },
    });

    // Create context log entry
    const logId = ulid();
    await runnerADb.prisma.context_log.create({
      data: {
        id: logId,
        user_id: userId,
        run_id: 1,
        session_id: 1,
        role: "user",
        source: "user",
        type: "message",
        message: "Test log message",
        date: now,
      },
    });

    // Wait for sync
    await waitForSync(1000);

    // Verify log exists in hub (context_log syncs to hub but is NOT forwarded)
    const hubLog = await hubDb.prisma.context_log.findUnique({
      where: { id: logId },
    });
    expect(hubLog).not.toBeNull();
    expect(hubLog?.message).toBe("Test log message");

    // context_log should NOT be forwarded to runner B (hub-only table)
    const runnerBLog = await runnerBDb.prisma.context_log.findUnique({
      where: { id: logId },
    });
    expect(runnerBLog).toBeNull();
  });
});
