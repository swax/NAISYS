import { test, expect, type Page } from "@playwright/test";
import { getTestCredentials } from "../auth-helper";

test.describe.serial("Full order lifecycle (UI)", () => {
  const uniqueKey = `e2e-lifecycle-${Date.now()}`;
  const orderName = "Lifecycle Test Order";
  const orderDesc = "End-to-end lifecycle test";

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Login via API to set session cookie
    const creds = getTestCredentials(test.info().workerIndex);
    const res = await page.request.post(
      "http://localhost:3002/api/erp/auth/login",
      { data: creds },
    );
    expect(res.status()).toBe(200);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("create a planning order", async () => {
    await page.goto("/erp/planning/orders");
    await page.getByRole("button", { name: "Create New" }).click();

    // Fill the form
    await page.getByLabel("Key").fill(uniqueKey);
    await page.getByLabel("Name").fill(orderName);
    await page.getByLabel("Description").fill(orderDesc);
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect back to list
    await expect(
      page.getByRole("heading", { name: "Planning Orders" }),
    ).toBeVisible();

    // Click into the newly created order
    await page.getByText(uniqueKey).click();
    await expect(page.getByRole("heading", { name: orderName })).toBeVisible();
  });

  test("create a revision", async () => {
    await page.getByRole("button", { name: "New Revision" }).click();

    // Fill the modal form
    await page.getByLabel("Notes").fill("Initial revision notes");
    await page.getByLabel("Change Summary").fill("First draft of the order");
    await page.getByRole("button", { name: "Create" }).click();

    // Verify draft revision appears in the table
    const row = page.getByTestId("revision-row-1");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("revision-status-1")).toHaveText("draft");
  });

  test("approve the revision", async () => {
    // Accept the confirm() dialog before clicking
    page.on("dialog", (d) => d.accept());

    await page.getByTestId("revision-approve-1").click();

    // Verify status changes to approved
    await expect(page.getByTestId("revision-status-1")).toHaveText("approved");
  });

  test("cut an execution order", async () => {
    await page.getByTestId("revision-cut-order-1").click();

    // Should navigate to exec order create page with prefilled IDs
    await expect(
      page.getByRole("heading", { name: "Create Execution Order" }),
    ).toBeVisible();

    // The plan order ID and rev ID fields should be prefilled (non-empty)
    const planOrderIdInput = page.getByLabel("Planning Order ID");
    await expect(planOrderIdInput).not.toHaveValue("");

    // Submit the form
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect to execution orders list
    await expect(
      page.getByRole("heading", { name: "Execution Orders" }),
    ).toBeVisible();
  });

  test("start the execution order", async () => {
    // Click the first (most recent) execution order row
    await page.locator("table tbody tr").first().click();

    // Verify initial status is released
    await expect(page.getByTestId("exec-order-status")).toHaveText("released");

    // Click Start
    await page.getByTestId("exec-order-start").click();

    // Verify status changes to started
    await expect(page.getByTestId("exec-order-status")).toHaveText("started");
  });

  test("close the execution order", async () => {
    await page.getByTestId("exec-order-close").click();

    // Verify status changes to closed
    await expect(page.getByTestId("exec-order-status")).toHaveText("closed");

    // Start and Close buttons should be gone
    await expect(page.getByTestId("exec-order-start")).not.toBeVisible();
    await expect(page.getByTestId("exec-order-close")).not.toBeVisible();
  });
});
