import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 3A, Organization run: Account → Email → send → the Account's Timeline.
 *
 * The Lead-proven composer and send route, addressed at an Account. The recipient decision is
 * the one under test: an account's Email is prefilled with the account's *own* address, never
 * with one of its contacts', because a contact is emailed from the contact's record so the
 * conversation lands on that person's Timeline (design.md §4.7). An account with no address of
 * its own offers no email action, however many contacts it has.
 */

const orgId = 987655201;
const moduleCacheKey = "lynk_modules:v4";
const sendUrl = `**/mail/records/sales_organizations/${orgId}/send`;

const accountSummary = (primaryEmail: string | null) => ({
  organization: {
    org_id: orgId,
    org_name: "Acme Robotics",
    primary_email: primaryEmail,
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  related_contacts: [
    { contact_id: 987655202, first_name: "Grace", last_name: "Hopper", primary_email: "grace@acme.test" },
    { contact_id: 987655203, first_name: "Alan", last_name: "Turing", primary_email: "alan@acme.test" },
  ],
  related_opportunities: [],
  related_quotes: [],
  related_orders: [],
  related_invoices: [],
  inferred_services: [],
  contact_count: 2,
  opportunity_count: 0,
  quote_count: 0,
  order_count: 0,
  invoice_count: 0,
});

const connectedMailbox = {
  connections: [{
    provider: "google", status: "connected", account_email: "rep@example.com", provider_mailbox_id: "primary",
    provider_mailbox_name: "Primary inbox", can_send: true, can_sync: true, last_synced_at: null, last_error: null,
    health_status: "healthy", credential_state: "active", scopes: ["gmail.send"], last_successful_sync_at: null,
    last_failure_reason: null, reconnect_required: false, reconnect_label: null, sync_unavailable_reason: null,
  }],
  sync_available: true,
  sync_note: "Mailbox sync is ready.",
};

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function activity(sent: boolean) {
  return {
    items: sent ? [{
      id: "email:9201", type: "email", occurred_at: "2099-07-24T08:00:00Z", title: "Annual renewal",
      summary: "Hello Acme team", direction: "outbound", status: "sent", actor: { user_id: 1, name: "rep@example.com" },
      source: { module_key: "mail", record_id: "9201" }, record: { module_key: "sales_organizations", entity_id: String(orgId) },
      capabilities: ["open", "reply"], meta: { from_email: "rep@example.com", to_recipients: ["hello@acme.test"], folder: "sent" },
    }] : [],
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

async function stubAccount(page: Page, primaryEmail: string | null) {
  const modules = ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents", "mail", "message_templates"].map((name, index) => ({
    id: 500 + index,
    name,
    is_enabled: true,
    actions: { can_view: true, can_create: true, can_edit: true, can_delete: true, can_restore: false, can_export: false, can_configure: false },
  }));
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
  await page.route(`**/sales/organizations/${orgId}/summary`, (route) => route.fulfill(json(accountSummary(primaryEmail))));
  await page.route("**/record-layouts/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "none" }) }));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }], has_more: false })));
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/record-comments?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/activity/record?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
}

function headerActions(page: Page) {
  return page.locator("[data-record-workspace-actions]");
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Account email is addressed to the account, sends against it, and lands on its timeline", async ({ page }) => {
  await stubAccount(page, "hello@acme.test");
  let sendCount = 0;
  await page.route("**/records/sales_organizations/*/activity?**", (route) => route.fulfill(json(activity(sendCount > 0))));
  await page.route(sendUrl, async (route) => {
    sendCount += 1;
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ provider: "google", to: ["hello@acme.test"], subject: "Annual renewal" });
    expect(payload.idempotency_key).toBeTruthy();
    await route.fulfill(json({ id: 9201, direction: "outbound", folder: "sent", send_status: "sent", created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }));
  });

  await page.goto(`/dashboard/sales/organizations/${orgId}`);
  await headerActions(page).getByRole("button", { name: "Email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: /Email Acme Robotics/ });
  await expect(composer).toBeVisible();
  // The account's own address, and only it: its two contacts are not guessed into To.
  await expect(composer.getByLabel("To")).toHaveValue("hello@acme.test");

  await composer.getByLabel("Subject").fill("Annual renewal");
  await composer.getByLabel("Message").fill("Hello Acme team");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer).toBeHidden();
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText("Annual renewal")).toBeVisible();
  expect(sendCount).toBe(1);
});

test("An account with no address of its own offers no email action", async ({ page }) => {
  await stubAccount(page, null);
  await page.route("**/records/sales_organizations/*/activity?**", (route) => route.fulfill(json(activity(false))));
  await page.goto(`/dashboard/sales/organizations/${orgId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Acme Robotics");
  await expect(headerActions(page).getByRole("button", { name: "Email", exact: true })).toHaveCount(0);
  await expect(headerActions(page).getByRole("link", { name: "Email" })).toHaveCount(0);
});
