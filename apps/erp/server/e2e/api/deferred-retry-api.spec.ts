import Database from "better-sqlite3";
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
  // Advance only this synthetic fixture's stored retry time; no wall-clock sleeps.
  const db = new Database(path.resolve(".test-naisys/database/naisys_erp.db"));
  db.prepare("UPDATE operation_runs SET retry_not_before = ? WHERE id = ?").run(
    Date.now() - 1000,
    item.id,
  );
  db.close();
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
