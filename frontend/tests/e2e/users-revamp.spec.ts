import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const users = [
  {
    id: 987651,
    first_name: "Amina",
    last_name: "Silva",
    email: "amina@example.test",
    team_id: 11,
    role_id: 21,
    team_name: "Sales",
    role_name: "Sales Rep",
    role_level: 20,
    photo_url: null,
    auth_mode: "manual_only",
    mfa_enabled: false,
    mfa_required: false,
    is_active: "active",
  },
  {
    id: 987652,
    first_name: "Noah",
    last_name: "Fernando",
    email: "noah@example.test",
    team_id: 11,
    role_id: 21,
    team_name: "Sales",
    role_name: "Sales Rep",
    role_level: 20,
    photo_url: null,
    auth_mode: "manual_only",
    mfa_enabled: true,
    mfa_required: false,
    is_active: "active",
  },
];

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  await page.route("**/admin/users/options", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        roles: [
          { id: 21, name: "Sales Rep" },
          { id: 22, name: "Manager" },
        ],
        teams: [{ id: 11, name: "Sales" }],
        statuses: ["active", "inactive"],
      }),
    }),
  );
  await page.route("**/admin/users/mfa-policy", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: "admins_only" }),
    }),
  );
  await page.route("**/auth/password-policy", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        min_length: 12,
        requirements: [
          "Use at least 12 characters.",
          "Use at least one uppercase letter, one lowercase letter, and one number.",
          "Avoid common or repeated-character passwords.",
        ],
      }),
    }),
  );
  await page.route("**/admin/users/sso-settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        provider_type: "oidc",
        issuer_url: null,
        authorization_endpoint: null,
        token_endpoint: null,
        userinfo_endpoint: null,
        jwks_uri: null,
        client_id: null,
        has_client_secret: false,
        allowed_email_domains: [],
        auto_provision_users: false,
        default_role_id: null,
        default_team_id: null,
        email_claim: "email",
        first_name_claim: "given_name",
        last_name_claim: "family_name",
        status: "disabled",
        last_test_result: {
          ok: false,
          message: "Issuer certificate could not be verified.",
          checked_at: "2099-07-20T09:00:00Z",
          metadata: {},
          errors: ["Provider returned TLS_CERT_ERROR"],
        },
        last_successful_test: {
          ok: true,
          message: "Connection verified.",
          checked_at: "2099-07-19T09:00:00Z",
          metadata: {},
          errors: [],
        },
        last_failed_test: {
          ok: false,
          message: "Issuer certificate could not be verified.",
          checked_at: "2099-07-20T09:00:00Z",
          metadata: {},
          errors: ["Provider returned TLS_CERT_ERROR"],
        },
        last_successful_login_at: "2099-07-18T09:00:00Z",
        last_failed_login_reason: "Provider rejected the callback.",
      }),
    }),
  );
  await page.route("**/admin/users/sso-settings/test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        message: "Connection verified.",
        checked_at: "2099-07-20T10:00:00Z",
        metadata: {},
        errors: [],
      }),
    }),
  );
  await page.route("**/admin/users/domains", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
  await page.route("**/admin/users/search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: users,
        range_start: 1,
        range_end: users.length,
        total_count: users.length,
        total_pages: 1,
        page: 1,
        page_size: 10,
      }),
    }),
  );
});

test("legacy tab URLs redirect to dedicated routes", async ({ page }) => {
  for (const section of ["authentication", "domains", "provisioning"]) {
    await page.goto(`/dashboard/settings/users?tab=${section}`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/settings/${section}$`));
  }
});

test("Users does not fetch identity or domain settings", async ({ page }) => {
  let identityRequests = 0;
  await page.route(/\/admin\/users\/(mfa-policy|sso-settings|domains)/, async (route) => {
    identityRequests += 1;
    await route.continue();
  });
  await page.goto("/dashboard/settings/users");
  await expect(page.getByPlaceholder("Search users...")).toBeVisible();
  expect(identityRequests).toBe(0);
});

test("Authentication keeps dirty SSO values until save", async ({ page }) => {
  let savedPayload: Record<string, unknown> | null = null;
  await page.route("**/admin/users/sso-settings", async (route) => {
    if (route.request().method() === "PUT") {
      savedPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...savedPayload, provider_type: "oidc", has_client_secret: false, allowed_email_domains: [], auto_provision_users: false, default_role_id: null, default_team_id: null, email_claim: "email", first_name_claim: "given_name", last_name_claim: "family_name", status: "configured", last_test_result: null, last_successful_test: null, last_failed_test: null, last_successful_login_at: null, last_failed_login_reason: null }) });
      return;
    }
    await route.fallback();
  });
  await page.goto("/dashboard/settings/authentication");
  await page.getByLabel("Issuer URL").fill("https://identity.example.test");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Domains", exact: true }).click();
  await expect(page).toHaveURL(/settings\/authentication/);
  await expect(page.getByLabel("Issuer URL")).toHaveValue("https://identity.example.test");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => savedPayload?.issuer_url).toBe("https://identity.example.test");
});

test("Provisioning saves defaults without authentication fields", async ({ page }) => {
  let savedPayload: Record<string, unknown> | null = null;
  await page.route("**/admin/users/sso-settings", async (route) => {
    if (route.request().method() === "PUT") {
      savedPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...savedPayload, enabled: false, provider_type: "oidc", issuer_url: null, authorization_endpoint: null, token_endpoint: null, userinfo_endpoint: null, jwks_uri: null, client_id: null, has_client_secret: false, allowed_email_domains: [], status: "disabled", last_test_result: null, last_successful_test: null, last_failed_test: null, last_successful_login_at: null, last_failed_login_reason: null }) });
      return;
    }
    await route.fallback();
  });
  await page.goto("/dashboard/settings/provisioning");
  await page.getByRole("combobox", { name: "Default role" }).click();
  await page.getByRole("option", { name: "Manager" }).click();
  await page.getByRole("button", { name: "Save provisioning" }).click();
  await expect.poll(() => savedPayload?.default_role_id).toBe(22);
  expect(savedPayload).not.toHaveProperty("issuer_url");
});

test("User filters follow one vertical scan path and expose selected state", async ({ page }) => {
  await page.goto("/dashboard/settings/users");
  await page.getByRole("button", { name: /^Filters/ }).click();

  const teamsHeading = page.getByRole("heading", { name: "Teams", exact: true });
  const rolesHeading = page.getByRole("heading", { name: "Roles", exact: true });
  const statusHeading = page.getByRole("heading", { name: "Status", exact: true });
  const [teamsBox, rolesBox, statusBox] = await Promise.all([
    teamsHeading.boundingBox(),
    rolesHeading.boundingBox(),
    statusHeading.boundingBox(),
  ]);

  expect(teamsBox).not.toBeNull();
  expect(rolesBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(teamsBox?.y ?? 0).toBeLessThan(rolesBox?.y ?? 0);
  expect(rolesBox?.y ?? 0).toBeLessThan(statusBox?.y ?? 0);

  const managerFilter = page.getByRole("button", { name: "Manager", exact: true });
  await managerFilter.click();
  await expect(managerFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("Users supports responsive bulk role and status updates", async ({
  page,
}) => {
  let bulkPayload: unknown;
  await page.route("**/admin/users/bulk", async (route) => {
    bulkPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(users),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/users");

  await expect(
    page.getByRole("heading", { name: "User Management" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Search users...")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Amina Silva" }).click();
  await page.getByRole("checkbox", { name: "Select Noah Fernando" }).click();
  await page.getByRole("combobox", { name: "Bulk role" }).click();
  await page.getByRole("option", { name: "Set role: Manager" }).click();
  await page.getByRole("combobox", { name: "Bulk status" }).click();
  await page.getByRole("option", { name: "Set inactive" }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();

  await expect(page.getByText("2 users updated.")).toBeVisible();
  expect(bulkPayload).toEqual({
    user_ids: [987651, 987652],
    role_id: 22,
    is_active: "inactive",
  });
});

test("opens Add User from the palette action deep link", async ({ page }) => {
  await page.goto("/dashboard/settings/users?action=create-user");

  await expect(page.getByRole("heading", { name: "Add user" })).toBeVisible();
});

test("Add user validates labeled fields and redacts create failures", async ({
  page,
}) => {
  await page.route("**/admin/users", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_password=private-secret" }),
    }),
  );
  await page.goto("/dashboard/settings/users?action=create-user");

  const email = page.getByLabel("Email");
  await email.fill("not-an-email");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create user" })).toBeDisabled();

  await email.fill("new.user@example.test");
  await page.getByRole("combobox", { name: "Team", exact: true }).click();
  await page.getByRole("option", { name: "Sales" }).click();
  await page.getByRole("combobox", { name: "Role", exact: true }).click();
  await page.getByRole("option", { name: "Sales Rep" }).click();
  await expect(page.getByRole("combobox", { name: "Sign-in mode" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create user" }).click();
  await expect(
    page.getByText("The user could not be created. Review the details and try again."),
  ).toBeVisible();
  await expect(page.getByText("database_password=private-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create user" })).toBeEnabled();
});

test("Edit user enforces self-protection and semantic MFA state", async ({
  page,
}) => {
  await page.evaluate((userId) => {
    window.sessionStorage.setItem("lynk_user", JSON.stringify({ id: userId }));
  }, users[0].id);
  await page.goto("/dashboard/settings/users");

  await page.getByRole("row", { name: /Amina Silva/ }).click();
  await expect(page.getByRole("heading", { name: "Edit user" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Role", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeDisabled();
  await expect(page.getByText("You cannot deactivate your own account.")).toBeVisible();
  await expect(page.locator("span.bg-surface-muted", { hasText: "Off" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("Edit user prevents repeat saves and redacts update failures", async ({
  page,
}) => {
  await page.route(`**/admin/users/${users[1].id}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 internal_trace=private" }),
    });
  });
  await page.goto("/dashboard/settings/users");

  await page.getByRole("row", { name: /Noah Fernando/ }).click();
  await page.getByRole("combobox", { name: "Role", exact: true }).click();
  await page.getByRole("option", { name: "Manager" }).click();
  const saveButton = page.getByRole("button", { name: "Save changes" });
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(
    page.getByText("The user could not be updated. Review the selections and try again."),
  ).toBeVisible();
  await expect(page.getByText("tenant_id=42 internal_trace=private")).toHaveCount(0);
  await expect(saveButton).toBeEnabled();
});

test("Administration settings use dedicated routes", async ({
  page,
}) => {
  await page.goto("/dashboard/settings/authentication");
  await expect(page.getByText("MFA policy")).toBeVisible();
  await expect(page.getByText("Password policy")).toBeVisible();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page.getByText("OIDC SSO")).toBeVisible();
  await expect(
    page.getByText("Issuer certificate could not be verified."),
  ).not.toBeVisible();
  await page.getByText("View technical details").click();
  await expect(
    page.getByText("Issuer certificate could not be verified."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("SSO configuration test passed.")).toBeVisible();

  await page.getByRole("link", { name: "Domains", exact: true }).click();
  await expect(page).toHaveURL(/settings\/domains/);
  await expect(page.getByText("Custom domains")).toBeVisible();

  await page.getByRole("link", { name: "Provisioning", exact: true }).click();
  await expect(page).toHaveURL(/settings\/provisioning/);
  await expect(page.getByText("User provisioning")).toBeVisible();
  await expect(page.getByText("Auto-provision users")).toBeVisible();
});

test("Domains shows DNS records, failed checks, and guarded removal", async ({
  page,
}) => {
  let domain = {
    id: 765431,
    hostname: "lynk.example.com",
    is_primary: true,
    status: "pending",
    verification_token: "lynk-domain-verification=test-token",
    txt_record_name: "example.com",
    txt_record_value: "lynk-domain-verification=test-token",
    verified_at: null as string | null,
    last_checked_at: null as string | null,
    created_at: "2099-07-20T08:00:00Z",
  };
  let added = false;
  let deleted = false;

  await page.route("**/admin/users/domains", async (route) => {
    if (route.request().method() === "POST") {
      added = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(domain),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(added && !deleted ? [domain] : []),
    });
  });
  await page.route(
    `**/admin/users/domains/${domain.id}/verify`,
    async (route) => {
      domain = {
        ...domain,
        status: "failed",
        last_checked_at: "2099-07-20T09:00:00Z",
      };
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Provider-specific DNS failure" }),
      });
    },
  );
  await page.route(`**/admin/users/domains/${domain.id}`, async (route) => {
    deleted = true;
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/dashboard/settings/domains");

  await expect(page.getByText("No custom domains yet")).toBeVisible();
  await page.getByLabel("Custom domain").fill("lynk.example.com");
  await page.getByRole("button", { name: "Add Domain" }).click();
  await expect(page.getByText("Custom domain added.")).toBeVisible();
  await expect(page.getByText("lynk.example.com")).toBeVisible();
  await expect(page.getByText("TXT", { exact: true })).toBeVisible();
  await expect(page.getByText("example.com", { exact: true })).toBeVisible();
  await expect(
    page.getByText("lynk-domain-verification=test-token", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Never", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText(
      "The custom domain could not be verified. Please try again.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "DNS proof was not found. Confirm the TXT host and value, allow for propagation, then verify again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Provider-specific DNS failure"),
  ).not.toBeVisible();
  await expect(page.getByText("Never", { exact: true })).not.toBeVisible();

  await page.getByRole("button", { name: "Remove lynk.example.com" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove custom domain?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove domain" }).click();
  await expect(page.getByText("Custom domain removed.")).toBeVisible();
  await expect(page.getByText("No custom domains yet")).toBeVisible();
});
