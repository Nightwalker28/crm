// Guards the bounded Lead Quick Create layout builder.
//
// The read paths (admin state, preview) run against the real backend on purpose: the whole
// point of the builder is that its validation and its preview are the server's, not a
// second implementation in the browser. Only the write paths are mocked, so a run never
// republishes the development tenant's layout.
import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const BUILDER_ROUTE = "/dashboard/settings/record-layouts";

/** Long enough to cover the builder's preview debounce plus the round trip. */
const VALIDATION_TIMEOUT = 15_000;

async function openBuilder(page: Page) {
  await page.goto(BUILDER_ROUTE);
  await expect(page.getByRole("heading", { name: "Available fields" })).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Blocking errors and suggestions stay separate, and only errors gate publishing", async ({ page }) => {
  await openBuilder(page);

  const publish = page.getByRole("button", { name: "Publish" });
  await expect(publish).toBeDisabled();

  // Email is required by the Lead domain, so taking it off Quick Create is a blocking error
  // rather than advice. The server decides that; the builder only has to show it as blocking.
  await page.getByRole("button", { name: "Remove Email from the layout" }).click();

  const errors = page.locator("[data-layout-error]");
  await expect(errors.first()).toBeVisible({ timeout: VALIDATION_TIMEOUT });
  await expect(page.getByText(/problem(s)? block(s)? publishing|problem blocks publishing/)).toBeVisible();
  await expect(publish).toBeDisabled();
  // A blocking error means there is nothing truthful to preview.
  await expect(page.getByText("No preview available")).toBeVisible();

  await page.getByRole("button", { name: "Add Email to the layout" }).click();
  await expect(page.locator("[data-layout-validation='valid']")).toBeVisible({ timeout: VALIDATION_TIMEOUT });
  await expect(errors).toHaveCount(0);
  await expect(publish).toBeEnabled();
});

test("A long Quick Create warns without blocking, and warnings never appear as errors", async ({ page }) => {
  await openBuilder(page);

  // Quick Create is recommended to stay under nine visible fields. Pushing past that is the
  // tenant's call, so it has to surface as a suggestion that still publishes.
  const addButtons = page.getByRole("button", { name: /^Add .+ to the layout$/ });
  const available = await addButtons.count();
  for (let index = 0; index < available; index += 1) {
    await addButtons.first().click();
  }

  await expect(page.locator("[data-layout-warning]").first()).toBeVisible({ timeout: VALIDATION_TIMEOUT });
  await expect(page.getByText("These do not block publishing.")).toBeVisible();
  await expect(page.locator("[data-layout-error]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
});

test("Fields reorder without any drag interaction and the preview follows", async ({ page }) => {
  await openBuilder(page);

  const firstSection = page.locator("[data-layout-builder-section]").first();
  const fieldKeysIn = async () =>
    firstSection.locator("[data-layout-builder-field]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-layout-builder-field") ?? ""),
    );

  const before = await fieldKeysIn();
  expect(before.length).toBeGreaterThan(1);

  const movedLabel = await firstSection
    .locator(`[data-layout-builder-field="${before[0]}"] span.font-medium`)
    .first()
    .innerText();
  // Reordering is button-driven only — there is no drag affordance anywhere on this page.
  await page.getByRole("button", { name: `Move ${movedLabel} down` }).click();

  const after = await fieldKeysIn();
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);

  // The move must reach the server-resolved preview, not just the builder's own list.
  await expect
    .poll(
      async () =>
        page.locator("[data-layout-preview] [data-layout-field]").first().getAttribute("data-layout-field"),
      { timeout: VALIDATION_TIMEOUT },
    )
    .toBe(after[0]);
});

test("The preview renders desktop and mobile without resizing the window", async ({ page }) => {
  await openBuilder(page);

  await expect(page.locator("[data-layout-preview='desktop']")).toBeVisible({ timeout: VALIDATION_TIMEOUT });
  await page.getByRole("button", { name: "Mobile" }).click();

  const mobile = page.locator("[data-layout-preview='mobile']");
  await expect(mobile).toBeVisible();
  // Mobile pins the single-column form; a half-width field must not sit beside its neighbour.
  await expect(mobile.locator("[data-record-layout][data-layout-viewport='mobile']")).toBeVisible();
  const width = await mobile.boundingBox();
  expect(width?.width ?? 0).toBeLessThanOrEqual(420);
});

test("Publishing sends the draft with the loaded version and reports a stale layout", async ({ page }) => {
  await openBuilder(page);

  let published: Record<string, unknown> | null = null;
  await page.route("**/api/v1/admin/record-layouts/sales_leads/quick_create", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    published = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        detail: {
          message: "This layout changed since you opened it. Reload to see the current version.",
          current_version: 99,
        },
      }),
    });
  });

  // Collapsing a section is a change that can never be invalid, so this test exercises the
  // publish transport rather than validation.
  await page.getByRole("button", { name: "Collapsed" }).first().click();
  const publish = page.getByRole("button", { name: "Publish" });
  await expect(publish).toBeEnabled({ timeout: VALIDATION_TIMEOUT });
  await publish.click();

  await expect(page.getByText("This layout changed since you opened it. Reload to see the current version.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload layout" })).toBeVisible();
  expect(published).toHaveProperty("definition");
  expect(published).toHaveProperty("expected_version");
});
