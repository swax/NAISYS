/**
 * Order Runs API happy path E2E.
 *
 *  1. Create a parent order + initial revision via the API helpers.
 *  2. Create the first order run against that revision; assert runNo=1
 *     and the released-state actions/links.
 *  3. List and fetch runs by runNo; assert collection metadata and the
 *     released status.
 *  4. Update the released run (priority + release note); assert actions
 *     are still returned.
 *  5. Start the run (released → started); assert the audit trail entry
 *     and the started-state action set (no start/delete).
 *  6. Try to delete a started run; assert 409 conflict.
 *  7. Close the run (started → closed); assert the audit entry and that
 *     only the reopen action remains.
 *  8. Try to start and cancel the closed run; assert 409 on both.
 *  9. Create a second run, then cancel it; assert cancelled status and
 *     reopen-only actions.
 * 10. Filter runs by status and priority; assert each item matches.
 * 11. Try to delete the order while revisions exist; assert 409.
 * 12. Create a fresh draft revision with an order run, then try to
 *     delete the draft; assert 409 (blocked by existing order runs).
 */

import { type APIRequestContext } from "@playwright/test";

import { test, expect } from "../fixtures";
import {
  erpApiPath,
  expectActions,
  expectConflict,
  expectJson,
  expectLinks,
  expectNoActions,
} from "./helpers/erp-api-client";
import {
  createOrderWithRevision,
  createOrderRun,
  expectAuditEntry,
} from "./helpers/order-fixtures";

test.describe("Order Runs - API happy path", () => {
  let orderKey: string;
  let revNo: number;
  let orderRunNo: number;
  let orderRunDbId: number; // database ID for audit queries
  let orderRunNo2: number;
  let api: APIRequestContext;

  test.beforeAll(async ({ authedApi }) => {
    api = authedApi;
  });

  test("create an order + revision for testing", async () => {
    const setup = await createOrderWithRevision(
      api,
      {
        key: `e2e-run-test-${Date.now()}`,
        description: "Order for order run e2e testing",
      },
      { description: "Test revision", changeSummary: "Initial" },
    );
    orderKey = setup.order.key;
    revNo = setup.revision.revNo;
  });

  test("create order run", async () => {
    const body = await createOrderRun(api, orderKey, {
      revNo,
      priority: "high",
      dueAt: "2099-12-31",
      releaseNote: "First order run",
    });
    expect(body.runNo).toBe(1);
    expectActions(body, ["start", "cancel", "update", "delete"]);
    expectLinks(body, ["order"]);
    orderRunNo = body.runNo;
    orderRunDbId = body.id;
  });

  test("list order runs", async () => {
    const res = await api.get(erpApiPath(`/orders/${orderKey}/runs`));
    const body = await expectJson<{ total: number; items: unknown[] }>(
      res,
      200,
    );
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  test("get order run by runNo", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}`),
    );
    const body = await expectJson<{
      runNo: number;
      status: string;
      _links: { rel: string }[];
    }>(res, 200);
    expect(body.runNo).toBe(orderRunNo);
    expect(body.status).toBe("released");
    expectLinks(body, ["self", "collection"]);
  });

  test("update released order run", async () => {
    const res = await api.put(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}`),
      {
        data: {
          priority: "critical",
          releaseNote: "Updated release note",
        },
      },
    );
    const body = await expectJson<{ _actions: unknown }>(res, 200);
    expect(body._actions).toBeDefined();
  });

  test("start order run (released → started)", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}/start`),
    );
    const body = await expectJson<{
      status: string;
      _actions: { rel: string }[];
    }>(res, 200);
    expect(body.status).toBe("started");

    await expectAuditEntry(api, {
      entityType: "OrderRun",
      entityId: orderRunDbId,
      action: "start",
      field: "status",
      oldValue: "released",
      newValue: "started",
    });

    expectActions(body, ["close", "cancel", "update"]);
    expectNoActions(body, ["start", "delete"]);
  });

  test("cannot delete started order run (409)", async () => {
    const res = await api.delete(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}`),
    );
    await expectConflict(res);
  });

  test("close order run (started → closed)", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}/close`),
    );
    const body = await expectJson<{
      status: string;
      _actions: { rel: string }[];
    }>(res, 200);
    expect(body.status).toBe("closed");

    await expectAuditEntry(api, {
      entityType: "OrderRun",
      entityId: orderRunDbId,
      action: "close",
      field: "status",
      oldValue: "started",
      newValue: "closed",
    });

    // closed: only reopen action
    expect(body._actions).toEqual([expect.objectContaining({ rel: "reopen" })]);
  });

  test("cannot start closed order run (409)", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}/start`),
    );
    await expectConflict(res);
  });

  test("cannot cancel closed order run (409)", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo}/cancel`),
    );
    await expectConflict(res);
  });

  test("create and cancel an order run", async () => {
    const created = await createOrderRun(api, orderKey, {
      revNo,
      priority: "low",
      dueAt: "2099-12-31",
    });
    expect(created.runNo).toBe(2);
    orderRunNo2 = created.runNo;

    const cancelRes = await api.post(
      erpApiPath(`/orders/${orderKey}/runs/${orderRunNo2}/cancel`),
    );
    const body = await expectJson<{
      status: string;
      _actions: { rel: string }[];
    }>(cancelRes, 200);
    expect(body.status).toBe("cancelled");
    // cancelled: only reopen action
    expect(body._actions).toEqual([expect.objectContaining({ rel: "reopen" })]);
  });

  test("filter by status", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs?status=closed`),
    );
    const body = await expectJson<{ items: { status: string }[] }>(res, 200);
    for (const item of body.items) {
      expect(item.status).toBe("closed");
    }
  });

  test("filter by priority", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs?priority=critical`),
    );
    const body = await expectJson<{ items: { priority: string }[] }>(res, 200);
    for (const item of body.items) {
      expect(item.priority).toBe("critical");
    }
  });

  test("cannot delete order with revisions (409)", async () => {
    const res = await api.delete(erpApiPath(`/orders/${orderKey}`));
    await expectConflict(res, "existing revisions");
  });

  test("cannot delete draft revision with order runs (409)", async () => {
    // Create a new draft revision, then create an order run against it
    const revRes = await api.post(erpApiPath(`/orders/${orderKey}/revs`), {
      data: { description: "Draft with order runs" },
    });
    const rev = await expectJson<{ revNo: number }>(revRes, 201);

    await createOrderRun(api, orderKey, {
      revNo: rev.revNo,
      priority: "low",
      dueAt: "2099-12-31",
    });

    // Try to delete the draft revision — should be blocked by order runs
    const delRes = await api.delete(
      erpApiPath(`/orders/${orderKey}/revs/${rev.revNo}`),
    );
    await expectConflict(delRes, "existing order runs");
  });
});
