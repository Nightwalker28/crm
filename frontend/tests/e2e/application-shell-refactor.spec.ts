import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
});

test("uses one settings entry and settings-only breadcrumbs", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /^Permissions/ }).click();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Settings");
  await expect(breadcrumb).toContainText("Permissions");
  await expect(breadcrumb).not.toContainText("Dashboard");
});

test("keeps the global search centered and shell controls singular", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");

  const header = page.locator("header");
  const search = page.getByRole("button", { name: "Open command palette" }).filter({ visible: true });
  const centeredDifference = async () => {
    const headerBox = await header.boundingBox();
    const searchBox = await search.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    return Math.abs((searchBox!.x + searchBox!.width / 2) - (headerBox!.x + headerBox!.width / 2));
  };

  expect(await centeredDifference()).toBeLessThan(2);
  await expect(page.getByRole("button", { name: /Open notifications/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open profile menu" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(1);

  const sidebar = page.getByRole("complementary", { name: "Primary navigation" });
  expect(await sidebar.evaluate((element) => getComputedStyle(element).borderRightWidth)).not.toBe("0px");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  expect(await centeredDifference()).toBeLessThan(2);
});

test("shows the module title in the header and a cached profile photo in the profile trigger", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  await expect(page.locator("header").getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Search leads")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create lead" })).toBeVisible();

  await page.evaluate(() => {
    const current = JSON.parse(sessionStorage.getItem("lynk_user") || "{}");
    sessionStorage.setItem("lynk_user", JSON.stringify({ ...current, photo_url: "data:image/png;base64,iVBORw0KGgo=" }));
    window.dispatchEvent(new Event("lynk:user-cache-change"));
  });
  await expect(page.getByRole("button", { name: "Open profile menu" }).locator("img")).toBeVisible();
});

test("uses the global header as the only page title across workspace and settings routes", async ({ page }) => {
  const routes = [
    "/dashboard",
    "/dashboard/calendar",
    "/dashboard/mail",
    "/dashboard/reports",
    "/dashboard/client-portal",
    "/dashboard/settings",
    "/dashboard/settings/general",
    "/dashboard/settings/permissions",
    "/dashboard/settings/integrations",
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("main header").getByRole("heading")).toHaveCount(1);
    await expect(page.locator("main header + div h1")).toHaveCount(0);
  }
});
