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
  actions: { can_edit: boolean; can_delete: boolean },
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
          can_create: false,
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
