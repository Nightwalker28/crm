import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fakeContactId = 987654322;
const fakeContactSummary = {
  contact: {
    contact_id: fakeContactId,
    first_name: "Browser",
    last_name: "Contact",
    primary_email: "browser.contact@example.com",
    contact_telephone: "+94770000001",
    current_title: "Operations Lead",
    linkedin_url: "https://linkedin.com/in/browser-contact",
    region: "APAC",
    country: "Sri Lanka",
    email_opt_out: false,
    organization_id: 4,
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  organization: { org_id: 4, org_name: "Lynk QA" },
  related_opportunities: [],
  related_quotes: [],
  inferred_services: [],
  opportunity_count: 0,
  quote_count: 0,
};

async function mockContactRelationships(page: Page) {
  await page.route("**/linked-record-options/users?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.com" }] }) });
  });
  await page.route("**/sales/organizations/search/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ org_id: 4, org_name: "Lynk QA" }] }) });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Contacts list keeps the shared controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard/sales/contacts");

  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByPlaceholder("Search contacts")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create contact" })).toBeVisible();
  const filtersButton = page.getByRole("button", { name: /Filters/ });
  await filtersButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Filter Conditions")).toBeVisible();
  const tableRegion = page.getByRole("region", { name: "Data table" });
  await expect(tableRegion).toBeVisible();
  expect(await tableRegion.locator("thead th").evaluateAll((headers) => headers.slice(0, 2).map((header) => window.getComputedStyle(header).position))).toEqual(["sticky", "sticky"]);
});

test("Contact create, detail, edit, and record tabs follow the shared workflow", async ({ page }) => {
  await mockContactRelationships(page);
  await page.route(`**/sales/contacts/${fakeContactId}/summary`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeContactSummary) });
  });

  await page.goto("/dashboard/sales/contacts/new");
  await expect(page.getByRole("heading", { name: "Create contact" })).toBeVisible();
  await page.getByRole("button", { name: "Create contact" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email is required.");
  await expect(page.getByLabel("Email")).toBeFocused();

  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  await page.getByRole("button", { name: /Ada Owner/ }).click();
  await expect(ownerPicker).toHaveValue("Ada Owner");
  const accountPicker = page.getByPlaceholder("Search accounts");
  await accountPicker.fill("Lynk");
  await page.getByRole("button", { name: "Lynk QA" }).click();
  await expect(accountPicker).toHaveValue("Lynk QA");

  await page.goto(`/dashboard/sales/contacts/${fakeContactId}`);
  await expect(page.getByRole("heading", { name: "Browser Contact" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Ada Owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Lynk QA", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Audit history" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/contacts/${fakeContactId}\\?tab=audit$`));

  await page.goto(`/dashboard/sales/contacts/${fakeContactId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit contact" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("browser.contact@example.com");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByPlaceholder("Search accounts")).toHaveValue("Lynk QA");
  await expect(page.getByText(/Last modified/)).toBeVisible();
});
