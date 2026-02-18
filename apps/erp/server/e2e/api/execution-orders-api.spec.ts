import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsTestUser } from "../auth-helper";

const API = "http://localhost:3201/api/erp";

test.describe("Execution Orders - API happy path", () => {
  let planOrderId: number;
  let planOrderRevId: number;
  let execOrderId: number;
  let execOrderId2: number;
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    await loginAsTestUser(api, test.info().workerIndex);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("create a planning order + revision for testing", async () => {
    // Create planning order
    const orderRes = await api.post(`${API}/planning/orders`, {
      data: {
        key: `e2e-exec-test-${Date.now()}`,
        name: "E2E Exec Test Order",
        description: "Order for execution order e2e testing",
      },
    });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    planOrderId = order.id;

    // Create revision
    const revRes = await api.post(
      `${API}/planning/orders/${planOrderId}/revisions`,
      {
        data: {
          notes: "Test revision",
          changeSummary: "Initial",
        },
      },
    );
    expect(revRes.status()).toBe(201);
    const rev = await revRes.json();
    planOrderRevId = rev.id;
  });

  test("create execution order", async () => {
    const res = await api.post(`${API}/execution/orders`, {
      data: {
        planOrderId,
        planOrderRevId,
        priority: "high",
        assignedTo: "test-user",
        notes: "First execution order",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.orderNo).toBe(1);
    expect(body.status).toBe("released");
    expect(body.priority).toBe("high");
    expect(body.assignedTo).toBe("test-user");
    expect(body.planOrderId).toBe(planOrderId);
    expect(body.planOrderRevId).toBe(planOrderRevId);
    expect(body.releasedAt).toBeTruthy();
    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "start" }),
        expect.objectContaining({ rel: "cancel" }),
        expect.objectContaining({ rel: "update" }),
        expect.objectContaining({ rel: "delete" }),
      ]),
    );
    expect(body._links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "planning-order" }),
      ]),
    );
    execOrderId = body.id;
  });

  test("list execution orders", async () => {
    const res = await api.get(`${API}/execution/orders`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  test("get execution order by id", async () => {
    const res = await api.get(`${API}/execution/orders/${execOrderId}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(execOrderId);
    expect(body.status).toBe("released");
    expect(body._links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "self" }),
        expect.objectContaining({ rel: "collection" }),
      ]),
    );
  });

  test("update released order", async () => {
    const res = await api.put(`${API}/execution/orders/${execOrderId}`, {
      data: {
        priority: "critical",
        notes: "Updated notes",
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.priority).toBe("critical");
    expect(body.notes).toBe("Updated notes");
  });

  test("start order (released → started)", async () => {
    const res = await api.post(`${API}/execution/orders/${execOrderId}/start`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("started");

    // Verify audit entry was created
    const auditRes = await api.get(
      `${API}/audit?entityType=ExecOrder&entityId=${execOrderId}`,
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

  test("cannot delete started order (409)", async () => {
    const res = await api.delete(`${API}/execution/orders/${execOrderId}`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("close order (started → closed)", async () => {
    const res = await api.post(`${API}/execution/orders/${execOrderId}/close`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("closed");

    // Verify audit entry was created
    const auditRes = await api.get(
      `${API}/audit?entityType=ExecOrder&entityId=${execOrderId}`,
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

    // closed: no actions
    expect(body._actions).toHaveLength(0);
  });

  test("cannot start closed order (409)", async () => {
    const res = await api.post(`${API}/execution/orders/${execOrderId}/start`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("cannot cancel closed order (409)", async () => {
    const res = await api.post(`${API}/execution/orders/${execOrderId}/cancel`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("create and cancel an order", async () => {
    // Create second order
    const createRes = await api.post(`${API}/execution/orders`, {
      data: {
        planOrderId,
        planOrderRevId,
        priority: "low",
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.orderNo).toBe(2);
    execOrderId2 = created.id;

    // Cancel it
    const cancelRes = await api.post(
      `${API}/execution/orders/${execOrderId2}/cancel`,
    );
    expect(cancelRes.status()).toBe(200);

    const body = await cancelRes.json();
    expect(body.status).toBe("cancelled");
    // cancelled: no actions
    expect(body._actions).toHaveLength(0);
  });

  test("filter by status", async () => {
    const res = await api.get(`${API}/execution/orders?status=closed`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    for (const item of body.items) {
      expect(item.status).toBe("closed");
    }
  });

  test("filter by priority", async () => {
    const res = await api.get(`${API}/execution/orders?priority=critical`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    for (const item of body.items) {
      expect(item.priority).toBe("critical");
    }
  });

  test("cannot delete planning order with revisions (409)", async () => {
    const res = await api.delete(`${API}/planning/orders/${planOrderId}`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toContain("existing revisions");
  });

  test("cannot delete draft revision with exec orders (409)", async () => {
    // Create a new draft revision, then create an exec order against it
    const revRes = await api.post(
      `${API}/planning/orders/${planOrderId}/revisions`,
      { data: { notes: "Draft with exec orders" } },
    );
    expect(revRes.status()).toBe(201);
    const rev = await revRes.json();

    const execRes = await api.post(`${API}/execution/orders`, {
      data: {
        planOrderId,
        planOrderRevId: rev.id,
        priority: "low",
      },
    });
    expect(execRes.status()).toBe(201);

    // Try to delete the draft revision — should be blocked by exec orders
    const delRes = await api.delete(
      `${API}/planning/orders/${planOrderId}/revisions/${rev.id}`,
    );
    expect(delRes.status()).toBe(409);
    const body = await delRes.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toContain("existing execution orders");
  });
});
