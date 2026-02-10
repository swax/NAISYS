import { test, expect } from "@playwright/test";

test("planning orders page renders with title and create button", async ({
  page,
}) => {
  await page.goto("/erp/planning/orders");

  // Verify the page title renders
  await expect(
    page.getByRole("heading", { name: "Planning Orders" }),
  ).toBeVisible();

  // Verify the "Create New" button exists
  await expect(page.getByRole("button", { name: "Create New" })).toBeVisible();
});
