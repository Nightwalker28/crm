import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const productId = 4401;

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
    media_url: null,
    media_content_type: null,
    media_original_filename: null,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
  };
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
