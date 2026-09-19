import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  createRetryNotifier,
  type RetryNotification,
} from "../../src/services/operations/retry-notifications.js";
import path from "node:path";
import { test, expect } from "../fixtures";
import { erpApiPath, expectJson } from "./helpers/erp-api-client";
import { addOperation, approveRevision } from "./helpers/master-data-fixtures";
import {
  createOrderWithRevision,
  createOrderRun,
} from "./helpers/order-fixtures";

test("deferred failures survive storage and cannot be redispatched/reopened early", async ({
  authedApi: api,
}) => {
  const key = `e2e-defer-${Date.now()}`;
  const { revision } = await createOrderWithRevision(api, { key });
  const op = await addOperation(api, key, revision.revNo, {
    title: "Synthetic quota operation",
  });
  await approveRevision(api, key, revision.revNo);
  const run = await createOrderRun(api, key, {
    revNo: revision.revNo,
    priority: "high",
  });
  const base = `/orders/${key}/runs/${run.runNo}/ops/${op.seqNo}`;
  await expectJson(await api.post(erpApiPath(`${base}/start`)), 200);
  const retryNotBefore = "2099-09-20T12:00:00Z";
  await expectJson(
    await api.post(erpApiPath(`${base}/fail`), {
      data: {
        note: "Synthetic quota; retry time is conservative",
        retryNotBefore,
      },
    }),
    200,
  );
  const item = await expectJson<{
    id: number;
    retryNotBefore: string;
    _actions: { rel: string; disabled?: boolean }[];
  }>(await api.get(erpApiPath(base)), 200);
  expect(item.retryNotBefore).toBe("2099-09-20T12:00:00.000Z");
  expect((await api.post(erpApiPath(`${base}/reopen`))).status()).toBe(409);
  for (const suffix of ["", "&canWork=true"]) {
    const dispatch = await expectJson<{ total: number }>(
      await api.get(erpApiPath(`/dispatch?search=${key}${suffix}`)),
      200,
    );
    expect(dispatch.total).toBe(0);
  }
  const deferred = await expectJson<{ items: { canWork: boolean }[] }>(
    await api.get(erpApiPath(`/dispatch?search=${key}&includeDeferred=true`)),
    200,
  );
  expect(deferred.items).toHaveLength(1);
  expect(deferred.items[0].canWork).toBe(false);
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: `file:${path.resolve(".test-naisys/database/naisys_erp.db")}`,
    }),
  });
  const notifications: RetryNotification[] = [];
  const notificationErrors: unknown[] = [];
  const notifier = createRetryNotifier(
    prisma,
    async (n) => {
      notifications.push(n);
    },
    (error) => notificationErrors.push(error),
  );
  await notifier.tick();
  expect(notifications.some((n) => n.body.includes(key))).toBe(false);
  // Advance only this synthetic fixture's stored retry time; no wall-clock sleeps.
  await prisma.operationRun.update({
    where: { id: item.id },
    data: { retryNotBefore: new Date(Date.now() - 1000) },
  });
  try {
    await notifier.tick();
    expect(notificationErrors).toEqual([]);
    expect(notifications.filter((n) => n.body.includes(key))).toHaveLength(1);
    const stored = await prisma.operationRun.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.status).toBe("failed"); // notification must not reopen it
    expect(stored.retryManagerId).toBe(stored.updatedById);
    expect(stored.retryWakeSentAt).not.toBeNull();
    const restarted = createRetryNotifier(
      prisma,
      async (n) => {
        notifications.push(n);
      },
      (error) => notificationErrors.push(error),
    );
    await restarted.tick();
    expect(notifications.filter((n) => n.body.includes(key))).toHaveLength(1);
  } finally {
    notifier.stop();
    await prisma.$disconnect();
  }
  const ready = await expectJson<{ total: number }>(
    await api.get(erpApiPath(`/dispatch?search=${key}&canWork=true`)),
    200,
  );
  expect(ready.total).toBe(1);
  await expectJson(await api.post(erpApiPath(`${base}/reopen`)), 200);
  const reopened = await expectJson<{ retryNotBefore: string | null }>(
    await api.get(erpApiPath(base)),
    200,
  );
  expect(reopened.retryNotBefore).toBeNull();
});
