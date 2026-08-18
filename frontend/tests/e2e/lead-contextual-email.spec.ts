import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Lead → Email → send → appears in relationship Activity
 * (03-email-integration, frontend Phase 1).
 *
 * Everything the mail domain owns is stubbed at the network boundary, so this
 * asserts the surface's own contract: the record is addressed by the URL, the
 * mailbox is chosen from connected accounts, failures are distinguishable, and
 * a retry reuses one idempotency key rather than composing a second message.
 */

const leadId = 987654322;
const moduleCacheKey = "lynk_modules:v4";
const sendUrl = `**/mail/records/sales_leads/${leadId}/send`;

const leadSummary = {
  lead: {
    lead_id: leadId,
    first_name: "Ada",
    last_name: "Lovelace",
    company: "Lynk QA",
    primary_email: "ada@example.com",
    phone: "+94770000000",
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
};

const connectedMailbox = {
  connections: [
    {
      provider: "google",
      status: "connected",
      account_email: "rep@example.com",
      provider_mailbox_id: "primary",
      provider_mailbox_name: "Primary inbox",
      can_send: true,
      can_sync: true,
      last_synced_at: null,
      last_error: null,
      health_status: "healthy",
      credential_state: "active",
      scopes: ["gmail.send"],
      last_successful_sync_at: null,
      last_failure_reason: null,
      reconnect_required: false,
      reconnect_label: null,
      sync_unavailable_reason: null,
    },
  ],
  sync_available: true,
  sync_note: "Mailbox sync is ready.",
};

const disconnectedMailbox = {
  connections: [
    { ...connectedMailbox.connections[0], can_send: false, can_sync: false, status: "error", credential_state: "reconnect_required", health_status: "reconnect_required", reconnect_required: true, reconnect_label: "Reconnect Gmail" },
  ],
  sync_available: false,
  sync_note: "Reconnect this mailbox.",
};

/**
 * The record header action, not the Follow-up panel's channel button of the
 * same name. Both legitimately read "Email".
 */
function headerEmailAction(page: Page) {
  return page.locator("[data-record-workspace-actions]").getByRole("button", { name: "Email", exact: true });
}

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function emptyActivity() {
  return {
    items: [],
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

function sentEmailActivity() {
  return {
    ...emptyActivity(),
    items: [
      {
        id: "email:9001",
        type: "email",
        occurred_at: "2099-07-24T08:00:00Z",
        title: "Renewal review",
        summary: "Hello Ada",
        direction: "outbound",
        status: "sent",
        actor: { user_id: 1, name: "rep@example.com" },
        source: { module_key: "mail", record_id: "9001" },
        record: { module_key: "sales_leads", entity_id: String(leadId) },
        capabilities: ["open", "reply"],
        meta: { from_email: "rep@example.com", to_recipients: ["ada@example.com"], folder: "sent" },
      },
    ],
  };
}

async function stubWorkspace(page: Page) {
  const modules = ["sales_leads", "tasks", "documents", "mail", "message_templates"].map((name, index) => ({
    id: 200 + index,
    name,
    is_enabled: true,
    actions: {
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  }));
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
  await page.route(`**/sales/leads/${leadId}/summary`, (route) => route.fulfill(json(leadSummary)));
  await page.route("**/record-layouts/sales_leads/detail/resolved", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "none" }) }),
  );
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/record-comments?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/activity/record?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubWorkspace(page);
});

test("Lead email composes, sends, and lands on the timeline", async ({ page }) => {
  let sendCount = 0;
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
  await page.route("**/records/sales_leads/*/activity?**", (route) =>
    route.fulfill(json(sendCount ? sentEmailActivity() : emptyActivity())),
  );
  await page.route(sendUrl, async (route) => {
    sendCount += 1;
    const payload = route.request().postDataJSON();
    // The record is in the URL, not the body: the composer cannot send mail
    // that is not filed against this lead.
    expect(payload).toMatchObject({
      provider: "google",
      to: ["ada@example.com"],
      subject: "Renewal review",
    });
    expect(payload.idempotency_key).toBeTruthy();
    await route.fulfill(json({ id: 9001, direction: "outbound", folder: "sent", send_status: "sent", created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }));
  });

  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await headerEmailAction(page).click();

  const composer = page.getByRole("dialog", { name: /Email Ada Lovelace/ });
  await expect(composer).toBeVisible();
  // The record's own address is already there — known context is not re-asked.
  await expect(composer.getByLabel("To")).toHaveValue("ada@example.com");
  await expect(composer.getByRole("button", { name: "Create & open" })).toHaveCount(0);

  await composer.getByLabel("Subject").fill("Renewal review");
  await composer.getByLabel("Message").fill("Hello Ada");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer).toBeHidden();
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText("Renewal review")).toBeVisible();
  expect(sendCount).toBe(1);
});

test("Lead email refuses an invalid recipient before contacting the mail domain", async ({ page }) => {
  let sendCount = 0;
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
  await page.route("**/records/sales_leads/*/activity?**", (route) => route.fulfill(json(emptyActivity())));
  await page.route(sendUrl, async (route) => {
    sendCount += 1;
    await route.fulfill(json({ id: 1 }));
  });

  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await headerEmailAction(page).click();
  const composer = page.getByRole("dialog", { name: /Email Ada Lovelace/ });

  await composer.getByLabel("To").fill("not-an-email");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer.locator('[data-slot="field-error"]')).toHaveText(
    "Enter a valid email address for not-an-email.",
  );
  expect(sendCount).toBe(0);
});

test("A transient send failure offers a retry that reuses one idempotency key", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/mail/context", (route) => route.fulfill(json(connectedMailbox)));
  await page.route("**/records/sales_leads/*/activity?**", (route) => route.fulfill(json(emptyActivity())));
  await page.route(sendUrl, async (route) => {
    keys.push(route.request().postDataJSON().idempotency_key);
    if (keys.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "provider_unavailable",
            message: "The mail provider is temporarily unavailable. The message was not sent — retry in a moment.",
            retryable: true,
            reconnect_required: false,
          },
        }),
      });
      return;
    }
    await route.fulfill(json({ id: 9002, direction: "outbound", folder: "sent", send_status: "sent", created_at: "2099-07-24T08:00:00Z", updated_at: "2099-07-24T08:00:00Z" }));
  });

  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await headerEmailAction(page).click();
  const composer = page.getByRole("dialog", { name: /Email Ada Lovelace/ });
  await composer.getByLabel("Subject").fill("Renewal review");
  await composer.getByRole("button", { name: "Send email" }).click();

  await expect(composer.getByText("temporarily unavailable")).toBeVisible();
  await expect(composer.getByText("it cannot arrive twice")).toBeVisible();

  await composer.getByRole("button", { name: "Send email" }).click();
  await expect(composer).toBeHidden();

  // Same attempt, same key — the backend's duplicate guard has something to hold.
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("A disconnected mailbox keeps the mailto fallback instead of the composer", async ({ page }) => {
  await page.route("**/mail/context", (route) => route.fulfill(json(disconnectedMailbox)));
  await page.route("**/records/sales_leads/*/activity?**", (route) => route.fulfill(json(emptyActivity())));

  await page.goto(`/dashboard/sales/leads/${leadId}`);
  const emailAction = page
    .locator("[data-record-workspace-actions]")
    .getByRole("link", { name: "Email", exact: true });
  await expect(emailAction).toHaveAttribute("href", "mailto:ada@example.com");
});
