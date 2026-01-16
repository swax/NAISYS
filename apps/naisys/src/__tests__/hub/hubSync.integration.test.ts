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
 * Integration tests for hub sync functionality.
 *
 * Tests the flow of data from runners to the hub:
 * 1. Runner creates data locally
 * 2. Hub pulls data from runner via sync_request
 * 3. Hub stores data in its database
 *
 * Uses isolated test databases and mock transport layer (no real network).
 */

jest.setTimeout(30000);

describe("Hub Sync Integration Tests", () => {
  let runnerADb: TestDatabase;
  let hubDb: TestDatabase;

  let hostAId: string;
  const hostAName = "runner-a-host";

  let bridge: ReturnType<typeof createSyncEventBridge>;
  let mockHubServer: MockHubServer;
  let mockHubManagerA: MockHubManager;

  let hubSyncServer: HubSyncServer;
  let hubForwardService: HubForwardService;
  // Client is created to establish connection; not called directly
  let _syncClientA: HubSyncClient;

  const logs: string[] = [];
  const mockHubServerLog: HubServerLog = {
    log: (msg) => logs.push(`[HUB] ${msg}`),
    error: (msg) => logs.push(`[HUB ERROR] ${msg}`),
  };
  const mockClientLogA: HubClientLog = {
    write: (msg) => logs.push(`[RUNNER-A] ${msg}`),
    error: (msg) => logs.push(`[RUNNER-A ERROR] ${msg}`),
  };

  beforeEach(async () => {
    logs.length = 0;

    [runnerADb, hubDb] = await Promise.all([
      createTestDatabase("runner-a", "naisys"),
      createTestDatabase("hub", "hub"),
    ]);

    hostAId = ulid();

    await Promise.all([
      seedHost(runnerADb.prisma, hostAId, hostAName),
      seedHost(hubDb.prisma, hostAId, hostAName),
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

    const hostServiceA: HostService = {
      localHostId: hostAId,
      localHostname: hostAName,
    };

    _syncClientA = await createHubSyncClient(
      mockHubManagerA as unknown as HubManager,
      mockClientLogA,
      runnerADb.dbService,
      hostServiceA
    );
  });

  afterEach(() => {
    hubSyncServer.stop();
    runnerADb.cleanup();
    hubDb.cleanup();
    bridge.reset();
  });

  async function waitForSync(ms: number = 500): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  test("should sync user from runner A to hub", async () => {
    const userId = ulid();
    const username = "test-user-alice";
    await seedUser(runnerADb.prisma, userId, username, hostAId);

    await waitForSync(500);

    const hubUser = await hubDb.prisma.users.findUnique({
      where: { id: userId },
    });

    expect(hubUser).not.toBeNull();
    expect(hubUser?.username).toBe(username);
    expect(hubUser?.host_id).toBe(hostAId);
  });

  test("should handle multiple records in single sync batch", async () => {
    const userIds = [ulid(), ulid(), ulid()];
    const usernames = ["user1", "user2", "user3"];

    for (let i = 0; i < userIds.length; i++) {
      await seedUser(runnerADb.prisma, userIds[i], usernames[i], hostAId);
    }

    await waitForSync(1000);

    for (let i = 0; i < userIds.length; i++) {
      const hubUser = await hubDb.prisma.users.findUnique({
        where: { id: userIds[i] },
      });
      expect(hubUser).not.toBeNull();
      expect(hubUser?.username).toBe(usernames[i]);
    }
  });

  test("should sync context_log (append-only, hub-only)", async () => {
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

    await waitForSync(1000);

    const hubLog = await hubDb.prisma.context_log.findUnique({
      where: { id: logId },
    });
    expect(hubLog).not.toBeNull();
    expect(hubLog?.message).toBe("Test log message");
  });

  test("should handle runner disconnect and state cleanup", async () => {
    const userId = ulid();
    await seedUser(runnerADb.prisma, userId, "disconnect-test", hostAId);

    await waitForSync(500);

    bridge.disconnectRunner(hostAId);

    await waitForSync(200);

    const clientState = hubSyncServer.getClientState(hostAId);
    expect(clientState).toBeUndefined();

    expect(hubForwardService.getPendingCount(hostAId)).toBe(0);
  });
});
