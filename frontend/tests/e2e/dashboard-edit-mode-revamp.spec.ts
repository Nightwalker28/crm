import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type DashboardWidget = {
  id: string;
  type: string;
  size: string;
  module_key?: string;
  config?: Record<string, unknown>;
};

test.beforeEach(async ({ page }) => {
  let widgets: DashboardWidget[] = [
    { id: "crm-snapshot", type: "crm_snapshot", size: "wide" },
    { id: "quick-actions", type: "quick_actions", size: "medium" },
  ];

  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "tasks", base_route: "/dashboard/tasks", description: "Tasks", is_enabled: true },
        { id: 2, name: "reports", base_route: "/dashboard/reports", description: "Reports", is_enabled: true },
      ]),
    }),
  );
  await page.route("**/users/dashboard-layout", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { widgets: DashboardWidget[] };
      widgets = payload.widgets;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ widgets, has_layout: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ widgets, has_layout: true }),
    });
  });
  await page.route("**/reports/saved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/reports/crm-summary?**", (route) => {
    const periodDays = Number(new URL(route.request().url()).searchParams.get("period_days") ?? 30);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        period_days: periodDays,
        modules: {},
        lead_status: [],
        lead_sources: [],
        new_leads: 4,
        deal_stages: [],
        pipeline_value: 125000,
        forecast_summary: null,
        won_deals: 2,
        lost_deals: 1,
        quote_status: [],
        overdue_follow_ups: 3,
        upcoming_tasks: 8,
        owner_performance: [],
      }),
    });
  });
  await page.route("**/notifications?page=1&page_size=10", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        range_start: 0,
        range_end: 0,
        total_count: 0,
        total_pages: 0,
        page: 1,
        page_size: 10,
        unread_count: 0,
      }),
    }),
  );

  await loginAsAdmin(page);
});

test("stages mobile widget changes and persists them with one save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add widget" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Move Quick Actions up" })).toBeHidden();

  const rangeRequest = page.waitForRequest((request) => request.url().includes("/reports/crm-summary?period_days=7"));
  await page.getByLabel("Dashboard date range").click();
  await page.getByRole("option", { name: "Last 7 days" }).click();
  await rangeRequest;

  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await expect(page.getByText("Dashboard edit mode")).toBeVisible();
  await page.getByRole("button", { name: "Add widget" }).click();
  await page.getByRole("button", { name: /Quick Note/ }).click();
  await page.getByRole("button", { name: "Resize Quick Note to small" }).click();
  await page.getByRole("button", { name: "Move Quick Note up" }).click();
  await page.getByRole("button", { name: "Remove Quick Actions" }).click();

  await expect(page.getByText("Unsaved layout changes")).toBeVisible();
  const saveRequest = page.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith("/users/dashboard-layout"),
  );
  await page.getByRole("button", { name: "Save layout" }).click();
  const payload = (await saveRequest).postDataJSON() as { widgets: DashboardWidget[] };

  expect(payload.widgets).toHaveLength(2);
  expect(payload.widgets[1]).toMatchObject({ type: "note", size: "small" });
  await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resize Quick Note to small" })).toBeHidden();
});

test("cancel discards the whole dashboard draft without writing", async ({ page }) => {
  await page.goto("/dashboard");
  let writeCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/users/dashboard-layout")) writeCount += 1;
  });

  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Remove Quick Actions" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
  expect(writeCount).toBe(0);
});
