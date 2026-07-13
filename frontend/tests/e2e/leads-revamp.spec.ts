import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fakeLeadId = 987654321;
const fakeLeadSummary = {
  lead: {
    lead_id: fakeLeadId,
    first_name: "Browser",
    last_name: "Fixture",
    company: "Lynk QA",
    primary_email: "browser.fixture@example.com",
    phone: "+94770000000",
    title: "QA Lead",
    source: "Browser verification",
    status: "qualified",
    notes: "Non-persistent browser fixture",
    custom_fields: {},
    score: 45,
    score_grade: "warm",
    score_factors: [],
  },
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Leads list keeps its controls usable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/dashboard/sales/leads");

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByPlaceholder("Search leads")).toBeVisible();
  await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create lead" })).toBeVisible();

  const tableRegion = page.getByRole("region", { name: "Data table" });
  await expect(tableRegion).toBeVisible();
  const stickyPositions = await tableRegion.locator("thead th").evaluateAll((headers) =>
    headers.slice(0, 2).map((header) => window.getComputedStyle(header).position),
  );
  expect(stickyPositions).toEqual(["sticky", "sticky"]);
});

test("Leads routed workflow exposes create, detail, edit, conversion, and deep-linked tabs", async ({ page }) => {
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) });
  });

  await page.goto("/dashboard/sales/leads/new");
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Email is required.")).toBeVisible();

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.getByRole("heading", { name: "Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}\\?tab=audit$`));
  await expect(page.getByRole("tab", { name: "Audit history" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit lead" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("browser.fixture@example.com");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/convert`);
  await expect(page.getByRole("heading", { name: "Convert Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm conversion" })).toBeVisible();
});
