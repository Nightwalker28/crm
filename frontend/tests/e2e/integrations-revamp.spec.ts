import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const providerHealth = {
  provider: {
    id: 1,
    key: "google_calendar",
    name: "Google Calendar",
    category: "Scheduling",
    description: "Google Calendar sync for CRM calendar events.",
    enabled: true,
    metadata_json: { config_href: "/dashboard/settings/integrations" },
  },
  connection: {
    id: 4,
    provider_key: "google_calendar",
    status: "reconnect_required",
    provider_display_name: "Google Calendar",
    account_label: "admin@example.com",
    last_sync_at: "2099-07-24T08:00:00Z",
    last_successful_sync_at: "2099-07-23T08:00:00Z",
    source: "calendar",
    connection_count: 1,
    credential_state: "expired",
    health_status: "reconnect_required",
    scopes: ["calendar.events"],
    last_error: "oauth_client_secret=do-not-render",
    last_failure_reason: "oauth_client_secret=do-not-render",
    reconnect_url: "/dashboard/settings/integrations",
    reconnect_action: "Reconnect Google Calendar",
    queued_jobs: 0,
    failed_jobs: 1,
    help_text: "Reconnect Google Calendar, then retry sync.",
  },
};

async function mockIntegrations(page: import("@playwright/test").Page) {
  await page.route("**/admin/integrations-registry/health", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [providerHealth] }) }),
  );
  await page.route("**/integrations/api-keys", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 8, api_key: "lynk_live_visible_once", name: "Website", scopes: ["catalog:read"], allowed_origins: [], status: "active" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 7, name: "Production website", key_prefix: "lynk_live", scopes: ["catalog:read"], allowed_origins: [], status: "active", last_used_at: null, created_at: "2099-07-24T08:00:00Z" }]),
    });
  });
  await page.route("**/integrations/catalog/published?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total_count: 0 }) }),
  );
  await page.route("**/integrations/orders?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route("**/admin/notification-channels", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 3, provider: "slack", channel_name: "#sales", webhook_url_masked: "https://hooks.slack.com/***", is_active: true, created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }] }),
    }),
  );
  await page.route("**/admin/crm-events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 9,
          actor_user_id: 1,
          event_type: "lead.created",
          entity_type: "sales_contact",
          entity_id: "21",
          payload: { lead_name: "New lead" },
          created_at: "2099-07-24T08:00:00Z",
          deliveries: [{ id: 10, channel_id: 3, provider: "slack", status: "failed", channel_name: "#sales", error_message: "webhook_token=do-not-render", delivered_at: null, created_at: "2099-07-24T08:00:00Z" }],
        }],
      }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await mockIntegrations(page);
});

test("Integrations show provider account and safe recovery guidance on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/integrations");

  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByText("admin@example.com")).toBeVisible();
  await expect(page.getByText("This connection needs attention. Review its configuration or reconnect, then try again.")).toBeVisible();
  await expect(page.getByText("oauth_client_secret=do-not-render")).toBeHidden();
  await expect(page.getByText("webhook_token=do-not-render")).toBeHidden();
});

test("API key creation labels scopes and exposes the secret only until dismissed", async ({ page }) => {
  await page.goto("/dashboard/settings/integrations");

  await page.getByRole("button", { name: "New API key" }).click();
  const apiKeyEditor = page.getByRole("dialog", { name: "Create API key" });
  await expect(apiKeyEditor).toBeVisible();
  await page.getByLabel("Key Name").fill("Website");
  await expect(page.getByLabel("Allow catalog read access")).toBeChecked();
  await page.getByRole("button", { name: "Create API Key" }).click();
  await expect(page.getByText("lynk_live_visible_once")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("lynk_live_visible_once")).toBeHidden();
  await expect(apiKeyEditor).toHaveCount(0);
});

test("Webhook creation uses an explicit guarded drawer", async ({ page }) => {
  await page.goto("/dashboard/settings/integrations");

  await page.getByRole("button", { name: "New webhook" }).click();
  const webhookEditor = page.getByRole("dialog", { name: "Create webhook" });
  await expect(webhookEditor).toBeVisible();
  await expect(webhookEditor.getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Channel Name").fill("#operations");
  await webhookEditor.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Discard webhook draft?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(webhookEditor).toHaveCount(0);
});

test("Sensitive integration actions require confirmation", async ({ page }) => {
  await page.goto("/dashboard/settings/integrations");

  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(page.getByRole("heading", { name: "Rotate Production website?" })).toBeVisible();
  await expect(page.getByText("The current key will stop working immediately.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Delete #sales" }).click();
  await expect(page.getByRole("heading", { name: "Delete #sales webhook?" })).toBeVisible();
});
