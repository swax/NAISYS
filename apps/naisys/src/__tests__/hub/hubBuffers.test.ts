import type { CostWriteEntry, LogWriteEntry } from "@naisys/hub-protocol";
import {
  COST_FLUSH_INTERVAL_MS,
  HubEvents,
  LOG_FLUSH_INTERVAL_MS,
} from "@naisys/hub-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { HubClient } from "../../hub/hubClient.js";
import { createHubCostBuffer } from "../../hub/hubCostBuffer.js";
import { createHubLogBuffer } from "../../hub/hubLogBuffer.js";

function createHubClient(connected: boolean) {
  return {
    isConnected: vi.fn(() => connected),
    sendMessage: vi.fn(() => connected),
    sendRequest: vi.fn(() => Promise.resolve({ budgets: [] })),
  } as unknown as HubClient;
}

function costEntry(): CostWriteEntry {
  return {
    userId: 1,
    runId: 2,
    sessionId: 3,
    source: "console",
    model: "test-model",
    cost: 0.01,
    inputTokens: 1,
    outputTokens: 2,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
}

function logEntry(): LogWriteEntry {
  return {
    userId: 1,
    runId: 2,
    sessionId: 3,
    role: "NAISYS",
    source: "console",
    type: "comment",
    message: "test",
    createdAt: new Date(0).toISOString(),
  };
}

describe("hub buffers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("log buffer flushes entries on its interval", async () => {
    const hubClient = createHubClient(true);
    const buffer = createHubLogBuffer(hubClient);
    const resolveAttachment = vi.fn(() => Promise.resolve(99));

    buffer.pushEntry(logEntry(), resolveAttachment);
    await vi.advanceTimersByTimeAsync(LOG_FLUSH_INTERVAL_MS);

    expect(resolveAttachment).toHaveBeenCalledOnce();
    expect(hubClient.sendMessage).toHaveBeenCalledWith(HubEvents.LOG_WRITE, {
      entries: [{ ...logEntry(), attachmentId: 99 }],
    });
  });

  test("cost buffer flushes entries on its interval", async () => {
    const hubClient = createHubClient(true);
    vi.mocked(hubClient.sendRequest).mockResolvedValue({
      budgets: [{ userId: 1, budgetLeft: 12.34 }],
    });
    const buffer = createHubCostBuffer(hubClient);
    const budgetCallback = vi.fn();

    buffer.registerBudgetCallback(1, budgetCallback);
    buffer.pushEntry(costEntry());
    await vi.advanceTimersByTimeAsync(COST_FLUSH_INTERVAL_MS);

    expect(hubClient.sendRequest).toHaveBeenCalledWith(HubEvents.COST_WRITE, {
      entries: [costEntry()],
    });
    expect(budgetCallback).toHaveBeenCalledWith(12.34);
  });

  test("log flushFinal drains pending entries", async () => {
    const hubClient = createHubClient(true);
    const buffer = createHubLogBuffer(hubClient);
    const resolveAttachment = vi.fn(() => Promise.resolve(99));

    buffer.pushEntry(logEntry(), resolveAttachment);
    await buffer.flushFinal();

    expect(resolveAttachment).toHaveBeenCalledOnce();
    expect(hubClient.sendMessage).toHaveBeenCalledWith(HubEvents.LOG_WRITE, {
      entries: [{ ...logEntry(), attachmentId: 99 }],
    });
  });

  test("cost flushFinal drains pending entries", async () => {
    const hubClient = createHubClient(true);
    vi.mocked(hubClient.sendRequest).mockResolvedValue({
      budgets: [{ userId: 1, budgetLeft: 12.34 }],
    });
    const buffer = createHubCostBuffer(hubClient);
    const budgetCallback = vi.fn();

    buffer.registerBudgetCallback(1, budgetCallback);
    buffer.pushEntry(costEntry());
    await buffer.flushFinal();

    expect(hubClient.sendRequest).toHaveBeenCalledWith(HubEvents.COST_WRITE, {
      entries: [costEntry()],
    });
    expect(budgetCallback).toHaveBeenCalledWith(12.34);
  });

  test("flushFinal on empty buffers is a no-op", async () => {
    const hubClient = createHubClient(true);
    const logBuffer = createHubLogBuffer(hubClient);
    const costBuffer = createHubCostBuffer(hubClient);

    await Promise.all([logBuffer.flushFinal(), costBuffer.flushFinal()]);

    expect(hubClient.sendMessage).not.toHaveBeenCalled();
    expect(hubClient.sendRequest).not.toHaveBeenCalled();
  });
});
