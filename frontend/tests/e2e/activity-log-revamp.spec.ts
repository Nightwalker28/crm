import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const activityItems = [
  {
    id: 91,
    actor_user_id: 7,
    module_key: "authentication",
    entity_type: "user_session",
    entity_id: "7",
    action: "auth.login.failed",
    description: "Sign-in attempt failed.",
    created_at: "2026-07-27T08:00:00Z",
  },
  {
    id: 90,
    actor_user_id: null,
    module_key: "sales_contacts",
    entity_type: "sales_contact",
    entity_id: "41",
    action: "restore",
    description: "Restored contact from recycle bin.",
    created_at: "2026-07-27T07:00:00Z",
  },
];

function activityResponse(results = activityItems, pageSize = 10) {
  return {
    results,
    range_start: results.length ? 1 : 0,
    range_end: results.length,
    total_count: results.length ? 30 : 0,
    total_pages: results.length ? Math.ceil(30 / pageSize) : 0,
    page: 1,
  };
}

async function mockActivity(page: Page) {
  await page.route("**/activity?**", (route) => {
    const url = new URL(route.request().url());
    const pageSize = Number(url.searchParams.get("page_size") ?? "10");
    const action = url.searchParams.get("action");
    const results = action ? activityItems.filter((item) => item.action === action) : activityItems;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activityResponse(results, pageSize)),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("shows readable actions, record types, and actor attribution on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockActivity(page);
  await page.goto("/dashboard/settings/activity-log");

  await expect(page.getByText("Auth Login Failed")).toBeVisible();
  await expect(page.getByText("User Session")).toBeVisible();
  await expect(page.getByText("User #7")).toBeVisible();
  await expect(page.getByText("System")).toBeVisible();

  const restoreRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/activity") && url.searchParams.get("action") === "restore";
  });
  await page.getByRole("combobox", { name: "Activity action" }).click();
  await page.getByRole("option", { name: "Restore" }).click();
  await restoreRequest;

  await expect(page.getByText("Restored contact from recycle bin.")).toBeVisible();
  await expect(page.getByText("Sign-in attempt failed.")).toBeHidden();
});

test("items-per-page selection updates the server query", async ({ page }) => {
  await mockActivity(page);
  await page.goto("/dashboard/settings/activity-log");

  const pageSizeRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/activity") && url.searchParams.get("page_size") === "25";
  });
  const pageSizeControl = page.getByText("Items per page").locator("..").getByRole("combobox");
  await pageSizeControl.click();
  await page.getByRole("option", { name: "25" }).click();
  await pageSizeRequest;

  await expect(pageSizeControl).toHaveText("25");
});

test("shows retryable fixed errors without audit backend detail", async ({ page }) => {
  await page.route("**/activity?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "activity_logs tenant_id=42 SELECT failed at private-db" }),
    }),
  );

  await page.goto("/dashboard/settings/activity-log");

  await expect(page.getByText("Activity could not be loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/tenant_id=42|SELECT failed|private-db/)).toHaveCount(0);
});
