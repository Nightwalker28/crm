import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fakeLeadId = 987654321;
const moduleCacheKey = "lynk_modules:v4";
const fakeLeadSummary = {
  lead: {
    lead_id: fakeLeadId,
    first_name: "Browser",
    last_name: "Fixture",
    company: "Lynk QA",
    primary_email: "browser.fixture@example.com",
    phone: "+94770000000",
    title: "QA Lead",
    source: "Browser verification",
    status: "qualified",
    notes: "Non-persistent browser fixture",
    custom_fields: { renewal_tier: "Gold" },
    updated_at: "2099-07-20T09:30:00Z",
    score: 45,
    score_grade: "warm",
    score_factors: [],
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    team_id: 4,
    team_name: "Revenue",
    tags: ["Enterprise", "Warm"],
    next_follow_up_at: "2099-07-20T09:30:00Z",
    next_follow_up_is_overdue: false,
  },
};

const leadDetailLayout = {
  layout_id: null,
  module_key: "sales_leads",
  surface: "detail",
  name: "Lead Details",
  source: "system",
  version: 1,
  can_customize: false,
  warnings: [],
  sections: [
    {
      id: "contact",
      label: "Contact",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "company", label: "Company", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: true },
        { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 1, width: "half", visible: true, required: true, readonly: true },
        { field_key: "phone", label: "Phone", field_type: "phone", field_source: "system", position: 2, width: "half", visible: false, required: false, readonly: true },
        { field_key: "assigned_to", label: "Owner", field_type: "user_reference", field_source: "system", position: 3, width: "half", visible: true, required: false, readonly: true },
        { field_key: "team_id", label: "Team", field_type: "team_reference", field_source: "system", position: 4, width: "half", visible: true, required: false, readonly: true },
        { field_key: "next_follow_up_at", label: "Next follow-up", field_type: "datetime", field_source: "system", position: 5, width: "full", visible: true, required: false, readonly: true },
        { field_key: "tags", label: "Tags", field_type: "tags", field_source: "system", position: 6, width: "full", visible: true, required: false, readonly: true },
      ],
    },
    {
      id: "custom_fields",
      label: "Configured details",
      position: 1,
      region: "main",
      collapsed_by_default: true,
      fields: [
        { field_key: "custom:renewal_tier", label: "Renewal tier", field_type: "text", field_source: "custom_field", position: 0, width: "half", visible: true, required: false, readonly: true },
      ],
    },
  ],
};

const leadQuickCreateLayout = {
  layout_id: null,
  module_key: "sales_leads",
  surface: "quick_create",
  name: "Lead Quick Create",
  source: "system",
  version: 1,
  can_customize: false,
  warnings: [],
  sections: [
    {
      id: "contact",
      label: "Contact",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "first_name", label: "First name", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
        { field_key: "last_name", label: "Last name", field_type: "text", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: false },
        { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 2, width: "full", visible: true, required: true, readonly: false },
      ],
    },
  ],
};

type WorkspacePermissionOverrides = Partial<Record<
  "sales_leads" | "tasks" | "documents" | "sales_organizations" | "sales_contacts" | "sales_opportunities",
  Partial<{
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
  }>
>>;

async function stubWorkspacePermissions(page: Page, overrides: WorkspacePermissionOverrides = {}) {
  const moduleNames = [
    "sales_leads",
    "tasks",
    "documents",
    "sales_organizations",
    "sales_contacts",
    "sales_opportunities",
  ] as const;
  const modules = moduleNames.map((name, index) => ({
    id: 100 + index,
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
      ...overrides[name],
    },
  }));
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
}

async function stubEmptyWorkspacePanels(page: Page) {
  await page.route("**/tasks?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0 }) }),
  );
  await page.route("**/record-comments?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0 }) }),
  );
  await page.route("**/documents?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0 }) }),
  );
  await page.route("**/activity/record?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0 }) }),
  );
  // Relationship activity projection — separate surface from the audit log above.
  await page.route("**/records/*/*/activity?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        next_cursor: null,
        has_more: false,
        limit: 20,
        available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
        omitted_types: [],
      }),
    }),
  );
}

async function mockLeadRelationshipOptions(page: Page) {
  await page.route("**/linked-record-options/users?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.com" }] }),
    });
  });
  await page.route("**/linked-record-options/teams?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 4, label: "Revenue" }] }),
    });
  });
  await page.route("**/linked-record-options/tags?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ name: "Enterprise" }] }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubWorkspacePermissions(page);
  await page.route("**/record-layouts/sales_leads/detail/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(leadDetailLayout) }),
  );
});

// The primary create interaction on the Leads list is Quick Create, so this baseline now runs
// the journey through it. The canonical /dashboard/sales/leads/new route is still first-class
// and is covered end to end by leads-quick-create.spec.ts ("More details").
test("Lead journey behavior baseline: filter, create, open, and add a note", async ({ page }) => {
  const createdLeadId = 987654399;
  const createdLeadEmail = "journey.baseline@example.test";
  const noteBody = "Baseline next action recorded.";
  let createdLeadPayload: Record<string, unknown> | null = null;
  let createdNotePayload: Record<string, unknown> | null = null;
  let noteWasCreated = false;

  await page.route("**/users/saved-views/sales_leads?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ views: [] }),
    }),
  );
  await page.route("**/module-fields/sales_leads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route("**/custom-fields/sales_leads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route("**/record-layouts/sales_leads/quick_create/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(leadQuickCreateLayout) }),
  );
  await page.route("**/sales/leads/search?**", (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("search")).toBe("Baseline");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          lead_id: fakeLeadId,
          first_name: "Existing",
          last_name: "Baseline",
          company: "Lynk QA",
          primary_email: "existing.baseline@example.test",
          status: "new",
          assigned_to: 7,
          assigned_to_name: "Ada Owner",
          created_time: "2099-07-20T09:30:00Z",
          tags: [],
          custom_fields: {},
        }],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
      }),
    });
  });
  await page.route("**/api/v1/sales/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createdLeadPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ lead_id: createdLeadId }),
    });
  });
  await page.route(`**/sales/leads/${createdLeadId}/summary`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lead: {
          ...fakeLeadSummary.lead,
          lead_id: createdLeadId,
          first_name: "Journey",
          last_name: "Baseline",
          primary_email: createdLeadEmail,
          status: "new",
        },
      }),
    }),
  );
  await page.route("**/record-comments?**", async (route) => {
    if (route.request().method() === "POST") {
      createdNotePayload = route.request().postDataJSON() as Record<string, unknown>;
      noteWasCreated = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 73, body: noteBody }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: noteWasCreated
          ? [{ id: 73, body: noteBody, author_name: "System Admin", created_at: "2099-07-20T09:35:00Z" }]
          : [],
      }),
    });
  });

  await page.goto("/dashboard/sales/leads");
  await page.getByPlaceholder("Search leads").fill("Baseline");
  await expect(page.getByText("Existing Baseline", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create lead" }).click();
  const quickCreate = page.getByRole("dialog", { name: "Create lead" });
  await quickCreate.getByLabel("First name").fill("Journey");
  await quickCreate.getByLabel("Last name").fill("Baseline");
  await quickCreate.getByLabel("Email").fill(createdLeadEmail);
  await quickCreate.getByRole("button", { name: "Create & open" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${createdLeadId}$`));
  await expect(page.locator("[data-record-workspace-title]", { hasText: "Journey Baseline" })).toBeVisible();
  expect(createdLeadPayload).toMatchObject({
    first_name: "Journey",
    last_name: "Baseline",
    primary_email: createdLeadEmail,
  });

  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.getByLabel("Add internal note")).toBeFocused();
  await page.getByLabel("Add internal note").fill(noteBody);
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page.getByText(noteBody)).toBeVisible();
  expect(createdNotePayload).toMatchObject({ body: noteBody, mentioned_user_ids: [] });
});

test("Leads list keeps its controls usable in a narrow viewport", async ({ page }) => {
  await page.route("**/users/saved-views/sales_leads?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        views: [
          {
            id: 41,
            module_key: "sales_leads",
            name: "All leads",
            config: {
              // score_grade carries the "Warm" pill this test asserts on; score shows the number.
              visible_columns: ["score_grade", "first_name", "last_name", "company", "status"],
              filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
              sort: null,
            },
            is_default: true,
            is_system: true,
          },
          {
            id: 42,
            module_key: "sales_leads",
            name: "My qualified leads",
            config: {
              visible_columns: ["score_grade", "first_name", "company", "status"],
              filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
              sort: null,
            },
            is_default: false,
            is_system: false,
          },
        ],
      }),
    }),
  );
  await page.route("**/sales/leads?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          lead_id: fakeLeadId,
          first_name: "Browser",
          last_name: "Fixture",
          company: "Lynk QA",
          primary_email: "browser.fixture@example.com",
          phone: null,
          title: "QA Lead",
          source: "Browser verification",
          status: "qualified",
          assigned_to: 7,
          assigned_to_name: "Ada Owner",
          created_time: "2099-07-20T09:30:00Z",
          score: 45,
          score_grade: "warm",
          tags: [],
          custom_fields: {},
        }],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
      }),
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard/sales/leads");

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByPlaceholder("Search leads")).toBeVisible();
  await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create lead" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Record views" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /All leads/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "My qualified leads" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage views" })).toBeVisible();
  await page.getByRole("tab", { name: /All leads/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "My qualified leads" })).toHaveAttribute("aria-selected", "true");

  const tableRegion = page.getByRole("region", { name: "Leads" });
  await expect(tableRegion).toBeVisible();
  const tableBounds = await tableRegion.boundingBox();
  expect(tableBounds?.height).toBeLessThan(400);
  await expect(tableRegion.locator('[data-slot="status-value"][data-tone="neutral"]', { hasText: "Qualified" })).toBeVisible();
  await expect(tableRegion.locator('[data-slot="status-value"][data-tone="category"]', { hasText: "Warm" })).toBeVisible();
  const stickyPositions = await tableRegion.locator("thead th").evaluateAll((headers) =>
    headers.slice(0, 2).map((header) => window.getComputedStyle(header).position),
  );
  expect(stickyPositions).toEqual(["sticky", "sticky"]);

  const filtersButton = page.getByRole("button", { name: /Filters/ });
  await filtersButton.focus();
  await expect(filtersButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Filter Conditions")).toBeVisible();
});

test("Leads routed workflow exposes create, detail, edit, conversion, and deep-linked tabs", async ({ page }) => {
  await mockLeadRelationshipOptions(page);
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) });
  });

  await page.goto("/dashboard/sales/leads/new");
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
  await page.getByRole("button", { name: "Create lead" }).click();
  // Next renders an empty route announcer with role="alert", so match the form's own error
  // slot rather than every alert on the page.
  await expect(page.locator('[data-slot="field-error"]')).toHaveText("Email is required.");
  await expect(page.getByLabel("Email")).toBeFocused();

  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  // ArrowDown no-ops until the debounced lookup returns, so wait for the option to exist.
  await expect(page.getByRole("option", { name: /Ada Owner/ })).toBeVisible();
  await ownerPicker.press("ArrowDown");
  await expect(ownerPicker).toHaveAttribute("aria-activedescendant", /-user-7$/);
  await ownerPicker.press("Enter");
  await expect(ownerPicker).toHaveValue("Ada Owner");

  const teamPicker = page.getByPlaceholder("Search teams (defaults to yours)");
  await teamPicker.fill("Rev");
  await page.getByRole("option", { name: "Revenue" }).click();
  await expect(teamPicker).toHaveValue("Revenue");

  const tagInput = page.getByPlaceholder("Type a tag and press Enter");
  await tagInput.fill("Enterprise");
  await tagInput.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Enterprise tag" })).toBeVisible();
  await expect(page.getByLabel("Next follow-up")).toBeVisible();

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.locator("[data-record-workspace-title]", { hasText: "Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Follow-up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks & reminders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes & Comments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Relationship context" })).toBeVisible();
  await page.getByRole("button", { name: "Follow-up", exact: true }).click();
  await expect(page.getByLabel("Follow-up note")).toBeFocused();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.getByLabel("Add internal note")).toBeFocused();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await expect(page.getByLabel("Task title")).toBeFocused();
  await expect(page.locator("[data-record-layout]").getByText("Ada Owner", { exact: true })).toBeVisible();
  await expect(page.locator("[data-record-layout]").getByText("Revenue", { exact: true })).toBeVisible();
  await expect(page.getByText("Enterprise", { exact: true })).toBeVisible();
  // "Warm" is both a tag and the score grade; this line is about the tag, like the one above.
  await expect(page.locator("[data-layout-field='tags']").getByText("Warm", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="lead-score"]')).toBeVisible();
  await expect(page.locator("[data-record-layout]").getByText("Next follow-up", { exact: true })).toBeVisible();
  const detailFields = page.locator("[data-layout-section='contact'] [data-layout-field]");
  await expect(detailFields.nth(0)).toHaveAttribute("data-layout-field", "company");
  await expect(detailFields.nth(1)).toHaveAttribute("data-layout-field", "primary_email");
  await expect(page.locator("[data-layout-field='phone']")).toHaveCount(0);
  await page.locator("[data-layout-section='custom_fields'] summary").click();
  await expect(page.getByText("Renewal tier", { exact: true })).toBeVisible();
  await expect(page.getByText("Gold", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}\\?tab=files$`));
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}\\?tab=audit$`));
  await expect(page.getByRole("tab", { name: "Audit history" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Follow-up" })).toBeVisible();

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit lead" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("browser.fixture@example.com");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByPlaceholder("Search teams")).toHaveValue("Revenue");
  await expect(page.getByRole("button", { name: "Remove Enterprise tag" })).toBeVisible();
  await expect(page.getByLabel("Next follow-up")).not.toHaveValue("");
  await expect(page.getByText(/Last modified/)).toBeVisible();

  await page.getByLabel("Email").fill("changed@example.com");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}/edit$`));
  await expect(page.getByLabel("Email")).toHaveValue("changed@example.com");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/convert`);
  await expect(page.getByRole("heading", { name: "Convert Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm conversion" })).toBeVisible();
});

test("Lead workspace gates mutation regions without hiding view-only context", async ({ page }) => {
  await stubWorkspacePermissions(page, {
    sales_leads: { can_edit: false, can_delete: false },
    tasks: { can_create: false, can_edit: false },
    documents: { can_view: true, can_create: true, can_edit: true, can_delete: true },
    sales_organizations: { can_create: false },
    sales_contacts: { can_create: false },
    sales_opportunities: { can_create: false },
  });
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.route("**/documents?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 81,
          title: "Lead brief",
          original_filename: "lead-brief.pdf",
          content_type: "application/pdf",
          extension: "pdf",
          file_size_bytes: 1024,
          storage_provider: "local",
          provider_status: "available",
          tags: [],
          is_template: false,
          created_at: "2099-07-20T09:30:00Z",
          updated_at: "2099-07-20T09:30:00Z",
          links: [],
          client_shares: [],
        }],
        total: 1,
      }),
    }),
  );
  await page.route("**/documents/81/versions", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);

  await expect(page.locator("[data-record-workspace-title]", { hasText: "Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Convert" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Follow-up", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Note", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByLabel("Follow-up note")).toHaveCount(0);
  await expect(page.getByLabel("Add internal note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audit history" })).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page.getByRole("button", { name: "Upload Document" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByRole("button", { name: "New Version" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark Template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
});

test("Lead conversion uses permitted existing targets without creating forbidden records", async ({ page }) => {
  let conversionPayload: Record<string, unknown> | null = null;
  await stubWorkspacePermissions(page, {
    sales_organizations: { can_view: true, can_create: false },
    sales_contacts: { can_view: true, can_create: false },
    sales_opportunities: { can_create: false },
  });
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.route("**/sales/organizations/search/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ org_id: 51, org_name: "Existing Account" }] }),
    }),
  );
  await page.route("**/sales/contacts/search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ contact_id: 61, first_name: "Existing", last_name: "Contact", primary_email: "existing@example.test" }] }),
    }),
  );
  await page.route(`**/sales/leads/${fakeLeadId}/convert`, async (route) => {
    conversionPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ account_id: 51, contact_id: 61, deal_id: null }),
    });
  });

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.getByRole("link", { name: "Convert" })).toBeVisible();
  await page.getByRole("link", { name: "Convert" }).click();

  await expect(page.getByRole("switch", { name: "Create account" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Create account" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Create contact" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Create contact" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Create opportunity" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm conversion" })).toBeDisabled();

  await page.getByPlaceholder("Search accounts").fill("Existing");
  await page.getByRole("option", { name: "Existing Account" }).click();
  await page.getByPlaceholder("Search contacts").fill("Existing");
  await page.getByRole("option", { name: /Existing Contact/ }).click();
  await expect(page.getByRole("button", { name: "Confirm conversion" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm conversion" }).click();

  await expect.poll(() => conversionPayload).not.toBeNull();
  expect(conversionPayload).toMatchObject({
    create_account: false,
    account_id: 51,
    create_contact: false,
    contact_id: 61,
    create_deal: false,
  });
});

test("Lead conversion is unavailable without a permitted account path", async ({ page }) => {
  await stubWorkspacePermissions(page, {
    sales_organizations: { can_view: false, can_create: false },
  });
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.getByRole("link", { name: "Convert" })).toHaveCount(0);

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/convert`);
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();
});

test("Lead workspace fails optional fields closed and excludes disabled names from linked tasks", async ({ page }) => {
  let releaseFieldConfigs!: () => void;
  const fieldConfigGate = new Promise<void>((resolve) => {
    releaseFieldConfigs = resolve;
  });
  let createdTaskPayload: Record<string, unknown> | null = null;
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.route("**/module-fields/sales_leads", async (route) => {
    await fieldConfigGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { module_key: "sales_leads", field_key: "first_name", label: "First name", field_source: "system", is_enabled: false, is_protected: false, sort_order: 0 },
        { module_key: "sales_leads", field_key: "last_name", label: "Last name", field_source: "system", is_enabled: false, is_protected: false, sort_order: 1 },
        { module_key: "sales_leads", field_key: "phone", label: "Phone", field_source: "system", is_enabled: false, is_protected: false, sort_order: 2 },
      ]),
    });
  });
  await page.route("**/tasks/options", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [], teams: [] }) }),
  );
  await page.route("**/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createdTaskPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: 901, title: "Safe linked task", status: "todo", priority: "medium" }),
    });
  });

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.locator("[data-record-workspace-title]", { hasText: fakeLeadSummary.lead.primary_email })).toBeVisible();
  await expect(page.getByText(fakeLeadSummary.lead.phone, { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);

  releaseFieldConfigs();
  await expect(page.locator("[data-record-workspace-title]", { hasText: fakeLeadSummary.lead.primary_email })).toBeVisible();
  await expect(page.getByText("Browser Fixture", { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByLabel("Task title").fill("Safe linked task");
  await page.getByRole("button", { name: "Create linked task" }).click();
  await expect.poll(() => createdTaskPayload).not.toBeNull();
  expect(createdTaskPayload).toMatchObject({
    source_label: fakeLeadSummary.lead.primary_email,
    source_module_key: "sales_leads",
    source_entity_id: String(fakeLeadId),
  });
});

test("Lead workspace stacks its relationship rail and keeps stable regions usable on mobile", async ({ page }) => {
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);

  const primary = page.locator("[data-record-workspace-primary]");
  const workRegion = primary.locator(":scope > div");
  const relationshipRail = primary.locator("[data-record-workspace-relationship-rail]");
  await expect(workRegion).toBeVisible();
  await expect(relationshipRail).toBeVisible();
  const workBounds = await workRegion.boundingBox();
  const railBounds = await relationshipRail.boundingBox();
  expect(railBounds?.y).toBeGreaterThan((workBounds?.y ?? 0) + (workBounds?.height ?? 0) - 1);
  expect(Math.abs((railBounds?.x ?? 0) - (workBounds?.x ?? 0))).toBeLessThan(2);
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audit history" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("Legacy Lead workspace tabs land on stable regions without opening composers", async ({ page }) => {
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );

  // `activity` is now a real tab; the Follow-up region sits outside the tab set
  // and stays reachable either way.
  await page.goto(`/dashboard/sales/leads/${fakeLeadId}?tab=activity`);
  await expect(page.getByRole("heading", { name: "Follow-up" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}?tab=related`);
  await expect(page.getByRole("heading", { name: "Tasks & reminders" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task" })).toBeVisible();
  await expect(page.getByLabel("Task title")).toHaveCount(0);

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}?tab=notes`);
  await expect(page.getByRole("heading", { name: "Notes & Comments" })).toBeVisible();
});

test("Lead workspace distinguishes denied and missing records", async ({ page }) => {
  const deniedLeadId = 987654322;
  const missingLeadId = 987654323;
  await page.route(`**/sales/leads/${deniedLeadId}/summary`, (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Forbidden" }) }),
  );
  await page.route(`**/sales/leads/${missingLeadId}/summary`, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) }),
  );

  await page.goto(`/dashboard/sales/leads/${deniedLeadId}`);
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();

  await page.goto(`/dashboard/sales/leads/${missingLeadId}`);
  await expect(page.getByRole("heading", { name: "Lead not found" })).toBeVisible();
});

test("Lead detail layout failure stays contained to Details", async ({ page }) => {
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.route("**/record-layouts/sales_leads/detail/resolved", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Layout failed" }) }),
  );

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);

  await expect(page.getByRole("heading", { name: "Follow-up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks & reminders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes & Comments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lead details are unavailable" })).toBeVisible();
  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
});

test("Lead relationship activity renders each source and stays separate from audit", async ({ page }) => {
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );

  const activityItem = (
    type: string,
    id: number,
    occurredAt: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: `${type}:${id}`,
    type,
    occurred_at: occurredAt,
    title,
    summary: null,
    direction: null,
    status: null,
    actor: { user_id: 7, name: "Ada Owner" },
    source: { module_key: type, record_id: String(id) },
    record: { module_key: "sales_leads", entity_id: String(fakeLeadId) },
    capabilities: [],
    meta: {},
    ...extra,
  });

  const allItems = [
    activityItem("email", 1, "2026-08-05T10:00:00+00:00", "Proposal", {
      direction: "outbound",
      summary: "Attached is the proposal.",
      meta: { from_email: "rep@example.com", to_recipients: ["ada@example.com"] },
    }),
    activityItem("meeting", 2, "2026-08-04T09:00:00+00:00", "Discovery call", {
      meta: { start_at: "2026-08-04T09:00:00+00:00", location: "Zoom", participants: ["Ada Owner"] },
    }),
    activityItem("follow_up", 3, "2026-08-03T08:00:00+00:00", "Call follow-up logged", {
      summary: "Left a voicemail.",
      meta: { channel: "call" },
    }),
  ];

  await page.route("**/records/sales_leads/*/activity?**", (route) => {
    const url = new URL(route.request().url());
    const types = url.searchParams.get("types");
    const items = types ? allItems.filter((item) => types.split(",").includes(item.type)) : allItems;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        next_cursor: null,
        has_more: false,
        limit: 20,
        available_types: ["email", "follow_up", "meeting", "note", "task", "whatsapp"],
        omitted_types: [],
      }),
    });
  });

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}?tab=activity`);

  const feed = page.getByRole("list", { name: "Activity entries" });
  await expect(feed.getByRole("listitem")).toHaveCount(3);
  // Domain-specific bodies, not flattened generic rows.
  await expect(feed.getByText("ada@example.com")).toBeVisible();
  await expect(feed.getByText("Zoom")).toBeVisible();
  await expect(feed.getByText("Left a voicemail.")).toBeVisible();

  // The Follow-up panel also has an "Email" button, so scope to the filter group.
  const filters = page.getByRole("group", { name: "Filter activity by type" });
  await filters.getByRole("button", { name: "Email", exact: true }).click();
  await expect(feed.getByRole("listitem")).toHaveCount(1);
  await expect(feed.getByText("Proposal", { exact: true })).toBeVisible();

  // Audit history remains its own region and does not absorb the feed.
  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Activity entries" })).toHaveCount(0);
});

test("Lead activity keeps loaded history when the projection fails", async ({ page }) => {
  await stubEmptyWorkspacePanels(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) }),
  );
  await page.route("**/records/sales_leads/*/activity?**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) }),
  );

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}?tab=activity`);
  await expect(page.getByText("Activity could not be loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Lead tags support keyboard suggestions and redact lookup failures", async ({ page }) => {
  let shouldFail = false;
  await page.route("**/linked-record-options/tags?**", (route) =>
    route.fulfill({
      status: shouldFail ? 500 : 200,
      contentType: "application/json",
      body: shouldFail
        ? JSON.stringify({ detail: "tenant_id=42 database_password=private-secret" })
        : JSON.stringify({ results: [{ name: "Enterprise" }, { name: "Expansion" }] }),
    }),
  );

  await page.goto("/dashboard/sales/leads/new");
  // Exact: the tag input's chip container is labelled "Selected tags", which a substring match also picks up.
  const tagInput = page.getByLabel("Tags", { exact: true });
  await tagInput.fill("Ent");
  await expect(page.getByRole("option", { name: "Enterprise" })).toBeVisible();
  await tagInput.press("ArrowDown");
  await expect(tagInput).toHaveAttribute("aria-activedescendant", /options-0$/);
  await tagInput.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Enterprise tag" })).toBeVisible();

  shouldFail = true;
  await tagInput.fill("private");
  await expect(page.getByText("Tag suggestions could not be loaded.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=private-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Lead custom fields are labeled and preserve required false boolean values", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/custom-fields/sales_leads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 301,
          module_key: "sales_leads",
          field_key: "renewal_tier",
          label: "Renewal tier",
          field_type: "text",
          placeholder: "Gold",
          help_text: "Internal qualification tier.",
          is_required: true,
          is_active: true,
          sort_order: 10,
        },
        {
          id: 302,
          module_key: "sales_leads",
          field_key: "priority_account",
          label: "Priority account",
          field_type: "boolean",
          placeholder: null,
          help_text: "Include this lead in priority reviews.",
          is_required: true,
          is_active: true,
          sort_order: 20,
        },
      ]),
    }),
  );
  await page.route("**/api/v1/sales/leads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ lead_id: fakeLeadId }),
    });
  });

  await page.goto("/dashboard/sales/leads/new");
  await expect(page.getByLabel("Renewal tier")).toHaveAttribute("required", "");
  await expect(page.getByText("Internal qualification tier.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Priority account.*Enabled|Enabled.*Priority account/ })).not.toBeChecked();

  await page.getByLabel("Email").fill("qualified@example.test");
  await page.getByLabel("Renewal tier").fill("Gold");
  await page.getByRole("button", { name: "Create lead" }).click();

  expect(submitted).toMatchObject({
    primary_email: "qualified@example.test",
    custom_fields: {
      renewal_tier: "Gold",
      priority_account: false,
    },
  });
});
