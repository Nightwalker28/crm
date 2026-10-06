import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * ERP E1 — products and services, first class (docs/crm-evolution/12-erp-inventory.md §4.1).
 *
 * A quote line searches the catalog as it is typed: choosing an item fills the line and links
 * it, and anything typed without choosing stays a custom line. The product record's Sales tab
 * lists the lines picked from it. Categories are managed under Settings.
 *
 * Every write is intercepted, so nothing is saved.
 */

const productId = 987650001;
const serviceId = 987650002;

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

const cameraOption = {
  kind: "product",
  id: productId,
  name: "E2E camera kit",
  description: "Body, lens and strap\nSecond line is not copied",
  sku: "E2E-CAM",
  barcode: "4006381333931",
  unit: "box",
  currency: "USD",
  unit_price: "250.0000",
  category_name: "Cameras",
};

const installOption = {
  kind: "service",
  id: serviceId,
  name: "E2E camera installation",
  description: null,
  sku: "E2E-SVC",
  barcode: null,
  unit: "hour",
  currency: "USD",
  unit_price: "120.0000",
  category_name: null,
};

async function stubCatalogSearch(page: Page, seen: URL[] = []) {
  await page.route("**/api/v1/catalog/items/search?**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const results = [cameraOption, installOption].filter((option) => option.name.toLowerCase().includes(query));
    return route.fulfill(json({ results }));
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("A quote line picks from the catalog, and a typed line stays custom", async ({ page }) => {
  const searches: URL[] = [];
  await stubCatalogSearch(page, searches);
  let submitted: { items?: Array<Record<string, unknown>> } | null = null;
  await page.route("**/sales/quotes", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON();
    return route.fulfill(json({ detail: "Stopped by the test." }, 400));
  });

  await page.goto("/dashboard/sales/quotes/new");
  await page.getByLabel("Customer name").fill("Browser Customer");

  await page.getByLabel("name line 1").fill("camera kit");
  const option = page.getByRole("option", { name: /E2E camera kit/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText("Product · E2E-CAM · $250.00 / box");
  expect(searches.at(-1)?.searchParams.get("currency")).toBe("USD");
  await option.click();

  await expect(page.getByLabel("name line 1")).toHaveValue("E2E camera kit");
  await expect(page.getByLabel("unit price line 1")).toHaveValue("250.0000");
  await expect(page.getByLabel("description line 1")).toHaveValue("Body, lens and strap");
  await expect(page.getByLabel("quantity line 1")).toBeFocused();
  await expect(page.getByRole("button", { name: "Unlink line 1 from the catalog" })).toBeVisible();

  // Enter still walks the grid, and a line typed without choosing is a custom line.
  await page.getByLabel("name line 1").press("Enter");
  await expect(page.getByLabel("name line 2")).toBeFocused();
  await page.getByLabel("name line 2").fill("Custom mounting bracket");
  await expect(page.getByRole("status").filter({ hasText: "Keep typing to add a custom line" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("unit price line 2").fill("45");
  await expect(page.getByRole("button", { name: "Unlink line 2 from the catalog" })).toHaveCount(0);

  await page.getByRole("button", { name: "Create quote" }).click();
  await expect.poll(() => submitted).not.toBeNull();
  const items = submitted!.items ?? [];
  expect(items.map((item) => [item.name, item.catalog_product_id, item.catalog_service_id])).toEqual([
    ["E2E camera kit", productId, null],
    ["Custom mounting bracket", null, null],
  ]);
});

test("Unlinking keeps the line as typed and drops the catalog link", async ({ page }) => {
  await stubCatalogSearch(page);

  await page.goto("/dashboard/sales/orders/new");
  await page.getByLabel("name line 1").fill("installation");
  await page.getByRole("option", { name: /E2E camera installation/ }).click();
  await expect(page.getByLabel("unit price line 1")).toHaveValue("120.0000");

  await page.getByRole("button", { name: "Unlink line 1 from the catalog" }).click();
  await expect(page.getByLabel("name line 1")).toHaveValue("E2E camera installation");
  await expect(page.getByLabel("unit price line 1")).toHaveValue("120.0000");
  await expect(page.getByRole("button", { name: "Unlink line 1 from the catalog" })).toHaveCount(0);
});

test("A product's Sales tab lists the quote and order lines picked from it", async ({ page }) => {
  // Scoped to the API: a bare `**/catalog/products/<id>` also matches the page URL itself.
  await page.route(`**/api/v1/catalog/products/${productId}`, (route) =>
    route.fulfill(json({
      id: productId,
      name: "E2E camera kit",
      slug: "e2e-camera-kit",
      description: null,
      sku: "E2E-CAM",
      barcode: "4006381333931",
      category_id: 7,
      category_name: "Cameras",
      cost_price: "180.0000",
      unit: "box",
      currency: "USD",
      public_unit_price: "250.0000",
      stock_status: "untracked",
      stock_quantity: null,
      is_public: false,
      is_active: true,
      media_url: null,
      created_at: "2099-07-01T10:00:00Z",
      updated_at: "2099-07-02T10:00:00Z",
    })),
  );
  await page.route(`**/api/v1/catalog/products/${productId}/sales`, (route) =>
    route.fulfill(json({
      results: [
        { document_type: "order", document_id: 987650101, document_number: "SO-E2E-1", customer_name: "Acme", status: "confirmed", currency: "USD", quantity: "3", unit_price: "250", line_total: "750", document_date: "2099-07-03T10:00:00Z" },
        { document_type: "quote", document_id: 987650201, document_number: "Q-E2E-1", customer_name: "Acme", status: "accepted", currency: "USD", quantity: "3", unit_price: "250", line_total: "750", document_date: "2099-07-02T10:00:00Z" },
      ],
      quote_line_count: 1,
      order_line_count: 1,
      ordered_quantity: "3",
      can_view_quotes: true,
      can_view_orders: true,
    })),
  );

  await page.goto(`/dashboard/catalog/products/${productId}`);
  await expect(page.getByRole("heading", { name: "E2E camera kit", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Sales" }).click();

  // `RecordTable`'s label names its region.
  const table = page.getByRole("region", { name: "Sales of this product" });
  await expect(table).toContainText("SO-E2E-1");
  await expect(table).toContainText("Q-E2E-1");
  await expect(table).toContainText("3 box");
  await expect(page.getByText("Ordered, excluding cancelled")).toBeVisible();
  await expect(page.getByRole("link", { name: "SO-E2E-1" })).toHaveAttribute("href", "/dashboard/sales/orders/987650101");
});

test("Catalog categories nest one level and are created from Settings", async ({ page }) => {
  const categories = [
    { id: 7, name: "Cameras", full_name: "Cameras", parent_id: null, description: null, sort_order: 0, product_count: 2, service_count: 0, created_at: "2099-07-01T10:00:00Z", updated_at: "2099-07-01T10:00:00Z" },
    { id: 8, name: "Mirrorless", full_name: "Cameras / Mirrorless", parent_id: 7, description: null, sort_order: 0, product_count: 1, service_count: 0, created_at: "2099-07-01T10:00:00Z", updated_at: "2099-07-01T10:00:00Z" },
  ];
  let created: Record<string, unknown> | null = null;
  await page.route("**/api/v1/catalog/categories", async (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill(json({ ...categories[0], id: 9, name: "Lenses", full_name: "Cameras / Lenses", parent_id: 7, product_count: 0 }, 201));
    }
    return route.fulfill(json({ results: categories }));
  });

  await page.goto("/dashboard/settings/catalog-categories");
  const table = page.getByRole("region", { name: "Catalog categories" });
  await expect(table).toContainText("Cameras / Mirrorless");
  await expect(table).toContainText("2 products");

  await page.getByRole("button", { name: "Create category" }).first().click();
  await page.getByLabel("Name").fill("Lenses");
  await page.getByLabel("Parent").click();
  // Only top-level categories can be parents.
  await expect(page.getByRole("option", { name: "Mirrorless" })).toHaveCount(0);
  await page.getByRole("option", { name: "Cameras" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create category" }).click();

  await expect.poll(() => created).toMatchObject({ name: "Lenses", parent_id: 7, description: null, sort_order: 0 });
});
