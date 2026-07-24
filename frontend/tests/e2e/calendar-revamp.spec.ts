import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

function eventFixture() {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  return {
    id: 765432101,
    title: "Customer renewal review",
    description: "Review the renewal plan.",
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    is_all_day: false,
    location: "Boardroom",
    meeting_url: null,
    status: "scheduled",
    owner_user_id: 1,
    owner_name: "Admin User",
    source_module_key: null,
    source_entity_id: null,
    source_label: null,
    current_user_response: "accepted",
    participants: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  const calendarEvent = eventFixture();
  await page.route("**/calendar/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        users: [{ id: 1, name: "Admin User", email: "admin@example.com" }],
        teams: [],
        connections: [{
          provider: "google",
          status: "error",
          account_email: "admin@example.com",
          provider_calendar_id: "primary",
          provider_calendar_name: "Primary calendar",
          sync_enabled_for_current_session: true,
          last_synced_at: null,
          last_error: "token_response_payload=secret",
          health_status: "reconnect_required",
          credential_state: "reconnect_required",
          scopes: ["calendar.events"],
          last_successful_sync_at: null,
          last_failure_reason: "token_response_payload=secret",
          reconnect_required: true,
          reconnect_label: "Reconnect Google",
        }],
        recent_sync_jobs: [{
          id: 44,
          module_key: "calendar",
          operation_type: "sync",
          status: "failed",
          mode: "background",
          error_message: "provider_stack_trace=secret",
          progress_percent: 100,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        pending_invite_count: 0,
      }),
    }),
  );
  await page.route("**/calendar/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [calendarEvent] }),
    }),
  );
});

test("Calendar keeps core scheduling usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/calendar");

  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByLabel("Calendar month agenda")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  await expect(page.getByText("Customer renewal review").first()).toBeVisible();

  await page.getByRole("button", { name: "New event" }).click();
  await expect(page.getByRole("heading", { name: "Create Event" })).toBeVisible();
  await page.getByLabel("Event title").fill("Mobile follow-up");
  await page.getByLabel("All-day event").click();
  await expect(page.getByLabel("All-day event")).toHaveAttribute("data-state", "checked");
});

test("Calendar provider cards hide technical sync details", async ({ page }) => {
  await page.goto("/dashboard/calendar");

  await expect(page.getByText("Reconnect required")).toBeVisible();
  await expect(page.getByText("The provider needs attention. Reconnect it, then try syncing again.")).toBeVisible();
  await expect(page.getByText("token_response_payload=secret")).toBeHidden();
  await expect(page.getByText("provider_stack_trace=secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reconnect Google" })).toBeVisible();
});
