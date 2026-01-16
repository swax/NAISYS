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
 * Integration tests for hub forward service functionality.
 *
 * Tests the flow of data from hub to other runners:
 * 1. Runner A creates data locally
 * 2. Hub pulls data from Runner A via sync_request
 * 3. Hub stores data and queues for forwarding
 * 4. Hub forwards data to Runner B via piggybacked sync_request
 * 5. Runner B upserts forwarded data
 *
 * Uses isolated test databases and mock transport layer (no real network).
 */

jest.setTimeout(30000);

describe("Hub Forward Service Integration Tests", () => {
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
  // Clients are created to establish connections; not called directly
  let _syncClientA: HubSyncClient;
  let _syncClientB: HubSyncClient;

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

    mockHubManagerA = bridge.createMockHubManager(hostAId, hostAName);
    mockHubManagerB = bridge.createMockHubManager(hostBId, hostBName);

    const hostServiceA: HostService = {
      localHostId: hostAId,
      localHostname: hostAName,
    };
    const hostServiceB: HostService = {
      localHostId: hostBId,
      localHostname: hostBName,
    };

    _syncClientA = await createHubSyncClient(
      mockHubManagerA as unknown as HubManager,
      mockClientLogA,
      runnerADb.dbService,
      hostServiceA
    );
    _syncClientB = await createHubSyncClient(
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

  test("should forward user from runner A through hub to runner B", async () => {
    const userId = ulid();
    const username = "test-user-bob";
    await seedUser(runnerADb.prisma, userId, username, hostAId);

    await waitForSync(1000);

    const runnerBUser = await runnerBDb.prisma.users.findUnique({
      where: { id: userId },
    });

    expect(runnerBUser).not.toBeNull();
    expect(runnerBUser?.username).toBe(username);
    expect(runnerBUser?.host_id).toBe(hostAId);
  });

  test("should not create sync loop - forwarded data should not be re-synced", async () => {
    const userId = ulid();
    await seedUser(runnerADb.prisma, userId, "no-loop-user", hostAId);

    await waitForSync(1000);

    const runnerBUser = await runnerBDb.prisma.users.findUnique({
      where: { id: userId },
    });
    expect(runnerBUser).not.toBeNull();

    await waitForSync(500);

    // The hub should NOT receive the user back from runner B
    // because the user's host_id = hostAId, not hostBId
    const forwardCountForA = hubForwardService.getPendingCount(hostAId);
    expect(forwardCountForA).toBe(0);
  });

  test("should sync mail message from runner A to hub and forward to runner B", async () => {
    // Create user first (for FK constraint)
    // Need to seed hostA in runnerB since alice's host_id references hostAId
    const userAId = ulid();
    await seedHost(runnerBDb.prisma, hostAId, hostAName);
    await Promise.all([
      seedUser(runnerADb.prisma, userAId, "alice", hostAId),
      seedUser(hubDb.prisma, userAId, "alice", hostAId),
      seedUser(runnerBDb.prisma, userAId, "alice", hostAId),
    ]);

    const messageId = ulid();
    await runnerADb.prisma.mail_messages.create({
      data: {
        id: messageId,
        from_user_id: userAId,
        host_id: hostAId,
        subject: "Test Message",
        body: "Test body content",
        created_at: new Date(),
      },
    });

    await waitForSync(1000);

    const hubMessage = await hubDb.prisma.mail_messages.findUnique({
      where: { id: messageId },
    });
    expect(hubMessage).not.toBeNull();
    expect(hubMessage?.subject).toBe("Test Message");

    const runnerBMessage = await runnerBDb.prisma.mail_messages.findUnique({
      where: { id: messageId },
    });
    expect(runnerBMessage).not.toBeNull();
    expect(runnerBMessage?.subject).toBe("Test Message");
  });

  test("should handle bidirectional sync - users from both runners", async () => {
    const userAId = ulid();
    await seedUser(runnerADb.prisma, userAId, "from-runner-a", hostAId);

    const userBId = ulid();
    await seedUser(runnerBDb.prisma, userBId, "from-runner-b", hostBId);

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

  test("should forward multiple records in single sync batch", async () => {
    const userIds = [ulid(), ulid(), ulid()];
    const usernames = ["user1", "user2", "user3"];

    for (let i = 0; i < userIds.length; i++) {
      await seedUser(runnerADb.prisma, userIds[i], usernames[i], hostAId);
    }

    await waitForSync(1000);

    // Verify all users forwarded to runner B
    for (let i = 0; i < userIds.length; i++) {
      const runnerBUser = await runnerBDb.prisma.users.findUnique({
        where: { id: userIds[i] },
      });
      expect(runnerBUser).not.toBeNull();
      expect(runnerBUser?.username).toBe(usernames[i]);
    }
  });

  test("should not forward context_log (hub-only table)", async () => {
    const userId = ulid();
    // Seed hostA in runnerB since we're creating a user with hostAId there
    await seedHost(runnerBDb.prisma, hostAId, hostAName);
    await seedUser(runnerADb.prisma, userId, "log-user", hostAId);
    await seedUser(hubDb.prisma, userId, "log-user", hostAId);
    await seedUser(runnerBDb.prisma, userId, "log-user", hostAId);

    const now = new Date();
    await runnerADb.prisma.run_session.create({
      data: {
        user_id: userId,
        run_id: 1,
        session_id: 1,
        host_id: hostAId,
        created_at: now,
        last_active: now,
        model_name: "test-model",
      },
    });
    await hubDb.prisma.run_session.create({
      data: {
        user_id: userId,
        run_id: 1,
        session_id: 1,
        host_id: hostAId,
        created_at: now,
        last_active: now,
        model_name: "test-model",
      },
    });

    const logId = ulid();
    await runnerADb.prisma.context_log.create({
      data: {
        id: logId,
        user_id: userId,
        run_id: 1,
        session_id: 1,
        host_id: hostAId,
        role: "user",
        source: "user",
        type: "message",
        message: "Test log message",
        created_at: now,
      },
    });

    await waitForSync(1000);

    // context_log should NOT be forwarded to runner B (hub-only table)
    const runnerBLog = await runnerBDb.prisma.context_log.findUnique({
      where: { id: logId },
    });
    expect(runnerBLog).toBeNull();
  });
});
