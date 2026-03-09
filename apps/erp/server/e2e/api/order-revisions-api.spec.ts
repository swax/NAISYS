import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsTestUser } from "../auth-helper";

const API = "http://localhost:3201/api/erp";

test.describe("Order Revisions - API happy path", () => {
  let orderKey: string;
  let revisionId: number;
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    await loginAsTestUser(api, test.info().workerIndex);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test("create an order", async () => {
    orderKey = `e2e-rev-test-${Date.now()}`;

    const res = await api.post(`${API}/orders`, {
      data: {
        key: orderKey,
        name: "E2E Revision Test Order",
        description: "Order created for revision e2e testing",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("active");
    expect(body._links).toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: "revisions" })]),
    );
  });

  test("list revisions (empty)", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/revs`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("create first revision", async () => {
    const res = await api.post(`${API}/orders/${orderKey}/revs`, {
      data: {
        notes: "Initial draft",
        changeSummary: "First version of the order",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.revNo).toBe(1);
    expect(body.status).toBe("draft");
    expect(body.notes).toBe("Initial draft");
    expect(body.changeSummary).toBe("First version of the order");
    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "approve" }),
        expect.objectContaining({ rel: "update" }),
        expect.objectContaining({ rel: "delete" }),
      ]),
    );
    revisionId = body.id;
  });

  test("update draft revision", async () => {
    const res = await api.put(`${API}/orders/${orderKey}/revs/1`, {
      data: {
        notes: "Updated draft notes",
        changeSummary: "Updated summary",
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.notes).toBe("Updated draft notes");
    expect(body.changeSummary).toBe("Updated summary");
    expect(body.status).toBe("draft");
  });

  test("approve the revision", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/revs/1/approve`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("approved");

    // Verify audit entry was created
    const auditRes = await api.get(
      `${API}/audit?entityType=OrderRevision&entityId=${revisionId}`,
    );
    const audit = await auditRes.json();
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approve",
          field: "status",
          oldValue: "draft",
          newValue: "approved",
        }),
      ]),
    );

    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "obsolete" }),
        expect.objectContaining({ rel: "cut-order" }),
      ]),
    );
    // Should NOT have update or delete actions
    expect(body._actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ rel: "update" })]),
    );
  });

  test("cannot update approved revision (409)", async () => {
    const res = await api.put(`${API}/orders/${orderKey}/revs/1`, {
      data: { notes: "should fail" },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("cannot delete approved revision (409)", async () => {
    const res = await api.delete(`${API}/orders/${orderKey}/revs/1`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBeTruthy();
  });

  test("mark approved revision as obsolete", async () => {
    const res = await api.post(
      `${API}/orders/${orderKey}/revs/1/obsolete`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("obsolete");
    // obsolete should have no actions
    expect(body._actions).toHaveLength(0);
  });

  test("create second revision (auto-increments revNo)", async () => {
    const res = await api.post(`${API}/orders/${orderKey}/revs`, {
      data: {
        notes: "Second revision",
        changeSummary: "Improvements based on feedback",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.revNo).toBe(2);
    expect(body.status).toBe("draft");
  });

  test("list revisions shows both (ordered by revNo desc)", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/revs`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Ordered by revNo desc
    expect(body.items[0].revNo).toBe(2);
    expect(body.items[1].revNo).toBe(1);
  });

  test("filter revisions by status", async () => {
    const res = await api.get(
      `${API}/orders/${orderKey}/revs?status=draft`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe("draft");
  });

  test("get single revision by revNo", async () => {
    const res = await api.get(`${API}/orders/${orderKey}/revs/1`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(revisionId);
    expect(body.status).toBe("obsolete");
    expect(body._links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "self" }),
        expect.objectContaining({ rel: "collection" }),
        expect.objectContaining({ rel: "parent" }),
      ]),
    );
  });

  test("delete draft revision succeeds", async () => {
    const res = await api.delete(`${API}/orders/${orderKey}/revs/2`);
    expect(res.status()).toBe(204);

    // Verify only 1 revision left
    const afterRes = await api.get(`${API}/orders/${orderKey}/revs`);
    const after = await afterRes.json();
    expect(after.total).toBe(1);
  });

  test("cannot delete order with revisions (409)", async () => {
    // There's still 1 obsolete revision, so delete should be blocked
    const res = await api.delete(`${API}/orders/${orderKey}`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toContain("existing revisions");
  });
});
