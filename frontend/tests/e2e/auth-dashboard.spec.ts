import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

async function loginAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) {
    throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set for e2e tests.");
  }

  await page.goto("/auth/login");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();

  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in with email" }).click();

  await page.waitForURL("**/dashboard/users");
  await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
}

test("guest dashboard access redirects to login", async ({ page }) => {
  await page.goto("/dashboard/users");
  await page.waitForURL("**/auth/login");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
});

test("admin manual login and dashboard navigation works", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole("link", { name: "Teams & Departments" }).click();
  await page.waitForURL("**/dashboard/user/teams");
  await expect(page.getByRole("heading", { name: "Teams & Departments" })).toBeVisible();

  await page.getByRole("button", { name: "Finance" }).click();
  await page.getByRole("link", { name: "Insertion Orders" }).click();
  await page.waitForURL("**/dashboard/finance/insertion-orders");
  await expect(page.getByRole("heading", { name: "Insertion Orders" })).toBeVisible();

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("link", { name: "Organizations" }).click();
  await page.waitForURL("**/dashboard/sales/organizations");
  await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("link", { name: "Contacts" }).click();
  await page.waitForURL("**/dashboard/sales/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
});

test("logged in user is redirected away from auth pages", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/auth/login");
  await page.waitForURL("**/dashboard/users");
  await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
});
