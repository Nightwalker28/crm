import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("adjustment and transfer documents render their draft workflows in both themes", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const theme of ["dark", "light"] as const) {
    const visit = async (route: string) => {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.goto(route);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    };

    await visit("/dashboard/inventory/adjustments");
    await expect(page.getByRole("heading", { name: "Adjustments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Adjustments" })).toBeVisible();
    await page.getByRole("link", { name: "New adjustment" }).click();
    await expect(page.getByRole("heading", { name: "New adjustment" })).toBeVisible();
    await page.getByRole("combobox", { name: "Adjustment type" }).click();
    await page.getByRole("option", { name: "Physical count" }).click();
    await expect(page.getByLabel("Counted, line 1")).toBeVisible();
    await expect(page.getByText("Expected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByPlaceholder("Search tracked products")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();

    await visit("/dashboard/inventory/transfers");
    await expect(page.getByRole("heading", { name: "Transfers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Transfers" })).toBeVisible();
    await page.getByRole("link", { name: "New transfer" }).click();
    await expect(page.getByRole("heading", { name: "New transfer" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "From warehouse" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "To warehouse" })).toBeVisible();
    await expect(page.getByLabel("Quantity, line 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("an adjustment draft saves and remains recoverable after removal", async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  await loginAsAdmin(page);
  await page.goto("/dashboard/inventory/stock");
  const product = page.locator('a[href*="/dashboard/catalog/products/"][href*="tab=stock"]').first();
  await expect(product).toBeVisible();
  const name = (await product.textContent())?.trim() ?? "";
  expect(name).not.toBe("");

  await page.goto("/dashboard/inventory/adjustments/new");
  await page.getByLabel("Reason").fill("E2 browser draft check");
  await page.getByPlaceholder("Search tracked products").fill(name);
  await page.getByRole("option").first().click();
  await page.getByLabel("Change, line 1").fill("1");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/adjustments\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove draft" }).click();
  const number = ((await page.getByRole("dialog").getByRole("heading").textContent()) ?? "").replace(/^Remove |\?$/g, "");
  expect(number).toMatch(/^ADJ-/);
  await page.getByRole("dialog").getByRole("button", { name: "Remove draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/adjustments$/);
  await expect(page.getByText(number, { exact: true })).toHaveCount(0);

  // Removed drafts are recovered from the shared recycle bin, newest removal first.
  await page.goto("/dashboard/settings/recycle-bin");
  await page.getByRole("combobox", { name: "Recycle bin module" }).click();
  await page.getByRole("option", { name: "Adjustments" }).click();
  await expect(page.getByText(number)).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: `Restore ${number}?` })).toBeVisible();
  await page.getByRole("button", { name: "Restore record" }).click();
  await expect(page.getByText(number)).toHaveCount(0);
  await page.goto("/dashboard/inventory/adjustments");
  await expect(page.getByRole("row", { name: new RegExp(`^${number} `) })).toBeVisible();
});

test("a transfer draft links two warehouses and saves its product line", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsAdmin(page);
  await page.goto("/dashboard/inventory/stock");
  const product = page.locator('a[href*="/dashboard/catalog/products/"][href*="tab=stock"]').first();
  await expect(product).toBeVisible();
  const name = (await product.textContent())?.trim() ?? "";
  const warehouseName = `E2 browser ${Date.now()}`;
  const warehouseCode = `E2${Date.now()}`;

  await page.goto("/dashboard/settings/warehouses");
  await page.getByRole("button", { name: "Add warehouse" }).click();
  await page.getByLabel("Code", { exact: true }).fill(warehouseCode);
  await page.getByLabel("Name", { exact: true }).fill(warehouseName);
  await page.getByRole("button", { name: "Save warehouse" }).click();
  await expect(page.getByRole("region", { name: "Warehouses" }).getByText(warehouseName)).toBeVisible();

  await page.goto("/dashboard/inventory/transfers/new");
  await page.getByRole("combobox", { name: "To warehouse" }).click();
  await page.getByRole("option", { name: warehouseName }).click();
  await page.getByPlaceholder("Search tracked products").fill(name);
  await page.getByRole("option").first().click();
  await page.getByLabel("Quantity, line 1").fill("1");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/transfers\/\d+$/, { timeout: 30_000 });
  await expect(page.getByText(warehouseName)).toBeVisible();
  await page.getByRole("button", { name: "Remove draft" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/transfers$/);

  await page.goto("/dashboard/settings/warehouses");
  await page.getByRole("button", { name: `Remove ${warehouseName}` }).click();
  await page.getByRole("button", { name: "Remove warehouse" }).click();
  await expect(page.getByRole("region", { name: "Warehouses" }).getByText(warehouseName)).toHaveCount(0);
});
