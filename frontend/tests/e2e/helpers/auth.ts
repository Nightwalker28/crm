import { expect, type Page } from "@playwright/test";

import { generateTotpCode, secondsUntilNextTotpWindow } from "./totp";

const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
const adminTotpSecret = process.env.E2E_ADMIN_TOTP_SECRET;
const adminMfaCode = process.env.E2E_ADMIN_MFA_CODE;
const adminRecoveryCode = process.env.E2E_ADMIN_RECOVERY_CODE;

/**
 * Derives a live authenticator code from the configured TOTP secret. A code generated in the
 * last moments of its window can expire before the request lands, so wait for the next window
 * rather than submit one that is about to roll over.
 */
async function currentTotpCode() {
  if (!adminTotpSecret) return null;

  const remaining = secondsUntilNextTotpWindow();
  if (remaining < 2) {
    await new Promise((resolve) => setTimeout(resolve, remaining * 1000 + 250));
  }
  return generateTotpCode(adminTotpSecret);
}

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
    const totpCode = await currentTotpCode();
    if (totpCode) {
      await authenticatorInput.fill(totpCode);
    } else if (adminMfaCode) {
      await authenticatorInput.fill(adminMfaCode);
    } else if (adminRecoveryCode) {
      await page.getByLabel("Recovery Code").fill(adminRecoveryCode);
    } else {
      throw new Error(
        "Admin MFA is enabled. Set E2E_ADMIN_TOTP_SECRET (the authenticator setup key) to generate codes automatically, or E2E_ADMIN_RECOVERY_CODE for a single run.",
      );
    }
    await page.getByRole("button", { name: "Verify MFA" }).click();

    // A rejected code drops the challenge and resets the sign-in form, so the only reliable
    // signal is whether the dashboard is reached. Translate the timeout into something actionable.
    try {
      await page.waitForURL("**/dashboard", { timeout: 20_000 });
    } catch {
      throw new Error(
        "The admin MFA code was not accepted. Check that E2E_ADMIN_TOTP_SECRET matches the account's enrolled authenticator and that the host clock is accurate.",
      );
    }
  }

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
