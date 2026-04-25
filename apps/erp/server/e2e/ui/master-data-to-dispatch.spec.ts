/**
 * ERP master data → dispatch workflow E2E (UI).
 *
 *  1. Login and create a work center.
 *  2. Create an item, then add a required custom field to it.
 *  3. From the item detail, create an item instance (lot) with a quantity.
 *  4. Create an order that produces the item; assert the order detail
 *     links to the item.
 *  5. Add a revision to the order.
 *  6. Add an operation to the revision and edit it to assign the work
 *     center.
 *  7. Approve the revision.
 *  8. Cut an order run from the approved revision; assert it lands in
 *     released state.
 *  9. Open the dispatch open queue, search by order key, and assert the
 *     operation appears.
 * 10. Start the order run, then start and complete the operation run.
 * 11. Open the dispatch ready-to-close queue and assert the run appears.
 * 12. Complete the order run via the modal that mints a new item
 *     instance (filling the required field); assert closed status and
 *     a link to the produced instance.
 */

import { test, expect, type Page } from "@playwright/test";

import { loginAsTestUser } from "../auth-helper";

test.describe.serial("ERP master data to dispatch workflow (UI)", () => {
  const stamp = Date.now();
  const wcKey = `e2e-wc-${stamp}`;
  const itemKey = `e2e-item-${stamp}`;
  const itemDesc = "Widget for master-data e2e test";
  const itemFieldLabel = "Material";
  const instanceKey = `LOT-${stamp}`;
  const orderKey = `e2e-md-${stamp}`;
  const orderDesc = "Master-data to dispatch e2e order";
  const opTitle = "Machining";

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginAsTestUser(page.request, test.info().workerIndex);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Master data ──────────────────────────────────────────────────────

  test("create work center", async () => {
    await page.goto("/erp/work-centers");
    await page.getByRole("button", { name: "Create New" }).click();

    await page.getByLabel("Key").fill(wcKey);
    await page.getByLabel("Description").fill("Work center for e2e test");
    await page.getByRole("button", { name: "Create" }).click();

    // Lands on the work center detail page
    await expect(page.getByRole("heading", { name: wcKey })).toBeVisible();
  });

  test("create item", async () => {
    await page.goto("/erp/items");
    await page.getByRole("button", { name: "Create New" }).click();

    await page.getByLabel("Key").fill(itemKey);
    await page.getByLabel("Description").fill(itemDesc);
    await page.getByRole("button", { name: "Create" }).click();

    // Returns to items list — navigate into the new item
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    await page.getByText(itemKey).click();
    await expect(page.getByRole("heading", { name: itemKey })).toBeVisible();
  });

  test("add a field to the item", async () => {
    // Add Field button is in FieldDefList on the item detail
    await page.getByRole("button", { name: "Add Field" }).click();

    await page.getByLabel("Label").fill(itemFieldLabel);
    await page.getByRole("checkbox", { name: "Required" }).check();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByText(itemFieldLabel)).toBeVisible();
    await expect(page.getByText("required")).toBeVisible();
  });

  test("create an item instance", async () => {
    await page.getByRole("button", { name: "View Instances" }).click();
    await expect(
      page.getByRole("heading", { name: `Instances for ${itemKey}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create New" }).click();
    await page.getByLabel("Key (lot/serial number)").fill(instanceKey);
    await page.getByLabel("Quantity").fill("5");
    await page.getByRole("button", { name: "Create" }).click();

    // Lands on the instance detail page
    await expect(page.getByRole("heading", { name: instanceKey })).toBeVisible();
    await expect(page.getByText("5", { exact: true }).first()).toBeVisible();
  });

  // ── Order/revision tied to the item ──────────────────────────────────

  test("create order producing the item", async () => {
    await page.goto("/erp/orders");
    await page.getByRole("button", { name: "Create New" }).click();

    await page.getByLabel("Key").fill(orderKey);
    await page.getByRole("textbox", { name: "Produces Item" }).fill(itemKey);
    await page.getByLabel("Description").fill(orderDesc);
    await page.getByRole("button", { name: "Create" }).click();

    // Returns to orders list — navigate into the new order
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await page.getByText(orderKey).click();
    await expect(page.getByRole("heading", { name: orderKey })).toBeVisible();

    // Verify the order is linked to our item
    await expect(page.getByText("Produces Item:")).toBeVisible();
    await expect(
      page.getByRole("link", { name: itemKey, exact: true }),
    ).toBeVisible();
  });

  test("create revision", async () => {
    await page.getByRole("button", { name: "New Revision" }).click();
    await expect(page.getByText("REV 1")).toBeVisible();
  });

  test("add an operation with work center", async () => {
    await page.getByRole("button", { name: "Add Operation" }).click();

    await page.getByLabel("Title").fill(opTitle);
    await page.getByRole("button", { name: "Create" }).click();

    // Should navigate to the operation detail
    await expect(page.getByText(`OPERATION 10: ${opTitle}`)).toBeVisible();

    // Edit to assign the work center
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("textbox", { name: "Work Center" }).fill(wcKey);
    await page.getByRole("button", { name: "Save" }).click();

    // Work center key shown on the operation detail header
    await expect(page.getByText(`[${wcKey}]`)).toBeVisible();
  });

  test("approve the revision", async () => {
    page.once("dialog", (d) => d.accept());

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("approved")).toBeVisible();
  });

  test("cut an order run", async () => {
    await page.getByRole("button", { name: "Cut Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Create Order Run" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create" }).click();

    // Lands on the run detail page
    await expect(page.getByTestId("order-run-status")).toHaveText("released");
  });

  // ── Dispatch queue inspection ────────────────────────────────────────

  test("operation appears in the dispatch open queue", async () => {
    await page.goto("/erp/dispatch");
    await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();

    // Filter to our order — search debounces ~300ms
    await page.getByPlaceholder("Search...").fill(orderKey);
    await expect(page.getByRole("link", { name: new RegExp(orderKey) }).first()).toBeVisible();
    await expect(page.getByText(`10 — ${opTitle}`)).toBeVisible();
  });

  // ── Run/operation execution to populate ready-to-close ──────────────

  test("start the order run", async () => {
    await page.goto(`/erp/orders/${orderKey}/runs/1`);
    await page.getByTestId("order-run-start").click();
    await expect(page.getByTestId("order-run-status")).toHaveText("started");
  });

  test("start and complete the operation run", async () => {
    await page.getByRole("link", { name: `10. ${opTitle}` }).click();
    await expect(page.getByText(`OPERATION 10: ${opTitle}`)).toBeVisible();

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("in_progress").first()).toBeVisible();

    // Two "Complete" buttons exist on the page — the order-run Complete
    // (disabled until all ops finish) and the operation Complete. Pick the
    // enabled one. Exclude both native and aria-disabled forms so the
    // selector survives a switch in how disabled state is rendered.
    await page
      .getByRole("button", { name: "Complete", exact: true })
      .and(page.locator(':not([disabled]):not([aria-disabled="true"])'))
      .click();
    await expect(page.getByText(/Completed by/)).toBeVisible();
  });

  test("run appears in the dispatch ready-to-close queue", async () => {
    await page.goto("/erp/dispatch/ready-to-close");
    await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();

    await page.getByPlaceholder("Search order key or description...").fill(orderKey);
    await expect(page.getByRole("link", { name: new RegExp(orderKey) }).first()).toBeVisible();
  });

  test("complete the order run into a new item instance", async () => {
    await page.goto(`/erp/orders/${orderKey}/runs/1`);

    // Order has an itemKey, so the run finishes via Complete (which opens
    // a modal to mint an item instance) rather than the plain Close action.
    const runInstanceKey = `RUN-${stamp}`;
    await page.getByTestId("order-run-complete").click();

    const dialog = page.getByRole("dialog", { name: "Complete Order Run" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Instance Key (SN / Lot Code)").fill(runInstanceKey);
    await dialog.getByLabel("Quantity").fill("1");
    await dialog.getByLabel(`${itemFieldLabel} *`).fill("Aluminum");
    await dialog.getByRole("button", { name: "Complete" }).click();

    await expect(page.getByTestId("order-run-status")).toHaveText("closed");

    // Header now links to the produced instance
    await expect(page.getByText(/Completed into/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(runInstanceKey) }),
    ).toBeVisible();
  });
});
