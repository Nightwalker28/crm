import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const dealId = 987654324;
const summary = {
  opportunity: { opportunity_id: dealId, opportunity_name: "Browser Deal", client: "Grace Buyer", sales_stage: "proposal", contact_id: 41, contact_name: "Grace Buyer", organization_id: 51, organization_name: "Acme", assigned_to: 7, assigned_to_name: "Ada Owner", start_date: "2099-07-01", expected_close_date: "2099-08-01", probability_percent: 65, total_cost_of_project: "125000", currency_type: "USD", campaign_type: "Demand generation", target_geography: "APAC", target_audience: "Operations leaders", delivery_format: "Qualified leads", created_time: "2099-07-20T09:30:00Z", updated_at: "2099-07-20T09:30:00Z", custom_fields: {} },
  contact: { contact_id: 41, first_name: "Grace", last_name: "Buyer", primary_email: "grace@example.com", contact_telephone: "+94770000003", current_title: "COO" },
  organization: { org_id: 51, org_name: "Acme" },
  related_quotes: [], related_insertion_orders: [], inferred_services: ["Demand generation"], insertion_order_count: 0,
};

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

test("Deals expose the shared table and pipeline controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/sales/opportunities");
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add deal" })).toBeVisible();
  await expect(page.getByPlaceholder("Search deals")).toBeVisible();
  await expect(page.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pipeline" }).click();
  await expect(page.getByText(/Drag a card to another stage/)).toBeVisible();
});

test("Deal create, detail, and edit use routed record workflows", async ({ page }) => {
  await page.route(`**/sales/opportunities/${dealId}/summary`, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) }));
  await page.goto("/dashboard/sales/opportunities/new");
  await expect(page.getByRole("heading", { name: "Create deal" })).toBeVisible();
  await page.getByRole("button", { name: "Create deal" }).click();
  await expect(page.getByText("Deal name is required.")).toBeVisible();
  await expect(page.getByText("Select an existing contact.")).toBeVisible();
  await expect(page.getByLabel("Deal name")).toBeFocused();

  await page.goto(`/dashboard/sales/opportunities/${dealId}`);
  await expect(page.getByRole("heading", { name: "Browser Deal" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Ada Owner", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Related/ }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/opportunities/${dealId}\\?tab=related$`));

  await page.goto(`/dashboard/sales/opportunities/${dealId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit deal" })).toBeVisible();
  await expect(page.getByLabel("Deal name")).toHaveValue("Browser Deal");
  await expect(page.getByPlaceholder("Search owners")).toHaveValue("Ada Owner");
  await expect(page.getByText(/Last modified/)).toBeVisible();
});
