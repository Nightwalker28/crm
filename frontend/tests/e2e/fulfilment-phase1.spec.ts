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

type Order = { id: number; order_number: string; items: Array<{ id: number }> };

test("confirmed orders hold stock oldest first and holds move to a more urgent order", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await loginAsAdmin(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const stamp = Date.now();
  const product = await api<{ id: number; name: string }>(page, "/catalog/products", "POST", {
    name: `E3 reservation camera ${stamp}`, currency: "USD", public_unit_price: "10", track_inventory: true, stock_quantity: "5",
  });
  let sequence = 0;
  const order = (quantity: number) => api<Order>(page, "/sales/orders", "POST", {
    order_number: `E3-R-${stamp}-${++sequence}`, status: "confirmed", currency: "USD",
    items: [{ catalog_product_id: product.id, name: product.name, quantity: String(quantity), unit_price: "10" }],
  });
  const older = await order(5);
  const newer = await order(3);

  try {
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.goto(`/dashboard/sales/orders/${newer.id}?tab=fulfilment`);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(page.getByRole("tab", { name: "Fulfilment" })).toHaveAttribute("aria-selected", "true");
      const lines = page.getByRole("region", { name: "Order lines and stock" });
      await expect(lines.getByText("Waiting")).toBeVisible();
      await expect(page.getByRole("button", { name: "Check availability" })).toBeVisible();

      await page.getByRole("button", { name: `More actions for ${product.name}` }).click();
      await page.getByRole("menuitem", { name: "Reallocate stock…" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: `Reservations · ${product.name}` })).toBeVisible();
      await expect(dialog.getByLabel(`Reserved for ${older.order_number}`)).toHaveValue("5");
      await expect(dialog.getByLabel(`Reserved for ${newer.order_number}`)).toHaveValue("0");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    }

    // Give the newer, more urgent order three of the five units.
    await page.getByRole("button", { name: `More actions for ${product.name}` }).click();
    await page.getByRole("menuitem", { name: "Reallocate stock…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(`Reserved for ${older.order_number}`).fill("2");
    await dialog.getByLabel(`Reserved for ${newer.order_number}`).fill("3");
    await expect(dialog.getByText(`${older.order_number} loses 3, ${newer.order_number} gains 3`)).toBeVisible();
    await dialog.getByRole("button", { name: "Save reservations" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Order lines and stock" }).locator("tbody").getByText("Reserved", { exact: true })).toBeVisible();

    await page.goto(`/dashboard/sales/orders/${older.id}?tab=fulfilment`);
    await expect(page.getByRole("region", { name: "Order lines and stock" }).getByText("Partly reserved")).toBeVisible();

    // A third order finds nothing free and cannot be fulfilled from held stock.
    const third = await order(1);
    await page.goto(`/dashboard/sales/orders/${third.id}?tab=fulfilment`);
    await expect(page.getByRole("region", { name: "Order lines and stock" }).getByText("Waiting")).toBeVisible();

    await page.goto(`/dashboard/catalog/products/${product.id}?tab=stock`);
    await expect(page.getByText("Reserved", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Reservations" }).click();
    const productDialog = page.getByRole("dialog");
    await expect(productDialog.getByText("Manual")).toHaveCount(2);
    await expect(productDialog.getByLabel(`Reserved for ${third.order_number}`)).toHaveValue("0");
    await productDialog.getByRole("button", { name: "Cancel" }).click();

    await api(page, `/sales/orders/${third.id}`, "PATCH", { status: "cancelled" });
  } finally {
    for (const id of [older.id, newer.id]) {
      await api(page, `/sales/orders/${id}`, "PATCH", { status: "cancelled" }).catch(() => undefined);
    }
  }
  expect(errors).toEqual([]);
});
