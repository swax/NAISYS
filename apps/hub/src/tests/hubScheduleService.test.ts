import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { HubEvents } from "@naisys/hub-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { HubConfigService } from "../config/hubConfigService.js";
import type { HubAgentService } from "../lifecycle/hubAgentService.js";
import type { HubHeartbeatService } from "../lifecycle/hubHeartbeatService.js";
import { createHubScheduleService } from "../lifecycle/hubScheduleService.js";
import type { HubSendMailService } from "../mail/hubSendMailService.js";
import type { HubCostService } from "../observability/hubCostService.js";
import type { HubRedactionService } from "../observability/hubRedactionService.js";
import type { NaisysServer } from "../server/naisysServer.js";

const ADMIN_USER_ID = 1;
const AGENT_USER_ID = 42;
const HUB_TZ = "UTC";

type EventHandler = (...args: unknown[]) => void | Promise<void>;

function createServerHarness() {
  const handlers = new Map<string, EventHandler>();
  const server = {
    registerEvent: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    unregisterEvent: vi.fn(),
    broadcastToAll: vi.fn(),
    broadcastToSupervisors: vi.fn(),
    sendMessage: vi.fn(() => true),
    getConnectionByHostId: vi.fn(),
    getConnectedClients: vi.fn(() => []),
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

interface ChatRow {
  id: number;
  body: string;
  source: string | null;
  created_at: Date;
  recipient: {
    user_id: number;
    read_at: Date | null;
    archived_at: Date | null;
  };
}

interface UserRow {
  id: number;
  username: string;
  config: string;
  enabled: boolean;
  archived: boolean;
  next_run_at: Date | null;
}

function buildHarness(opts?: {
  users?: UserRow[];
  chats?: ChatRow[];
  spendSuspended?: Set<number>;
  runningAgents?: Set<number>;
}) {
  const users = opts?.users ?? [
    {
      id: ADMIN_USER_ID,
      username: "admin",
      config: "{}",
      enabled: true,
      archived: false,
      next_run_at: null,
    },
    {
      id: AGENT_USER_ID,
      username: "alice",
      config: JSON.stringify({
        schedules: [{ name: "morning", cron: "0 9 * * *", enabled: true }],
      }),
      enabled: true,
      archived: false,
      next_run_at: null,
    },
  ];
  const chats: ChatRow[] = opts?.chats ?? [];
  const spendSuspended = opts?.spendSuspended ?? new Set<number>();
  const runningAgents = opts?.runningAgents ?? new Set<number>();
  let nextChatId =
    chats.length > 0 ? Math.max(...chats.map((c) => c.id)) + 1 : 100;

  const hubDb = {
    users: {
      findUnique: vi.fn(
        ({
          where,
          select: _select,
        }: {
          where: { id?: number; username?: string };
          select?: unknown;
        }) => {
          const u = users.find(
            (u) =>
              (where.id !== undefined && u.id === where.id) ||
              (where.username !== undefined && u.username === where.username),
          );
          return Promise.resolve(u ?? null);
        },
      ),
      findMany: vi.fn(() => Promise.resolve(users)),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<UserRow>;
        }) => {
          const u = users.find((u) => u.id === where.id);
          if (u) Object.assign(u, data);
          return Promise.resolve(u);
        },
      ),
    },
    mail_messages: {
      findFirst: vi.fn(
        ({
          where,
        }: {
          where: {
            source?: string;
            created_at?: { gte: Date };
            recipients?: { some?: { user_id?: number } };
          };
        }) => {
          const matches = chats.filter((c) => {
            if (where.source && c.source !== where.source) return false;
            if (where.created_at && c.created_at < where.created_at.gte)
              return false;
            const userId = where.recipients?.some?.user_id;
            if (userId !== undefined && c.recipient.user_id !== userId)
              return false;
            return true;
          });
          // The real query orders by id desc.
          matches.sort((a, b) => b.id - a.id);
          const m = matches[0];
          return Promise.resolve(
            m
              ? {
                  id: m.id,
                  body: m.body,
                  recipients: [
                    {
                      read_at: m.recipient.read_at,
                      archived_at: m.recipient.archived_at,
                    },
                  ],
                }
              : null,
          );
        },
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: { body?: string; created_at?: Date };
        }) => {
          const c = chats.find((c) => c.id === where.id);
          if (c) Object.assign(c, data);
          return Promise.resolve(c);
        },
      ),
    },
  } as unknown as PrismaClient;

  const sendMailService = {
    sendMail: vi.fn(
      (params: {
        recipientUserIds: number[];
        body: string;
        source?: string;
      }) => {
        const row: ChatRow = {
          id: nextChatId++,
          body: params.body,
          source: params.source ?? null,
          created_at: new Date(),
          recipient: {
            user_id: params.recipientUserIds[0],
            read_at: null,
            archived_at: null,
          },
        };
        chats.push(row);
        return Promise.resolve(undefined);
      },
    ),
  } as unknown as HubSendMailService;

  const agentService = {
    tryStartAgent: vi.fn(() => Promise.resolve(true)),
  } as unknown as HubAgentService;

  const heartbeatService = {
    findHostsForAgent: vi.fn((userId: number) =>
      runningAgents.has(userId) ? [1] : [],
    ),
    getActiveUserIds: vi.fn(() => runningAgents),
  } as unknown as HubHeartbeatService;

  const costService = {
    checkSpendLimits: vi.fn(() => Promise.resolve()),
    isUserSpendSuspended: vi.fn((userId: number) => spendSuspended.has(userId)),
  } as unknown as HubCostService;

  const configService = {
    getConfig: () => ({ success: true, config: { hubTimezone: HUB_TZ } }),
  } as unknown as HubConfigService;

  const redactionService = {
    redact: vi.fn((s: string) => s),
  } as unknown as HubRedactionService;

  const { server, handlers } = createServerHarness();
  const logger = createLogger();

  const service = createHubScheduleService(
    server,
    { hubDb } as HubDatabaseService,
    logger,
    sendMailService,
    agentService,
    heartbeatService,
    costService,
    configService,
    redactionService,
  );

  return {
    service,
    server,
    handlers,
    hubDb,
    sendMailService,
    agentService,
    heartbeatService,
    costService,
    chats,
    users,
    logger,
  };
}

describe("hubScheduleService.triggerNow (manual fire)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("sends a chat and starts the agent when no pending chat exists", async () => {
    const h = buildHarness();
    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    expect(h.sendMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: [AGENT_USER_ID],
        source: "schedule:morning",
        kind: "chat",
      }),
    );
    expect(h.agentService.tryStartAgent).toHaveBeenCalledWith(
      AGENT_USER_ID,
      "schedule:morning",
    );
  });

  test("dedupes against an already-pending chat with the same body", async () => {
    // Simulate a previously-fired-but-unread chat.
    const existingBody = "[schedule: morning]";
    const h = buildHarness({
      chats: [
        {
          id: 5,
          body: existingBody,
          source: "schedule:morning",
          created_at: new Date("2026-05-18T08:00:00Z"),
          recipient: {
            user_id: AGENT_USER_ID,
            read_at: null,
            archived_at: null,
          },
        },
      ],
    });

    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    expect(result.reason).toContain("already pending");
    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();
    // Start still attempts so a queued chat doesn't sit forever.
    expect(h.agentService.tryStartAgent).toHaveBeenCalled();
  });

  test("updates the existing pending chat when body differs (no resend)", async () => {
    // Body differs because the schedule prompt was edited since the original fire.
    const h = buildHarness({
      users: [
        {
          id: ADMIN_USER_ID,
          username: "admin",
          config: "{}",
          enabled: true,
          archived: false,
          next_run_at: null,
        },
        {
          id: AGENT_USER_ID,
          username: "alice",
          config: JSON.stringify({
            schedules: [
              {
                name: "morning",
                cron: "0 9 * * *",
                enabled: true,
                prompt: "new prompt text",
              },
            ],
          }),
          enabled: true,
          archived: false,
          next_run_at: null,
        },
      ],
      chats: [
        {
          id: 5,
          body: "[schedule: morning] old prompt text",
          source: "schedule:morning",
          created_at: new Date("2026-05-18T08:00:00Z"),
          recipient: {
            user_id: AGENT_USER_ID,
            read_at: null,
            archived_at: null,
          },
        },
      ],
    });

    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    expect(result.reason).toContain("updated pending chat");
    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();
    expect(h.hubDb.mail_messages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          body: "[schedule: morning] new prompt text",
        }),
      }),
    );
  });

  test("manual fire ignores read state and still dispatches", async () => {
    // A READ chat from a past fire would block the cron path; the manual
    // path should fire anyway since the user explicitly clicked trigger.
    const h = buildHarness({
      chats: [
        {
          id: 5,
          body: "[schedule: morning]",
          source: "schedule:morning",
          created_at: new Date("2026-05-18T08:00:00Z"),
          recipient: {
            user_id: AGENT_USER_ID,
            // already read — cron path would short-circuit; manual must not
            read_at: new Date("2026-05-18T08:05:00Z"),
            archived_at: null,
          },
        },
      ],
    });

    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    // Body matches → no resend. But the start path runs.
    expect(h.agentService.tryStartAgent).toHaveBeenCalled();
  });

  test("returns running status without starting when agent is up", async () => {
    const h = buildHarness({
      runningAgents: new Set([AGENT_USER_ID]),
    });

    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    expect(result.reason).toContain("agent running");
    expect(h.agentService.tryStartAgent).not.toHaveBeenCalled();
  });

  test("defers (delivers chat, does not start) when cost-suspended", async () => {
    const h = buildHarness({
      spendSuspended: new Set([AGENT_USER_ID]),
    });

    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");

    expect(result.ok).toBe(true);
    expect(result.reason).toContain("cost-suspended");
    expect(h.sendMailService.sendMail).toHaveBeenCalled();
    expect(h.agentService.tryStartAgent).not.toHaveBeenCalled();
  });

  test("rejects disabled or unknown schedules", async () => {
    const h = buildHarness();
    const missing = await h.service.triggerNow(AGENT_USER_ID, "nonexistent");
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain("not found");
    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();
  });

  test("rejects on disabled agent", async () => {
    const h = buildHarness({
      users: [
        {
          id: ADMIN_USER_ID,
          username: "admin",
          config: "{}",
          enabled: true,
          archived: false,
          next_run_at: null,
        },
        {
          id: AGENT_USER_ID,
          username: "alice",
          config: JSON.stringify({
            schedules: [{ name: "morning", cron: "0 9 * * *" }],
          }),
          enabled: false,
          archived: false,
          next_run_at: null,
        },
      ],
    });
    const result = await h.service.triggerNow(AGENT_USER_ID, "morning");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("disabled");
    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();
  });
});

describe("hubScheduleService cron path (sweepAll on start)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("fires within-window schedules on startup sweep", async () => {
    // Set time to 09:00:30 — the 09:00 daily fire was 30s ago (within 60s window).
    vi.setSystemTime(new Date("2026-05-18T09:00:30Z"));

    const h = buildHarness();
    h.service.start();
    // Let the IIFE-wrapped sweep complete and flush microtasks.
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(h.sendMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ source: "schedule:morning" }),
    );

    h.service.cleanup();
  });

  test("skips re-firing when the occurrence's chat was already read", async () => {
    // 09:00:30 — would fire if not for the already-read chat from this occurrence.
    vi.setSystemTime(new Date("2026-05-18T09:00:30Z"));

    const h = buildHarness({
      chats: [
        {
          id: 5,
          body: "[schedule: morning]",
          source: "schedule:morning",
          // Chat sent at exact occurrence and already read — restart-within-window
          // sweep must not relaunch this.
          created_at: new Date("2026-05-18T09:00:00Z"),
          recipient: {
            user_id: AGENT_USER_ID,
            read_at: new Date("2026-05-18T09:00:10Z"),
            archived_at: null,
          },
        },
      ],
    });
    h.service.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();
    expect(h.agentService.tryStartAgent).not.toHaveBeenCalled();

    h.service.cleanup();
  });

  test("does not fire when no schedule is due in the window", async () => {
    // 09:02 — last fire was 2 minutes ago, outside 60s window. Skip.
    vi.setSystemTime(new Date("2026-05-18T09:02:00Z"));

    const h = buildHarness();
    h.service.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(h.sendMailService.sendMail).not.toHaveBeenCalled();

    h.service.cleanup();
  });

  test("advances next_run_at for users with schedules removed", async () => {
    vi.setSystemTime(new Date("2026-05-18T09:02:00Z"));

    const h = buildHarness({
      users: [
        {
          id: ADMIN_USER_ID,
          username: "admin",
          config: "{}",
          enabled: true,
          archived: false,
          next_run_at: null,
        },
        {
          id: AGENT_USER_ID,
          username: "alice",
          // Schedules were removed since next_run_at was last set
          config: "{}",
          enabled: true,
          archived: false,
          next_run_at: new Date("2026-05-18T09:00:00Z"),
        },
      ],
    });
    h.service.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    // Should clear next_run_at so the scheduler tick stops polling this user.
    expect(h.hubDb.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: AGENT_USER_ID },
        data: { next_run_at: null },
      }),
    );

    h.service.cleanup();
  });
});

describe("hubScheduleService SCHEDULE_TRIGGER event", () => {
  test("registers a SCHEDULE_TRIGGER handler that maps to triggerNow", async () => {
    const h = buildHarness();
    const handler = h.handlers.get(HubEvents.SCHEDULE_TRIGGER);
    expect(handler).toBeDefined();

    const ack = vi.fn();
    await handler!(99, { userId: AGENT_USER_ID, scheduleName: "morning" }, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(h.sendMailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ source: "schedule:morning" }),
    );
  });

  test("acks with ok:false on validation error", async () => {
    const h = buildHarness();
    const handler = h.handlers.get(HubEvents.SCHEDULE_TRIGGER);

    const ack = vi.fn();
    // Missing scheduleName — should fail validation.
    await handler!(99, { userId: AGENT_USER_ID }, ack);

    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
});
