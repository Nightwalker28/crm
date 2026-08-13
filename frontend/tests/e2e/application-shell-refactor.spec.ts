import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
});

test("uses one settings entry and never renders breadcrumbs", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /^Permissions/ }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
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

  // The sidebar animates its width over 200ms (transition-[width] duration-200), so a bare
  // read straight after a collapse samples a frame mid-transition — 18px off at t=0, 0.3px
  // at t=100ms, 0 once settled. Poll for the settled value instead of racing the animation.
  const expectCentered = async () =>
    expect
      .poll(centeredDifference, { message: "Expected the command palette to settle centered.", timeout: 5000 })
      .toBeLessThan(2);

  await expectCentered();
  await expect(page.getByRole("button", { name: /Open notifications/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Open profile menu" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(1);

  const sidebar = page.getByRole("complementary", { name: "Primary navigation" });
  expect(await sidebar.evaluate((element) => getComputedStyle(element).borderRightWidth)).not.toBe("0px");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectCentered();
});

test("shows only the module name in the global header and a cached profile photo", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  await expect(page.locator("main > div > header").getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Search leads")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create lead" })).toBeVisible();

  await page.evaluate(() => {
    const current = JSON.parse(sessionStorage.getItem("lynk_user") || "{}");
    sessionStorage.setItem("lynk_user", JSON.stringify({ ...current, photo_url: "data:image/png;base64,iVBORw0KGgo=" }));
    window.dispatchEvent(new Event("lynk:user-cache-change"));
  });
  await expect(page.getByRole("button", { name: "Open profile menu" }).locator("img")).toBeVisible();
});

test("renders neither breadcrumb trails nor visible page-title headers across dashboard routes", async ({ page }) => {
  const routes = [
    ["/dashboard", "Dashboard"],
    ["/dashboard/calendar", "Calendar"],
    ["/dashboard/mail", "Mail"],
    ["/dashboard/reports", "Reports"],
    ["/dashboard/client-portal", "Client Portal"],
    // The sidebar has one flat Settings entry, so the landing page is named for the section.
    // An open settings page names itself in the header.
    ["/dashboard/settings", "Settings"],
    ["/dashboard/settings/general", "General"],
    ["/dashboard/settings/permissions", "Permissions"],
    ["/dashboard/settings/integrations", "Integrations"],
  ];

  for (const [route, moduleName] of routes) {
    await page.goto(route);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
    await expect(page.locator("main > div > header").getByRole("heading", { name: moduleName, exact: true })).toBeVisible();
    await expect(page.locator("main > div > header + div h1:not(.sr-only)")).toHaveCount(0);
  }
});
