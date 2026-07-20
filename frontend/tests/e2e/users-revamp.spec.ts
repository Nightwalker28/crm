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

test("Administration settings are split into addressable tabs", async ({
  page,
}) => {
  await page.goto("/dashboard/settings/users");

  await page.getByRole("tab", { name: "Authentication" }).click();
  await expect(page).toHaveURL(/tab=authentication/);
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

  await page.getByRole("tab", { name: "Domains" }).click();
  await expect(page).toHaveURL(/tab=domains/);
  await expect(page.getByText("Custom domains")).toBeVisible();

  await page.getByRole("tab", { name: "Provisioning" }).click();
  await expect(page).toHaveURL(/tab=provisioning/);
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

  await page.goto("/dashboard/settings/users?tab=domains");

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
