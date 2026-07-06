import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

async function loginAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) {
    throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set for e2e tests.");
  }

  await page.goto("/auth/login");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();

  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in with email" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("guest dashboard access redirects to login", async ({ page }) => {
  await page.goto("/dashboard/settings/users");
  await page.waitForURL("**/auth/login");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
});

test("failed required MFA setup returns login form to a usable state", async ({ page }) => {
  await page.route("**/auth/login", async (route) => {
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

  await expect(page.getByText("MFA setup is temporarily unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with SSO" })).toBeEnabled();
});

test("admin manual login and dashboard navigation works", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Teams" }).click();
  await page.waitForURL("**/dashboard/settings/teams");
  await expect(page.getByRole("heading", { name: "Teams & Departments" })).toBeVisible();

  await page.getByRole("button", { name: "Finance" }).click();
  await page.getByRole("link", { name: "Insertion Orders" }).click();
  await page.waitForURL("**/dashboard/finance/insertion-orders");
  await expect(page.getByRole("heading", { name: "Insertion Orders" })).toBeVisible();

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("link", { name: "Accounts" }).click();
  await page.waitForURL("**/dashboard/sales/organizations");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

  await page.getByRole("button", { name: "Sales" }).click();
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
