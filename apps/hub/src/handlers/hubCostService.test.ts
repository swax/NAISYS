import { buildDefaultAgentConfig } from "@naisys/common";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HubEvents } from "@naisys/hub-protocol";
import { describe, expect, test, vi } from "vitest";

import type { NaisysServer } from "../services/naisysServer.js";
import type { HubConfigService } from "./hubConfigService.js";
import { createHubCostService } from "./hubCostService.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";

type CostWriteAck = (response: unknown) => void;
type CostWriteHandler = (
  hostId: number,
  data: unknown,
  ack: CostWriteAck,
) => Promise<void>;

function createServerHarness() {
  const handlers = new Map<string, CostWriteHandler>();
  const server = {
    registerEvent: vi.fn((event: string, handler: CostWriteHandler) => {
      handlers.set(event, handler);
    }),
    broadcastToSupervisors: vi.fn(),
    sendMessage: vi.fn(() => true),
  } as unknown as NaisysServer;

  async function emitCostWrite(hostId: number, data: unknown) {
    const handler = handlers.get(HubEvents.COST_WRITE);
    if (!handler) throw new Error("COST_WRITE handler was not registered");

    let ackResponse: unknown;
    await handler(hostId, data, (response) => {
      ackResponse = response;
    });
    return ackResponse;
  }

  return { server, emitCostWrite };
}

function createHubDb() {
  const budgetLeft = new Map<number, number | null>([[1, 5]]);

  const hubDb = {
    costs: {
      create: vi.fn(() => Promise.resolve({})),
      aggregate: vi.fn(() => Promise.resolve({ _sum: { cost: 0 } })),
    },
    run_session: {
      updateMany: vi.fn(() => Promise.resolve({})),
    },
    users: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
    user_notifications: {
      findUnique: vi.fn(({ where }: { where: { user_id: number } }) => {
        const value = budgetLeft.get(where.user_id);
        return Promise.resolve(
          value === undefined ? null : { budget_left: value },
        );
      }),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { user_id: number };
          data: { budget_left: number };
        }) => {
          budgetLeft.set(where.user_id, data.budget_left);
          return Promise.resolve({ budget_left: data.budget_left });
        },
      ),
      updateMany: vi.fn(() => Promise.resolve({})),
    },
  } as unknown as PrismaClient;

  return { hubDb, budgetLeft };
}

function createLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    disableConsole: vi.fn(),
  };
}

function createHeartbeatService(
  activeUserIds: number[],
  hostIdsByUser = new Map<number, number[]>([[1, [101]]]),
) {
  return {
    getActiveUserIds: vi.fn(() => activeUserIds),
    findHostsForAgent: vi.fn(
      (userId: number) => hostIdsByUser.get(userId) ?? [],
    ),
  } as unknown as HubHeartbeatService;
}

function createConfigService(config: {
  spendLimitDollars?: number;
  spendLimitHours?: number;
}) {
  return {
    getConfig: vi.fn(() => ({ config })),
  } as unknown as HubConfigService;
}

function userRow(
  id: number,
  configOverrides: Partial<ReturnType<typeof buildDefaultAgentConfig>>,
  spendLimitResetAt?: Date,
) {
  return {
    id,
    config: JSON.stringify({
      ...buildDefaultAgentConfig(`agent-${id}`),
      ...configOverrides,
    }),
    user_notifications: {
      spend_limit_reset_at: spendLimitResetAt,
    },
  };
}

describe("hubCostService", () => {
  test("persists subagent cost entries, pushes scoped deltas, and decrements budget", async () => {
    const { server, emitCostWrite } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const heartbeatService = createHeartbeatService([]);
    const configService = createConfigService({});
    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      heartbeatService,
      configService,
    );

    const ack = await emitCostWrite(42, {
      entries: [
        {
          userId: 1,
          runId: 7,
          subagentId: -1,
          sessionId: 1,
          source: "genimg",
          model: "mock-image",
          cost: 0.5,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
        {
          userId: 1,
          runId: 7,
          subagentId: -1,
          sessionId: 1,
          source: "genimg",
          model: "mock-image",
          cost: 0.25,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      ],
    });

    expect(hubDb.costs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 1,
        run_id: 7,
        subagent_id: -1,
        session_id: 1,
        host_id: 42,
        cost: 0.5,
      }),
    });
    expect(hubDb.run_session.updateMany).toHaveBeenCalledWith({
      where: {
        user_id: 1,
        run_id: 7,
        subagent_id: -1,
        session_id: 1,
      },
      data: {
        total_cost: { increment: 0.5 },
      },
    });
    expect(server.broadcastToSupervisors).toHaveBeenCalledWith(
      HubEvents.COST_PUSH,
      {
        entries: [
          {
            userId: 1,
            runId: 7,
            subagentId: -1,
            sessionId: 1,
            costDelta: 0.75,
          },
        ],
      },
    );
    expect(hubDb.user_notifications.update).toHaveBeenCalledWith({
      where: { user_id: 1 },
      data: { budget_left: 4.25 },
    });
    expect(ack).toEqual({ budgets: [{ userId: 1, budgetLeft: 4.25 }] });

    service.cleanup();
  });

  test("normalizes parent-agent subagentId to undefined on the wire (DB row stays 0)", async () => {
    const { server, emitCostWrite } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const heartbeatService = createHeartbeatService([]);
    const configService = createConfigService({});
    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      heartbeatService,
      configService,
    );

    await emitCostWrite(42, {
      entries: [
        {
          userId: 1,
          runId: 7,
          // subagentId omitted — represents the parent agent
          sessionId: 1,
          source: "console",
          model: "mock",
          cost: 0.1,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      ],
    });

    expect(hubDb.costs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ subagent_id: 0 }),
    });
    expect(server.broadcastToSupervisors).toHaveBeenCalledWith(
      HubEvents.COST_PUSH,
      {
        entries: [
          {
            userId: 1,
            runId: 7,
            subagentId: undefined,
            sessionId: 1,
            costDelta: 0.1,
          },
        ],
      },
    );

    service.cleanup();
  });

  test("suspends, re-sends, and resumes per-agent cost control", async () => {
    const { server, emitCostWrite } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const heartbeatService = createHeartbeatService([1]);
    const configService = createConfigService({});
    vi.mocked(hubDb.users.findMany as any).mockResolvedValue([
      userRow(1, { spendLimitDollars: 1 }),
    ]);
    vi.mocked(hubDb.costs.aggregate as any)
      .mockResolvedValueOnce({ _sum: { cost: 1.25 } })
      .mockResolvedValueOnce({ _sum: { cost: 0.25 } });

    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      heartbeatService,
      configService,
    );

    await service.checkSpendLimits();

    const suspendReason = "Spend limit of $1 reached (current: $1.25)";
    expect(server.sendMessage).toHaveBeenCalledWith(
      101,
      HubEvents.COST_CONTROL,
      {
        userId: 1,
        enabled: false,
        reason: suspendReason,
      },
    );
    expect(service.isUserSpendSuspended(1)).toBe(true);
    expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
      where: { user_id: 1 },
      data: { cost_suspended_reason: suspendReason },
    });

    vi.mocked(server.sendMessage).mockClear();
    await emitCostWrite(42, {
      entries: [
        {
          userId: 1,
          runId: 7,
          subagentId: -1,
          sessionId: 1,
          source: "genimg",
          model: "mock-image",
          cost: 0.1,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
        },
      ],
    });

    expect(server.sendMessage).toHaveBeenCalledWith(
      101,
      HubEvents.COST_CONTROL,
      {
        userId: 1,
        enabled: false,
        reason: suspendReason,
      },
    );

    vi.mocked(server.sendMessage).mockClear();
    await service.checkSpendLimits();

    expect(server.sendMessage).toHaveBeenCalledWith(
      101,
      HubEvents.COST_CONTROL,
      {
        userId: 1,
        enabled: true,
        reason: "Spend limit period reset (current: $0.25, limit: $1)",
      },
    );
    expect(service.isUserSpendSuspended(1)).toBe(false);
    expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
      where: { user_id: 1 },
      data: { cost_suspended_reason: null },
    });

    service.cleanup();
  });
});
