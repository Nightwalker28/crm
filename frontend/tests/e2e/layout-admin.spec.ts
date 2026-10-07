// 13b Phase 4 slices 4c–4e: layouts for every module and surface, and the pages that draw them.
//
// Read paths run against the real backend, as in `record-layouts-admin.spec.ts`: the
// layouts, their validation and their preview are the server's. Nothing here publishes, so a
// run never changes the tenant's layouts.
import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const BUILDER_ROUTE = "/dashboard/settings/record-layouts";

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Every module's full form is editable and previews live through the runtime form", async ({ page }) => {
  await page.goto(BUILDER_ROUTE);
  await expect(page.getByRole("heading", { name: "Available fields" })).toBeVisible({ timeout: 30_000 });

  await choose(page, "Module", "Purchase orders");
  await choose(page, "Layout", "Full form");

  const preview = page.locator('[data-record-layout="purchase_orders:full_form"]').first();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Live preview of the create and edit form. Nothing typed here is saved.")).toBeVisible();
  // The vendor is required by the domain, so the layout keeps it and the preview marks it.
  await expect(preview.getByRole("combobox", { name: "Vendor", exact: true })).toBeVisible();
  await expect(preview.getByLabel("Expected date")).toBeEditable();

  // Details are a structure preview: there is no record to show values from.
  await choose(page, "Layout", "Details");
  await expect(page.getByText("Preview of the details layout. Values show once a record is open.")).toBeVisible();
});

test("The layout for a role starts from the workspace layout", async ({ page }) => {
  await page.goto(BUILDER_ROUTE);
  await expect(page.getByRole("heading", { name: "Available fields" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("combobox", { name: "Layout for", exact: true }).click();
  const roleOption = page.getByRole("option", { name: /^Role: / }).first();
  test.skip(!(await roleOption.count()), "The tenant has no roles to override for.");
  await roleOption.click();
  // No override yet: nothing to remove, and publishing would create one.
  await expect(page.getByRole("button", { name: "Remove layout" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
});

test("Quote and order forms draw their full form layout, with lines after the first section", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes/new");
  const quoteForm = page.locator('[data-record-layout="sales_quotes:full_form"]');
  await expect(quoteForm).toBeVisible({ timeout: 30_000 });
  // The line editor sits between the `Quote` section and the addresses.
  const order = await quoteForm.evaluate((root) => {
    const quote = root.querySelector('[data-layout-section="quote"]');
    const lines = root.querySelector("[data-line-field='name']");
    const billing = root.querySelector('[data-layout-section="billing"]');
    if (!quote || !lines || !billing) return null;
    return [
      Boolean(quote.compareDocumentPosition(lines) & Node.DOCUMENT_POSITION_FOLLOWING),
      Boolean(lines.compareDocumentPosition(billing) & Node.DOCUMENT_POSITION_FOLLOWING),
    ];
  });
  expect(order).toEqual([true, true]);

  // *Same as billing* lives in the shipping section's heading and copies the address over.
  await page.locator("#quote-billing-city").fill("Lisbon");
  await page.getByRole("button", { name: "Same as billing" }).click();
  await expect(page.locator("#quote-shipping-city")).toHaveValue("Lisbon");

  await page.goto("/dashboard/sales/orders/new");
  await expect(page.locator('[data-record-layout="sales_orders:full_form"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create order" }).click();
  // An account or a contact: the error sits on the account picker.
  await expect(page.getByText("Select an account or contact for this order.")).toBeVisible();
  await expect(page.locator("#order-account")).toBeFocused();
});

test("ERP document headers draw their full form layout", async ({ page }) => {
  await page.goto("/dashboard/purchasing/orders/new");
  const form = page.locator('[data-record-layout="purchase_orders:full_form"]');
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form.locator("#po-vendor")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Vendor is required.")).toBeVisible();
  await expect(page.locator("#po-vendor")).toBeFocused();

  await page.goto("/dashboard/inventory/adjustments/new");
  await expect(page.locator('[data-record-layout="inventory_adjustments:full_form"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Adjustment type" })).toBeVisible();
});
