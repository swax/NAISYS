import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HUB_HEARTBEAT_INTERVAL_MS, HubEvents } from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import { createHubHeartbeatService } from "../lifecycle/hubHeartbeatService.js";
import type { HubOwnershipService } from "../lifecycle/hubOwnershipService.js";
import type { HubRedactionService } from "../observability/hubRedactionService.js";
import type { NaisysServer } from "../server/naisysServer.js";

type EventHandler = (hostId: number, data: unknown) => Promise<void> | void;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createServerHarness() {
  const handlers = new Map<string, EventHandler>();
  const server = {
    registerEvent: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    broadcastToAll: vi.fn(),
    broadcastToSupervisors: vi.fn(),
    sendMessage: vi.fn(() => true),
  } as unknown as NaisysServer;

  return { server, handlers };
}

function createLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    disableConsole: vi.fn(),
  } as unknown as DualLogger;
}

function createOwnershipService(adminUserId = 999) {
  const owned = new Map<number, Set<number>>();
  return {
    adminUserId,
    hostOwnsUser: vi.fn((hostId: number, userId: number) =>
      userId === adminUserId || (owned.get(hostId)?.has(userId) ?? false),
    ),
    addStartedAgent: vi.fn((hostId: number, userId: number) => {
      let set = owned.get(hostId);
      if (!set) {
        set = new Set();
        owned.set(hostId, set);
      }
      set.add(userId);
    }),
    removeStoppedAgent: vi.fn((hostId: number, userId: number) => {
      owned.get(hostId)?.delete(userId);
    }),
    reconcileHeartbeatPresence: vi.fn(
      (hostId: number, claimedUserIds: Set<number>) => {
        if (claimedUserIds.has(adminUserId)) {
          let set = owned.get(hostId);
          if (!set) {
            set = new Set();
            owned.set(hostId, set);
          }
          set.add(adminUserId);
        }
        const current = owned.get(hostId);
        if (current) {
          for (const userId of [...current]) {
            if (!claimedUserIds.has(userId)) current.delete(userId);
          }
        }
      },
    ),
    findHostsForAgent: vi.fn((userId: number) => {
      const hostIds: number[] = [];
      for (const [hostId, set] of owned) if (set.has(userId)) hostIds.push(hostId);
      return hostIds;
    }),
    getHostActiveAgentCount: vi.fn(
      (hostId: number) => owned.get(hostId)?.size ?? 0,
    ),
    getActiveUserIds: vi.fn(() => {
      const all = new Set<number>();
      for (const set of owned.values()) for (const id of set) all.add(id);
      return all;
    }),
    updateAgentNotification: vi.fn(),
    throttledPushAgentsStatus: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as HubOwnershipService;
}

describe("hubHeartbeatService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("publishes session heartbeats from memory before heartbeat DB writes finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00Z"));

    const { server, handlers } = createServerHarness();
    const hostUpdate = createDeferred<{ count: number }>();
    const hubDb = {
      hosts: {
        updateMany: vi.fn(() => hostUpdate.promise),
      },
      user_notifications: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      run_session: {
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      users: {
        findMany: vi.fn(() => Promise.resolve([])),
      },
    } as unknown as PrismaClient;
    const redactionService = {
      registerRuntimeApiKey: vi.fn(),
    } as unknown as HubRedactionService;
    const runtimeKeyService = {
      issueRuntimeApiKey: vi.fn(),
    } as unknown as HubRuntimeKeyService;

    const ownershipService = createOwnershipService();
    const service = createHubHeartbeatService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
      redactionService,
      runtimeKeyService,
      ownershipService,
    );

    try {
      const heartbeatHandler = handlers.get(HubEvents.HEARTBEAT);
      if (!heartbeatHandler) {
        throw new Error("HEARTBEAT handler was not registered");
      }

      // The handler filters claims by ACL membership; seed authority first.
      ownershipService.addStartedAgent(42, 1);

      const handlerPromise = Promise.resolve(
        heartbeatHandler(42, {
          activeSessions: [
            {
              userId: 1,
              runId: 7,
              sessionId: 2,
              paused: true,
              state: "Waiting",
            },
          ],
        }),
      );

      expect(hubDb.hosts.updateMany).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(HUB_HEARTBEAT_INTERVAL_MS);

      expect(server.broadcastToSupervisors).toHaveBeenCalledWith(
        HubEvents.SESSION_HEARTBEAT,
        {
          updates: [
            {
              userId: 1,
              runId: 7,
              subagentId: undefined,
              sessionId: 2,
              lastActive: "2026-05-09T12:00:00.000Z",
              paused: true,
              state: "Waiting",
              totalTokens: undefined,
            },
          ],
        },
      );

      hostUpdate.resolve({ count: 1 });
      await handlerPromise;
    } finally {
      service.cleanup();
    }
  });
});
