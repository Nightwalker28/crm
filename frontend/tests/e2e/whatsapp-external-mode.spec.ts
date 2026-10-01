import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * External (click-to-chat) WhatsApp — 06-whatsapp-business.md Phase 1.
 *
 * The regression suite for the mode that must survive every provider phase. The three
 * surfaces that open WhatsApp — the record header, the Timeline's WhatsApp follow-up and the
 * contact's tracked click-to-chat — share `lib/whatsapp.ts`, and what is under test is its
 * contract: the chat opens at a dialable number, a window opened for a chat is opened before
 * the first await and closed again if the chat is not started, a number WhatsApp cannot dial
 * is explained rather than opened, and a workspace that does not allow the mode is not
 * offered it.
 *
 * `window.open` is replaced with a recorder, so nothing leaves the browser.
 */

const leadId = 987654377;
const contactId = 987655177;
const moduleCacheKey = "lynk_modules:v4";

type RecordedWindow = { initial: string; href: string; closed: boolean };

declare global {
  interface Window {
    __whatsAppWindows: RecordedWindow[];
  }
}

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function emptyActivity() {
  return {
    items: [],
    next_cursor: null,
    has_more: false,
    limit: 20,
    available_types: ["follow_up", "note", "task", "whatsapp"],
    omitted_types: [],
  };
}

const externalOnly = {
  default_mode: "external_link",
  effective_mode: "external_link",
  modes: [
    { mode: "external_link", enabled: true, available: true, unavailable_reason: null, sends_from_crm: false, tracks_delivery: false, receives_inbound: false },
    { mode: "meta_cloud_api", enabled: false, available: false, unavailable_reason: "disabled_by_policy", sends_from_crm: true, tracks_delivery: true, receives_inbound: true },
  ],
};

const externalDisabled = {
  default_mode: "external_link",
  effective_mode: null,
  modes: externalOnly.modes.map((mode) => ({ ...mode, enabled: false, available: false, unavailable_reason: "disabled_by_policy" })),
};

async function recordWindows(page: Page) {
  await page.addInitScript(() => {
    window.__whatsAppWindows = [];
    window.open = ((url?: string | URL) => {
      const entry = { initial: String(url ?? ""), href: String(url ?? ""), closed: false };
      window.__whatsAppWindows.push(entry);
      return {
        opener: null,
        get closed() {
          return entry.closed;
        },
        close() {
          entry.closed = true;
        },
        location: {
          set href(value: string) {
            entry.href = value;
          },
          get href() {
            return entry.href;
          },
        },
      } as unknown as Window;
    }) as typeof window.open;
  });
}

function openedWindows(page: Page) {
  return page.evaluate(() => window.__whatsAppWindows);
}

async function stubModules(page: Page, names: string[]) {
  const modules = names.map((name, index) => ({
    id: 700 + index,
    name,
    is_enabled: true,
    actions: { can_view: true, can_create: true, can_edit: true, can_delete: true, can_restore: false, can_export: false, can_configure: false },
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
  await page.route("**/records/*/*/activity?**", (route) => route.fulfill(json(emptyActivity())));
}

async function stubLead(page: Page, { phone, capabilities = externalOnly }: { phone: string; capabilities?: unknown }) {
  await stubModules(page, ["sales_leads", "tasks", "documents", "message_templates"]);
  await page.route("**/whatsapp/capabilities", (route) => route.fulfill(json(capabilities)));
  await page.route(`**/sales/leads/${leadId}/summary`, (route) =>
    route.fulfill(
      json({
        lead: {
          lead_id: leadId,
          first_name: "Ada",
          last_name: "Lovelace",
          company: "Lynk QA",
          primary_email: "ada@example.com",
          phone,
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
      }),
    ),
  );
}

async function stubContact(page: Page) {
  await stubModules(page, ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents", "message_templates"]);
  await page.route("**/whatsapp/capabilities", (route) => route.fulfill(json(externalOnly)));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [], has_more: false })));
  await page.route("**/message-templates?**", (route) =>
    route.fulfill(json({ results: [{ id: 41, name: "Follow-up", body: "Hi {{first_name}}, following up.", variables: ["first_name"] }] })),
  );
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) =>
    route.fulfill(
      json({
        contact: {
          contact_id: contactId,
          first_name: "Grace",
          last_name: "Hopper",
          primary_email: "grace@example.test",
          contact_telephone: "077 123 4567",
          email_opt_out: false,
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
      }),
    ),
  );
}

function headerWhatsApp(page: Page) {
  return page.locator("[data-record-workspace-actions]").getByRole("button", { name: "WhatsApp", exact: true });
}

async function openTimelineWhatsApp(page: Page) {
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByLabel("Add to the timeline").getByRole("radio", { name: "WhatsApp" }).click();
}

test.beforeEach(async ({ page }) => {
  // Sign-in plus a record page leaves little of the default budget for the interaction,
  // on the capped dev server (as in opportunity-participants / pipeline-settings).
  test.slow();
  await recordWindows(page);
  await loginAsAdmin(page);
});

test("the header opens WhatsApp at the number's digits", async ({ page }) => {
  await stubLead(page, { phone: "+94 77 000 0000" });
  await page.goto(`/dashboard/sales/leads/${leadId}`);

  await headerWhatsApp(page).click();

  expect(await openedWindows(page)).toEqual([
    { initial: "https://wa.me/94770000000", href: "https://wa.me/94770000000", closed: false },
  ]);
});

test("a number with no country code is explained, not opened", async ({ page }) => {
  await stubLead(page, { phone: "077 000 0000" });
  await page.goto(`/dashboard/sales/leads/${leadId}`);

  await headerWhatsApp(page).click();

  await expect(page.getByText("Add the country code to this phone number to open WhatsApp.")).toBeVisible();
  expect(await openedWindows(page)).toEqual([]);
});

test("the WhatsApp follow-up opens its window before logging, then points it at the chat", async ({ page }) => {
  await stubLead(page, { phone: "+94 77 000 0000" });
  let windowsWhenLogged: RecordedWindow[] | null = null;
  await page.route(`**/sales/leads/${leadId}/follow-up`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ channel: "whatsapp" });
    windowsWhenLogged = await openedWindows(page);
    await route.fulfill(json({ module_key: "sales_leads", entity_id: String(leadId), channel: "whatsapp", last_contacted_at: "2099-07-24T08:00:00Z", follow_up_task_id: null }));
  });
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await openTimelineWhatsApp(page);

  await page.getByRole("button", { name: "Log whatsapp" }).click();

  await expect(page.getByText("WhatsApp logged")).toBeVisible();
  // Opened synchronously on the click, while the log was still in flight.
  expect(windowsWhenLogged).toEqual([{ initial: "about:blank", href: "about:blank", closed: false }]);
  expect(await openedWindows(page)).toEqual([
    { initial: "about:blank", href: "https://wa.me/94770000000", closed: false },
  ]);
});

test("a follow-up that fails to log closes the window it opened", async ({ page }) => {
  await stubLead(page, { phone: "+94 77 000 0000" });
  await page.route(`**/sales/leads/${leadId}/follow-up`, (route) => route.fulfill(json({ detail: "boom" }, 500)));
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await openTimelineWhatsApp(page);

  await page.getByRole("button", { name: "Log whatsapp" }).click();

  await expect(page.getByText("The WhatsApp follow-up could not be logged. Try again.")).toBeVisible();
  expect(await openedWindows(page)).toEqual([{ initial: "about:blank", href: "about:blank", closed: true }]);
});

test("a national number is still logged, and the chat is not opened", async ({ page }) => {
  await stubLead(page, { phone: "077 000 0000" });
  let logged = 0;
  await page.route(`**/sales/leads/${leadId}/follow-up`, async (route) => {
    logged += 1;
    await route.fulfill(json({ module_key: "sales_leads", entity_id: String(leadId), channel: "whatsapp", last_contacted_at: "2099-07-24T08:00:00Z", follow_up_task_id: null }));
  });
  await page.goto(`/dashboard/sales/leads/${leadId}`);
  await openTimelineWhatsApp(page);

  await expect(page.getByText("Logging still records the follow-up.")).toBeVisible();
  await page.getByRole("button", { name: "Log whatsapp" }).click();

  await expect(page.getByText("WhatsApp logged")).toBeVisible();
  expect(logged).toBe(1);
  expect(await openedWindows(page)).toEqual([]);
});

test("the contact's tracked chat opens the URL the server prepared", async ({ page }) => {
  await stubContact(page);
  await page.route(`**/whatsapp/contacts/${contactId}/click`, (route) =>
    route.fulfill(
      json(
        {
          interaction_id: 5,
          contact_id: contactId,
          mode: "external_link",
          status: "prepared",
          phone_number: "94771234567",
          template_id: 41,
          message_body: "Hi Grace, following up.",
          whatsapp_url: "https://web.whatsapp.com/send?phone=94771234567&text=Hi%20Grace%2C%20following%20up.",
          last_contacted_at: "2099-07-24T08:00:00Z",
          follow_up_task: null,
        },
        201,
      ),
    ),
  );
  await page.goto(`/dashboard/sales/contacts/${contactId}`);
  await openTimelineWhatsApp(page);

  await expect(page.getByText("Lynk records that the chat was opened, not whether")).toBeVisible();
  await page.getByRole("button", { name: "Open WhatsApp" }).click();

  await expect(page.getByText("WhatsApp chat opened.")).toBeVisible();
  expect(await openedWindows(page)).toEqual([
    {
      initial: "about:blank",
      href: "https://web.whatsapp.com/send?phone=94771234567&text=Hi%20Grace%2C%20following%20up.",
      closed: false,
    },
  ]);
});

test("a refused tracked chat says why and closes its window", async ({ page }) => {
  await stubContact(page);
  await page.route(`**/whatsapp/contacts/${contactId}/click`, (route) =>
    route.fulfill(json({ detail: "Contact phone number needs a country code for WhatsApp" }, 400)),
  );
  await page.goto(`/dashboard/sales/contacts/${contactId}`);
  await openTimelineWhatsApp(page);

  await page.getByRole("button", { name: "Open WhatsApp" }).click();

  await expect(
    page.getByText("WhatsApp chat could not be started. Contact phone number needs a country code for WhatsApp."),
  ).toBeVisible();
  expect(await openedWindows(page)).toEqual([{ initial: "about:blank", href: "about:blank", closed: true }]);
});

test("a workspace that does not allow external WhatsApp is not offered it", async ({ page }) => {
  await stubLead(page, { phone: "+94 77 000 0000", capabilities: externalDisabled });
  await page.goto(`/dashboard/sales/leads/${leadId}`);

  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Ada Lovelace");
  await expect(page.locator("[data-record-workspace-actions]").getByRole("link", { name: "Call" })).toBeVisible();
  await expect(headerWhatsApp(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Timeline" }).click();
  const composerModes = page.getByLabel("Add to the timeline");
  await expect(composerModes.getByRole("radio", { name: "Call" })).toBeVisible();
  await expect(composerModes.getByRole("radio", { name: "WhatsApp" })).toHaveCount(0);
});
