import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("dashboard shell provides an accessible mobile navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/sales/leads");

  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  await expect(openNavigation).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeHidden();

  await openNavigation.click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Mobile navigation" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  await expect(openNavigation).toBeFocused();
});

test("table density preference persists and updates shared tables", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");

  const table = page.locator("[data-table-density]").first();
  await expect(table).toHaveAttribute("data-table-density", "comfortable");

  // `radio`, not `button`. `TableDensityToggle` is a `SegmentedControl`, which is a Radix
  // ToggleGroup with `type="single"` — so the group is a `radiogroup` and each segment is a
  // `radio`. The spec was written against whatever preceded the primitive and has been
  // matching nothing ever since; it is a real accessibility contract, so assert the real one.
  await page.getByRole("radio", { name: "Compact table density" }).click();
  await expect(table).toHaveAttribute("data-table-density", "compact");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("lynk:table-density"))).toBe("compact");

  await page.reload();
  await expect(page.locator("[data-table-density]").first()).toHaveAttribute("data-table-density", "compact");

  await page.getByRole("radio", { name: "Comfortable table density" }).click();
  await expect(page.locator("[data-table-density]").first()).toHaveAttribute("data-table-density", "comfortable");
});
