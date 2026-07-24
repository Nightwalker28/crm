import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const invoiceId = 987654339;

function invoiceFixture() {
  return {
    id: invoiceId,
    invoice_number: "INV-PAY-001",
    mode: "pos",
    status: "issued",
    payment_status: "partial",
    payment_method: "Bank transfer",
    template_id: "modern",
    accent_color: "#14b8a6",
    customer_name: "Acme Operations",
    customer_email: "finance@acme.test",
    customer_address: null,
    customer_contact_id: 41,
    customer_organization_id: 51,
    issue_date: "2099-07-01",
    due_date: "2099-07-31",
    currency: "USD",
    subtotal_amount: 1000,
    discount_amount: 0,
    tax_rate: 0,
    tax_amount: 0,
    total_amount: 1000,
    amount_paid: 250,
    balance_due: 750,
    payment_terms: "Net 30",
    notes: null,
    user_name: "Admin User",
    updated_at: "2099-07-10T10:00:00Z",
    lines: [],
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  let invoice = invoiceFixture();
  await page.route("**/finance/pos-invoices?**", async (route) => {
    const url = new URL(route.request().url());
    const pageSize = Number(url.searchParams.get("page_size") ?? 10);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [invoice], range_start: 1, range_end: 1, total_count: 1, total_pages: 1, page: 1, page_size: pageSize }) });
  });
  await page.route(`**/finance/pos-invoices/${invoiceId}/payments`, async (route) => {
    const payload = route.request().postDataJSON() as { amount: number; payment_method?: string };
    invoice = { ...invoice, amount_paid: invoice.amount_paid + payload.amount, balance_due: invoice.balance_due - payload.amount, payment_method: payload.payment_method ?? invoice.payment_method };
    if (invoice.balance_due === 0) invoice = { ...invoice, status: "paid", payment_status: "paid" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invoice) });
  });
});

test("Payments provides a responsive receivables list and records a payment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/finance/payments");

  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByPlaceholder("Search payments by invoice, customer, method, or status")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Payment status" })).toBeVisible();
  await expect(page.getByRole("link", { name: "INV-PAY-001" })).toBeVisible();

  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { name: "Record payment" })).toBeVisible();
  await expect(page.getByLabel("Payment amount")).toHaveValue("750.00");
  await page.getByLabel("Payment method").fill("Card");
  await page.getByRole("button", { name: "Record payment", exact: true }).last().click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
});

test("Payments distinguishes filtered empty results", async ({ page }) => {
  await page.route("**/finance/pos-invoices?**", async (route) => {
    const url = new URL(route.request().url());
    const pageSize = Number(url.searchParams.get("page_size") ?? 10);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], range_start: 0, range_end: 0, total_count: 0, total_pages: 0, page: 1, page_size: pageSize }) });
  });
  await page.goto("/dashboard/finance/payments");
  await page.getByPlaceholder("Search payments by invoice, customer, method, or status").fill("missing customer");
  await expect(page.getByText("No payments match these filters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("Payment recording provides a responsive routed workflow with bounded amounts", async ({ page }) => {
  let submittedPayload: { amount: number; payment_method?: string | null } | null = null;
  await page.route(`**/finance/pos-invoices/${invoiceId}/payments`, async (route) => {
    submittedPayload = route.request().postDataJSON() as { amount: number; payment_method?: string | null };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...invoiceFixture(),
        amount_paid: 1000,
        balance_due: 0,
        status: "paid",
        payment_status: "paid",
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/finance/payments/record");

  await expect(page.getByRole("heading", { name: "Record payment" })).toBeVisible();
  await page.getByRole("button", { name: /INV-PAY-001 · Acme Operations/ }).click();
  await expect(page.getByLabel("Payment amount")).toHaveValue("750.00");

  await page.getByLabel("Payment amount").fill("751");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByText("Payment amount cannot exceed the outstanding balance.")).toBeVisible();

  await page.getByLabel("Payment amount").fill("750");
  await page.getByLabel("Payment method").fill("Card");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/finance/payments\\?recordedInvoiceId=${invoiceId}$`));
  expect(submittedPayload).toEqual({ amount: 750, payment_method: "Card" });
});

test("Payment recording hides backend failure details", async ({ page }) => {
  await page.route(`**/finance/pos-invoices/${invoiceId}/payments`, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SECRET ledger reconciliation failure" }),
    }),
  );
  await page.goto("/dashboard/finance/payments/record");
  await page.getByRole("button", { name: /INV-PAY-001 · Acme Operations/ }).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("We could not record this payment.");
  await expect(page.getByText(/SECRET ledger reconciliation failure/)).toHaveCount(0);
});
