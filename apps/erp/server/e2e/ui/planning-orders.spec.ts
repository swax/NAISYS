import { test, expect } from "@playwright/test";
import { getTestCredentials } from "../auth-helper";

test("planning orders page renders with title and create button", async ({
  page,
  request,
}, testInfo) => {
  // Login via API to set session cookie
  const creds = getTestCredentials(testInfo.workerIndex);
  await request.post("http://localhost:3201/api/erp/auth/login", {
    data: creds,
  });

  await page.goto("/erp/planning/orders");

  // Verify the page title renders
  await expect(
    page.getByRole("heading", { name: "Planning Orders" }),
  ).toBeVisible();

  // Verify the "Create New" button exists
  await expect(page.getByRole("button", { name: "Create New" })).toBeVisible();
});
