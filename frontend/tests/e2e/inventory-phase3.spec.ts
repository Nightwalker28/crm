import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("stock saved views and transfer controls render in both themes", async ({ page }) => {
  test.setTimeout(2 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto("/dashboard/inventory/stock");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("tab", { name: "Low stock" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Out of stock" })).toBeVisible();
    await page.getByRole("tab", { name: "Low stock" }).click();
    await expect(page.getByRole("tab", { name: "Low stock" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Import opening stock" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export levels" })).toBeVisible();

    await page.goto("/dashboard/inventory/movements");
    await expect(page.getByRole("button", { name: "Export movements" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
