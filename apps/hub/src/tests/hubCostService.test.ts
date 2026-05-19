import { buildDefaultAgentConfig, LlmApiType } from "@naisys/common";
import type * as CommonNode from "@naisys/common-node";
import { fetchCodexUsage } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HubEvents } from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { HubCodexAuthService } from "../auth/hubCodexAuthService.js";
import type { HubConfigService } from "../config/hubConfigService.js";
import type {
  HubActiveSession,
  HubHeartbeatService,
} from "../lifecycle/hubHeartbeatService.js";
import type { HubOwnershipService } from "../lifecycle/hubOwnershipService.js";
import { createHubCostService } from "../observability/hubCostService.js";
import type { NaisysServer } from "../server/naisysServer.js";

vi.mock("@naisys/common-node", async () => {
  const actual = await vi.importActual<typeof CommonNode>(
    "@naisys/common-node",
  );
  return {
    ...actual,
    fetchCodexUsage: vi.fn(),
  };
});

type CostWriteAck = (response: unknown) => void;
type CostWriteHandler = (
  hostId: number,
  data: unknown,
  ack: CostWriteAck,
) => Promise<void>;

const CODEX_TEST_CHECK_MINUTES = 0.001;
const CODEX_TEST_CHECK_MS = CODEX_TEST_CHECK_MINUTES * 60_000;
const mockedFetchCodexUsage = vi.mocked(fetchCodexUsage);

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
      findMany: vi.fn(() => Promise.resolve([])),
    },
    models: {
      findMany: vi.fn(() => Promise.resolve([])),
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

function createOwnershipService(
  activeUserIds: number[],
  hostIdsByUser = new Map<number, number[]>([[1, [101]]]),
) {
  return {
    adminUserId: 0,
    getActiveUserIds: vi.fn(() => new Set(activeUserIds)),
    findHostsForAgent: vi.fn(
      (userId: number) => hostIdsByUser.get(userId) ?? [],
    ),
    hostOwnsUser: vi.fn(() => true),
  } as unknown as HubOwnershipService;
}

function createHeartbeatService(activeSessions: HubActiveSession[] = []) {
  return {
    getActiveSessions: vi.fn(() => activeSessions),
  } as unknown as HubHeartbeatService;
}

function createConfigService(config: {
  spendLimitDollars?: number;
  spendLimitHours?: number;
  codexUsageLimitPercent?: number;
  codexUsageCheckMinutes?: number;
}) {
  return {
    getConfig: vi.fn(() => ({ config })),
  } as unknown as HubConfigService;
}

function createCodexAuthService(accessToken?: string) {
  return {
    getAccessToken: vi.fn(() =>
      Promise.resolve(
        accessToken
          ? { accessToken, expiresAt: Date.now() + 60_000 }
          : undefined,
      ),
    ),
  } as unknown as HubCodexAuthService;
}

function llmModelRow(key: string, apiType: LlmApiType) {
  return {
    id: key.length,
    key,
    type: "llm",
    label: key,
    version_name: key,
    is_builtin: true,
    is_custom: false,
    meta: JSON.stringify({
      apiType,
      maxTokens: 1_000,
      apiKeyVar: "OPENAI_API_KEY",
    }),
  };
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
  afterEach(() => {
    mockedFetchCodexUsage.mockReset();
    vi.useRealTimers();
  });

  test("persists subagent cost entries, pushes scoped deltas, and decrements budget", async () => {
    const { server, emitCostWrite } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const ownershipService = createOwnershipService([]);
    const heartbeatService = createHeartbeatService([]);
    const configService = createConfigService({});
    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      ownershipService,
      heartbeatService,
      configService,
      createCodexAuthService(),
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
    const ownershipService = createOwnershipService([]);
    const heartbeatService = createHeartbeatService([]);
    const configService = createConfigService({});
    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      ownershipService,
      heartbeatService,
      configService,
      createCodexAuthService(),
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
    const ownershipService = createOwnershipService([1]);
    const heartbeatService = createHeartbeatService([]);
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
      ownershipService,
      heartbeatService,
      configService,
      createCodexAuthService(),
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

  test("suspends and resumes active Codex OAuth users based on account usage", async () => {
    vi.useFakeTimers();

    const { server } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const ownershipService = createOwnershipService(
      [],
      new Map([
        [1, [101]],
        [2, [202]],
      ]),
    );
    const heartbeatService = createHeartbeatService([
      { userId: 1, runId: 7, subagentId: null, sessionId: 1 },
      { userId: 1, runId: 7, subagentId: -1, sessionId: 1 },
      { userId: 2, runId: 8, subagentId: null, sessionId: 1 },
    ]);
    const configService = createConfigService({
      codexUsageLimitPercent: 80,
      codexUsageCheckMinutes: CODEX_TEST_CHECK_MINUTES,
    });
    const codexAuthService = createCodexAuthService("access-token");
    vi.mocked(hubDb.run_session.findMany as any).mockResolvedValue([
      { user_id: 1, model_name: "gpt-4.1" },
      { user_id: 1, model_name: "codex-oauth" },
      { user_id: 2, model_name: "gpt-4.1" },
    ]);
    vi.mocked(hubDb.models.findMany as any).mockResolvedValue([
      llmModelRow("gpt-4.1", LlmApiType.OpenAI),
      llmModelRow("codex-oauth", LlmApiType.OpenAIOAuth),
    ]);
    mockedFetchCodexUsage
      .mockResolvedValueOnce({
        checkedAt: Date.now(),
        limitReached: false,
        primaryWindow: { usedPercent: 81 },
      })
      .mockResolvedValueOnce({
        checkedAt: Date.now(),
        limitReached: false,
        primaryWindow: { usedPercent: 20 },
      });

    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      ownershipService,
      heartbeatService,
      configService,
      codexAuthService,
    );

    try {
      await vi.advanceTimersByTimeAsync(CODEX_TEST_CHECK_MS);

      expect(hubDb.run_session.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { user_id: 1, run_id: 7, subagent_id: 0, session_id: 1 },
            { user_id: 1, run_id: 7, subagent_id: -1, session_id: 1 },
            { user_id: 2, run_id: 8, subagent_id: 0, session_id: 1 },
          ],
        },
        select: { user_id: true, model_name: true },
      });
      expect(codexAuthService.getAccessToken).toHaveBeenCalledTimes(1);
      expect(mockedFetchCodexUsage).toHaveBeenCalledWith({
        accessToken: "access-token",
      });
      expect(server.sendMessage).toHaveBeenCalledWith(
        101,
        HubEvents.COST_CONTROL,
        {
          userId: 1,
          enabled: false,
          reason: "OpenAI Codex usage at/over 80% (primary: 81%)",
        },
      );
      expect(server.sendMessage).not.toHaveBeenCalledWith(
        202,
        HubEvents.COST_CONTROL,
        expect.anything(),
      );
      expect(service.isUserSpendSuspended(1)).toBe(true);
      expect(service.isUserSpendSuspended(2)).toBe(false);
      expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        data: {
          cost_suspended_reason:
            "OpenAI Codex usage at/over 80% (primary: 81%)",
        },
      });

      vi.mocked(server.sendMessage).mockClear();
      vi.mocked(hubDb.user_notifications.updateMany as any).mockClear();

      await vi.advanceTimersByTimeAsync(CODEX_TEST_CHECK_MS);

      expect(server.sendMessage).toHaveBeenCalledWith(
        101,
        HubEvents.COST_CONTROL,
        {
          userId: 1,
          enabled: true,
          reason: "OpenAI Codex usage back under limit (primary: 20%)",
        },
      );
      expect(service.isUserSpendSuspended(1)).toBe(false);
      expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        data: { cost_suspended_reason: null },
      });
    } finally {
      service.cleanup();
    }
  });

  test("restores the spend-limit suspension when Codex usage drops below limit", async () => {
    vi.useFakeTimers();

    const { server } = createServerHarness();
    const { hubDb } = createHubDb();
    const logger = createLogger();
    const ownershipService = createOwnershipService(
      [1],
      new Map([[1, [101]]]),
    );
    const heartbeatService = createHeartbeatService([
      { userId: 1, runId: 7, subagentId: null, sessionId: 1 },
    ]);
    const configService = createConfigService({
      codexUsageLimitPercent: 80,
      codexUsageCheckMinutes: CODEX_TEST_CHECK_MINUTES,
    });
    vi.mocked(hubDb.users.findMany as any).mockResolvedValue([
      userRow(1, { spendLimitDollars: 1 }),
    ]);
    vi.mocked(hubDb.costs.aggregate as any).mockResolvedValue({
      _sum: { cost: 1.25 },
    });
    vi.mocked(hubDb.run_session.findMany as any).mockResolvedValue([
      { user_id: 1, model_name: "codex-oauth" },
    ]);
    vi.mocked(hubDb.models.findMany as any).mockResolvedValue([
      llmModelRow("codex-oauth", LlmApiType.OpenAIOAuth),
    ]);
    mockedFetchCodexUsage
      .mockResolvedValueOnce({
        checkedAt: Date.now(),
        limitReached: false,
        primaryWindow: { usedPercent: 90 },
      })
      .mockResolvedValueOnce({
        checkedAt: Date.now(),
        limitReached: false,
        primaryWindow: { usedPercent: 20 },
      });

    const service = createHubCostService(
      server,
      { hubDb } as HubDatabaseService,
      logger,
      ownershipService,
      heartbeatService,
      configService,
      createCodexAuthService("access-token"),
    );

    try {
      await service.checkSpendLimits();

      const spendReason = "Spend limit of $1 reached (current: $1.25)";
      expect(server.sendMessage).toHaveBeenCalledWith(
        101,
        HubEvents.COST_CONTROL,
        {
          userId: 1,
          enabled: false,
          reason: spendReason,
        },
      );

      vi.mocked(server.sendMessage).mockClear();
      vi.mocked(hubDb.user_notifications.updateMany as any).mockClear();
      await vi.advanceTimersByTimeAsync(CODEX_TEST_CHECK_MS);

      const codexReason = "OpenAI Codex usage at/over 80% (primary: 90%)";
      expect(server.sendMessage).toHaveBeenCalledWith(
        101,
        HubEvents.COST_CONTROL,
        {
          userId: 1,
          enabled: false,
          reason: codexReason,
        },
      );
      expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        data: { cost_suspended_reason: codexReason },
      });

      vi.mocked(server.sendMessage).mockClear();
      vi.mocked(hubDb.user_notifications.updateMany as any).mockClear();
      await vi.advanceTimersByTimeAsync(CODEX_TEST_CHECK_MS);

      expect(server.sendMessage).toHaveBeenCalledWith(
        101,
        HubEvents.COST_CONTROL,
        {
          userId: 1,
          enabled: false,
          reason: spendReason,
        },
      );
      expect(service.isUserSpendSuspended(1)).toBe(true);
      expect(hubDb.user_notifications.updateMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        data: { cost_suspended_reason: spendReason },
      });
    } finally {
      service.cleanup();
    }
  });
});
