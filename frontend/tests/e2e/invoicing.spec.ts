import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

/** E5 invoicing and bills (docs/crm-evolution/12c-erp-invoicing.md). */

/** Calls the API from inside the signed-in page, so the session cookies and origin apply. */
async function api<T>(page: Page, path: string, method = "GET", body?: unknown): Promise<T> {
  return page.evaluate(async ({ path, method, body }) => {
    const base = (window.__LYNK_RUNTIME_CONFIG__?.apiBaseUrl ?? "").replace(/\/+$/, "");
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Lynk-Frontend-Origin": window.location.origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data)}`);
    return data;
  }, { path, method, body }) as Promise<T>;
}

type Invoice = { id: number; invoice_number: string | null; status: string; payment_status: string; balance_due: number; amount_credited: number; lines: Array<{ id: number }> };

test("an invoice is drafted, issued, part-paid and credited", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stamp = Date.now();

  await page.goto("/dashboard/finance/invoices/new");
  await expect(page.getByRole("heading", { name: "Create invoice" }).first()).toBeVisible();
  await page.getByLabel(/^Customer name/).fill(`E5 Customer ${stamp}`);
  await page.getByLabel("name line 1").fill("Consulting day");
  await page.getByLabel("quantity line 1").fill("2");
  await page.getByLabel("unit price line 1").fill("50");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/finance\/invoices\/\d+$/, { timeout: 30_000 });
  const invoiceUrl = page.url();
  const invoiceId = Number(invoiceUrl.split("/").pop());

  // A draft has no number; issuing gives it one.
  await expect(page.getByRole("heading", { name: "Draft invoice", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /^INV-/, level: 2 })).toBeVisible({ timeout: 30_000 });

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto(invoiceUrl);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("heading", { name: /^INV-/, level: 2 })).toBeVisible();
  }

  // An issued invoice refuses a line edit.
  await expect(api(page, `/finance/invoices/${invoiceId}`, "PUT", { lines: [{ description: "Changed", quantity: 1, unit_price: 1 }] }))
    .rejects.toThrow(/409/);

  await page.getByRole("button", { name: "Record payment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payment amount").fill("40");
  await dialog.getByLabel("Reference").fill(`E5-${stamp}`);
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("region", { name: "Payments on this invoice" })).toContainText("PAY-", { timeout: 30_000 });
  let invoice = await api<Invoice>(page, `/finance/invoices/${invoiceId}`);
  expect([invoice.payment_status, invoice.balance_due]).toEqual(["partial", 60]);

  // Credit one of the two days.
  await page.goto(`/dashboard/finance/credit-notes/new?invoice_id=${invoiceId}`);
  await expect(page.getByRole("heading", { name: "New credit note" })).toBeVisible();
  await page.getByLabel("Quantity to credit for Consulting day").fill("1");
  await page.getByLabel("Reason").fill("One day not delivered");
  await page.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByRole("heading", { name: /^Credit note CN-/ })).toBeVisible({ timeout: 30_000 });
  invoice = await api<Invoice>(page, `/finance/invoices/${invoiceId}`);
  expect([invoice.amount_credited, invoice.balance_due]).toEqual([50, 10]);

  // Payments list shows the payment record.
  await page.goto("/dashboard/finance/payments");
  await page.getByPlaceholder(/Search by number/).fill(`E5-${stamp}`);
  await expect(page.getByRole("region", { name: "Payments" })).toContainText(`E5 Customer ${stamp}`, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("an order is invoiced as it is delivered", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  const stamp = Date.now();
  const company = await api<{ invoicing_policy: string }>(page, "/users/company");
  expect(company.invoicing_policy).toBe("delivered");
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E5 invoiced lens ${stamp}`, currency: "USD", public_unit_price: "30", track_inventory: true, stock_quantity: "5",
  });
  const order = await api<{ id: number; items: Array<{ id: number }> }>(page, "/sales/orders", "POST", {
    order_number: `E5-SO-${stamp}`, status: "confirmed", currency: "USD",
    items: [{ catalog_product_id: product.id, name: product.name, quantity: "5", unit_price: "30" }],
  });
  const delivery = await api<{ id: number }>(page, "/inventory/deliveries", "POST", {
    order_id: order.id, lines: [{ order_line_id: order.items[0].id, quantity: "2" }],
  });
  await api(page, `/inventory/deliveries/${delivery.id}/post`, "POST");

  await page.goto(`/dashboard/sales/orders/${order.id}?tab=invoicing`);
  await expect(page.getByRole("region", { name: "Order lines to invoice" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/dashboard\/finance\/invoices\/\d+$/, { timeout: 30_000 });
  const invoiceId = Number(page.url().split("/").pop());
  const draft = await api<Invoice & { lines: Array<{ quantity: number; sales_order_item_id: number }> }>(page, `/finance/invoices/${invoiceId}`);
  expect(draft.lines.map((line) => [line.quantity, line.sales_order_item_id])).toEqual([[2, order.items[0].id]]);
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("heading", { name: /^INV-/, level: 2 })).toBeVisible({ timeout: 30_000 });

  const invoicing = await api<{ invoice_status: string; lines: Array<{ invoiced: string; to_invoice: string }> }>(page, `/sales/orders/${order.id}/invoicing`);
  expect([invoicing.invoice_status, Number(invoicing.lines[0].invoiced), Number(invoicing.lines[0].to_invoice)]).toEqual(["partial", 2, 0]);
  // An order with an issued invoice cannot be cancelled.
  await expect(api(page, `/sales/orders/${order.id}`, "PATCH", { status: "cancelled" })).rejects.toThrow(/409/);
});

test("received stock is billed and the bill is paid", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  const stamp = Date.now();
  const vendor = await api<{ org_id: number }>(page, "/sales/organizations", "POST", {
    org_name: `E5 Supplier ${stamp}`, primary_email: `bills-${stamp}@supplier.test`, is_vendor: true,
  });
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E5 billed part ${stamp}`, currency: "USD", public_unit_price: "20", cost_price: "8", track_inventory: true, stock_quantity: "0",
  });
  const order = await api<{ id: number; lines: Array<{ id: number }> }>(page, "/purchasing/orders", "POST", {
    vendor_id: vendor.org_id, lines: [{ product_id: product.id, quantity: "6", unit_cost: "8" }],
  });
  await api(page, `/purchasing/orders/${order.id}/order`, "POST");
  const receipt = await api<{ id: number }>(page, "/purchasing/receipts", "POST", { order_id: order.id, lines: [{ order_line_id: order.lines[0].id, quantity: "4" }] });
  await api(page, `/purchasing/receipts/${receipt.id}/post`, "POST");

  await page.goto(`/dashboard/purchasing/orders/${order.id}`);
  await page.getByRole("link", { name: "Create bill" }).click();
  await expect(page.getByRole("heading", { name: "New bill" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(`Quantity for ${product.name}`)).toHaveValue("4");
  await page.getByLabel(`Unit cost for ${product.name}`).fill("8.5");
  await page.getByLabel("Vendor invoice number").fill(`V-${stamp}`);
  await page.getByRole("button", { name: "Save and post" }).click();
  await expect(page.getByRole("heading", { name: /^Bill BILL-/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Price differs from purchase order").first()).toBeVisible();

  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("region", { name: "Payments on this bill" })).toContainText("PAY-", { timeout: 30_000 });
  // A second bill for the same vendor invoice is refused.
  await expect(api(page, "/purchasing/bills", "POST", { vendor_id: vendor.org_id, vendor_invoice_number: `v-${stamp}`, lines: [{ description: "X", quantity: "1", unit_cost: "1" }] }))
    .rejects.toThrow(/409/);
});
