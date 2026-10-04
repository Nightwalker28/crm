import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test("guest dashboard access redirects to login", async ({ page }) => {
  await page.goto("/dashboard/settings/users");
  // The deep link rides along, so signing in comes back here (13a I2).
  await page.waitForURL("**/auth/login?next=%2Fdashboard%2Fsettings%2Fusers");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
});

test("failed required MFA setup returns login form to a usable state", async ({ page }) => {
  await page.route("**/auth/login", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "mfa_setup_required" }),
    });
  });
  await page.route("**/auth/mfa/setup", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "MFA setup is temporarily unavailable" }),
    });
  });

  await page.goto("/auth/login");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();

  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in with email" }).click();

  await expect(page.getByText("MFA setup could not be started. Try again.")).toBeVisible();
  await expect(page.getByText("MFA setup is temporarily unavailable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with SSO" })).toBeEnabled();
});

test("admin manual login and dashboard navigation works", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  // The settings rail is gone (2026-10-01): the hub links every settings page.
  await page.getByRole("main").getByRole("link", { name: /^Teams/ }).first().click();
  await page.waitForURL("**/dashboard/settings/teams");
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Finance" }).click();
  await page.getByRole("link", { name: "Insertion orders" }).click();
  await page.waitForURL("**/dashboard/finance/insertion-orders");
  await expect(page.getByRole("heading", { name: "Insertion orders" })).toBeVisible();

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("link", { name: "Accounts" }).click();
  await page.waitForURL("**/dashboard/sales/organizations");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

  // Sales is still open from Accounts, and its header is a toggle: clicking it again closes
  // the group. Open it only if it is shut.
  const sales = page.getByRole("button", { name: "Sales" });
  if ((await sales.getAttribute("aria-expanded")) !== "true") await sales.click();
  await page.getByRole("link", { name: "Contacts" }).click();
  await page.waitForURL("**/dashboard/sales/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
});

test("logged in user is redirected away from auth pages", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/auth/login");
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
