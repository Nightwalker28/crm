import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("inventory ledger screens and product stock tab render in both themes", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsAdmin(page);

  for (const theme of ["dark", "light"] as const) {
    const visit = async (route: string) => {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.goto(route);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    };
    await visit("/dashboard/inventory/stock");
    await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter stock status" })).toBeVisible();
    const productLink = page.locator('a[href*="/dashboard/catalog/products/"][href*="tab=stock"]').first();
    await expect(productLink).toBeVisible();
    const productHref = await productLink.getAttribute("href");
    expect(productHref).toBeTruthy();

    await visit("/dashboard/inventory/movements");
    await expect(page.getByRole("heading", { name: "Movements", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Filter movement type" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Stock movements" })).toBeVisible();

    await visit("/dashboard/settings/warehouses");
    await expect(page.getByRole("heading", { name: "Warehouses", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Warehouses" })).toBeVisible();
    await page.getByRole("button", { name: "Add warehouse" }).click();
    await expect(page.getByLabel("Code", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await visit(productHref!);
    await expect(page.getByRole("tab", { name: "Stock" })).toBeVisible();
    await expect(page.getByText("Recent movements")).toBeVisible();
    await page.getByRole("button", { name: "Adjust stock" }).click();
    await expect(page.getByLabel("Reason")).toBeVisible();
    await expect(page.getByLabel("Change", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  }
});
