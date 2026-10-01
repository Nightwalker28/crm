import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 3A, Opportunity run: Deal → Email, addressed to the deal's participants.
 *
 * Owner decision (docs/crm-evolution/STATUS.md, 2026-09-29), following Salesforce, Dynamics
 * and HubSpot: the deal offers Email when at least one participant can be emailed; one such
 * participant is prefilled, several leave To empty for the user to choose; opted-out
 * participants are listed but cannot be chosen; the send names the chosen participants so the
 * server files each beside the deal (design.md §4.7).
 */

const dealId = 987655501;
const graceId = 987655502;
const linusId = 987655503;
const ottoId = 987655504;
const moduleCacheKey = "lynk_modules:v4";
const sendUrl = `**/mail/records/sales_opportunities/${dealId}/send`;

type Person = { id: number; first: string; role: string; primary?: boolean; optedOut?: boolean; email?: string | null };

const grace: Person = { id: graceId, first: "Grace", role: "Champion", primary: true };
const linus: Person = { id: linusId, first: "Linus", role: "Finance" };
const otto: Person = { id: ottoId, first: "Otto", role: "Legal", optedOut: true };

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function participant(person: Person, index: number) {
  const email = person.email === undefined ? `${person.first.toLowerCase()}@acme.test` : person.email;
  return {
    id: 800 + index,
    opportunity_id: dealId,
    contact_id: person.id,
    role_key: person.role.toLowerCase(),
    role_label: person.role,
    is_primary: Boolean(person.primary),
    contact_name: `${person.first} Example`,
    contact: {
      contact_id: person.id,
      first_name: person.first,
      last_name: "Example",
      primary_email: email,
      email_opt_out: Boolean(person.optedOut),
    },
  };
}

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

function activity(sent: boolean) {
  return {
    items: sent ? [{
      id: "email:9301", type: "email", occurred_at: "2099-07-24T08:00:00Z", title: "Pilot pricing",
      summary: "Hello Linus", direction: "outbound", status: "sent", actor: { user_id: 1, name: "rep@example.com" },
      source: { module_key: "mail", record_id: "9301" }, record: { module_key: "sales_opportunities", entity_id: String(dealId) },
      capabilities: ["open", "reply"], meta: { from_email: "rep@example.com", to_recipients: ["linus@acme.test"], folder: "sent" },
    }] : [],
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

async function stubDeal(page: Page, people: Person[], state: { sent: boolean } = { sent: false }) {
  const modules = ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents", "mail", "message_templates"].map((name, index) => ({
    id: 700 + index,
    name,
    is_enabled: true,
    actions: { can_view: true, can_create: true, can_edit: true, can_delete: false, can_restore: false, can_export: false, can_configure: false },
  }));
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
  const participants = people.map(participant);
  const primary = participants.find((item) => item.is_primary);
  await page.route(`**/sales/opportunities/${dealId}/summary`, (route) => route.fulfill(json({
    opportunity: {
      opportunity_id: dealId, opportunity_name: "Acme Pilot", sales_stage: "proposal",
      contact_id: primary?.contact_id ?? null, organization_id: 1, organization_name: "Acme",
      assigned_to: 7, assigned_to_name: "Ada Owner", custom_fields: {},
    },
    contact: primary ? primary.contact : null,
    organization: { org_id: 1, org_name: "Acme" },
    participant_contacts: participants,
    can_view_contacts: true,
    related_quotes: [], related_insertion_orders: [], inferred_services: [], insertion_order_count: 0,
  })));
  await page.route("**/record-layouts/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "none" }) }));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }], has_more: false })));
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
  await page.route("**/records/sales_opportunities/*/activity?**", (route) => route.fulfill(json(activity(state.sent))));
}

function headerEmail(page: Page) {
  return page.locator("[data-record-workspace-actions]").getByRole("button", { name: "Email", exact: true });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Several participants: To starts empty, the user picks, and the send names the pick", async ({ page }) => {
  const state = { sent: false };
  await stubDeal(page, [grace, linus, otto], state);
  let payload: Record<string, unknown> | null = null;
  await page.route(sendUrl, async (route) => {
    payload = route.request().postDataJSON();
    state.sent = true;
    await route.fulfill(json({ id: 9301, direction: "outbound", folder: "sent", send_status: "sent", created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }));
  });

  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await headerEmail(page).click();
  const composer = page.getByRole("dialog", { name: /Email Acme Pilot/ });
  await expect(composer).toBeVisible();
  // Not the primary, not anybody: the choice is the user's.
  await expect(composer.locator("#record-mail-to")).toHaveValue("");

  const list = composer.getByRole("list", { name: "Participants" });
  await expect(list.getByRole("listitem").filter({ hasText: "Grace Example" })).toContainText("Champion · Primary contact");
  await expect(list.getByRole("listitem").filter({ hasText: "Linus Example" })).toContainText("Finance · linus@acme.test");
  await expect(list.getByRole("listitem").filter({ hasText: "Otto Example" })).toContainText("Opted out of email");
  await expect(composer.getByRole("checkbox", { name: "Otto Example" })).toBeDisabled();

  await composer.getByRole("checkbox", { name: "Linus Example" }).click();
  await expect(composer.locator("#record-mail-to")).toHaveValue("linus@acme.test");
  await composer.getByLabel("Subject").fill("Pilot pricing");
  await composer.getByLabel("Message").fill("Hello Linus");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer).toBeHidden();
  expect(payload).toMatchObject({ to: ["linus@acme.test"], related_contact_ids: [linusId], subject: "Pilot pricing" });
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText("Pilot pricing")).toBeVisible();
});

test("Unticking a participant takes its address out of To", async ({ page }) => {
  await stubDeal(page, [grace, linus]);
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await headerEmail(page).click();
  const composer = page.getByRole("dialog", { name: /Email Acme Pilot/ });
  await composer.getByRole("checkbox", { name: "Grace Example" }).click();
  await composer.getByRole("checkbox", { name: "Linus Example" }).click();
  await expect(composer.locator("#record-mail-to")).toHaveValue("grace@acme.test, linus@acme.test");
  await composer.getByRole("checkbox", { name: "Grace Example" }).click();
  await expect(composer.locator("#record-mail-to")).toHaveValue("linus@acme.test");
});

test("One participant who can be emailed is prefilled", async ({ page }) => {
  await stubDeal(page, [grace, otto, { id: 987655505, first: "Nomail", role: "Technical", email: null }]);
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await headerEmail(page).click();
  const composer = page.getByRole("dialog", { name: /Email Acme Pilot/ });
  await expect(composer.locator("#record-mail-to")).toHaveValue("grace@acme.test");
  await expect(composer.getByRole("checkbox", { name: "Grace Example" })).toBeChecked();
  await expect(composer.getByRole("list", { name: "Participants" }).getByRole("listitem").filter({ hasText: "Nomail" })).toContainText("No email address");
});

test("A typed opted-out address is refused before sending", async ({ page }) => {
  await stubDeal(page, [grace, otto]);
  let sends = 0;
  await page.route(sendUrl, (route) => { sends += 1; return route.fulfill(json({})); });
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await headerEmail(page).click();
  const composer = page.getByRole("dialog", { name: /Email Acme Pilot/ });
  await composer.locator("#record-mail-to").fill("grace@acme.test, OTTO@acme.test");
  await composer.getByRole("button", { name: "Send email" }).click();
  await expect(composer.getByText("Otto Example has opted out of email.")).toBeVisible();
  expect(sends).toBe(0);
});

test("A deal whose participants cannot be emailed offers no Email", async ({ page }) => {
  await stubDeal(page, [otto]);
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Acme Pilot");
  await expect(headerEmail(page)).toHaveCount(0);
});
