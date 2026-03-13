import { test, expect, type Page } from "@playwright/test";
import { getTestCredentials } from "../auth-helper";
import { createOrderWithRevision } from "./helpers/order-setup";

test.describe.serial("Full order lifecycle with operations (UI)", () => {
  const uniqueKey = `e2e-full-${Date.now()}`;
  const orderDesc = "End-to-end test with operation, step, and field";
  const opTitle = "Assembly";
  const stepInstructions = "Assemble the components per specification";
  const fieldLabel = "Serial Number";

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

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

  // ── Design-time: build the order structure ───────────────────────────

  test("create order with revision", async () => {
    await createOrderWithRevision(page, { uniqueKey, orderDesc });
  });

  test("add an operation", async () => {
    await page.getByRole("button", { name: "Add Operation" }).click();

    // Fill the modal form
    await page.getByLabel("Title").fill(opTitle);
    await page.getByRole("button", { name: "Create" }).click();

    // Should navigate to the operation detail
    await expect(page.getByText(`OPERATION 10. ${opTitle}`)).toBeVisible();
  });

  test("add a step", async () => {
    await page.getByRole("button", { name: "Add Step" }).click();

    await page.getByLabel("Instructions (markdown)").fill(stepInstructions);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // Verify the step card appears
    await expect(page.getByText("STEP 10")).toBeVisible();
  });

  test("add a field to the step", async () => {
    await page.getByRole("button", { name: "Add Field" }).click();

    await page.getByLabel("Label").fill(fieldLabel);
    await page.getByRole("checkbox", { name: "Required" }).check();
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // Verify the field appears with label and required badge
    await expect(page.getByText(fieldLabel)).toBeVisible();
    await expect(page.getByText("required")).toBeVisible();
  });

  test("approve the revision", async () => {
    page.on("dialog", (d) => d.accept());

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("approved")).toBeVisible();
  });

  // ── Runtime: execute the order run ───────────────────────────────────

  test("cut an order run", async () => {
    await page.getByRole("button", { name: "Cut Order" }).click();

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

  test("start the operation run", async () => {
    // The sidebar auto-navigates to the first operation run
    await expect(page.getByText(`OPERATION 10. ${opTitle}`)).toBeVisible();

    // The header Start is gone (now shows Close), so this is the op's Start
    await page.getByRole("button", { name: "Start" }).click();

    // Status should change to in_progress (matches both detail badge and sidebar)
    await expect(page.getByText("in_progress").first()).toBeVisible();
  });

  test("fill in the field and complete the step", async () => {
    // Fill the required field value
    await page.getByLabel(fieldLabel).fill("SN-12345");

    // Wait for the field save (triggered on blur) to complete
    const savePromise = page.waitForResponse(
      (r) => r.url().includes("/fields/") && r.request().method() === "PUT",
    );
    await page.getByLabel(fieldLabel).blur();
    await savePromise;

    // Complete the step (scope to step card to avoid ambiguity with op Complete)
    const stepCard = page
      .locator(".mantine-Card-root")
      .filter({ hasText: "STEP 10" });
    await stepCard.getByRole("button", { name: "Complete" }).click();

    // Step should show as completed
    await expect(stepCard.getByText("Completed")).toBeVisible();
  });

  test("complete the operation run", async () => {
    // After step completion, the step's Complete button is gone.
    // The remaining Complete button is the operation run's.
    await page.getByRole("button", { name: "Complete" }).click();

    // The "Completed by ..." text appears for the op run
    await expect(page.getByText(/Completed by/)).toBeVisible();
  });

  test("close the order run", async () => {
    await page.getByTestId("order-run-close").click();
    await expect(page.getByTestId("order-run-status")).toHaveText("closed");
  });
});
