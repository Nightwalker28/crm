import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fakeAccountId = 987654323;
const fakeAccountSummary = {
  organization: {
    org_id: fakeAccountId,
    org_name: "Browser Account",
    primary_email: "account@example.com",
    secondary_email: "billing@example.com",
    website: "https://example.com",
    primary_phone: "+94770000002",
    secondary_phone: "",
    industry: "Technology",
    annual_revenue: "$10M - $25M",
    billing_address: "1 Test Street",
    billing_city: "Colombo",
    billing_state: "Western",
    billing_postal_code: "00100",
    billing_country: "Sri Lanka",
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  related_contacts: [],
  related_opportunities: [],
  related_quotes: [],
  related_orders: [{ id: 71, order_number: "SO-BROWSER", status: "confirmed", currency: "USD", grand_total: 1250, updated_at: "2099-07-20T09:30:00Z" }],
  related_invoices: [{ id: 72, invoice_number: "INV-BROWSER", status: "issued", payment_status: "unpaid", currency: "USD", total_amount: 1250, updated_at: "2099-07-20T09:30:00Z" }],
  related_insertion_orders: [],
  inferred_services: [],
  contact_count: 0,
  opportunity_count: 0,
  quote_count: 0,
  order_count: 1,
  invoice_count: 1,
  insertion_order_count: 0,
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Accounts list keeps shared controls usable on mobile", async ({ page }) => {
  await page.route("**/sales/organizations?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          org_id: fakeAccountId,
          org_name: "Browser Account",
          primary_email: "account@example.com",
          website: "https://example.com",
          industry: "Media & Entertainment",
          annual_revenue: "$10M - $25M",
          primary_phone: "+94770000002",
          billing_country: "Sri Lanka",
          assigned_to: 7,
          assigned_to_name: "Ada Owner",
          created_time: "2099-07-20T09:30:00Z",
          updated_at: "2099-07-20T09:30:00Z",
          custom_fields: {},
        }],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
      }),
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard/sales/organizations");

  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByPlaceholder("Search accounts")).toBeVisible();
  // Create is the Quick Create surface now, not a navigation to /new.
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  const filtersButton = page.getByRole("button", { name: /Filters/ });
  await filtersButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Filter Conditions")).toBeVisible();
  const tableRegion = page.getByRole("region", { name: "Accounts" });
  await expect(tableRegion).toBeVisible();
  await expect(tableRegion.locator("span.bg-surface-muted", { hasText: "Media & Entertainment" })).toBeVisible();
  expect(await tableRegion.locator("thead th").evaluateAll((headers) => headers.slice(0, 2).map((header) => window.getComputedStyle(header).position))).toEqual(["sticky", "sticky"]);
});

test("Account create, detail, edit, and related-record tabs use the shared workflow", async ({ page }) => {
  await page.route("**/linked-record-options/users?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.com" }] }) });
  });
  await page.route(`**/sales/organizations/${fakeAccountId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeAccountSummary) });
  });

  await page.goto("/dashboard/sales/organizations/new");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account name is required.")).toBeVisible();
  await expect(page.getByText("Primary email is required.")).toBeVisible();
  await expect(page.getByLabel("Account name")).toBeFocused();
  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  await page.getByRole("option", { name: /Ada Owner/ }).click();
  await expect(ownerPicker).toHaveValue("Ada Owner");

  await page.goto(`/dashboard/sales/organizations/${fakeAccountId}`);
  await expect(page.getByRole("heading", { name: "Browser Account" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  // Ownership now reads from the workspace relationship rail; the industry stays on Details.
  await expect(
    page.locator("[data-record-workspace-relationship-rail]").getByText("Ada Owner", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-layout-field='industry']")).toContainText("Technology");
  await page.getByRole("tab", { name: "Related records" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/organizations/${fakeAccountId}\\?tab=related$`));
  // The relationship rail also counts insertion orders, so target the related-records card.
  await expect(page.getByRole("heading", { name: "Insertion orders" })).toBeVisible();
  await expect(page.getByText("SO-BROWSER", { exact: true })).toBeVisible();
  await expect(page.getByText("INV-BROWSER", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/sales/organizations/${fakeAccountId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit account" })).toBeVisible();
  await expect(page.getByLabel("Account name")).toHaveValue("Browser Account");
  await expect(page.getByLabel("Primary email")).toHaveValue("account@example.com");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByText(/Last modified/)).toBeVisible();
});
