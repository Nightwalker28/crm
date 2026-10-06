import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Calls — 07-telephony.md Phase 1: `tel:` fallback and manual call logs.
 *
 * Lynk places no calls. The header's Call dials through the operator's phone; the Timeline's
 * Call mode records what they report afterwards and never dials on submit. On a deal the call
 * names the participant on the line, and several participants are the operator's choice
 * (design.md §4.7). The feed entry says the call was logged by hand.
 *
 * Every API the pages read is stubbed, so nothing is written.
 */

const leadId = 987656101;
const dealId = 987656201;
const graceId = 987656202;
const linusId = 987656203;
const moduleCacheKey = "lynk_modules:v4";
const leadCalls = `**/telephony/records/sales_leads/${leadId}/calls`;
const dealCalls = `**/telephony/records/sales_opportunities/${dealId}/calls`;

type Person = { id: number; first: string; role: string; phone: string | null; primary?: boolean };
const grace: Person = { id: graceId, first: "Grace", role: "Champion", phone: "+44 20 7946 0002", primary: true };
const linus: Person = { id: linusId, first: "Linus", role: "Finance", phone: "+44 (20) 7946-0003" };

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function activity(items: unknown[] = []) {
  return {
    items,
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["call", "email", "follow_up", "meeting", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

function loggedCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    module_key: "sales_leads",
    entity_id: String(leadId),
    capture: "manual",
    direction: "outbound",
    outcome: "no_answer",
    occurred_at: "2099-07-24T08:00:00Z",
    duration_seconds: null,
    note: null,
    phone_number: "+44 20 7946 0000",
    contact_id: null,
    follow_up_task_id: null,
    ...overrides,
  };
}

async function stubModules(page: Page, names: string[]) {
  const modules = names.map((name, index) => ({
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
  await page.route("**/record-layouts/**", (route) => route.fulfill(json({ detail: "none" }, 404)));
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/record-comments?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/activity/record?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [], has_more: false })));
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
  await page.route("**/whatsapp/capabilities", (route) =>
    route.fulfill(json({
      default_mode: "external_link",
      effective_mode: "external_link",
      modes: [{ mode: "external_link", enabled: true, available: true, unavailable_reason: null, sends_from_crm: false, tracks_delivery: false, receives_inbound: false }],
    })),
  );
}

async function stubLead(page: Page, feed: unknown[] = []) {
  await stubModules(page, ["sales_leads", "tasks", "documents", "message_templates"]);
  await page.route("**/records/sales_leads/*/activity?**", (route) => route.fulfill(json(activity(feed))));
  await page.route(`**/sales/leads/${leadId}/summary`, (route) =>
    route.fulfill(json({
      lead: {
        lead_id: leadId,
        first_name: "Ada",
        last_name: "Lovelace",
        company: "Lynk QA",
        primary_email: "ada@example.com",
        phone: "+44 20 7946 0000",
        status: "qualified",
        custom_fields: {},
        updated_at: "2099-07-20T09:30:00Z",
        score: 45,
        score_grade: "warm",
        score_factors: [],
        assigned_to: 7,
        assigned_to_name: "Ada Owner",
        tags: [],
        next_follow_up_is_overdue: false,
      },
    })),
  );
}

async function stubDeal(page: Page, people: Person[]) {
  await stubModules(page, ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents", "message_templates"]);
  await page.route("**/records/sales_opportunities/*/activity?**", (route) => route.fulfill(json(activity())));
  await page.route("**/mail/context", (route) => route.fulfill(json({ connections: [], sync_available: false, sync_note: null })));
  const participants = people.map((person, index) => ({
    id: 900 + index,
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
      primary_email: `${person.first.toLowerCase()}@acme.test`,
      contact_telephone: person.phone,
      email_opt_out: false,
    },
  }));
  const primary = participants.find((item) => item.is_primary);
  await page.route(`**/sales/opportunities/${dealId}/summary`, (route) =>
    route.fulfill(json({
      opportunity: {
        opportunity_id: dealId, opportunity_name: "Acme Pilot", sales_stage: "proposal",
        contact_id: primary?.contact_id ?? null, organization_id: 1, organization_name: "Acme",
        assigned_to: 7, assigned_to_name: "Ada Owner", custom_fields: {},
      },
      contact: primary ? primary.contact : null,
      organization: { org_id: 1, org_name: "Acme" },
      participant_contacts: participants,
      can_view_contacts: true,
      related_quotes: [], inferred_services: [],
    })),
  );
}

async function openCallMode(page: Page) {
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByLabel("Add to the timeline").getByRole("radio", { name: "Call" }).click();
}

async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  // Sign-in plus a record page leaves little of the default budget for the interaction on
  // the capped dev server (as in whatsapp-external-mode).
  test.slow();
  await loginAsAdmin(page);
});

test("the header dials the lead's number, and the Call mode logs what happened without dialling", async ({ page }) => {
  await stubLead(page);
  let payload: Record<string, unknown> | null = null;
  await page.route(leadCalls, async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill(json(loggedCall({ direction: "inbound", follow_up_task_id: 77 }), 201));
  });
  await page.goto(`/dashboard/sales/leads/${leadId}`);

  await expect(
    page.locator("[data-record-workspace-actions]").getByRole("link", { name: "Call" }),
  ).toHaveAttribute("href", "tel:+442079460000");

  await openCallMode(page);
  const logButton = page.getByRole("button", { name: "Log call" });
  await expect(logButton).toBeDisabled();
  await expect(page.getByText("Choose an outcome to log the call.")).toBeVisible();
  await expect(page.getByText("Lynk does not place, time or record calls.")).toBeVisible();

  await page.getByLabel("Call direction").getByRole("radio", { name: "Inbound" }).click();
  await choose(page, "Outcome", "Left voicemail");
  await page.getByLabel("Duration in minutes").fill("4");
  await page.getByLabel("Call note").fill("Asked for pricing");
  const url = page.url();
  await logButton.click();

  await expect(page.getByText("Call logged and reminder created.")).toBeVisible();
  expect(payload).toEqual({
    direction: "inbound",
    outcome: "left_voicemail",
    occurred_at: null,
    duration_seconds: 240,
    note: "Asked for pricing",
    contact_id: null,
    create_follow_up_task: true,
    follow_up_due_at: null,
  });
  // Logging is not dialling: the page did not hand itself to `tel:`.
  expect(page.url()).toBe(url);
  await expect(page.getByLabel("Call note")).toHaveValue("");
  await expect(logButton).toBeDisabled();
});

test("a refused log says why and keeps what was typed", async ({ page }) => {
  await stubLead(page);
  await page.route(leadCalls, (route) => route.fulfill(json({ detail: "You cannot log calls on this record." }, 403)));
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await openCallMode(page);

  await choose(page, "Outcome", "Connected");
  await page.getByLabel("Call note").fill("Agreed next steps");
  await page.getByRole("button", { name: "Log call" }).click();

  await expect(page.getByText("The call could not be logged. You cannot log calls on this record.")).toBeVisible();
  await expect(page.getByLabel("Call note")).toHaveValue("Agreed next steps");
});

test("a time in the future and a bad duration are caught before anything is sent", async ({ page }) => {
  await stubLead(page);
  let sends = 0;
  await page.route(leadCalls, (route) => {
    sends += 1;
    return route.fulfill(json(loggedCall(), 201));
  });
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await openCallMode(page);

  await choose(page, "Outcome", "Connected");
  await page.getByLabel("When").fill("2099-01-01T10:00");
  await expect(page.getByRole("alert").filter({ hasText: "A call cannot be logged in the future." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log call" })).toBeDisabled();

  await page.getByLabel("When").fill("");
  await page.getByLabel("Duration in minutes").fill("2.5");
  await expect(page.getByRole("alert").filter({ hasText: "Enter whole minutes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log call" })).toBeDisabled();
  expect(sends).toBe(0);
});

test("several participants: the operator chooses who was on the call, and the log names them", async ({ page }) => {
  await stubDeal(page, [grace, linus]);
  let payload: Record<string, unknown> | null = null;
  await page.route(dealCalls, async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill(json(loggedCall({ module_key: "sales_opportunities", entity_id: String(dealId), contact_id: linusId }), 201));
  });
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await openCallMode(page);

  // Not the primary, not anybody.
  await expect(page.getByText("Choose who was on the call.")).toBeVisible();
  await choose(page, "Outcome", "Connected");
  await expect(page.getByRole("button", { name: "Log call" })).toBeDisabled();

  await choose(page, "Who was on the call", "Linus Example · Finance");
  await expect(page.getByRole("link", { name: "Call +44 (20) 7946-0003" })).toHaveAttribute("href", "tel:+442079460003");
  await page.getByRole("button", { name: "Log call" }).click();

  await expect(page.getByText("Call logged.")).toBeVisible();
  expect(payload).toMatchObject({ contact_id: linusId, outcome: "connected" });
});

test("a call with someone not listed is logged on the deal alone", async ({ page }) => {
  await stubDeal(page, [grace, linus]);
  let payload: Record<string, unknown> | null = null;
  await page.route(dealCalls, async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill(json(loggedCall({ module_key: "sales_opportunities", entity_id: String(dealId) }), 201));
  });
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await openCallMode(page);

  await choose(page, "Who was on the call", "Someone not listed");
  await choose(page, "Outcome", "Busy");
  await expect(page.getByRole("link", { name: /^Call / })).toHaveCount(0);
  await page.getByRole("button", { name: "Log call" }).click();

  await expect(page.getByText("Call logged.")).toBeVisible();
  expect(payload).toMatchObject({ contact_id: null, outcome: "busy" });
});

test("one participant is preselected", async ({ page }) => {
  await stubDeal(page, [grace]);
  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await openCallMode(page);

  await expect(page.getByLabel("Who was on the call", { exact: true })).toContainText("Grace Example · Champion");
  await expect(page.getByRole("link", { name: "Call +44 20 7946 0002" })).toBeVisible();
});

test("a logged call reads as the operator's report", async ({ page }) => {
  await stubLead(page, [{
    id: "call:501",
    type: "call",
    occurred_at: "2099-07-24T08:00:00Z",
    title: "Outbound call",
    summary: "Asked for pricing",
    direction: "outbound",
    status: "no_answer",
    actor: { user_id: 1, name: "Rae Rep" },
    source: { module_key: "telephony", record_id: "501" },
    record: { module_key: "sales_leads", entity_id: String(leadId) },
    capabilities: [],
    meta: {
      capture: "manual",
      outcome: "no_answer",
      duration_seconds: 245,
      phone_number: "+44 20 7946 0000",
      contact_id: null,
      contact_name: null,
      logged_on_module_key: null,
      logged_on_entity_id: null,
      follow_up_task_id: null,
    },
  }]);
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await page.getByRole("tab", { name: "Timeline" }).click();

  const entry = page.getByRole("listitem").filter({ hasText: "Outbound call" });
  await expect(entry).toContainText("No answer");
  await expect(entry).toContainText("4 min 5 s");
  await expect(entry).toContainText("Logged by hand. Lynk did not place or track this call.");
  await expect(page.getByRole("radio", { name: "Calls" })).toBeVisible();
});
