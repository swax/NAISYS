import { type APIRequestContext } from "@playwright/test";

import { test, expect } from "../fixtures";
import {
  erpApiPath,
  expectActions,
  expectConflict,
  expectJson,
  expectLinks,
} from "./helpers/erp-api-client";
import {
  createOrder,
  createRevision,
  expectAuditEntry,
} from "./helpers/order-fixtures";

test.describe("Order Revisions - API happy path", () => {
  let orderKey: string;
  let revisionId: number;
  let api: APIRequestContext;

  test.beforeAll(async ({ authedApi }) => {
    api = authedApi;
  });

  test("create an order", async () => {
    const order = await createOrder(api, {
      key: `e2e-rev-test-${Date.now()}`,
      description: "Order created for revision e2e testing",
    });
    expect(order.id).toBeDefined();
    expectLinks(order, ["revisions"]);
    orderKey = order.key;
  });

  test("list revisions (empty)", async () => {
    const res = await api.get(erpApiPath(`/orders/${orderKey}/revs`));
    const body = await expectJson<{ items: unknown[]; total: number }>(
      res,
      200,
    );
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("create first revision", async () => {
    const body = await createRevision(api, orderKey, {
      description: "Initial draft",
      changeSummary: "First version of the order",
    });
    expect(body.revNo).toBe(1);
    expectActions(body, ["approve", "update", "delete"]);
    revisionId = body.id;
  });

  test("update draft revision", async () => {
    const res = await api.put(erpApiPath(`/orders/${orderKey}/revs/1`), {
      data: {
        description: "Updated draft description",
        changeSummary: "Updated summary",
      },
    });
    const body = await expectJson<{ _actions: unknown }>(res, 200);
    expect(body._actions).toBeDefined();
  });

  test("approve the revision", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/revs/1/approve`),
    );
    const body = await expectJson<{
      status: string;
      _actions: { rel: string; disabled?: boolean }[];
    }>(res, 200);
    expect(body.status).toBe("approved");

    await expectAuditEntry(api, {
      entityType: "OrderRevision",
      entityId: revisionId,
      action: "approve",
      field: "status",
      oldValue: "draft",
      newValue: "approved",
    });

    expectActions(body, ["obsolete", "cut-order"]);
    // Update should be disabled (not removed) after approval
    const updateAction = body._actions.find((a) => a.rel === "update");
    expect(updateAction?.disabled).toBe(true);
  });

  test("cannot update approved revision (409)", async () => {
    const res = await api.put(erpApiPath(`/orders/${orderKey}/revs/1`), {
      data: { description: "should fail" },
    });
    await expectConflict(res);
  });

  test("cannot delete approved revision (409)", async () => {
    const res = await api.delete(erpApiPath(`/orders/${orderKey}/revs/1`));
    await expectConflict(res);
  });

  test("mark approved revision as obsolete", async () => {
    const res = await api.post(
      erpApiPath(`/orders/${orderKey}/revs/1/obsolete`),
    );
    const body = await expectJson<{
      status: string;
      _actions: unknown[];
    }>(res, 200);
    expect(body.status).toBe("obsolete");
    // obsolete should have no actions
    expect(body._actions).toHaveLength(0);
  });

  test("create second revision (auto-increments revNo)", async () => {
    const body = await createRevision(api, orderKey, {
      description: "Second revision",
      changeSummary: "Improvements based on feedback",
    });
    expect(body.revNo).toBe(2);
  });

  test("list revisions shows both (ordered by revNo desc)", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/revs?includeObsolete=true`),
    );
    const body = await expectJson<{
      total: number;
      items: { revNo: number }[];
    }>(res, 200);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Ordered by revNo desc
    expect(body.items[0].revNo).toBe(2);
    expect(body.items[1].revNo).toBe(1);
  });

  test("filter revisions by status", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/revs?status=draft`),
    );
    const body = await expectJson<{
      total: number;
      items: { status: string }[];
    }>(res, 200);
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe("draft");
  });

  test("get single revision by revNo", async () => {
    const res = await api.get(erpApiPath(`/orders/${orderKey}/revs/1`));
    const body = await expectJson<{
      id: number;
      status: string;
      _links: { rel: string }[];
    }>(res, 200);
    expect(body.id).toBe(revisionId);
    expect(body.status).toBe("obsolete");
    expectLinks(body, ["self", "collection", "parent"]);
  });

  test("delete draft revision succeeds", async () => {
    const res = await api.delete(erpApiPath(`/orders/${orderKey}/revs/2`));
    expect(res.status()).toBe(204);

    // Verify only 1 revision left (the obsolete one)
    const afterRes = await api.get(
      erpApiPath(`/orders/${orderKey}/revs?includeObsolete=true`),
    );
    const after = await expectJson<{ total: number }>(afterRes, 200);
    expect(after.total).toBe(1);
  });

  test("cannot delete order with revisions (409)", async () => {
    // There's still 1 obsolete revision, so delete should be blocked
    const res = await api.delete(erpApiPath(`/orders/${orderKey}`));
    await expectConflict(res, "existing revisions");
  });
});
