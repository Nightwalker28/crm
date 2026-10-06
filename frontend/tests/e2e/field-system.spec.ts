import { expect, test, type Page } from "@playwright/test";
import { api } from "./helpers/api";
import { loginAsAdmin } from "./helpers/auth";

/**
 * 13b Phase 2: one field system. A custom field on an ERP document shows on its form; a
 * picklist custom field offers its list; a custom module's picklist field uses a picklist.
 * Runs on `e2e.sh`'s disposable database.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the specs read loose JSON.
const post = (page: Page, path: string, data: unknown) => api<any>(page, path, { method: "POST", data });

test("the field types endpoint lists the one type set and every module", async ({ page }) => {
  const body = await api<{ types: { key: string }[]; modules: { module_key: string }[] }>(page, "/custom-fields/types");
  expect(body.types.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining(["picklist", "lookup", "auto_number", "currency"]));
  expect(body.modules.map((item: { module_key: string }) => item.module_key)).toEqual(expect.arrayContaining(["purchase_orders", "finance_pos", "catalog_products"]));
});

test("a picklist custom field appears on the purchase order form with its own values", async ({ page }) => {
  const label = `Priority ${Date.now()}`;
  await post(page, "/admin/custom-fields/purchase_orders", { label, field_type: "picklist", picklist_values: ["Rush", "Standard"] });
  await page.goto("/dashboard/purchasing/orders/new");
  await expect(page.getByRole("heading", { name: "Custom fields" })).toBeVisible();
  await page.getByRole("combobox", { name: label }).click();
  await expect(page.getByRole("option", { name: "Rush" })).toBeVisible();
});

test("Settings → Fields creates a currency field on invoices", async ({ page }) => {
  const label = `Commission ${Date.now()}`;
  await page.goto("/dashboard/settings/fields?module=finance_pos");
  await page.getByRole("button", { name: /Create field|New field|Add field/ }).first().click();
  await page.getByLabel("Label").first().fill(label);
  await page.getByRole("combobox", { name: "Field type" }).click();
  await page.getByRole("option", { name: "Currency" }).click();
  await page.getByRole("button", { name: /Create field|Save field/ }).last().click();
  const fields = await api<{ label: string; field_type: string }[]>(page, "/custom-fields/finance_pos");
  expect(fields.some((field: { label: string; field_type: string }) => field.label === label && field.field_type === "currency")).toBe(true);
});

test("a custom module field can be a picklist", async ({ page }) => {
  const key = `assets_${Date.now()}`;
  const built = await post(page, "/module-builder", {
    name: `Assets ${key}`, key,
    fields: [
      { label: "Name", field_type: "text", is_required: true },
      { label: "Condition", field_type: "picklist", picklist_values: ["New", "Used"] },
    ],
  });
  const condition = built.fields.find((field: { key: string }) => field.key === "condition");
  expect(condition.field_type).toBe("picklist");
  expect(condition.picklist_key).toBeTruthy();
});
