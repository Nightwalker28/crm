import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fakeLeadId = 987654321;
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
    custom_fields: {},
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
              visible_columns: ["first_name", "last_name", "company", "status"],
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
              visible_columns: ["first_name", "company", "status"],
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
  await expect(page.getByRole("link", { name: "Create lead" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Record views" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /All leads/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "My qualified leads" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage views" })).toBeVisible();
  await page.getByRole("tab", { name: /All leads/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "My qualified leads" })).toHaveAttribute("aria-selected", "true");

  const tableRegion = page.getByRole("region", { name: "Data table" });
  await expect(tableRegion).toBeVisible();
  const tableBounds = await tableRegion.boundingBox();
  expect(tableBounds?.height).toBeLessThan(400);
  await expect(tableRegion.locator("span.bg-state-success-muted", { hasText: "Qualified" })).toBeVisible();
  await expect(tableRegion.locator("span.bg-state-warning-muted", { hasText: "Warm" })).toBeVisible();
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
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) });
  });

  await page.goto("/dashboard/sales/leads/new");
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email is required.");
  await expect(page.getByLabel("Email")).toBeFocused();

  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  await ownerPicker.press("ArrowDown");
  await expect(ownerPicker).toHaveAttribute("aria-activedescendant", /users-7$/);
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
  await expect(page.getByRole("heading", { name: "Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Ada Owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
  await expect(page.getByText("Enterprise", { exact: true })).toBeVisible();
  await expect(page.getByText("Warm", { exact: true })).toBeVisible();
  await expect(page.locator("div.bg-state-warning-muted", { hasText: "Lead Score" })).toBeVisible();
  await expect(page.getByText("Next follow-up", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}\\?tab=audit$`));
  await expect(page.getByRole("tab", { name: "Audit history" })).toHaveAttribute("aria-selected", "true");

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
  const tagInput = page.getByLabel("Tags");
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
  await page.route("**/sales/leads", async (route) => {
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
