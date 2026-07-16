import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

test("Order creation uses the shared itemized transaction workflow", async ({ page }) => {
  await page.goto("/dashboard/sales/orders/new");
  await expect(page.getByRole("heading", { name: "Create order" })).toBeVisible();
  await expect(page.getByText("Customer and billing details")).toBeVisible();
  await expect(page.getByText("Line items", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivery and payment details")).toBeVisible();
  await expect(page.getByText("Review summary")).toBeVisible();

  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText("Select an account or contact for this order.")).toBeVisible();
  await expect(page.getByText(/Each line needs a name/)).toBeVisible();

  await page.getByLabel("name line 1").fill("Implementation");
  await page.getByLabel("quantity line 1").fill("2");
  await page.getByLabel("unit price line 1").fill("100");
  await page.getByLabel("discount amount line 1").fill("10");
  await page.getByLabel("tax amount line 1").fill("19");
  await expect(page.getByText("$209.00", { exact: true })).toHaveCount(2);
  await page.getByLabel("name line 1").press("Enter");
  await expect(page.getByLabel("name line 2")).toBeFocused();
});

test("Orders list routes manual creation to the dedicated page", async ({ page }) => {
  await page.goto("/dashboard/sales/orders");
  const createLink = page.getByRole("link", { name: "Create order" });
  await expect(createLink).toBeVisible();
  await createLink.click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/orders\/new$/);
});

test("Order editing hydrates customer, item, and fulfillment fields", async ({ page }) => {
  const orderId = 987654342;
  await page.route(`**/sales/orders/${orderId}`, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    id: orderId, order_number: "SO-BROWSER-1", quote_id: null, organization_id: 51, organization_name: "Acme Operations", contact_id: 41, contact_name: "Grace Buyer", opportunity_id: null, opportunity_name: null, owner_id: 7, owner_name: "Ada Owner", status: "confirmed", currency: "USD", subtotal: "200", discount_total: "10", tax_total: "19", grand_total: "209", delivery_date: "2099-08-01", delivery_address: "1 Browser Street", payment_terms: "Net 30", notes: "Handle carefully", updated_at: "2099-07-10T10:00:00Z", items: [{ id: 1, name: "Implementation", description: "Configured delivery", quantity: "2", unit_price: "100", discount_amount: "10", tax_amount: "19", line_total: "209", sort_order: 0 }],
  }) }));

  await page.goto(`/dashboard/sales/orders/${orderId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit SO-BROWSER-1" })).toBeVisible();
  await expect(page.getByPlaceholder("Search accounts")).toHaveValue("Acme Operations");
  await expect(page.getByLabel("name line 1")).toHaveValue("Implementation");
  await expect(page.getByLabel("Delivery date")).toHaveValue("2099-08-01");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
});
