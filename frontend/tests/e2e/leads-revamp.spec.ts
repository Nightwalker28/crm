import { expect, test, type Page } from "@playwright/test";

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
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    team_id: 4,
    team_name: "Revenue",
    tags: ["Enterprise", "Warm"],
    next_follow_up_at: "2099-07-20T09:30:00Z",
    next_follow_up_is_overdue: false,
  },
};

async function mockLeadRelationshipOptions(page: Page) {
  await page.route("**/linked-record-options/users?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.com" }] }),
    });
  });
  await page.route("**/linked-record-options/teams?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 4, label: "Revenue" }] }),
    });
  });
  await page.route("**/linked-record-options/tags?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ name: "Enterprise" }] }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Leads list keeps its controls usable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
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

  const filtersButton = page.getByRole("button", { name: /Filters/ });
  await filtersButton.focus();
  await expect(filtersButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Filter Conditions")).toBeVisible();
});

test("Leads routed workflow exposes create, detail, edit, conversion, and deep-linked tabs", async ({ page }) => {
  await mockLeadRelationshipOptions(page);
  await page.route(`**/sales/leads/${fakeLeadId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeLeadSummary) });
  });

  await page.goto("/dashboard/sales/leads/new");
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email is required.");
  await expect(page.getByLabel("Email")).toBeFocused();

  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  await page.getByRole("button", { name: /Ada Owner/ }).click();
  await expect(ownerPicker).toHaveValue("Ada Owner");

  const teamPicker = page.getByPlaceholder("Search teams (defaults to yours)");
  await teamPicker.fill("Rev");
  await page.getByRole("button", { name: "Revenue" }).click();
  await expect(teamPicker).toHaveValue("Revenue");

  const tagInput = page.getByPlaceholder("Type a tag and press Enter");
  await tagInput.fill("Enterprise");
  await tagInput.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Enterprise tag" })).toBeVisible();
  await expect(page.getByLabel("Next follow-up")).toBeVisible();

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}`);
  await expect(page.getByRole("heading", { name: "Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Ada Owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
  await expect(page.getByText("Enterprise", { exact: true })).toBeVisible();
  await expect(page.getByText("Warm", { exact: true })).toBeVisible();
  await expect(page.getByText("Next follow-up", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${fakeLeadId}\\?tab=audit$`));
  await expect(page.getByRole("tab", { name: "Audit history" })).toHaveAttribute("aria-selected", "true");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit lead" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("browser.fixture@example.com");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByPlaceholder("Search teams")).toHaveValue("Revenue");
  await expect(page.getByRole("button", { name: "Remove Enterprise tag" })).toBeVisible();
  await expect(page.getByLabel("Next follow-up")).not.toHaveValue("");

  await page.goto(`/dashboard/sales/leads/${fakeLeadId}/convert`);
  await expect(page.getByRole("heading", { name: "Convert Browser Fixture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm conversion" })).toBeVisible();
});
