import { test, expect } from "../fixtures";

test("orders page renders with title and create button", async ({
  authedPage: page,
}) => {
  await page.goto("/erp/orders");

  // Verify the page title renders
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  // Verify the "Create New" button exists (gated on order_planner permission)
  await expect(page.getByRole("button", { name: "Create New" })).toBeVisible();
});
