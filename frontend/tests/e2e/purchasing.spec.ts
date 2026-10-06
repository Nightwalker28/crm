import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

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

test("a purchase order is placed, partly received and its stock arrives at cost", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stamp = Date.now();

  const vendor = await api<{ org_id: number; org_name: string }>(page, "/sales/organizations", "POST", {
    org_name: `E4 Lens Supply ${stamp}`, primary_email: `orders-${stamp}@lens.test`, is_vendor: true,
  });
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E4 purchase lens ${stamp}`, currency: "USD", public_unit_price: "40", cost_price: "12.5",
    track_inventory: true, stock_quantity: "0", reorder_point: "4", reorder_quantity: "10", preferred_vendor_id: vendor.org_id,
  });

  // The product shows on the Reorder screen under its vendor.
  await page.goto("/dashboard/purchasing/reorder");
  await expect(page.getByRole("heading", { name: "Reorder", exact: true })).toBeVisible();
  // One row per warehouse; with several, each box names its warehouse. The product's stock is in the default, Main.
  await expect(page.getByLabel(new RegExp(`^Quantity to order: ${product.name}( in Main)?$`))).toHaveValue("10");

  await page.goto("/dashboard/purchasing/orders/new");
  await expect(page.getByRole("heading", { name: "New purchase order" })).toBeVisible();
  await page.getByLabel("Vendor", { exact: true }).fill(vendor.org_name);
  await page.getByRole("option", { name: new RegExp(vendor.org_name) }).click();
  await page.getByPlaceholder("Search tracked products").fill(product.name);
  await page.getByRole("option", { name: new RegExp(product.name) }).click();
  await expect(page.getByLabel(`Unit cost for ${product.name}`)).toHaveValue("12.5");
  await page.getByLabel(`Quantity for ${product.name}`).fill("10");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/purchasing\/orders\/\d+$/, { timeout: 30_000 });
  const orderUrl = page.url();

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto(orderUrl);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("heading", { name: /^Purchase order PO-/ })).toBeVisible();
  }

  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Place order" }).click();
  await page.getByRole("link", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: "New receipt" })).toBeVisible();
  const receivedNow = page.getByLabel(`Received now: ${product.name}`);
  await expect(receivedNow).toHaveValue("10");
  await receivedNow.fill("4");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/purchasing\/receipts\/\d+$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expect(page.getByRole("button", { name: "Cancel receipt" })).toBeVisible({ timeout: 30_000 });

  await page.goto(orderUrl);
  await expect(page.getByText("Partly received").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Receipts for this purchase order" })).toBeVisible();

  const stock = await api<{ on_hand: string; incoming: string; projected: string }>(page, `/inventory/products/${product.id}/stock`);
  expect([Number(stock.on_hand), Number(stock.incoming), Number(stock.projected)]).toEqual([4, 6, 10]);
  const moves = await api<{ results: Array<{ move_type: string; source_type: string }> }>(page, `/inventory/movements?product_id=${product.id}`);
  expect(moves.results.some((move) => move.move_type === "receipt" && move.source_type === "purchase_receipt")).toBe(true);

  await page.goto(`${orderUrl}/print`);
  await expect(page.getByRole("heading", { name: /^PO-/ })).toBeVisible();
  await expect(page.getByText(vendor.org_name)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a delivery note prints the ship-to address and quantities", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  await loginAsAdmin(page);
  const stamp = Date.now();
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E3 note item ${stamp}`, currency: "USD", public_unit_price: "10", track_inventory: true, stock_quantity: "3",
  });
  const order = await api<{ id: number }>(page, "/sales/orders", "POST", {
    order_number: `E3-N-${stamp}`, status: "confirmed", currency: "USD", delivery_address: "12 Harbour Road\nColombo 03",
    items: [{ catalog_product_id: product.id, name: product.name, quantity: "3", unit_price: "10" }],
  });
  const delivery = await api<{ id: number; number: string }>(page, "/inventory/deliveries", "POST", { order_id: order.id, carrier: "DHL" });
  await page.goto(`/dashboard/inventory/deliveries/${delivery.id}`);
  await page.getByRole("link", { name: "Delivery note" }).click();
  await expect(page.getByRole("heading", { name: delivery.number })).toBeVisible();
  await expect(page.getByText("12 Harbour Road")).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
});
