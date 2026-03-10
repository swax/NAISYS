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
      "http://localhost:3201/api/erp/auth/login",
      { data: creds },
    );
    expect(res.status()).toBe(200);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("create an order", async () => {
    await page.goto("/erp/orders");
    await page.getByRole("button", { name: "Create New" }).click();

    // Fill the form
    await page.getByLabel("Key").fill(uniqueKey);
    await page.getByLabel("Name").fill(orderName);
    await page.getByLabel("Description").fill(orderDesc);
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect back to list
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

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

    // Should navigate to the revision detail page
    await expect(page.getByText("Rev #1")).toBeVisible();
  });

  test("approve the revision", async () => {
    // Accept the confirm() dialog before clicking
    page.on("dialog", (d) => d.accept());

    await page.getByRole("button", { name: "Approve" }).click();

    // Verify status badge changes to approved
    await expect(page.getByText("approved")).toBeVisible();
  });

  test("cut an order run", async () => {
    await page.getByRole("button", { name: "Cut Order" }).click();

    // Should navigate to order run create page
    await expect(
      page.getByRole("heading", { name: "Create Order Run" }),
    ).toBeVisible();

    // Submit the form
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect to runs list
    await expect(
      page.getByRole("heading", { name: `Runs for ${uniqueKey}` }),
    ).toBeVisible();
  });

  test("start the order run", async () => {
    // Click the first (most recent) order run row
    await page.locator("table tbody tr").first().click();

    // Verify initial status is released
    await expect(page.getByTestId("order-run-status")).toHaveText("released");

    // Click Start
    await page.getByTestId("order-run-start").click();

    // Verify status changes to started
    await expect(page.getByTestId("order-run-status")).toHaveText("started");
  });

  test("close the order run", async () => {
    await page.getByTestId("order-run-close").click();

    // Verify status changes to closed
    await expect(page.getByTestId("order-run-status")).toHaveText("closed");

    // Start and Close buttons should be gone
    await expect(page.getByTestId("order-run-start")).not.toBeVisible();
    await expect(page.getByTestId("order-run-close")).not.toBeVisible();
  });
});
