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

type Order = { id: number; order_number: string };

async function stockedOrder(page: Page, units: number) {
  const stamp = Date.now();
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E3 delivery lens ${stamp}`, currency: "USD", public_unit_price: "10", track_inventory: true, stock_quantity: String(units),
  });
  const order = await api<Order>(page, "/sales/orders", "POST", {
    order_number: `E3-D-${stamp}`, status: "confirmed", currency: "USD",
    items: [{ catalog_product_id: product.id, name: product.name, quantity: String(units), unit_price: "10" }],
  });
  return { product, order };
}

test("a partial delivery posts, the rest stays to deliver, and closing the rest finishes the order", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { product, order } = await stockedOrder(page, 10);

  await page.goto(`/dashboard/sales/orders/${order.id}?tab=fulfilment`);
  await page.getByRole("link", { name: "Create delivery" }).click();
  await expect(page.getByRole("heading", { name: "New delivery" })).toBeVisible();
  const shipNow = page.getByLabel(`Ship now: ${product.name}`);
  await expect(shipNow).toHaveValue("10");
  await shipNow.fill("4");
  await page.getByLabel("Carrier").fill("DHL");
  await page.getByLabel("Tracking number").fill(`TRACK-${Date.now()}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/deliveries\/\d+$/, { timeout: 30_000 });
  const deliveryUrl = page.url();

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto(deliveryUrl);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("heading", { name: /^Delivery DEL-/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText(`The rest of ${order.order_number} stays to deliver.`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Post delivery" }).click();
  await expect(page.getByRole("button", { name: "Cancel delivery" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Delivery lines" }).getByText("4", { exact: true })).toBeVisible();

  await page.goto(`/dashboard/sales/orders/${order.id}?tab=fulfilment`);
  await expect(page.getByText("Partly delivered").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Deliveries for this order" })).toBeVisible();
  await page.getByRole("button", { name: "Close remaining" }).click();
  await page.getByLabel("Reason").fill("Customer cancelled the rest");
  await page.getByRole("dialog").getByRole("button", { name: "Close remaining" }).click();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Create delivery" })).toHaveCount(0);

  const orders = await api<{ results: Array<{ id: number; delivery_status: string }> }>(page, `/sales/orders?page=1&page_size=50&filters_all=${encodeURIComponent(JSON.stringify([{ field: "delivery_status", operator: "is", value: "closed" }]))}`);
  expect(orders.results.some((row) => row.id === order.id)).toBe(true);
  expect(errors).toEqual([]);
});

test("a return against a delivery restocks only what is marked for restock", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { product, order } = await stockedOrder(page, 3);
  const delivery = await api<{ id: number; number: string }>(page, "/inventory/deliveries", "POST", { order_id: order.id });
  await api(page, `/inventory/deliveries/${delivery.id}/post`, "POST");

  await page.goto(`/dashboard/inventory/deliveries/${delivery.id}`);
  await page.getByRole("link", { name: "Record return" }).click();
  await expect(page.getByRole("heading", { name: "New return" })).toBeVisible();
  await page.getByLabel("Reason").fill("Broken in transit");
  await page.getByLabel(`Returning: ${product.name}`).fill("2");
  await page.getByRole("switch", { name: `Restock ${product.name}` }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/returns\/\d+$/, { timeout: 30_000 });

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("heading", { name: /^Return RET-/ })).toBeVisible();
  }

  await page.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByText("nothing goes back into stock", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Receive return" }).click();
  await expect(page.getByRole("button", { name: "Cancel return" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No, damaged")).toBeVisible();

  const stock = await api<{ on_hand: string }>(page, `/inventory/products/${product.id}/stock`);
  expect(Number(stock.on_hand)).toBe(0);
  await page.goto(`/dashboard/sales/orders/${order.id}?tab=fulfilment`);
  await expect(page.getByRole("region", { name: "Order lines and stock" }).getByRole("columnheader", { name: "Returned" })).toBeVisible();
  expect(errors).toEqual([]);
});
