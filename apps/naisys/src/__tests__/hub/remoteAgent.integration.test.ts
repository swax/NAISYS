import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ulid } from "@naisys/database";
import type { HubServerLog } from "@naisys/hub/services/hubServerLog";
import type { AgentRunner } from "../../agent/agentRunner.js";
import type { HubClientLog } from "../../hub/hubClientLog.js";
import type { HubClient } from "../../hub/hubClient.js";
import { createRemoteAgentHandler } from "../../hub/remoteAgentHandler.js";
import {
  createRemoteAgentRequester,
  type RemoteAgentRequester,
} from "../../hub/remoteAgentRequester.js";
import type { HostService } from "../../services/hostService.js";
import {
  createSyncEventBridge,
  type MockHubClient,
  type MockHubServer,
} from "./syncEventBridge.js";
import {
  createTestDatabase,
  resetDatabase,
  seedHost,
  seedUser,
  type TestDatabase,
} from "./testDbHelper.js";

/**
 * Integration tests for remote agent control functionality.
 *
 * Tests the flow of agent start/stop/log requests between runners via the hub:
 * 1. Runner A sends agent_start request to hub
 * 2. Hub routes request to Runner B (target host)
 * 3. Runner B executes the operation and responds
 * 4. Response flows back through hub to Runner A
 *
 * Uses isolated test databases and mock transport layer (no real network).
 */

jest.setTimeout(30000);

describe("Remote Agent Integration Tests", () => {
  // Databases
  let runnerADb: TestDatabase;
  let runnerBDb: TestDatabase;
  let hubDb: TestDatabase;

  // Host identifiers (for DB seeding - hosts table)
  let hostAId: string;
  let hostBId: string;
  const hostAName = "runner-a-host";
  const hostBName = "runner-b-host";

  // Runner identifiers (for hub connections)
  let runnerAId: string;
  let runnerBId: string;
  const runnerAName = "runner-a";
  const runnerBName = "runner-b";

  // Bridge and mocks
  let bridge: ReturnType<typeof createSyncEventBridge>;
  let mockHubServer: MockHubServer;
  let mockHubClientA: MockHubClient;
  let mockHubClientB: MockHubClient;

  // Services
  let remoteAgentRequesterA: RemoteAgentRequester;
  let mockAgentRunnerB: AgentRunner;

  // Test user on Runner B
  let userBId: string;
  const userBUsername = "bob";

  // Logging
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

  // Create databases once for all tests (migrations are slow)
  beforeAll(async () => {
    [runnerADb, runnerBDb, hubDb] = await Promise.all([
      createTestDatabase("runner-a", "naisys"),
      createTestDatabase("runner-b", "naisys"),
      createTestDatabase("hub", "hub"),
    ]);
  });

  afterAll(async () => {
    // Wait a bit for connections to close before cleaning up databases
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Cleanup may fail on Windows due to SQLite file locking - ignore errors
    try {
      await runnerADb.cleanup();
    } catch {
      /* ignore */
    }
    try {
      await runnerBDb.cleanup();
    } catch {
      /* ignore */
    }
    try {
      await hubDb.cleanup();
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    logs.length = 0;

    // Reset database data (fast, no migrations)
    await Promise.all([
      resetDatabase(runnerADb.prisma),
      resetDatabase(runnerBDb.prisma),
      resetDatabase(hubDb.prisma),
    ]);

    // Generate unique IDs
    hostAId = ulid();
    hostBId = ulid();
    runnerAId = ulid();
    runnerBId = ulid();
    userBId = ulid();

    // Seed hosts in all databases
    await Promise.all([
      seedHost(runnerADb.prisma, hostAId, hostAName),
      seedHost(runnerADb.prisma, hostBId, hostBName),
      seedHost(runnerBDb.prisma, hostAId, hostAName),
      seedHost(runnerBDb.prisma, hostBId, hostBName),
      seedHost(hubDb.prisma, hostAId, hostAName),
      seedHost(hubDb.prisma, hostBId, hostBName),
    ]);

    // Seed user on Runner B
    await seedUser(runnerBDb.prisma, userBId, userBUsername, hostBId);

    // Create bridge and hub server
    bridge = createSyncEventBridge();
    mockHubServer = bridge.createMockHubServer();

    // Create Runner A (requester)
    mockHubClientA = bridge.createMockHubClient(runnerAId, runnerAName);

    remoteAgentRequesterA = createRemoteAgentRequester(
      mockHubClientA as unknown as HubClient,
    );

    // Create Runner B (handler)
    mockHubClientB = bridge.createMockHubClient(runnerBId, runnerBName);

    const hostServiceB: HostService = {
      cleanup: () => {},
      localHostId: hostBId,
      localHostname: hostBName,
      commandName: "ns-hosts",
      handleCommand: () => Promise.resolve(""),
    };

    // Create mock AgentRunner for Runner B
    mockAgentRunnerB = {
      startAgent: jest.fn(() => Promise.resolve(ulid())),
      stopAgentByUserId: jest.fn(() => Promise.resolve()),
    } as unknown as AgentRunner;

    // Register remote agent handler on Runner B
    createRemoteAgentHandler(
      mockHubClientB as unknown as HubClient,
      mockClientLogB,
      runnerBDb.dbService,
      hostServiceB,
      mockAgentRunnerB,
    );

    // Trigger connections
    mockHubClientA._triggerHubConnected();
    mockHubClientB._triggerHubConnected();

    // Wait for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    bridge.reset();
  });

  async function waitForAsync(ms: number = 200): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe("Agent Start", () => {
    test("should start agent on remote host via hub", async () => {
      const requesterId = ulid();
      const task = "Test task description";

      const result = await remoteAgentRequesterA.startAgent(
        userBId,
        runnerBId,
        requesterId,
        task,
        userBUsername,
        runnerBName,
      );

      expect(result).toContain("started");
      expect(result).toContain(userBUsername);

      // Verify agentRunner.startAgent was called on Runner B
      expect(mockAgentRunnerB.startAgent).toHaveBeenCalledWith(userBId);
    });

    test("should fail when target host is not connected", async () => {
      const requesterId = ulid();
      const unknownRunnerId = ulid();

      await expect(
        remoteAgentRequesterA.startAgent(
          userBId,
          unknownRunnerId,
          requesterId,
          "task",
          userBUsername,
          "unknown-runner",
        ),
      ).rejects.toThrow(/not connected/);
    });

    test("should fail when user not found on target host", async () => {
      const requesterId = ulid();
      const unknownUserId = ulid();

      await expect(
        remoteAgentRequesterA.startAgent(
          unknownUserId,
          runnerBId,
          requesterId,
          "task",
          "unknown-user",
          runnerBName,
        ),
      ).rejects.toThrow(/not found/);
    });

    test("should fail when target host is same as source host", async () => {
      const requesterId = ulid();

      // Try to start an agent on runnerA from runnerA (should be handled locally)
      await expect(
        remoteAgentRequesterA.startAgent(
          userBId,
          runnerAId, // Same as source
          requesterId,
          "task",
          userBUsername,
          runnerAName,
        ),
      ).rejects.toThrow(/handle locally/);
    });

    test("should fail when agentRunner.startAgent throws", async () => {
      const requesterId = ulid();

      // Make startAgent throw an error
      const mockStartAgent = mockAgentRunnerB.startAgent as jest.MockedFunction<
        typeof mockAgentRunnerB.startAgent
      >;
      mockStartAgent.mockRejectedValueOnce(new Error("Agent already running"));

      await expect(
        remoteAgentRequesterA.startAgent(
          userBId,
          runnerBId,
          requesterId,
          "task",
          userBUsername,
          runnerBName,
        ),
      ).rejects.toThrow(/Agent already running/);
    });
  });

  describe("Agent Stop", () => {
    test("should stop agent on remote host via hub", async () => {
      const requesterId = ulid();
      const reason = "Task completed";

      const result = await remoteAgentRequesterA.stopAgent(
        userBId,
        runnerBId,
        requesterId,
        reason,
        userBUsername,
        runnerBName,
      );

      expect(result).toContain("stop requested");
      expect(result).toContain(userBUsername);

      // Verify agentRunner.stopAgentByUserId was called on Runner B
      expect(mockAgentRunnerB.stopAgentByUserId).toHaveBeenCalledWith(
        userBId,
        reason,
      );
    });

    test("should fail when target host is not connected", async () => {
      const requesterId = ulid();
      const unknownRunnerId = ulid();

      await expect(
        remoteAgentRequesterA.stopAgent(
          userBId,
          unknownRunnerId,
          requesterId,
          "reason",
          userBUsername,
          "unknown-runner",
        ),
      ).rejects.toThrow(/not connected/);
    });

    test("should fail when user not found", async () => {
      const requesterId = ulid();
      const unknownUserId = ulid();

      await expect(
        remoteAgentRequesterA.stopAgent(
          unknownUserId,
          runnerBId,
          requesterId,
          "reason",
          "unknown-user",
          runnerBName,
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("Agent Log", () => {
    test("should get logs from agent on remote host", async () => {
      // First, create some log entries for the user
      const now = new Date();
      await runnerBDb.prisma.run_session.create({
        data: {
          user_id: userBId,
          run_id: 1,
          session_id: 1,
          host_id: hostBId,
          created_at: now,
          last_active: now,
          model_name: "test-model",
        },
      });

      await runnerBDb.prisma.context_log.createMany({
        data: [
          {
            id: ulid(),
            user_id: userBId,
            run_id: 1,
            session_id: 1,
            host_id: hostBId,
            role: "user",
            source: "user",
            type: "message",
            message: "First log message",
            created_at: new Date(now.getTime() + 1000),
          },
          {
            id: ulid(),
            user_id: userBId,
            run_id: 1,
            session_id: 1,
            host_id: hostBId,
            role: "assistant",
            source: "llm",
            type: "message",
            message: "Second log message",
            created_at: new Date(now.getTime() + 2000),
          },
        ],
      });

      const lines = await remoteAgentRequesterA.getAgentLog(
        userBId,
        runnerBId,
        50,
        userBUsername,
      );

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("First log message");
      expect(lines[1]).toBe("Second log message");
    });

    test("should return empty array when no logs exist", async () => {
      const lines = await remoteAgentRequesterA.getAgentLog(
        userBId,
        runnerBId,
        50,
        userBUsername,
      );

      expect(lines).toHaveLength(0);
    });

    test("should respect line limit", async () => {
      const now = new Date();
      await runnerBDb.prisma.run_session.create({
        data: {
          user_id: userBId,
          run_id: 1,
          session_id: 1,
          host_id: hostBId,
          created_at: now,
          last_active: now,
          model_name: "test-model",
        },
      });

      // Create 5 log entries
      await runnerBDb.prisma.context_log.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          id: ulid(),
          user_id: userBId,
          run_id: 1,
          session_id: 1,
          host_id: hostBId,
          role: "user",
          source: "user",
          type: "message",
          message: `Log message ${i + 1}`,
          created_at: new Date(now.getTime() + i * 1000),
        })),
      });

      // Request only 2 lines
      const lines = await remoteAgentRequesterA.getAgentLog(
        userBId,
        runnerBId,
        2,
        userBUsername,
      );

      expect(lines).toHaveLength(2);
      // Should get the most recent 2 (4 and 5), returned in chronological order
      expect(lines[0]).toBe("Log message 4");
      expect(lines[1]).toBe("Log message 5");
    });

    test("should fail when user not found", async () => {
      const unknownUserId = ulid();

      await expect(
        remoteAgentRequesterA.getAgentLog(
          unknownUserId,
          runnerBId,
          50,
          "unknown-user",
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("Hub Availability", () => {
    test("isAvailable returns true when hub is connected", () => {
      expect(remoteAgentRequesterA.isAvailable()).toBe(true);
    });

    test("should fail when no hub connection", async () => {
      // Create a requester with no connected hubs
      const disconnectedManager = {
        registerEvent: jest.fn(),
        unregisterEvent: jest.fn(),
        sendMessage: jest.fn(() => false),
        isConnected: () => false,
        getConnectionInfo: () => null,
        disableReconnection: jest.fn(),
      } as unknown as HubClient;

      const disconnectedRequester =
        createRemoteAgentRequester(disconnectedManager);

      expect(disconnectedRequester.isAvailable()).toBe(false);

      await expect(
        disconnectedRequester.startAgent(
          userBId,
          runnerBId,
          ulid(),
          "task",
          userBUsername,
          runnerBName,
        ),
      ).rejects.toThrow(/no hub connection/);
    });
  });

  describe("Connection Resilience", () => {
    test("should fail gracefully when runner disconnects mid-request", async () => {
      const requesterId = ulid();

      // Disconnect Runner B before the request can complete
      bridge.disconnectRunner(runnerBId);

      await expect(
        remoteAgentRequesterA.startAgent(
          userBId,
          runnerBId,
          requesterId,
          "task",
          userBUsername,
          runnerBName,
        ),
      ).rejects.toThrow(/not connected/);
    });
  });
});
