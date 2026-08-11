import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";
import { stubDefaultSavedViews } from "./helpers/savedViews";

const caseId = 987654301;

function supportCaseFixture() {
  return {
    id: caseId,
    tenant_id: 1,
    case_number: "CASE-2407-001",
    subject: "Customer cannot access the renewal order",
    description: "The customer sees an access error after signing in.",
    category: "technical",
    status: "open",
    priority: "urgent",
    source: "portal",
    contact_id: 41,
    contact_name: "Grace Buyer",
    organization_id: 51,
    organization_name: "Acme",
    opportunity_id: 61,
    opportunity_name: "Acme renewal",
    quote_id: 71,
    quote_label: "Q-2407",
    order_id: 81,
    order_label: "SO-2407",
    assigned_to_id: 1,
    assigned_to_name: "Admin User",
    created_by_id: 1,
    created_by_name: "Admin User",
    sla_due_at: "2099-07-25T12:00:00Z",
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
    comments: [{
      id: 1,
      case_id: caseId,
      author_id: 1,
      author_name: "Admin User",
      body: "We are reviewing the account permissions.",
      is_internal: false,
      created_at: "2099-07-24T09:00:00Z",
    }],
    events: [{
      id: 1,
      case_id: caseId,
      event_type: "created",
      payload_json: {},
      created_by_id: 1,
      created_at: "2099-07-24T08:00:00Z",
    }],
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubDefaultSavedViews(page);
  let supportCase = supportCaseFixture();

  await page.route("**/support/cases/summary", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total_open: 1, urgent_open: 1, overdue: 0, by_status: { open: 1 } }) }),
  );
  await page.route("**/support/cases?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [supportCase], range_start: 1, range_end: 1, total_count: 1, total_pages: 1, page: 1 }),
    }),
  );
  await page.route(`**/api/v1/support/cases/${caseId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      supportCase = { ...supportCase, ...route.request().postDataJSON(), updated_at: "2099-07-24T10:00:00Z" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(supportCase) });
  });
  await page.route("**/activity/records/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
});

test("Support list exposes shared controls and keyboard case navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/support/cases");

  await expect(page.getByRole("heading", { name: "Support Cases" })).toBeVisible();
  await expect(page.getByPlaceholder("Search support cases")).toBeVisible();
  await expect(page.getByText("CASE-2407-001")).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.locator("span.bg-state-warning-muted", { hasText: "Open" })).toBeVisible();
  await expect(page.locator("span.bg-state-danger-muted", { hasText: "Urgent" })).toBeVisible();

  const row = page.getByRole("row", { name: /Open CASE-2407-001/ });
  await row.focus();
  await row.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/dashboard/support/cases/${caseId}$`));
});

test("Support creation uses a full page and does not offer service-owned SLA fields", async ({ page }) => {
  await page.goto("/dashboard/support/cases/new");

  await expect(page.getByRole("heading", { name: "Create support case" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeVisible();
  await expect(page.getByLabel("SLA Due")).toHaveCount(0);
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByText("Subject is required.")).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeFocused();
});

test("Support detail prioritizes the requester and conversation with guarded saves", async ({ page }) => {
  await page.goto(`/dashboard/support/cases/${caseId}`);

  await expect(page.getByRole("heading", { name: "CASE-2407-001" })).toBeVisible();
  // The requester shows twice: once as a plain summary tile and once linked to its contact.
  // Assert the linked one, which also proves the record connection is present.
  await expect(page.getByRole("link", { name: "Grace Buyer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
  await expect(page.getByText("We are reviewing the account permissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(page.locator("span.bg-state-warning-muted", { hasText: "Open" })).toBeVisible();
  await expect(page.locator("span.bg-state-danger-muted", { hasText: "Urgent" })).toBeVisible();

  await page.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

test("Support failures do not expose backend details", async ({ page }) => {
  await page.unroute("**/support/cases?**");
  await page.route("**/support/cases?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_connection=secret" }),
    }),
  );
  await page.goto("/dashboard/support/cases");

  await expect(page.getByText("Support cases could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("database_connection=secret")).toBeHidden();
});
