import { test, expect, type Page } from "@playwright/test";
import { getTestCredentials } from "../auth-helper";
import { createOrderWithRevision } from "./helpers/order-setup";

test.describe.serial("Order lifecycle (UI)", () => {
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

  test("create order with revision", async () => {
    await createOrderWithRevision(page, { uniqueKey, orderName, orderDesc });
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

    // Submit the form — redirects to the new order run detail
    await page.getByRole("button", { name: "Create" }).click();

    // Verify we landed on the run detail page
    await expect(page.getByTestId("order-run-status")).toHaveText("released");
  });

  test("start the order run", async () => {
    // Already on the run detail page from the previous step
    await page.getByTestId("order-run-start").click();
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
