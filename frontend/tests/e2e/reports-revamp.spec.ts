import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const baseFilters = {
  search: "",
  logic: "all",
  conditions: [],
  all_conditions: [],
  any_conditions: [],
};

const leadModule = {
  module_key: "sales_leads",
  label: "Leads",
  dimensions: [{ key: "status", label: "Status", field_type: "select" }],
  metrics: [],
  filter_fields: [{ key: "status", label: "Status", field_type: "select" }],
  default_dimension: "status",
};

const dealModule = {
  module_key: "sales_opportunities",
  label: "Deals",
  dimensions: [{ key: "sales_stage", label: "Stage", field_type: "select" }],
  metrics: [{ key: "total_cost_of_project", label: "Deal value", field_type: "number" }],
  filter_fields: [{ key: "sales_stage", label: "Stage", field_type: "select" }],
  default_dimension: "sales_stage",
};

const financeModule = {
  module_key: "finance_io",
  label: "Insertion Orders",
  dimensions: [{ key: "status", label: "Status", field_type: "select" }],
  metrics: [{ key: "total_amount", label: "Total amount", field_type: "number" }],
  filter_fields: [{ key: "status", label: "Status", field_type: "select" }],
  default_dimension: "status",
};

const customModule = {
  module_key: "custom_projects",
  label: "Projects",
  dimensions: [{ key: "created_at", label: "Created date", field_type: "date" }],
  metrics: [],
  filter_fields: [{ key: "created_at", label: "Created date", field_type: "date" }],
  default_dimension: "created_at",
};

function reportFixture(moduleKey = "sales_leads") {
  return {
    module_key: moduleKey,
    dimension: { key: "status", label: "Status", field_type: "select" },
    metric: "count",
    metric_field: null,
    total_count: 6,
    rows: [
      { key: "new", label: "New", count: 4, value: 4 },
      { key: "qualified", label: "Qualified", count: 2, value: 2 },
    ],
  };
}

async function mockReportData(page: import("@playwright/test").Page, modules = [leadModule, financeModule, customModule]) {
  await page.route("**/reports/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: modules }) }),
  );
  await page.route("**/reports/modules/*", (route) => {
    const moduleKey = new URL(route.request().url()).pathname.split("/").at(-1) ?? "sales_leads";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportFixture(moduleKey)) });
  });
  await page.route("**/reports/saved?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Reports expose every authorized module and guard unavailable forecasting", async ({ page }) => {
  await mockReportData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/reports");

  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Forecast unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bar" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("combobox", { name: "Report module" }).click();
  await expect(page.getByRole("option", { name: "Insertion Orders" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Projects" })).toBeVisible();
  await page.getByRole("option", { name: "Insertion Orders" }).click();
  await expect(page.getByRole("heading", { name: "Insertion Orders report" })).toBeVisible();
});

test("Reports distinguish filtered empty results and redact backend failures", async ({ page }) => {
  await mockReportData(page);
  await page.unroute("**/reports/modules/*");
  await page.route("**/reports/modules/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("search")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...reportFixture(), total_count: 0, rows: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_connection=secret" }),
    });
  });

  await page.goto("/dashboard/reports");
  await expect(page.getByText("The report could not be generated. Adjust the configuration or try again.")).toBeVisible();
  await expect(page.getByText("database_connection=secret")).toBeHidden();

  await page.getByLabel("Search").fill("missing customer");
  await expect(page.getByText("No records match these filters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("Saved reports support keyboard opening, dirty saves, and confirmed deletion", async ({ page }) => {
  const savedReport = {
    id: 91,
    module_key: "sales_leads",
    name: "Weekly lead status",
    config: {
      dimension: "status",
      metric: "count",
      metric_field: "",
      filters: baseFilters,
      view_mode: "bar",
    },
    created_at: "2099-07-20T08:00:00Z",
    updated_at: "2099-07-24T08:00:00Z",
  };

  await mockReportData(page, [leadModule, dealModule]);
  await page.unroute("**/reports/saved?**");
  await page.route("**/reports/saved?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [savedReport] }) }),
  );
  await page.route("**/reports/forecast?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        period_start: "2099-07-24",
        period_end: "2099-10-22",
        gross_pipeline_amount: 1000,
        weighted_pipeline_amount: 600,
        commit_amount: 0,
        best_case_amount: 1000,
        actual_revenue_amount: 250,
        open_opportunity_count: 1,
        won_opportunity_count: 1,
        by_stage: [],
        by_owner: [],
        by_team: [],
      }),
    }),
  );

  await page.goto("/dashboard/reports");
  const row = page.getByRole("row", { name: "Open saved report Weekly lead status" });
  await row.focus();
  await row.press("Enter");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await page.getByRole("button", { name: "Pie" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Delete saved report?" })).toBeVisible();
  await expect(page.getByText(/removes the saved configuration, not the underlying CRM data/)).toBeVisible();
});

test("Forecast dates validate before issuing a report request", async ({ page }) => {
  await mockReportData(page, [leadModule, dealModule]);
  await page.route("**/reports/forecast?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }),
  );
  await page.goto("/dashboard/reports");

  await page.getByLabel("Start").fill("2099-08-02");
  await page.getByLabel("End").fill("2099-08-01");
  await expect(page.getByText("Forecast end date must be on or after the start date.")).toBeVisible();
  await expect(page.getByLabel("End")).toHaveAttribute("aria-invalid", "true");
});
