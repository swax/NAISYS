import { describe, expect, test, vi } from "vitest";

import type { PrismaClient } from "../generated/prisma/client.js";
import { createRetryNotifier } from "../services/operations/retry-notifications.js";

function setup() {
  const now = new Date("2026-09-20T08:00:00Z");
  const row = {
    id: 80,
    retryNotBefore: now,
    updatedAt: new Date("2026-09-19T07:58:00Z"),
    statusNote: "Quota exhausted",
    retryManager: { id: 7, uuid: "manager-uuid" },
    orderRun: { runNo: 80, order: { key: "NEW-SKETCH" } },
    operation: { seqNo: 60, title: "Index" },
  };
  const operationRun = {
    findMany: vi.fn().mockResolvedValue([row]),
    findFirst: vi.fn().mockResolvedValue({ id: 80 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const db = { operationRun } as unknown as PrismaClient;
  const deliver = vi.fn().mockResolvedValue(undefined);
  const error = vi.fn();
  return {
    now,
    row,
    db,
    operationRun,
    deliver,
    error,
    notifier: createRetryNotifier(db, deliver, error),
  };
}

describe("durable retry notifications", () => {
  test("queries only due, unsent failures on active orders and notifies the original manager", async () => {
    const h = setup();
    await h.notifier.tick(h.now);
    expect(h.operationRun.findMany.mock.calls[0][0].where).toEqual({
      status: "failed",
      retryNotBefore: { lte: h.now },
      retryWakeSentAt: null,
      retryManager: { deletedAt: null },
      orderRun: { status: "started" },
    });
    expect(h.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        managerUuid: "manager-uuid",
        body: expect.stringContaining("explicitly reopen"),
      }),
    );
    expect(h.operationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { retryWakeSentAt: h.now, updatedAt: h.row.updatedAt },
      }),
    );
  });
  test("does not mark delivery on failure, and reuses the key after restart or lost acknowledgement", async () => {
    const h = setup();
    h.deliver.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await h.notifier.tick(h.now);
    expect(h.operationRun.updateMany).not.toHaveBeenCalled();
    const first = h.deliver.mock.calls[0][0];
    const restarted = createRetryNotifier(h.db, h.deliver, h.error);
    await restarted.tick(new Date(h.now.getTime() + 30_000));
    expect(h.deliver.mock.calls[1][0]).toEqual(first);
    expect(h.operationRun.updateMany).toHaveBeenCalledTimes(1);
  });
  test("suppresses notification if the operation was reopened/cancelled after the poll", async () => {
    const h = setup();
    h.operationRun.findFirst.mockResolvedValue(null);
    await h.notifier.tick(h.now);
    expect(h.deliver).not.toHaveBeenCalled();
  });
  test("does not overlap slow ticks or run after shutdown", async () => {
    const h = setup();
    let resolve!: () => void;
    h.deliver.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = h.notifier.tick(h.now);
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(1));
    await h.notifier.tick(h.now);
    expect(h.operationRun.findMany).toHaveBeenCalledTimes(1);
    resolve();
    await pending;
    h.notifier.stop();
    await h.notifier.tick(h.now);
    expect(h.operationRun.findMany).toHaveBeenCalledTimes(1);
  });
});
