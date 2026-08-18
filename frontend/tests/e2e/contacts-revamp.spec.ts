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
  await page.route("**/users/saved-views/sales_contacts?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        views: [{
          id: 901,
          module_key: "sales_contacts",
          name: "Contact classification",
          config: {
            visible_columns: ["first_name", "organization_name", "primary_email", "region"],
            filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
            sort: null,
          },
          is_default: true,
          is_system: false,
        }],
      }),
    }),
  );
  await page.route("**/sales/contacts?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          contact_id: fakeContactId,
          first_name: "Browser",
          last_name: "Contact",
          primary_email: "browser.contact@example.com",
          contact_telephone: "+94770000001",
          linkedin_url: null,
          current_title: "Operations Lead",
          region: "EMEA",
          country: "Sri Lanka",
          organization_name: "Lynk QA",
          assigned_to: 7,
          assigned_to_name: "Ada Owner",
          created_time: "2099-07-20T09:30:00Z",
          last_contacted_at: null,
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
  await page.goto("/dashboard/sales/contacts");

  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByPlaceholder("Search contacts")).toBeVisible();
  // Create is the Quick Create surface now, not a navigation to /new.
  await expect(page.getByRole("button", { name: "Create contact" })).toBeVisible();
  const filtersButton = page.getByRole("button", { name: /Filters/ });
  await filtersButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Filter Conditions")).toBeVisible();
  const tableRegion = page.getByRole("region", { name: "Contacts" });
  await expect(tableRegion).toBeVisible();
  await expect(tableRegion.locator("span.bg-surface-muted", { hasText: "EMEA" })).toBeVisible();
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
  // A bare getByRole("alert") also matches Next's route announcer, and a bare "Email" label
  // also matches the "Email opt-out" checkbox. Target the field slot and the input itself.
  await expect(page.locator('[data-slot="field-error"]')).toHaveText("Email is required.");
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();

  const ownerPicker = page.getByPlaceholder("Search owners (defaults to you)");
  await ownerPicker.fill("Ada");
  await page.getByRole("option", { name: /Ada Owner/ }).click();
  await expect(ownerPicker).toHaveValue("Ada Owner");
  const accountPicker = page.getByPlaceholder("Search accounts");
  await accountPicker.fill("Lynk");
  await page.getByRole("option", { name: "Lynk QA" }).click();
  await expect(accountPicker).toHaveValue("Lynk QA");

  await page.goto(`/dashboard/sales/contacts/${fakeContactId}`);
  // Two elements carry the name now: `PageShell`'s sr-only h1 and the archetype's own
  // header line. Target the record header, as the lead spec does.
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Browser Contact");
  await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  // Ownership and the account read from the record spine now (design.md 4.7).
  const spine = page.locator('[data-slot="record-spine"]');
  await expect(spine.getByText("Ada Owner", { exact: true })).toBeVisible();
  await expect(spine.getByRole("link", { name: "Lynk QA" })).toBeVisible();
  // The tab set is the archetype's four plus the module's own, and history is a sheet off
  // the spine's "Updated" line rather than a fifth tab.
  await expect(page.getByRole("tab", { name: "Audit history" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Related records" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/contacts/${fakeContactId}\\?tab=related$`));
  await page.locator('[data-slot="record-spine-meta"]').getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
  await page.keyboard.press("Escape");

  // WhatsApp is the tracked click-to-chat in the Timeline composer, and the header no
  // longer offers the untracked wa.me path beside it (design.md 4.7).
  await page.getByRole("tab", { name: "Timeline" }).click();
  // Scoped to the composer: the feed's own filter strip offers a WhatsApp option too on a
  // record that has WhatsApp activity, and the two are different controls.
  await page.getByLabel("Add to the timeline").getByRole("radio", { name: "WhatsApp" }).click();
  await expect(page.getByRole("button", { name: "Open WhatsApp" })).toBeVisible();

  await page.goto(`/dashboard/sales/contacts/${fakeContactId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit contact" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue("browser.contact@example.com");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByPlaceholder("Search accounts")).toHaveValue("Lynk QA");
  await expect(page.getByText(/Last modified/)).toBeVisible();
});
