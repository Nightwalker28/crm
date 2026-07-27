import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const recycleItem = {
  module_key: "finance_insertion_orders",
  record_id: 501,
  title: "IO-2026-0501",
  subtitle: "ACME Media",
  deleted_at: "2026-07-27T08:00:00Z",
  details: {},
};

const emptyResponse = {
  results: [],
  range_start: 0,
  range_end: 0,
  total_count: 0,
  total_pages: 0,
  page: 1,
  page_size: 10,
};

async function mockCustomModules(page: Page) {
  await page.route("**/module-builder?include_deleted=true", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 91,
          key: "custom_vip_records",
          name: "VIP Records",
          description: "VIP Records",
          deleted_at: null,
          fields: [],
        },
      ]),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await mockCustomModules(page);
});

test("offers every built-in recovery module plus active custom modules on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/recycle?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyResponse) }),
  );

  await page.goto("/dashboard/settings/recycle-bin");
  await page.getByRole("combobox", { name: "Recycle bin module" }).click();

  await expect(page.getByRole("option", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Services" })).toBeVisible();
  await expect(page.getByRole("option", { name: "VIP Records" })).toBeVisible();
});

test("requires restore confirmation and redacts backend failures", async ({ page }) => {
  await page.route("**/recycle?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [recycleItem],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 10,
      }),
    }),
  );
  let restoreRequests = 0;
  await page.route("**/recycle/finance_insertion_orders/501/restore", (route) => {
    restoreRequests += 1;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 restore SQL failed at private-db" }),
    });
  });

  await page.goto("/dashboard/settings/recycle-bin");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Restore IO-2026-0501?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(restoreRequests).toBe(0);

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Restore record" }).click();
  await expect.poll(() => restoreRequests).toBe(1);
  await expect(page.getByText("The record could not be restored. It remains safely in the recycle bin.")).toBeVisible();
  await expect(page.getByText(/tenant_id=42|private-db|restore SQL/)).toHaveCount(0);
});

test("shows a retryable fixed error when recycled records cannot load", async ({ page }) => {
  await page.route("**/recycle?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SELECT deleted records failed for tenant_id=42" }),
    }),
  );

  await page.goto("/dashboard/settings/recycle-bin");

  await expect(page.getByText("Recycled records could not be loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/SELECT deleted records|tenant_id=42/)).toHaveCount(0);
});
