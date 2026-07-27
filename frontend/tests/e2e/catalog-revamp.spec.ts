import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const productId = 4401;
const serviceId = 4402;
const moduleCacheKey = "lynk_modules:v3";

function productFixture() {
  return {
    id: productId,
    name: "Camera kit",
    slug: "camera-kit",
    description: "Camera, lens, and transport case.",
    sku: "CAM-KIT",
    currency: "USD",
    public_unit_price: "1200.00",
    stock_status: "in_stock",
    stock_quantity: "8",
    is_public: true,
    is_active: true,
    media_url: "/uploads/catalog/camera-kit.jpg",
    media_content_type: "image/jpeg",
    media_original_filename: "camera-kit.jpg",
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
  };
}

function serviceFixture() {
  return {
    id: serviceId,
    name: "Installation service",
    slug: "installation-service",
    description: "On-site equipment installation.",
    currency: "USD",
    public_unit_price: "250.00",
    is_public: false,
    is_active: true,
    media_url: null,
    media_content_type: null,
    media_original_filename: null,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
  };
}

async function cacheCatalogPermissions(
  page: Parameters<typeof loginAsAdmin>[0],
  actions: { can_create?: boolean; can_edit: boolean; can_delete: boolean },
  moduleName = "catalog_products",
) {
  await page.evaluate(
    ({ cacheKey, moduleActions, moduleName: cachedModuleName }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify([{
        id: 44,
        name: cachedModuleName,
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: moduleActions.can_create ?? false,
          can_edit: moduleActions.can_edit,
          can_delete: moduleActions.can_delete,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      }]));
    },
    { cacheKey: moduleCacheKey, moduleActions: actions, moduleName },
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Product list uses permission-aware semantic actions and safe mutation feedback", async ({ page }) => {
  let product = productFixture();
  let updatedPayload: Record<string, unknown> | null = null;
  await cacheCatalogPermissions(page, { can_create: true, can_edit: true, can_delete: false });
  await page.route("**/catalog/products?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [product],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 10,
      }),
    }),
  );
  await page.route(`**/catalog/products/${productId}`, async (route) => {
    updatedPayload = route.request().postDataJSON() as Record<string, unknown>;
    product = { ...product, ...updatedPayload };
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "database_password=secret" }) });
  });

  await page.goto("/dashboard/catalog/products");

  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Product" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Camera kit" })).toHaveAttribute("href", `/dashboard/catalog/products/${productId}`);
  await expect(page.getByText("Public", { exact: true })).toBeVisible();

  await page.getByRole("switch", { name: "Deactivate Camera kit" }).click();
  await expect(page.getByText("We could not deactivate this product. Try again.")).toBeVisible();
  await expect(page.getByText("database_password=secret")).toHaveCount(0);
  expect(updatedPayload).toMatchObject({ name: "Camera kit", is_active: false });
});

test("Catalog lists hide ungranted actions and distinguish filtered empty states", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: false, can_delete: false }, "catalog_services");
  await page.route("**/catalog/services?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        range_start: 0,
        range_end: 0,
        total_count: 0,
        total_pages: 0,
        page: 1,
        page_size: 10,
      }),
    }),
  );

  await page.goto("/dashboard/catalog/services");

  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Service" })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("No services yet")).toBeVisible();
  await expect(page.getByText("Services will appear here when a teammate creates one.")).toBeVisible();

  await page.getByPlaceholder("Search services").fill("installation");
  await expect(page.getByText("No services match this search")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByText("No services yet")).toBeVisible();
});

test("Catalog list failures expose fixed retry guidance instead of backend detail", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: false, can_delete: false });
  await page.route("**/catalog/products?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 database_password=secret" }),
    }),
  );

  await page.goto("/dashboard/catalog/products");

  await expect(page.getByText("Catalog products could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("Product creation is responsive and validates the first required field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/catalog/products/new");

  await expect(page.getByRole("heading", { name: "Create product" })).toBeVisible();
  await expect(page.getByLabel("SKU")).toBeVisible();
  await expect(page.getByLabel("Stock status")).toBeVisible();
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByText("Name is required.")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();
});

test("Service creation uses the shared form without product inventory fields", async ({ page }) => {
  await page.goto("/dashboard/catalog/services/new");

  await expect(page.getByRole("heading", { name: "Create service" })).toBeVisible();
  await expect(page.getByLabel("SKU")).toHaveCount(0);
  await expect(page.getByLabel("Stock status")).toHaveCount(0);
  await expect(page.getByLabel("Public unit price")).toBeVisible();
});

test("Product editing hydrates the routed form and saves back to detail", async ({ page }) => {
  let product = productFixture();
  let updatedPayload: Record<string, unknown> | null = null;
  await page.route(`**/catalog/products/${productId}`, async (route) => {
    if (route.request().method() === "PUT") {
      updatedPayload = route.request().postDataJSON() as Record<string, unknown>;
      product = { ...product, ...updatedPayload, updated_at: "2099-07-24T10:00:00Z" };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(product),
    });
  });

  await page.goto(`/dashboard/catalog/products/${productId}/edit`);
  await expect(page.getByRole("heading", { name: "Edit Camera kit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByLabel("Name").fill("Production camera kit");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/catalog/products/${productId}$`));
  expect(updatedPayload).toMatchObject({
    name: "Production camera kit",
    sku: "CAM-KIT",
    currency: "USD",
    public_unit_price: 1200,
  });
});

test("Product detail uses the shared responsive summary and explains recoverable deletion", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/catalog/products/${productId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productFixture()),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.getByRole("heading", { name: "Camera kit" })).toBeVisible();
  await expect(page.getByText("Public base price")).toBeVisible();
  await expect(page.getByText("Customer-specific pricing is resolved separately for authenticated customers.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Camera kit catalog image" })).toBeVisible();
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page.getByText('Move "Camera kit" to the Recycle Bin? It can be restored by an administrator.')).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Recycle Bin" })).toBeVisible();
});

test("Product detail hides actions that are not granted", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: false, can_delete: false });
  await page.route(`**/catalog/products/${productId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productFixture()),
    });
  });

  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.getByRole("heading", { name: "Camera kit" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit product" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete product" })).toHaveCount(0);
});

test("Service detail uses the shared summary without product inventory fields", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true }, "catalog_services");
  await page.route(`**/catalog/services/${serviceId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(serviceFixture()),
    });
  });

  await page.goto(`/dashboard/catalog/services/${serviceId}`);

  await expect(page.getByRole("heading", { name: "Installation service" })).toBeVisible();
  await expect(page.getByText("Public base price")).toBeVisible();
  await expect(page.getByText("Private", { exact: true })).toBeVisible();
  await expect(page.getByText("SKU", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stock status", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stock quantity", { exact: true })).toHaveCount(0);
});

test("Shared record activity panels are responsive, labeled, and use consistent states", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/catalog/products/${productId}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(productFixture()) }),
  );
  await page.route("**/activity/record?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 51,
          module_key: "catalog_products",
          entity_type: "catalog_product",
          entity_id: String(productId),
          action: "record_updated",
          description: "Updated Camera kit",
          created_at: "2026-07-27T10:00:00Z",
        }],
      }),
    }),
  );
  await page.route("**/record-comments?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 61,
          actor_user_id: 1,
          module_key: "catalog_products",
          entity_id: String(productId),
          body: "Confirm the replenishment date.",
          author_name: "Admin User",
          created_at: "2026-07-27T10:15:00Z",
          updated_at: "2026-07-27T10:15:00Z",
        }],
      }),
    }),
  );
  await page.route("**/documents?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.route("**/tasks?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], range_start: 0, range_end: 0, total_count: 0, total_pages: 0, page: 1, page_size: 10 }),
    }),
  );
  await page.route("**/tasks/options**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [], teams: [] }) }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.getByRole("heading", { name: "Activity Timeline" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Activity Timeline entries" })).toContainText("Updated Camera kit");

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByLabel("Add internal note")).toBeVisible();
  await expect(page.getByRole("list", { name: "Record notes" })).toContainText("Confirm the replenishment date.");

  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByText("No documents are linked to this record yet.")).toBeVisible();

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(page.getByText("No linked tasks yet")).toBeVisible();
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(page.getByLabel("Due")).toBeVisible();
  await expect(page.getByLabel("Priority")).toBeVisible();
});

test("Record activity failures provide retry without backend details", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/catalog/products/${productId}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(productFixture()) }),
  );
  await page.route("**/activity/record?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_password=secret" }),
    }),
  );
  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.getByText("Record activity could not be loaded.")).toBeVisible();
  await expect(page.getByText("database_password=secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
