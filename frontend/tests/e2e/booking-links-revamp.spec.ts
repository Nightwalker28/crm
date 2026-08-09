import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  let bookingLink = {
    id: 17,
    owner_id: 1,
    owner_name: "Admin User",
    owner_handle: "admin-user",
    name: "Discovery call",
    slug: "discovery-call",
    duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    timezone: "UTC",
    enabled: true,
    availability: [{ weekday: 0, start_time: "09:00", end_time: "17:00", sort_order: 0 }],
    questions: [],
  };

  await page.route("**/calendar/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        users: [{ id: 1, name: "Admin User", email: "admin@example.com", booking_handle: "admin-user" }],
        teams: [],
        connections: [],
        recent_sync_jobs: [],
        pending_invite_count: 0,
      }),
    }),
  );
  await page.route("**/calendar/booking-types/handle/current", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { booking_handle: string };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ booking_handle: body.booking_handle, canonical_prefix: `/book/${body.booking_handle}` }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ booking_handle: "admin-user", canonical_prefix: "/book/admin-user" }),
    });
  });
  await page.route(/\/calendar\/booking-types(?:\/17)?$/, async (route) => {
    if (route.request().method() === "PUT") {
      bookingLink = { ...bookingLink, ...route.request().postDataJSON() };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bookingLink) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [bookingLink] }),
    });
  });
});

test("edits a booking link from the focused drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/calendar-booking");

  await expect(page.getByRole("heading", { name: "Booking Links" })).toBeVisible();
  await expect(page.getByText("Discovery call", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discovery call" }).click();
  await expect(page.getByRole("dialog", { name: "Edit booking link" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Customer discovery");
  await expect(page.getByRole("button", { name: "Enabled", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Disabled", exact: true }).click();
  await page.getByRole("button", { name: "Question", exact: true }).click();
  await page.getByLabel("Question 1 label").fill("What should we prepare?");
  await expect(page.getByRole("button", { name: "Optional", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Required", exact: true }).click();
  const updateRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/calendar/booking-types/17"),
  );
  await page.getByRole("button", { name: "Save booking link" }).click();
  expect((await updateRequest).postDataJSON()).toMatchObject({
    name: "Customer discovery",
    slug: "discovery-call",
    enabled: false,
    questions: [{ label: "What should we prepare?", field_type: "text", required: true }],
  });

  await expect(page.getByRole("dialog", { name: "Edit booking link" })).toHaveCount(0);
  await expect(page.getByText("Customer discovery", { exact: true })).toBeVisible();
});

test("protects an unsaved new booking link when the drawer closes", async ({ page }) => {
  await page.goto("/dashboard/settings/calendar-booking");

  await page.getByRole("button", { name: "New booking link" }).click();
  await expect(page.getByRole("dialog", { name: "Create booking link" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Onboarding call");
  await page.getByRole("button", { name: "Close booking link editor" }).click();

  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Create booking link" })).toBeVisible();

  await page.getByRole("button", { name: "Close booking link editor" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("dialog", { name: "Create booking link" })).toHaveCount(0);
});

test("shows and updates the stable handle and owner-scoped preview", async ({ page }) => {
  await page.goto("/dashboard/settings/calendar-booking");

  await expect(page.getByLabel("Public booking handle")).toHaveValue("admin-user");
  await page.getByLabel("Public booking handle").fill("admin-scheduling");
  const updateRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/calendar/booking-types/handle/current"),
  );
  await page.getByRole("button", { name: "Save handle" }).click();
  expect((await updateRequest).postDataJSON()).toEqual({ booking_handle: "admin-scheduling" });

  await page.getByRole("button", { name: "Discovery call" }).click();
  await expect(page.getByText("The public URL will be /book/admin-user/discovery-call.")).toBeVisible();
  await expect(page.getByText("Duration (minutes)")).toBeVisible();
});
