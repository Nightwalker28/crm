import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 3A, Contact run: Contact → Email → send → the Contact's Timeline.
 *
 * The Lead-proven composer and send route, addressed at a Contact. The mail domain is stubbed at
 * the network boundary; what is under test is that the Contact page opens the contextual
 * composer (not a bare `mailto:`), the send is filed against *this* contact by URL, and an
 * opted-out contact offers no email action at all.
 */

const contactId = 987655101;
const moduleCacheKey = "lynk_modules:v4";
const sendUrl = `**/mail/records/sales_contacts/${contactId}/send`;

const contactSummary = (emailOptOut = false) => ({
  contact: {
    contact_id: contactId,
    first_name: "Grace",
    last_name: "Hopper",
    primary_email: "grace@example.test",
    email_opt_out: emailOptOut,
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  organization: null,
  related_opportunities: [],
  related_quotes: [],
  inferred_services: [],
  opportunity_count: 0,
  quote_count: 0,
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
      id: "email:9101", type: "email", occurred_at: "2099-07-24T08:00:00Z", title: "Contract renewal",
      summary: "Hello Grace", direction: "outbound", status: "sent", actor: { user_id: 1, name: "rep@example.com" },
      source: { module_key: "mail", record_id: "9101" }, record: { module_key: "sales_contacts", entity_id: String(contactId) },
      capabilities: ["open", "reply"], meta: { from_email: "rep@example.com", to_recipients: ["grace@example.test"], folder: "sent" },
    }] : [],
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

async function stubContact(page: Page, emailOptOut = false) {
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
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) => route.fulfill(json(contactSummary(emailOptOut))));
  await page.route("**/record-layouts/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "none" }) }));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }], has_more: false })));
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/record-comments?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/activity/record?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
}

function headerEmailAction(page: Page) {
  return page.locator("[data-record-workspace-actions]").getByRole("button", { name: "Email", exact: true });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Contact email composes, sends against this contact, and lands on its timeline", async ({ page }) => {
  await stubContact(page);
  let sendCount = 0;
  await page.route("**/records/sales_contacts/*/activity?**", (route) => route.fulfill(json(activity(sendCount > 0))));
  await page.route(sendUrl, async (route) => {
    sendCount += 1;
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ provider: "google", to: ["grace@example.test"], subject: "Contract renewal" });
    expect(payload.idempotency_key).toBeTruthy();
    await route.fulfill(json({ id: 9101, direction: "outbound", folder: "sent", send_status: "sent", created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }));
  });

  await page.goto(`/dashboard/sales/contacts/${contactId}`);
  await headerEmailAction(page).click();
  const composer = page.getByRole("dialog", { name: /Email Grace Hopper/ });
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("To")).toHaveValue("grace@example.test");

  await composer.getByLabel("Subject").fill("Contract renewal");
  await composer.getByLabel("Message").fill("Hello Grace");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer).toBeHidden();
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText("Contract renewal")).toBeVisible();
  expect(sendCount).toBe(1);
});

test("An opted-out contact offers no email action", async ({ page }) => {
  await stubContact(page, true);
  await page.route("**/records/sales_contacts/*/activity?**", (route) => route.fulfill(json(activity(false))));
  await page.goto(`/dashboard/sales/contacts/${contactId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Grace Hopper");
  await expect(headerEmailAction(page)).toHaveCount(0);
  await expect(page.locator("[data-record-workspace-actions]").getByRole("link", { name: "Email" })).toHaveCount(0);
});
