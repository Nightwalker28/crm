import { expect, test, type Page, type Route } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Reports v2 (docs/crm-evolution/11-reports.md, Phase 1): the library, the builder, the
 * viewer with drill-down, and the forecast's own page. The report API is mocked so each
 * journey states exactly what the server answered.
 */

const field = (key: string, label: string, field_type: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  field_type,
  groupable: !["number", "money"].includes(field_type),
  measurable: ["number", "money"].includes(field_type),
  filter_type: ["number", "money", "user", "reference"].includes(field_type) ? "number" : ["date", "datetime"].includes(field_type) ? "date" : "text",
  ...extra,
});

const dealModule = {
  module_key: "sales_opportunities",
  label: "Deals",
  fields: [
    field("opportunity_name", "Name", "text", { groupable: false }),
    field("sales_stage", "Stage", "select", { reference: "stage", options: [{ value: "lead", label: "Lead" }, { value: "proposal", label: "Proposal" }] }),
    field("assigned_to", "Owner", "user", { reference: "user" }),
    field("amount", "Amount", "money"),
    field("expected_close_date", "Expected close", "date"),
  ],
  default_date_field: "expected_close_date",
  default_columns: ["sales_stage", "amount", "assigned_to"],
  supports_scope: true,
  has_record_pages: true,
};

const leadModule = {
  module_key: "sales_leads",
  label: "Leads",
  fields: [field("status", "Status", "select"), field("created_time", "Created", "datetime")],
  default_date_field: "created_time",
  default_columns: ["status"],
  supports_scope: true,
  has_record_pages: true,
};

const baseConfig = {
  version: 2,
  format: "summary",
  groupings: [{ field: "assigned_to", granularity: null }],
  measures: [{ aggregate: "count", field: null }, { aggregate: "sum", field: "amount" }],
  scope: "all",
  date_filter: { field: "expected_close_date", range: "this_quarter", start: null, end: null },
  filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
  columns: [],
  chart: { type: "column" },
  sort: { by: "value", direction: "desc" },
  limit: 25,
};

function savedReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    module_key: "sales_opportunities",
    module_label: "Deals",
    name: "Deals by owner",
    description: "This quarter's pipeline per owner",
    visibility: "private",
    owner_id: 1,
    owner_name: "Ada Lovelace",
    can_edit: true,
    config: baseConfig,
    created_at: "2099-07-20T08:00:00Z",
    updated_at: "2099-07-24T08:00:00Z",
    ...overrides,
  };
}

function runResult(config: Record<string, unknown> = baseConfig) {
  return {
    module_key: "sales_opportunities",
    label: "Deals",
    config,
    groupings: [{ ...field("assigned_to", "Owner", "user"), granularity: null }],
    measures: [
      { key: "count", aggregate: "count", field: null, label: "Records", field_type: "number" },
      { key: "sum:amount", aggregate: "sum", field: "amount", label: "Amount", field_type: "money" },
    ],
    rows: [
      { keys: ["1"], labels: ["Ada Lovelace"], count: 3, values: [3, 4500] },
      { keys: ["__empty__"], labels: ["Unassigned"], count: 1, values: [1, 200] },
    ],
    subtotals: [],
    totals: { count: 4, values: [4, 4700] },
    row_groups: [{ key: "1", label: "Ada Lovelace" }, { key: "__empty__", label: "Unassigned" }],
    column_groups: [],
    truncated: false,
    records: null,
    generated_at: "2099-07-24T08:00:00Z",
  };
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockCatalogue(page: Page, modules = [dealModule, leadModule]) {
  await page.route("**/reports/modules", (route) => json(route, { results: modules }));
  await page.route("**/reports/templates", (route) => json(route, {
    results: [{
      key: "deals-pipeline-by-stage",
      category: "Pipeline",
      name: "Pipeline by stage",
      description: "How many deals sit in each stage, and what they are worth.",
      module_key: "sales_opportunities",
      module_label: "Deals",
      config: { ...baseConfig, groupings: [{ field: "sales_stage", granularity: null }], chart: { type: "funnel" }, date_filter: null },
    }],
  }));
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("the library lists own and shared reports, and an empty library leads with templates", async ({ page }) => {
  await mockCatalogue(page);
  let reports = [savedReport(), savedReport({ id: 92, name: "Team pipeline", visibility: "everyone", owner_name: "Grace Hopper", can_edit: false, description: null })];
  await page.route(/\/reports\/saved(\?.*)?$/, (route) => json(route, { results: reports }));

  await page.goto("/dashboard/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByText("Deals by owner")).toBeVisible();
  await expect(table.getByText("Grace Hopper")).toBeVisible();
  await expect(table.getByText("Everyone")).toBeVisible();

  const sharedRequest = page.waitForRequest((request) => request.url().includes("/reports/saved?scope=shared"));
  await page.getByRole("radio", { name: "Shared" }).click();
  await sharedRequest;

  reports = [];
  await page.goto("/dashboard/reports");
  await expect(page.getByTestId("report-template-gallery")).toBeVisible();
  await expect(page.getByText("You have no reports yet.")).toBeVisible();
  await page.getByRole("link", { name: "Use template: Pipeline by stage" }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\/new\?template=deals-pipeline-by-stage$/);
});

test("the builder previews live and saves a shared report", async ({ page }) => {
  await mockCatalogue(page);
  const runBodies: Array<{ module_key: string; config: Record<string, unknown> }> = [];
  await page.route("**/reports/run", (route) => {
    const body = route.request().postDataJSON();
    runBodies.push(body);
    return json(route, runResult(body.config));
  });
  let createdBody: Record<string, unknown> | null = null;
  await page.route(/\/reports\/saved(\?.*)?$/, (route) => {
    if (route.request().method() === "POST") {
      createdBody = route.request().postDataJSON();
      return json(route, savedReport({ id: 93, name: "Quarter by owner", visibility: "everyone" }), 201);
    }
    return json(route, { results: [] });
  });
  await page.route("**/reports/saved/93", (route) => json(route, savedReport({ id: 93, name: "Quarter by owner", visibility: "everyone" })));

  await page.goto("/dashboard/reports/new?module=sales_opportunities");
  await expect(page.getByRole("heading", { name: "New report" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Report preview" }).getByText("Ada Lovelace").first()).toBeVisible();

  await page.getByRole("combobox", { name: "Group by" }).click();
  await page.getByRole("option", { name: "Expected close" }).click();
  await expect(page.getByRole("combobox", { name: "Group by interval" })).toBeVisible();
  await page.getByRole("radio", { name: "Matrix" }).click();
  await expect(page.getByRole("combobox", { name: "Columns" })).toBeVisible();
  await expect.poll(() => runBodies.at(-1)?.config.format).toBe("matrix");
  const groupings = runBodies.at(-1)?.config.groupings as Array<{ field: string; granularity: string | null }>;
  expect(groupings[0]).toEqual({ field: "expected_close_date", granularity: "month" });
  expect(groupings).toHaveLength(2);

  await page.getByRole("button", { name: "Save report" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save report" }).click();
  await expect(dialog.getByText("Name the report.")).toBeVisible();
  await dialog.getByLabel("Name").fill("Quarter by owner");
  await dialog.getByRole("radio", { name: "Everyone" }).click();
  await expect(dialog.getByText("Each person sees only the records they already have access to.")).toBeVisible();
  await dialog.getByRole("button", { name: "Save report" }).click();

  // The first visit to the report route compiles it on the dev server.
  await expect(page).toHaveURL(/\/dashboard\/reports\/93$/, { timeout: 60_000 });
  expect(createdBody).toMatchObject({ module_key: "sales_opportunities", name: "Quarter by owner", visibility: "everyone" });
  expect((createdBody as unknown as { config: { filters: Record<string, unknown> } }).config.filters).not.toHaveProperty("filtersOpen");
});

test("the viewer drills from a group to its records and guards deletion", async ({ page }) => {
  await mockCatalogue(page);
  await page.route("**/reports/saved/91", (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 204 }) : json(route, savedReport())));
  await page.route(/\/reports\/saved(\?.*)?$/, (route) => json(route, { results: [] }));
  await page.route("**/reports/run", (route) => json(route, runResult()));
  let drillBody: Record<string, unknown> | null = null;
  await page.route("**/reports/run/records", (route) => {
    drillBody = route.request().postDataJSON();
    return json(route, {
      columns: [field("sales_stage", "Stage", "select"), field("amount", "Amount", "money")],
      records: [{ id: 7, label: "Acme renewal", path: "/dashboard/sales/opportunities/7", values: { sales_stage: "Proposal", amount: 4500 } }],
      total: 1,
      offset: 0,
      limit: 25,
    });
  });

  await page.goto("/dashboard/reports/91");
  await expect(page.getByRole("heading", { name: "Deals by owner" })).toBeVisible();
  await expect(page.getByText("Deals · All records · Expected close this quarter · Yours · only you")).toBeVisible();

  await page.getByRole("row", { name: /Show records for Ada Lovelace/ }).click();
  const panel = page.getByRole("dialog", { name: "Ada Lovelace" });
  await expect(panel.getByText("Acme renewal")).toBeVisible();
  expect(drillBody).toMatchObject({ module_key: "sales_opportunities", group_keys: ["1"] });
  await expect(panel.getByRole("link", { name: "Acme renewal" })).toHaveAttribute("href", "/dashboard/sales/opportunities/7");
  await panel.getByRole("button", { name: "Close records" }).click();

  await page.getByRole("button", { name: "Delete Deals by owner" }).click();
  await expect(page.getByRole("dialog").getByText(/Dashboard charts built on it stop drawing/)).toBeVisible();
  await page.getByRole("button", { name: "Delete report" }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports$/);
});

test("a viewer schedules email to themselves through the workspace sender", async ({ page }) => {
  await mockCatalogue(page);
  await page.route("**/reports/saved/91", (route) => json(route, savedReport()));
  await page.route("**/reports/run", (route) => json(route, runResult()));
  let savedSchedule: Record<string, unknown> | null = null;
  await page.route(/\/reports\/subscriptions(\?.*)?$/, (route) => {
    if (route.request().method() === "PUT") {
      savedSchedule = route.request().postDataJSON();
      return json(route, { id: 8, ...savedSchedule, next_run_at: "2099-08-01T03:30:00Z", last_status: null, last_error: null, last_sent_at: null });
    }
    return json(route, { results: [] });
  });

  await page.goto("/dashboard/reports/91");
  await page.getByRole("button", { name: "Schedule email" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule email" });
  await expect(dialog.getByText(/your own email using the workspace sender/)).toBeVisible();
  await dialog.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option", { name: "Daily" }).click();
  await dialog.getByRole("button", { name: "Save schedule" }).click();
  await expect(dialog).not.toBeVisible();
  expect(savedSchedule).toMatchObject({ target_type: "report", target_id: 91, frequency: "daily", hour: 9, minute: 0 });
});

test("an administrator configures the workspace sender without exposing its password", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route("**/admin/tenant-mail", (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      return json(route, { configured: true, sender_email: saved?.sender_email, smtp_host: saved?.smtp_host, smtp_port: saved?.smtp_port, smtp_security: saved?.smtp_security, smtp_username: saved?.smtp_username });
    }
    return json(route, { configured: false, sender_email: null, smtp_host: null, smtp_port: null, smtp_security: null, smtp_username: null });
  });
  await page.goto("/dashboard/settings/integrations");
  await expect(page.getByRole("heading", { name: "Workspace email sender" })).toBeVisible();
  await page.getByRole("textbox", { name: "Sender email" }).fill("reports@example.com");
  await page.getByRole("textbox", { name: "SMTP host" }).fill("smtp.example.com");
  await page.getByRole("textbox", { name: "SMTP username" }).fill("reports");
  await page.getByLabel("SMTP password").fill("secret");
  await page.getByRole("button", { name: "Save sender" }).click();
  await expect(page.getByText("Workspace sender saved.")).toBeVisible();
  expect(saved).toMatchObject({ sender_email: "reports@example.com", smtp_host: "smtp.example.com", smtp_username: "reports", password: "secret" });
  await expect(page.getByLabel("SMTP password")).toHaveValue("");
});

test("a version 1 saved report opens as version 2, and failures stay generic", async ({ page }) => {
  await mockCatalogue(page);
  await page.route("**/reports/saved/91", (route) => json(route, savedReport({
    can_edit: false,
    visibility: "everyone",
    config: { dimension: "assigned_to", metric: "sum", metric_field: "amount", view_mode: "pie", filters: {} },
  })));
  let runBody: { config: Record<string, unknown> } | null = null;
  await page.route("**/reports/run", (route) => {
    runBody = route.request().postDataJSON();
    return json(route, { detail: "database_connection=secret" }, 500);
  });

  await page.goto("/dashboard/reports/91");
  await expect(page.getByText("This report could not be run. Try again.")).toBeVisible();
  await expect(page.getByText("database_connection=secret")).toBeHidden();
  await expect(page.getByText(/Shared by Ada Lovelace/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Deals by owner" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Save a copy" })).toBeVisible();
  expect(runBody).toMatchObject({ config: { version: 2, groupings: [{ field: "assigned_to" }], measures: [{ aggregate: "sum", field: "amount" }], chart: { type: "donut" } } });
});

test("the forecast has its own page and guards its dates", async ({ page }) => {
  await page.route("**/reports/forecast?**", (route) => json(route, {
    gross_pipeline_amount: 1000,
    weighted_pipeline_amount: 600,
    commit_amount: 0,
    best_case_amount: 1000,
    actual_revenue_amount: 0,
    open_opportunity_count: 2,
    won_opportunity_count: 0,
    by_stage: [{ key: "proposal", label: "Proposal", count: 2, weighted_pipeline_amount: 600 }],
    by_owner: [],
    by_team: [],
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/reports/forecast");
  await expect(page.getByRole("heading", { name: "Forecast" })).toBeVisible();
  await expect(page.getByText("2 open deals")).toBeVisible();
  await page.getByLabel("End").fill("2000-01-01");
  await expect(page.getByText("The end date must be on or after the start date.")).toBeVisible();
});

test("a dashboard applies its filters to every widget and says when a report is not shared", async ({ page }) => {
  await mockCatalogue(page);
  const sharedReport = savedReport({ id: 95, name: "Team pipeline", visibility: "everyone", can_edit: false, owner_name: "Grace Hopper" });
  // The API path, not the page: `**/reports/dashboards/40` also matches the page URL.
  await page.route(/\/api\/v1\/reports\/dashboards\/40$/, (route) => json(route, {
    id: 40,
    name: "Sales overview",
    description: "The weekly pipeline review",
    visibility: "everyone",
    owner_id: 2,
    owner_name: "Grace Hopper",
    can_edit: false,
    widget_count: 2,
    filters: { date_range: "this_quarter", scope: "report" },
    created_at: "2099-07-20T08:00:00Z",
    updated_at: "2099-07-24T08:00:00Z",
    widgets: [
      { id: "a", type: "kpi", size: "medium", report_id: 95, title: "Deals in play", chart_type: null, target: 8, report: sharedReport, unavailable_reason: null },
      { id: "b", type: "chart", size: "medium", report_id: 96, title: null, chart_type: null, target: null, report: null, unavailable_reason: "not_shared" },
    ],
  }));
  const runBodies: Array<{ config: { date_filter: unknown; scope: string } }> = [];
  await page.route("**/reports/run", (route) => {
    const request = route.request().postDataJSON();
    runBodies.push(request);
    return json(route, runResult(request.config));
  });

  await page.goto("/dashboard/reports/dashboards/40");
  await expect(page.getByRole("heading", { name: "Sales overview" })).toBeVisible();
  await expect(page.getByText("Shared by Grace Hopper")).toBeVisible();
  await expect(page.getByText("This report is not shared with you")).toBeVisible();
  // The figure is the report's first measure, a count of 4 here.
  await expect(page.getByText("50% of 8 target")).toBeVisible();
  await expect(page.getByRole("meter", { name: "Progress to target" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toBeHidden();
  expect(runBodies[0].config.date_filter).toEqual({ field: "expected_close_date", range: "this_quarter", start: null, end: null });

  await page.getByRole("combobox", { name: "Show me" }).click();
  await page.getByRole("option", { name: "My records" }).click();
  await expect(page).toHaveURL(/scope=mine/);
  await expect.poll(() => runBodies.at(-1)?.config.scope).toBe("mine");
});
