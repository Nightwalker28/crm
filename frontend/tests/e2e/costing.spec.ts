import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

/** E6 costing and valuation (docs/crm-evolution/12d-erp-costing.md). */

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

test("stock is valued at average cost, revalued, and an order shows its margin", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stamp = Date.now();
  await page.goto("/dashboard");
  const company = await api<{ base_currency: string | null; operating_currencies: string[] }>(page, "/users/company");
  const currency = company.base_currency ?? company.operating_currencies[0] ?? "USD";

  // Ten units at a cost of 5: worth 50.
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E6 costed lens ${stamp}`, currency, public_unit_price: "20", cost_price: "5", track_inventory: true, stock_quantity: "0",
  });
  await api(page, `/inventory/products/${product.id}/adjust`, "POST", { change: 10, reason: "E6 opening" });
  const stock = await api<{ valuation: { average_cost: string; stock_value: string } }>(page, `/inventory/products/${product.id}/stock`);
  expect(Number(stock.valuation.average_cost)).toBe(5);
  expect(Number(stock.valuation.stock_value)).toBe(50);

  // The product's cost is now its average: the form shows it read-only, and the API refuses a new one.
  await expect(api(page, `/catalog/products/${product.id}`, "PUT", { cost_price: "9" })).rejects.toThrow(/409/);

  // Revalue to 7 from the Stock tab: the dialog shows the change before it is made.
  await page.goto(`/dashboard/catalog/products/${product.id}?tab=stock`);
  await expect(page.getByText("Average cost", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Revalue", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/New average cost/).fill("7");
  await expect(dialog.getByText(/Stock value changes by/)).toBeVisible();
  await dialog.getByLabel("Reason").fill("Supplier price list");
  await dialog.getByRole("button", { name: "Revalue", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const revalued = await api<{ valuation: { average_cost: string; stock_value: string } }>(page, `/inventory/products/${product.id}/stock`);
  expect(Number(revalued.valuation.stock_value)).toBe(70);

  // Inventory → Valuation lists it at its value, in both themes, and the revaluation is in the history.
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto("/dashboard/inventory/valuation");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(page.getByRole("heading", { name: "Valuation", level: 1 })).toBeVisible();
  }
  await page.getByPlaceholder("Search product or SKU").fill(product.name);
  const row = page.getByRole("row", { name: new RegExp(product.name) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("70");
  await page.getByRole("radio", { name: "Revaluations" }).click();
  await expect(page.getByRole("row", { name: new RegExp(product.name) }).first()).toContainText("Supplier price list");

  // A sales order for 4 at 20 shows revenue 80 and cost 28 (estimated at the average until delivered).
  const order = await api<{ id: number }>(page, "/sales/orders", "POST", {
    order_number: `E6-M-${stamp}`, status: "confirmed", currency, items: [{ catalog_product_id: product.id, name: product.name, quantity: "4", unit_price: "20" }],
  });
  const margin = await api<{ revenue: string; cost: string; margin: string; estimated: boolean }>(page, `/sales/orders/${order.id}/margin`);
  expect([Number(margin.revenue), Number(margin.cost), Number(margin.margin), margin.estimated]).toEqual([80, 28, 52, true]);
  await page.goto(`/dashboard/sales/orders/${order.id}?tab=margin`);
  await expect(page.getByRole("heading", { name: "Margin" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Margin by line" })).toContainText(product.name);

  expect(errors).toEqual([]);
});
