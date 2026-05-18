import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HUB_HEARTBEAT_INTERVAL_MS, HubEvents } from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { HubRuntimeKeyService } from "../auth/hubRuntimeKeyService.js";
import { createHubHeartbeatService } from "../lifecycle/hubHeartbeatService.js";
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

    const service = createHubHeartbeatService(
      server,
      { hubDb } as HubDatabaseService,
      createLogger(),
      redactionService,
      runtimeKeyService,
    );

    try {
      const heartbeatHandler = handlers.get(HubEvents.HEARTBEAT);
      if (!heartbeatHandler) {
        throw new Error("HEARTBEAT handler was not registered");
      }

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
