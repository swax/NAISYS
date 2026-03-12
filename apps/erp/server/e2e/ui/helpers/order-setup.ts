import { expect, type Page } from "@playwright/test";

export interface OrderSetupParams {
  uniqueKey: string;
  orderName: string;
  orderDesc: string;
}

/**
 * Creates an order and its first revision.
 * Leaves the page on the revision detail view (/orders/:key/revs/1).
 */
export async function createOrderWithRevision(
  page: Page,
  { uniqueKey, orderName, orderDesc }: OrderSetupParams,
) {
  // Create order
  await page.goto("/erp/orders");
  await page.getByRole("button", { name: "Create New" }).click();

  await page.getByLabel("Key").fill(uniqueKey);
  await page.getByLabel("Name").fill(orderName);
  await page.getByLabel("Description").fill(orderDesc);
  await page.getByRole("button", { name: "Create" }).click();

  // Should redirect back to orders list
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  // Navigate into the newly created order
  await page.getByText(uniqueKey).click();
  await expect(page.getByRole("heading", { name: orderName })).toBeVisible();

  // Create revision
  await page.getByRole("button", { name: "New Revision" }).click();
  await page.getByLabel("Notes").fill("Initial revision notes");
  await page.getByLabel("Change Summary").fill("First draft of the order");
  await page.getByRole("button", { name: "Create" }).click();

  // Should navigate to the revision detail page (header shows "REV 1")
  await expect(page.getByText("REV 1")).toBeVisible();
}
