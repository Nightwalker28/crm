import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const SETTINGS_DESTINATIONS = [
  { name: "General", href: "/dashboard/settings/general" },
  { name: "Users", href: "/dashboard/settings/users" },
  { name: "Teams", href: "/dashboard/settings/teams" },
  { name: "Customer groups", href: "/dashboard/settings/customer-groups" },
  { name: "Permissions", href: "/dashboard/settings/permissions" },
  { name: "Module settings", href: "/dashboard/settings/modules" },
  { name: "Module builder", href: "/dashboard/settings/module-builder" },
  { name: "Field config", href: "/dashboard/settings/fields" },
  { name: "Templates", href: "/dashboard/settings/message-templates" },
  { name: "Automation", href: "/dashboard/settings/automation" },
  { name: "Booking links", href: "/dashboard/settings/calendar-booking" },
  { name: "Backups", href: "/dashboard/settings/backups" },
  { name: "Integrations", href: "/dashboard/settings/integrations" },
  { name: "Activity log", href: "/dashboard/settings/activity-log" },
  { name: "Recycle bin", href: "/dashboard/settings/recycle-bin" },
  { name: "Authentication", href: "/dashboard/settings/authentication" },
  { name: "Domains", href: "/dashboard/settings/domains" },
  { name: "Provisioning", href: "/dashboard/settings/provisioning" },
] as const;

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("shows every registered settings destination on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  for (const group of ["Workspace", "Users and organization", "Security and access", "Customization", "Integrations", "Data and maintenance"]) {
    await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
  }

  // Scoped to the hub, the one settings index.
  const hub = page.locator('[data-slot="settings-hub"]');
  for (const destination of SETTINGS_DESTINATIONS) {
    await expect(hub.getByRole("link", { name: new RegExp(`^${destination.name}`) })).toHaveAttribute(
      "href",
      destination.href,
    );
  }
});

test("settings rows use one scan column and support keyboard navigation", async ({ page }) => {
  await page.goto("/dashboard/settings");

  const hub = page.locator('[data-slot="settings-hub"]');
  const generalLink = hub.getByRole("link", { name: /^General/ });
  const usersLink = hub.getByRole("link", { name: /^Users/ });
  const generalBox = await generalLink.boundingBox();
  const usersBox = await usersLink.boundingBox();

  expect(generalBox).not.toBeNull();
  expect(usersBox).not.toBeNull();
  expect(Math.abs((generalBox?.x ?? 0) - (usersBox?.x ?? 0))).toBeLessThan(2);
  expect((generalBox?.y ?? 0) + (generalBox?.height ?? 0)).toBeLessThanOrEqual(usersBox?.y ?? 0);

  await generalLink.focus();
  await expect(generalLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\/settings\/general$/);
});

test("settings pages draw no second nav and return to the hub from the header", async ({ page }) => {
  await page.goto("/dashboard/settings/users");
  await expect(page.locator('[data-slot="settings-nav-rail"]')).toHaveCount(0);
  const back = page.getByRole("link", { name: "Back to all settings" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await expect(page.getByRole("link", { name: "Back to all settings" })).toHaveCount(0);
});
