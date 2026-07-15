import { expect, type Page } from "@playwright/test";

const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
const adminMfaCode = process.env.E2E_ADMIN_MFA_CODE;
const adminRecoveryCode = process.env.E2E_ADMIN_RECOVERY_CODE;

export async function loginAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) {
    throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set for e2e tests.");
  }

  await page.goto("/auth/login");
  await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();

  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in with email" }).click();

  const authenticatorInput = page.getByLabel("Authenticator Code");
  await expect
    .poll(
      async () => page.url().endsWith("/dashboard") || await authenticatorInput.isVisible().catch(() => false),
      { message: "Expected login to reach the dashboard or MFA challenge.", timeout: 20_000 },
    )
    .toBeTruthy();

  if (await authenticatorInput.isVisible().catch(() => false)) {
    if (adminMfaCode) {
      await authenticatorInput.fill(adminMfaCode);
    } else if (adminRecoveryCode) {
      await page.getByLabel("Recovery Code").fill(adminRecoveryCode);
    } else {
      throw new Error("Admin MFA is enabled. Set E2E_ADMIN_MFA_CODE or E2E_ADMIN_RECOVERY_CODE to run authenticated browser tests.");
    }
    await page.getByRole("button", { name: "Verify MFA" }).click();
  }

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
