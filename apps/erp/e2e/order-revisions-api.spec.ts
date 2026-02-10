import { test, expect } from "@playwright/test";

const API = "http://localhost:3002/api/erp";

test.describe("Planning Order Revisions - API happy path", () => {
  let orderId: number;
  let revisionId: number;

  test("create a planning order", async ({ request }) => {
    const res = await request.post(`${API}/planning/orders`, {
      data: {
        key: `e2e-rev-test-${Date.now()}`,
        name: "E2E Revision Test Order",
        description: "Order created for revision e2e testing",
        createdBy: "e2e-test",
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("active");
    expect(body._links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "revisions" }),
      ]),
    );
    orderId = body.id;
  });

  test("list revisions (empty)", async ({ request }) => {
    const res = await request.get(
      `${API}/planning/orders/${orderId}/revisions`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("create first revision", async ({ request }) => {
    const res = await request.post(
      `${API}/planning/orders/${orderId}/revisions`,
      {
        data: {
          notes: "Initial draft",
          changeSummary: "First version of the order",
        },
      },
    );
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.revNo).toBe(1);
    expect(body.status).toBe("draft");
    expect(body.notes).toBe("Initial draft");
    expect(body.changeSummary).toBe("First version of the order");
    expect(body.approvedAt).toBeNull();
    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "approve" }),
        expect.objectContaining({ rel: "update" }),
        expect.objectContaining({ rel: "delete" }),
      ]),
    );
    revisionId = body.id;
  });

  test("update draft revision", async ({ request }) => {
    const res = await request.put(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}`,
      {
        data: {
          notes: "Updated draft notes",
          changeSummary: "Updated summary",
        },
      },
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.notes).toBe("Updated draft notes");
    expect(body.changeSummary).toBe("Updated summary");
    expect(body.status).toBe("draft");
  });

  test("approve the revision", async ({ request }) => {
    const res = await request.post(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}/approve`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.approvedAt).toBeTruthy();
    expect(body._actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "obsolete" }),
      ]),
    );
    // Should NOT have update or delete actions
    expect(body._actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "update" }),
      ]),
    );
  });

  test("cannot update approved revision (409)", async ({ request }) => {
    const res = await request.put(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}`,
      { data: { notes: "should fail" } },
    );
    expect(res.status()).toBe(409);
  });

  test("cannot delete approved revision (409)", async ({ request }) => {
    const res = await request.delete(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}`,
    );
    expect(res.status()).toBe(409);
  });

  test("mark approved revision as obsolete", async ({ request }) => {
    const res = await request.post(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}/obsolete`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("obsolete");
    // obsolete should have no actions
    expect(body._actions).toHaveLength(0);
  });

  test("create second revision (auto-increments revNo)", async ({
    request,
  }) => {
    const res = await request.post(
      `${API}/planning/orders/${orderId}/revisions`,
      {
        data: {
          notes: "Second revision",
          changeSummary: "Improvements based on feedback",
        },
      },
    );
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.revNo).toBe(2);
    expect(body.status).toBe("draft");
  });

  test("list revisions shows both (ordered by revNo desc)", async ({
    request,
  }) => {
    const res = await request.get(
      `${API}/planning/orders/${orderId}/revisions`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // Ordered by revNo desc
    expect(body.items[0].revNo).toBe(2);
    expect(body.items[1].revNo).toBe(1);
  });

  test("filter revisions by status", async ({ request }) => {
    const res = await request.get(
      `${API}/planning/orders/${orderId}/revisions?status=draft`,
    );
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe("draft");
  });

  test("get single revision by id", async ({ request }) => {
    const res = await request.get(
      `${API}/planning/orders/${orderId}/revisions/${revisionId}`,
    );
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

  test("delete draft revision succeeds", async ({ request }) => {
    // Get the second revision (draft)
    const listRes = await request.get(
      `${API}/planning/orders/${orderId}/revisions?status=draft`,
    );
    const list = await listRes.json();
    const draftId = list.items[0].id;

    const res = await request.delete(
      `${API}/planning/orders/${orderId}/revisions/${draftId}`,
    );
    expect(res.status()).toBe(204);

    // Verify only 1 revision left
    const afterRes = await request.get(
      `${API}/planning/orders/${orderId}/revisions`,
    );
    const after = await afterRes.json();
    expect(after.total).toBe(1);
  });

  test("cleanup - delete the order", async ({ request }) => {
    const res = await request.delete(
      `${API}/planning/orders/${orderId}`,
    );
    expect(res.status()).toBe(204);
  });
});
