import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsTestUser } from "../auth-helper";

const API = "http://localhost:3201/erp/api";

test.describe("Order Runs - API happy path", () => {
  let orderKey: string;
  let revNo: number;
  let orderRunNo: number;
  let orderRunDbId: number; // database ID for audit queries
  let orderRunNo2: number;
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    await loginAsTestUser(api, test.info().workerIndex);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("create an order + revision for testing", async () => {
    orderKey = `e2e-run-test-${Date.now()}`;

    // Create planning order
    const orderRes = await api.post(`${API}/orders`, {
      data: {
        key: orderKey,
        description: "Order for order run e2e testing",
      },
    });
    expect(orderRes.status()).toBe(201);

    // Create revision
    const revRes = await api.post(`${API}/orders/${orderKey}/revs`, {
      data: {
        description: "Test revision",
        changeSummary: "Initial",
      },
    });
    expect(revRes.status()).toBe(201);
    const rev = await revRes.json();
    revNo = rev.revNo;
  });

  test("create order run", async () => {
    const res = await api.post(`${API}/orders/${orderKey}/runs`, {
      data: {
        revNo,
        priority: "high",
        dueAt: "2099-12-31",
        releaseNote: "First order run",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.runNo).toBe(1);
    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "start" }),
        expect.objectContaining({ rel: "cancel" }),
        expect.objectContaining({ rel: "update" }),
        expect.objectContaining({ rel: "delete" }),
      ]),
    );
    expect(body._links).toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: "order" })]),
    );
    orderRunNo = body.runNo;
    orderRunDbId = body.id;
  });

  test("list order runs", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/runs`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  test("get order run by runNo", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/runs/${orderRunNo}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.runNo).toBe(orderRunNo);
    expect(body.status).toBe("released");
    expect(body._links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "self" }),
        expect.objectContaining({ rel: "collection" }),
      ]),
    );
  });

  test("update released order run", async () => {
    const res = await api.put(`${API}/orders/${orderKey}/runs/${orderRunNo}`, {
      data: {
        priority: "critical",
        releaseNote: "Updated release note",
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body._actions).toBeDefined();
  });

  test("start order run (released → started)", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/runs/${orderRunNo}/start`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("started");

    // Verify audit entry was created
    const auditRes = await api.get(
      `${API}/audit?entityType=OrderRun&entityId=${orderRunDbId}`,
    );
    const audit = await auditRes.json();
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "start",
          field: "status",
          oldValue: "released",
          newValue: "started",
        }),
      ]),
    );

    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "close" }),
        expect.objectContaining({ rel: "cancel" }),
        expect.objectContaining({ rel: "update" }),
      ]),
    );
    // Should NOT have start or delete actions
    expect(body._actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: "start" })]),
    );
    expect(body._actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: "delete" })]),
    );
  });

  test("cannot delete started order run (409)", async () => {
    const res = await api.delete(
      `${API}/orders/${orderKey}/runs/${orderRunNo}`,
    );
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("close order run (started → closed)", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/runs/${orderRunNo}/close`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("closed");

    // Verify audit entry was created
    const auditRes = await api.get(
      `${API}/audit?entityType=OrderRun&entityId=${orderRunDbId}`,
    );
    const audit = await auditRes.json();
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "close",
          field: "status",
          oldValue: "started",
          newValue: "closed",
        }),
      ]),
    );

    // closed: only reopen action
    expect(body._actions).toEqual([expect.objectContaining({ rel: "reopen" })]);
  });

  test("cannot start closed order run (409)", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/runs/${orderRunNo}/start`,
    );
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("cannot cancel closed order run (409)", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/runs/${orderRunNo}/cancel`,
    );
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("create and cancel an order run", async () => {
    // Create second order run
    const createRes = await api.post(`${API}/orders/${orderKey}/runs`, {
      data: {
        revNo,
        priority: "low",
        dueAt: "2099-12-31",
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.runNo).toBe(2);
    orderRunNo2 = created.runNo;

    // Cancel it
    const cancelRes = await api.post(
      `${API}/orders/${orderKey}/runs/${orderRunNo2}/cancel`,
    );
    expect(cancelRes.status()).toBe(200);

    const body = await cancelRes.json();
    expect(body.status).toBe("cancelled");
    // cancelled: only reopen action
    expect(body._actions).toEqual([expect.objectContaining({ rel: "reopen" })]);
  });

  test("filter by status", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/runs?status=closed`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    for (const item of body.items) {
      expect(item.status).toBe("closed");
    }
  });

  test("filter by priority", async () => {
    const res = await api.get(
      `${API}/orders/${orderKey}/runs?priority=critical`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    for (const item of body.items) {
      expect(item.priority).toBe("critical");
    }
  });

  test("cannot delete order with revisions (409)", async () => {
    const res = await api.delete(`${API}/orders/${orderKey}`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toContain("existing revisions");
  });

  test("cannot delete draft revision with order runs (409)", async () => {
    // Create a new draft revision, then create an order run against it
    const revRes = await api.post(`${API}/orders/${orderKey}/revs`, {
      data: { description: "Draft with order runs" },
    });
    expect(revRes.status()).toBe(201);
    const rev = await revRes.json();

    const runRes = await api.post(`${API}/orders/${orderKey}/runs`, {
      data: {
        revNo: rev.revNo,
        priority: "low",
        dueAt: "2099-12-31",
      },
    });
    expect(runRes.status()).toBe(201);

    // Try to delete the draft revision — should be blocked by order runs
    const delRes = await api.delete(
      `${API}/orders/${orderKey}/revs/${rev.revNo}`,
    );
    expect(delRes.status()).toBe(409);
    const body = await delRes.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toContain("existing order runs");
  });
});
