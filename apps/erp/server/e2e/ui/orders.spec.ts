import { test, expect } from "@playwright/test";
import { getTestCredentials } from "../auth-helper";

test("orders page renders with title and create button", async ({
  page,
}, testInfo) => {
  // Login via page's request context so cookies are shared
  const creds = getTestCredentials(testInfo.workerIndex);
  await page.request.post("http://localhost:3201/erp/api/auth/login", {
    data: creds,
  });

  await page.goto("/erp/orders");

  // Verify the page title renders
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  // Verify the "Create New" button exists (gated on order_planner permission)
  await expect(page.getByRole("button", { name: "Create New" })).toBeVisible();
});
