import { expect, test } from "@playwright/test";

const slug = "public-booking-browser";
const bookingUrl = `/book/${slug}`;
const bookingApiPattern = `**/booking-links/${slug}`;
const slotsApiPattern = `**/booking-links/${slug}/slots?**`;
const submitApiPattern = `**/booking-links/${slug}/book`;

function bookingTypeFixture() {
  return {
    name: "Discovery call",
    slug,
    duration_minutes: 30,
    timezone: "UTC",
    owner_name: "Ada Owner",
    questions: [{
      id: 7,
      label: "Company",
      field_type: "text",
      required: true,
      sort_order: 0,
    }],
  };
}

function slotsFixture() {
  return {
    results: [{
      start_at: "2099-07-30T09:00:00Z",
      end_at: "2099-07-30T09:30:00Z",
      label: "Thu, Jul 30, 9:00 AM",
    }],
  };
}

test("Public booking is responsive, validates fields, and confirms safely", async ({ page }) => {
  let submittedBody: Record<string, unknown> | null = null;
  await page.route(slotsApiPattern, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(slotsFixture()) }),
  );
  await page.route(submitApiPattern, async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        start_at: "2099-07-30T09:00:00Z",
        end_at: "2099-07-30T09:30:00Z",
        timezone: "UTC",
        status: "confirmed",
      }),
    });
  });
  await page.route(bookingApiPattern, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bookingTypeFixture()) }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(bookingUrl);

  await expect(page.getByRole("heading", { name: "Discovery call" })).toBeVisible();
  await expect(page.getByLabel("Display timezone")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Available meeting times" })).toBeVisible();
  await page.getByRole("radio").first().click();

  await page.getByRole("button", { name: "Book meeting" }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();

  await page.getByLabel("Name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Book meeting" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();

  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByRole("button", { name: "Book meeting" }).click();
  await expect(page.getByText("Answer this required question.")).toBeVisible();
  await expect(page.getByLabel("Company")).toBeFocused();

  await page.getByLabel("Company").fill("Acme");
  await page.getByRole("button", { name: "Book meeting" }).click();
  await expect(page.getByRole("heading", { name: "Meeting booked" })).toBeVisible();
  await expect(page.getByText("Your time is confirmed with Ada Owner.")).toBeVisible();
  expect(submittedBody).toMatchObject({
    guest_name: "Grace Hopper",
    guest_email: "grace@example.com",
    answers: { "7": "Acme" },
  });
});

test("Unavailable booking links redact backend details without retry enumeration", async ({ page }) => {
  await page.route(slotsApiPattern, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "tenant_id=secret" }) }),
  );
  await page.route(bookingApiPattern, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "booking_type_id=private" }) }),
  );

  await page.goto(bookingUrl);
  await expect(page.getByRole("heading", { name: "This booking link is unavailable" })).toBeVisible();
  await expect(page.getByText("booking_type_id=private")).toHaveCount(0);
  await expect(page.getByText("tenant_id=secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("Slot failures stay scoped and recover through retry", async ({ page }) => {
  let slotsRequestCount = 0;
  await page.route(slotsApiPattern, (route) => {
    slotsRequestCount += 1;
    return route.fulfill(
      slotsRequestCount === 1
        ? { status: 500, contentType: "application/json", body: JSON.stringify({ detail: "calendar_provider_secret" }) }
        : { status: 200, contentType: "application/json", body: JSON.stringify(slotsFixture()) },
    );
  });
  await page.route(bookingApiPattern, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bookingTypeFixture()) }),
  );

  await page.goto(bookingUrl);
  await expect(page.getByRole("heading", { name: "Discovery call" })).toBeVisible();
  await expect(page.getByText("Available times could not be loaded.")).toBeVisible();
  await expect(page.getByText("calendar_provider_secret")).toHaveCount(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("radio").first()).toBeVisible();
  expect(slotsRequestCount).toBe(2);
});

test("A stale selected slot refreshes availability and requests another choice", async ({ page }) => {
  let slotsRequestCount = 0;
  await page.route(slotsApiPattern, (route) => {
    slotsRequestCount += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slotsRequestCount === 1 ? slotsFixture() : { results: [] }),
    });
  });
  await page.route(submitApiPattern, (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Selected slot is no longer available" }) }),
  );
  await page.route(bookingApiPattern, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bookingTypeFixture()) }),
  );

  await page.goto(bookingUrl);
  await page.getByRole("radio").first().click();
  await page.getByLabel("Name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByLabel("Company").fill("Acme");
  await page.getByRole("button", { name: "Book meeting" }).click();

  await expect(page.getByText("That time is no longer available. Choose another time.")).toBeVisible();
  await expect(page.getByText("No times are available in the next two weeks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book meeting" })).toBeDisabled();
  expect(slotsRequestCount).toBe(2);
});
