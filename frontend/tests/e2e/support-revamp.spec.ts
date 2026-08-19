import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";
import { stubDefaultSavedViews } from "./helpers/savedViews";

const caseId = 987654301;
const moduleCacheKey = "lynk_modules:v4";

/**
 * The record archetype gates its rail and its composer on `support_cases` edit permission —
 * the pre-5.3 page gated on nothing, which is why this stub is new. Tasks and documents are
 * here because the archetype's Tasks and Files tabs resolve through their own modules.
 */
function supportModulePermissions(canEdit: boolean) {
  return ["support_cases", "tasks", "documents"].map((name, index) => ({
    id: 300 + index,
    name,
    is_enabled: true,
    actions: {
      can_view: true,
      can_create: true,
      can_edit: canEdit,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  }));
}

async function cacheSupportPermissions(page: Parameters<typeof loginAsAdmin>[0], canEdit = true) {
  const modules = supportModulePermissions(canEdit);
  await page.addInitScript(
    ({ cacheKey, cachedModules }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules));
    },
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
  // useAccessibleModules revalidates from the API and overwrites the seeded cache, so the
  // stub has to agree with it or the real admin permissions win.
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
}

function supportCaseFixture() {
  return {
    id: caseId,
    tenant_id: 1,
    case_number: "CASE-2407-001",
    subject: "Customer cannot access the renewal order",
    description: "The customer sees an access error after signing in.",
    category: "technical",
    status: "open",
    priority: "urgent",
    source: "portal",
    contact_id: 41,
    contact_name: "Grace Buyer",
    organization_id: 51,
    organization_name: "Acme",
    opportunity_id: 61,
    opportunity_name: "Acme renewal",
    quote_id: 71,
    quote_label: "Q-2407",
    order_id: 81,
    order_label: "SO-2407",
    assigned_to_id: 1,
    assigned_to_name: "Admin User",
    created_by_id: 1,
    created_by_name: "Admin User",
    sla_due_at: "2099-07-25T12:00:00Z",
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
    comments: [{
      id: 1,
      case_id: caseId,
      author_id: 1,
      author_name: "Admin User",
      body: "We are reviewing the account permissions.",
      is_internal: false,
      created_at: "2099-07-24T09:00:00Z",
    }],
    events: [{
      id: 1,
      case_id: caseId,
      event_type: "created",
      payload_json: {},
      created_by_id: 1,
      created_at: "2099-07-24T08:00:00Z",
    }],
  };
}

/** The `detail` surface support cases adopted in rebuild 5.3 batch 4. */
const caseDetailLayout = {
  layout_id: null,
  module_key: "support_cases",
  surface: "detail",
  name: "Case Details",
  source: "system",
  version: 1,
  can_customize: false,
  warnings: [],
  sections: [
    {
      id: "request",
      label: "Request",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "description", label: "Description", field_type: "long_text", field_source: "system", position: 0, width: "full", visible: true, required: false, readonly: true },
        { field_key: "source", label: "Source", field_type: "select", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: true },
      ],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  // The rail's Owner control lists the tenant's users rather than searching for them
  // (design.md §7.8), so a record page now asks for them on load.
  await page.route("**/linked-record-options/users?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 1, label: "Admin User", email: "admin@example.com" }], has_more: false }),
    }),
  );
  await cacheSupportPermissions(page);
  await stubDefaultSavedViews(page);
  let supportCase = supportCaseFixture();

  await page.route("**/support/cases/summary", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total_open: 1, urgent_open: 1, overdue: 0, by_status: { open: 1 } }) }),
  );
  await page.route("**/support/cases?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [supportCase], range_start: 1, range_end: 1, total_count: 1, total_pages: 1, page: 1 }),
    }),
  );
  await page.route(`**/api/v1/support/cases/${caseId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      supportCase = { ...supportCase, ...route.request().postDataJSON(), updated_at: "2099-07-24T10:00:00Z" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(supportCase) });
  });
  await page.route("**/activity/records/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/record-layouts/support_cases/detail/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(caseDetailLayout) }),
  );
  // The conversation is the Timeline now, so the feed is what renders the case's replies.
  await page.route("**/records/support_cases/**/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: "case_reply:1",
          type: "case_reply",
          occurred_at: "2099-07-24T09:00:00Z",
          title: "Reply sent to customer",
          summary: "We are reviewing the account permissions.",
          direction: "outbound",
          status: null,
          actor: { user_id: 1, name: "Admin User" },
          source: { module_key: "support_cases", record_id: String(caseId) },
          record: { module_key: "support_cases", entity_id: String(caseId) },
          capabilities: [],
          meta: { is_internal: false },
        }],
        next_cursor: null,
        has_more: false,
        limit: 25,
        available_types: ["case_reply", "note", "task"],
        omitted_types: [],
      }),
    }),
  );
});

test("Support list exposes shared controls and keyboard case navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/support/cases");

  await expect(page.getByRole("heading", { name: "Support Cases" })).toBeVisible();
  await expect(page.getByPlaceholder("Search support cases")).toBeVisible();
  await expect(page.getByText("CASE-2407-001")).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-slot="status-value"][data-tone="neutral"]', { hasText: "Open" })).toBeVisible();
  await expect(page.locator('[data-slot="status-value"][data-tone="critical"]', { hasText: "Urgent" })).toBeVisible();

  const row = page.getByRole("row", { name: /Open CASE-2407-001/ });
  await row.focus();
  await row.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/dashboard/support/cases/${caseId}$`));
});

test("Support creation uses a full page and does not offer service-owned SLA fields", async ({ page }) => {
  await page.goto("/dashboard/support/cases/new");

  await expect(page.getByRole("heading", { name: "Create support case" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeVisible();
  await expect(page.getByLabel("SLA Due")).toHaveCount(0);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByText("Subject is required.")).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeFocused();
});

test("Support detail is the record archetype, and its state fields autosave", async ({ page }) => {
  await page.goto(`/dashboard/support/cases/${caseId}`);

  // The subject is the case's name and the number is its reference — the reverse of a
  // quote, whose number *is* its identity.
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Customer cannot access the renewal order");
  await expect(page.getByText("CASE-2407-001")).toBeVisible();

  // R9: state and relationships live in the spine, and the spine is the only editable region.
  const spine = page.locator('[data-slot="record-spine"]');
  await expect(spine.getByRole("combobox", { name: "Status" })).toBeVisible();
  await expect(spine.getByRole("combobox", { name: "Priority" })).toBeVisible();
  await expect(spine.getByRole("combobox", { name: "Category" })).toBeVisible();
  await expect(spine.getByRole("link", { name: "Grace Buyer" })).toBeVisible();
  await expect(spine.getByRole("link", { name: "Acme", exact: true })).toBeVisible();

  // The archetype owns the only tab strip, so the two comment systems and the two history
  // panels the census named have nowhere to live.
  await expect(page.getByRole("tab")).toHaveText(["Details", "Timeline", "Tasks", "Files"]);
  await expect(page.getByRole("heading", { name: "Conversation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Case history" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Related records" })).toHaveCount(0);
  // A field the spine or the header owns is not drawn again in Details (design.md §4.7).
  await expect(page.locator("[data-record-layout]").getByText("Urgent", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-layout-field='description']")).toBeVisible();

  // The conversation is the Timeline: one composer over one feed.
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/support/cases/${caseId}\\?tab=timeline$`));
  // `SegmentedControl` is a radix ToggleGroup, so a composer mode is a radio, not a button.
  await expect(page.getByRole("radio", { name: "Reply to the customer" })).toBeVisible();
  await expect(page.getByText("We are reviewing the account permissions.")).toBeVisible();

  await spine.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(page.locator('[data-slot="save-state-indicator"][data-state="saved"]')).toBeVisible();
  await expect(spine.locator('[data-slot="status-value"][data-tone="attention"]', { hasText: "High" })).toBeVisible();

  // Status is unaffected — each state field autosaves independently.
  await expect(spine.locator('[data-slot="status-value"][data-tone="neutral"]', { hasText: "Open" })).toBeVisible();
});

test("Support detail keeps the rail's scroll inside the rail", async ({ page }) => {
  // The tallest rail in the app — a lifecycle track, three State fields and six Connected
  // entries. Before rebuild 5.3 batch 4 it grew the row instead of scrolling, and the
  // dashboard shell absorbed the overflow: reaching `History` scrolled the *page* and
  // dragged the record's name and actions off the top (design.md §4.5, §4.7).
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto(`/dashboard/support/cases/${caseId}`);
  await expect(page.locator('[data-slot="record-spine"]')).toBeVisible();

  const overflow = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("main div.overflow-y-auto");
    const rail = document.querySelector<HTMLElement>('[data-slot="record-spine-scroll"]');
    return {
      shell: shell ? shell.scrollHeight - shell.clientHeight : 0,
      // `overflow-y: auto` computes the other axis to `auto` too, so the rail's -mx-2 bleed
      // would grow a horizontal scrollbar without the matching padding.
      railX: rail ? rail.scrollWidth - rail.clientWidth : 0,
    };
  });
  expect(overflow.shell).toBeLessThanOrEqual(2);
  expect(overflow.railX).toBeLessThanOrEqual(2);
});

test("Support failures do not expose backend details", async ({ page }) => {
  await page.unroute("**/support/cases?**");
  await page.route("**/support/cases?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_connection=secret" }),
    }),
  );
  await page.goto("/dashboard/support/cases");

  await expect(page.getByText("Support cases could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("database_connection=secret")).toBeHidden();
});
