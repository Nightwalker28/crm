import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";
import { stubDefaultSavedViews } from "./helpers/savedViews";

const moduleCacheKey = "lynk_modules:v4";

async function cachePosPermissions(
  page: Parameters<typeof loginAsAdmin>[0],
  actions: { can_create: boolean; can_edit: boolean; can_delete: boolean },
) {
  await page.evaluate(
    ({ cacheKey, moduleActions }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify([{
        id: 91,
        name: "finance_pos",
        is_enabled: true,
        actions: {
          can_view: true,
          ...moduleActions,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      }]));
    },
    { cacheKey: moduleCacheKey, moduleActions: actions },
  );

  // useAccessibleModules revalidates from the API and overwrites the seeded cache, so the
  // stub has to agree with it or the real admin permissions win.
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 91,
        name: "finance_pos",
        is_enabled: true,
        actions: {
          can_view: true,
          ...actions,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      }]),
    }),
  );
}

function invoiceFixture(invoiceId: number) {
  return {
    id: invoiceId,
    invoice_number: "INV-BROWSER-1",
    mode: "pos",
    status: "issued",
    payment_status: "partial",
    payment_method: "Bank transfer",
    template_id: "modern",
    accent_color: "#14b8a6",
    customer_name: "Acme Operations",
    customer_email: "finance@acme.test",
    customer_address: "1 Browser Street",
    customer_contact_id: 41,
    customer_organization_id: 51,
    customer_contact_name: "Grace Buyer",
    customer_organization_name: "Acme Operations",
    issue_date: "2099-07-01",
    due_date: "2099-07-31",
    currency: "USD",
    subtotal_amount: 200,
    discount_amount: 10,
    tax_rate: 10,
    tax_amount: 19,
    total_amount: 209,
    amount_paid: 50,
    balance_due: 159,
    payment_terms: "Net 30",
    notes: "Review terms",
    user_name: "Ada Owner",
    updated_at: "2099-07-10T10:00:00Z",
    lines: [
      {
        id: 1,
        description: "Implementation",
        quantity: 2,
        unit_price: 100,
        line_total: 200,
        sort_order: 0,
      },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubDefaultSavedViews(page);
});

test("Invoice creation uses the dedicated itemized transaction workflow", async ({
  page,
}) => {
  await page.goto("/dashboard/finance/pos/new");
  await expect(
    page.getByRole("heading", { name: "Create invoice" }),
  ).toBeVisible();
  await expect(page.getByText("Customer and billing details")).toBeVisible();
  await expect(page.getByText("Line items", { exact: true })).toBeVisible();
  await expect(page.getByText("Pricing, discounts, and taxes")).toBeVisible();
  await expect(page.getByText("Delivery and payment details")).toBeVisible();
  await expect(page.getByText("Review summary")).toBeVisible();

  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText("Customer name is required.")).toBeVisible();
  await expect(page.getByText(/Each line needs a description/)).toBeVisible();
  await expect(page.getByLabel("Customer name")).toBeFocused();

  await page.getByLabel("Customer name").fill("Browser Customer");
  await page.getByLabel("name line 1").fill("Implementation");
  await page.getByLabel("quantity line 1").fill("2");
  await page.getByLabel("unit price line 1").fill("100");
  await page.getByLabel("Discount amount").fill("10");
  await page.getByLabel("Tax rate (%)").fill("10");
  await expect(page.getByText("$209.00", { exact: true })).toBeVisible();
  await page.getByLabel("name line 1").press("Enter");
  await expect(page.getByLabel("name line 2")).toBeFocused();
});

test("Invoices list routes creation to the dedicated page", async ({
  page,
}) => {
  await page.goto("/dashboard/finance/pos");
  const createLink = page.getByRole("link", { name: "Create invoice" });
  await expect(createLink).toBeVisible();
  await createLink.click();
  await expect(page).toHaveURL(/\/dashboard\/finance\/pos\/new$/);
});

test("Invoice detail and edit use routed record workflows", async ({
  page,
}) => {
  const invoiceId = 987654343;
  const invoice = invoiceFixture(invoiceId);
  await cachePosPermissions(page, { can_create: true, can_edit: true, can_delete: true });
  await page.route(`**/finance/pos-invoices/${invoiceId}`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(invoice),
    }),
  );

  await page.goto(`/dashboard/finance/pos/${invoiceId}`);
  await expect(
    page.getByRole("heading", { name: "INV-BROWSER-1" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit invoice" })).toBeVisible();
  await expect(
    page.getByText("Acme Operations", { exact: true }).first(),
  ).toBeVisible();

  await page.goto(`/dashboard/finance/pos/${invoiceId}/edit`);
  await expect(
    page.getByRole("heading", { name: "Edit INV-BROWSER-1" }),
  ).toBeVisible();
  await expect(page.getByText(/Last modified/)).toBeVisible();
  await expect(page.getByLabel("Customer name")).toHaveValue("Acme Operations");
  await expect(page.getByLabel("name line 1")).toHaveValue("Implementation");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();
});

test("Invoice actions and routed forms respect role permissions", async ({ page }) => {
  const invoiceId = 987654344;
  await cachePosPermissions(page, { can_create: false, can_edit: false, can_delete: false });
  await page.route(`**/finance/pos-invoices/${invoiceId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(invoiceFixture(invoiceId)),
    }),
  );

  await page.goto(`/dashboard/finance/pos/${invoiceId}`);
  await expect(page.getByRole("heading", { name: "INV-BROWSER-1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit invoice" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Print" })).toBeVisible();

  await page.goto("/dashboard/finance/pos/new");
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();
});

test("Printable invoice uses accessible responsive document semantics", async ({ page }) => {
  const invoiceId = 987654345;
  await cachePosPermissions(page, { can_create: true, can_edit: true, can_delete: true });
  await page.route(`**/finance/pos-invoices/${invoiceId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...invoiceFixture(invoiceId), accent_color: "not-a-color" }),
    }),
  );
  await page.route("**/users/company", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Lynk Test Company",
        primary_email: "billing@lynk.test",
        primary_phone: "+1 555 0100",
        website: "https://lynk.test",
        billing_address: "100 Main Street\nColombo",
        logo_url: null,
      }),
    }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/finance/pos/${invoiceId}/print`);

  await expect(page.getByRole("heading", { name: "Print invoice" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "INV-BROWSER-1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print invoice INV-BROWSER-1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to invoice" })).toHaveAttribute("href", `/dashboard/finance/pos/${invoiceId}`);
  await expect(page.getByText("Partially paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Line items for invoice INV-BROWSER-1" })).toContainText("Implementation");
  await expect(page.getByText("Balance due", { exact: true })).toBeVisible();
});

test("Printable invoice failures redact backend details and provide retry", async ({ page }) => {
  const invoiceId = 987654346;
  await page.route(`**/finance/pos-invoices/${invoiceId}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_password=secret" }),
    }),
  );
  await page.route("**/users/company", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "Lynk Test Company" }) }),
  );

  await page.goto(`/dashboard/finance/pos/${invoiceId}/print`);
  await expect(page.getByRole("heading", { name: "Unable to load printable invoice" })).toBeVisible();
  await expect(page.getByText("database_password=secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
