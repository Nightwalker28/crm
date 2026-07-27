import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    first_name: "Jamie",
    last_name: "Morgan",
    email: "jamie@example.test",
    photo_url: null,
    phone_number: "+1 555 0100",
    job_title: "Account Director",
    timezone: "America/New_York",
    bio: "Customer partnerships",
    team_name: "Revenue",
    role_name: "Manager",
    mfa_enabled: false,
    mfa_required: false,
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Profile is responsive, tracks dirty fields, and redacts save failures", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/users/me", async (route) => {
    if (route.request().method() === "PUT") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "database_password=profile-secret" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture()) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/profile");

  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save profile" })).toBeDisabled();
  await expect(page.getByLabel("Timezone")).toBeVisible();
  await page.getByLabel("First name").fill("Jordan");
  await expect(page.getByText("You have unsaved profile changes.")).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();

  expect(submitted).toMatchObject({
    first_name: "Jordan",
    last_name: "Morgan",
    timezone: "America/New_York",
  });
  await expect(page.getByText("We could not save your profile. Review the information and try again.")).toBeVisible();
  await expect(page.getByText("database_password=profile-secret")).toBeHidden();
});

test("Profile rejects oversized images before upload", async ({ page }) => {
  let uploadRequests = 0;
  await page.route("**/users/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture()) }),
  );
  await page.route("**/users/me/photo", async (route) => {
    uploadRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ photo_url: "/media/profile-assets/new.png" }) });
  });

  await page.goto("/dashboard/profile");
  await page.getByLabel("Upload profile photo").setInputFiles({
    name: "large-profile.png",
    mimeType: "image/png",
    buffer: Buffer.alloc((5 * 1024 * 1024) + 1),
  });

  await expect(page.getByText("Choose an image no larger than 5 MB.")).toBeVisible();
  expect(uploadRequests).toBe(0);
});

test("Profile MFA setup redacts backend configuration details", async ({ page }) => {
  await page.route("**/users/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture()) }),
  );
  await page.route("**/auth/mfa/setup", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "APP_ENCRYPTION_SECRET is missing from /srv/private.env" }),
    }),
  );

  await page.goto("/dashboard/profile");
  await page.getByRole("button", { name: "Set up MFA" }).click();

  await expect(page.getByText("We could not start MFA setup. Try again or contact an administrator.")).toBeVisible();
  await expect(page.getByText("APP_ENCRYPTION_SECRET is missing from /srv/private.env")).toBeHidden();
});

test("Profile presents one-time recovery codes after enabling MFA", async ({ page }) => {
  await page.route("**/users/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileFixture()) }),
  );
  await page.route("**/auth/mfa/setup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/Lynk:jamie" }),
    }),
  );
  await page.route("**/auth/mfa/enable", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", backup_codes: ["RECOVERY-ONE", "RECOVERY-TWO"] }),
    }),
  );

  await page.goto("/dashboard/profile");
  await page.getByRole("button", { name: "Set up MFA" }).click();
  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Enable MFA" }).click();

  await expect(page.getByText("Save these recovery codes now")).toBeVisible();
  await expect(page.getByText("RECOVERY-ONE")).toBeVisible();
  await expect(page.getByText("MFA enabled")).toBeVisible();
});

test("Profile confirms MFA disabling before changing security state", async ({ page }) => {
  let disableRequests = 0;
  await page.route("**/users/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profileFixture({ mfa_enabled: true })),
    }),
  );
  await page.route("**/auth/mfa/disable", async (route) => {
    disableRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });

  await page.goto("/dashboard/profile");
  await page.getByLabel("Current password").fill("correct horse battery staple");
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Disable MFA" }).click();

  expect(disableRequests).toBe(0);
  await expect(page.getByText("This removes your authenticator secret and unused recovery codes, reducing protection for manual sign-in.")).toBeVisible();
  await page.getByRole("button", { name: "Disable MFA" }).last().click();
  await expect.poll(() => disableRequests).toBe(1);
  await expect(page.getByText("MFA off")).toBeVisible();
});
