import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const notification = {
  id: 9041,
  user_id: 1,
  category: "task_assigned",
  title: "Renewal task assigned",
  message: "Prepare the account renewal brief.",
  status: "unread",
  link_url: "https://untrusted.example/redirect",
  metadata: null,
  read_at: null,
  created_at: "2026-07-27T09:30:00Z",
  updated_at: "2026-07-27T09:30:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/notifications?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [notification],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 10,
        unread_count: 1,
      }),
    }),
  );
  await loginAsAdmin(page);
});

test("notification center is mobile-safe, marks reads, and rejects external destinations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/notifications/${notification.id}/read`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...notification, status: "read", read_at: "2026-07-27T10:00:00Z" }),
    }),
  );
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Open notifications, 1 unread" }).first().click();
  await expect(page.getByText("Renewal task assigned").first()).toBeVisible();
  const destination = page.getByRole("link", { name: /Renewal task assigned/ }).first();
  await expect(destination).toHaveAttribute("href", "/dashboard/settings/activity-log");
  await expect(page.getByText("https://untrusted.example/redirect")).toBeHidden();

  const readRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/notifications/${notification.id}/read`),
  );
  await destination.click();
  await readRequest;
});

test("notification failures use a scoped retry without backend details", async ({ page }) => {
  await page.unroute("**/notifications?**");
  await page.route("**/notifications?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_password=secret" }),
    }),
  );
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Open notifications" }).first().click();
  await expect(page.getByText("Notifications could not be loaded.").first()).toBeVisible();
  await expect(page.getByText("database_password=secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
});
