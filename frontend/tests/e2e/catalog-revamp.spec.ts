import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";
import { stubDefaultSavedViews } from "./helpers/savedViews";

const productId = 4401;
const serviceId = 4402;
const moduleCacheKey = "lynk_modules:v4";

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

/** The `detail` surfaces catalog records adopted in rebuild 5.3 batch 4. */
function catalogDetailLayout(moduleKey: "catalog_products" | "catalog_services") {
  const isProduct = moduleKey === "catalog_products";
  const f = (field_key: string, label: string, position: number, width = "half") => ({
    field_key, label, field_type: "text", field_source: "system", position, width,
    visible: true, required: false, readonly: true,
  });
  return {
    layout_id: null,
    module_key: moduleKey,
    surface: "detail",
    name: isProduct ? "Product Details" : "Service Details",
    source: "system",
    version: 1,
    can_customize: false,
    warnings: [],
    sections: [
      {
        id: "catalog",
        label: "Catalog",
        position: 0,
        region: "main",
        collapsed_by_default: false,
        fields: [
          ...(isProduct ? [f("sku", "SKU", 0)] : []),
          f("slug", "Public slug", 1),
          f("description", "Description", 2, "full"),
        ],
      },
      {
        id: "pricing",
        label: "Pricing",
        position: 1,
        region: "main",
        collapsed_by_default: false,
        fields: [f("public_unit_price", "Public base price", 0), f("currency", "Currency", 1)],
      },
      ...(isProduct ? [{
        id: "inventory",
        label: "Inventory",
        position: 2,
        region: "main",
        collapsed_by_default: false,
        fields: [f("stock_quantity", "Stock quantity", 0)],
      }] : []),
    ],
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

  // useAccessibleModules revalidates from the API and overwrites the seeded cache, so the
  // stub has to agree with it or the real admin permissions win.
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
      {
        id: 44,
        name: moduleName,
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: actions.can_create ?? false,
          can_edit: actions.can_edit,
          can_delete: actions.can_delete,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      },
      // The record archetype's Tasks and Files tabs resolve through their own modules —
      // a tab whose module is not granted is simply not rendered.
      ...["tasks", "documents"].map((name, index) => ({
        id: 45 + index,
        name,
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
        },
      })),
      ]),
    }),
  );

  // `Details` is `ReadOnlyRecordLayout` over the resolved layout, so a detail route cannot
  // render without one.
  await page.route(`**/record-layouts/${moduleName}/detail/resolved`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogDetailLayout(moduleName as "catalog_products" | "catalog_services")) }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubDefaultSavedViews(page);
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
  await page.route(`**/api/v1/catalog/products/${productId}`, async (route) => {
    updatedPayload = route.request().postDataJSON() as Record<string, unknown>;
    product = { ...product, ...updatedPayload };
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "database_password=secret" }) });
  });

  await page.goto("/dashboard/catalog/products");

  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create product" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Camera kit" })).toHaveAttribute("href", `/dashboard/catalog/products/${productId}`);
  await expect(page.getByText("Public", { exact: true })).toBeVisible();

  // H21: Active is a menu action with a confirmation, not a live switch in the row.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for Camera kit" }).click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Deactivate Camera kit?" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("We could not deactivate this product. Try again.")).toBeVisible();
  await expect(page.getByText("database_password=secret")).toHaveCount(0);
  // Only the field that changes is sent; the route is `exclude_unset`.
  expect(updatedPayload).toEqual({ is_active: false });
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
  await expect(page.getByRole("link", { name: "Create service" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /More actions for/ })).toHaveCount(0);
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

  await expect(page.getByText("Products could not be loaded", { exact: true })).toBeVisible();
  await expect(page.getByText("Check your connection and try again.", { exact: true })).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
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
  // ERP E1: services carry a SKU (Odoo's internal reference), but never a barcode or stock.
  await expect(page.getByLabel("SKU")).toBeVisible();
  await expect(page.getByLabel("Barcode")).toHaveCount(0);
  await expect(page.getByLabel("Stock status")).toHaveCount(0);
  await expect(page.getByLabel("Public unit price")).toBeVisible();
});

test("Product editing hydrates the routed form and saves back to detail", async ({ page }) => {
  let product = productFixture();
  let updatedPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/catalog/products/${productId}`, async (route) => {
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
  // The fixture's image must exist: since H17 a missing file renders the "Image file missing"
  // placeholder instead of a broken image.
  await page.route("**/uploads/catalog/camera-kit.jpg", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") }),
  );
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/api/v1/catalog/products/${productId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productFixture()),
    });
  });

  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Camera kit");
  // ERP E1 appends Sales: the quote and order lines picked from this item.
  await expect(page.getByRole("tab")).toHaveText(["Details", "Timeline", "Tasks", "Files", "Sales"]);

  // The three State fields are the rail's, and two of them are booleans whose values are
  // named states — a closed set the operator picks from, so they edit in place (design.md §4.7).
  const spine = page.locator('[data-slot="record-spine"]');
  await expect(spine.getByRole("combobox", { name: "Active" })).toBeVisible();
  await expect(spine.getByRole("combobox", { name: "Website feed" })).toBeVisible();
  await expect(spine.getByRole("combobox", { name: "Stock status" })).toBeVisible();
  // A catalog record has no relationship column at all, so there is no Connected block.
  await expect(spine.getByText("Connected", { exact: true })).toHaveCount(0);

  // The image is the record's customer-facing body, so it renders under the layout — the
  // same shape a line-item document's items take.
  await expect(page.getByText("Public base price")).toBeVisible();
  await expect(page.getByRole("img", { name: "Camera kit catalog image" })).toBeVisible();

  // Delete is destructive, so it is in the `[⋯]` menu rather than setting a second fill.
  await page.getByRole("button", { name: /More .* actions/ }).click();
  await page.getByRole("menuitem", { name: "Delete product" }).click();
  await expect(page.getByText('Move "Camera kit" to the recycle bin? It can be restored from Settings.')).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Product" })).toBeVisible();
});

test("Product detail hides actions that are not granted", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: false, can_delete: false });
  await page.route(`**/api/v1/catalog/products/${productId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productFixture()),
    });
  });

  await page.goto(`/dashboard/catalog/products/${productId}`);

  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Camera kit");
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  // With neither Edit nor Delete granted the overflow has nothing to hold, so it is absent.
  await expect(page.getByRole("button", { name: /More .* actions/ })).toHaveCount(0);
  // The rail falls back to a read-only status rather than offering a control that cannot save.
  const spine = page.locator('[data-slot="record-spine"]');
  await expect(spine.getByRole("combobox", { name: "Active" })).toHaveCount(0);
  await expect(spine.locator('[data-slot="status-value"]', { hasText: "Active" }).first()).toBeVisible();
});

test("Service detail uses the shared summary without product inventory fields", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true }, "catalog_services");
  await page.route(`**/api/v1/catalog/services/${serviceId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(serviceFixture()),
    });
  });

  await page.goto(`/dashboard/catalog/services/${serviceId}`);

  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Installation service");
  await expect(page.getByText("Public base price")).toBeVisible();
  const spine = page.locator('[data-slot="record-spine"]');
  await expect(spine.getByText("Private", { exact: true })).toBeVisible();
  // A service has no inventory, so the rail carries two State fields rather than three and
  // the layout carries no SKU.
  await expect(spine.getByRole("combobox", { name: "Stock status" })).toHaveCount(0);
  await expect(page.getByText("SKU", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stock quantity", { exact: true })).toHaveCount(0);
  // A service with no image says so rather than drawing an empty frame with no explanation.
  await expect(page.getByText("No image uploaded")).toBeVisible();
});

test("The record archetype's Timeline, Tasks and Files tabs replace the nested activity section", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/api/v1/catalog/products/${productId}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(productFixture()) }),
  );
  // The audit store the `History` sheet reads. It is deliberately separate from the
  // interaction feed below and is not a tab (design.md §4.7).
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
  // The interaction feed. A note is `type="note"` here, which is why there is no Notes tab.
  await page.route("**/records/catalog_products/**/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: "note:61",
          type: "note",
          occurred_at: "2026-07-27T10:15:00Z",
          title: "Note added",
          summary: "Confirm the replenishment date.",
          direction: null,
          status: null,
          actor: { user_id: 1, name: "Admin User" },
          source: { module_key: "catalog_products", record_id: "61" },
          record: { module_key: "catalog_products", entity_id: String(productId) },
          capabilities: [],
          meta: {},
        }],
        next_cursor: null,
        has_more: false,
        limit: 25,
        available_types: ["note"],
        omitted_types: [],
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

  await page.goto(`/dashboard/catalog/products/${productId}`);

  // One strip, four tabs, nothing nested — `CrmRecordActivitySection` supplied a second
  // strip inside the page's own, and it is gone with its last three consumers.
  // ERP E1 appends Sales: the quote and order lines picked from this item.
  await expect(page.getByRole("tab")).toHaveText(["Details", "Timeline", "Tasks", "Files", "Sales"]);
  await expect(page.getByRole("tab", { name: "Notes" })).toHaveCount(0);

  // The composer sits above the feed it writes to, and a note is one of the feed's entries
  // rather than a list of its own.
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/catalog/products/${productId}\\?tab=timeline$`));
  await expect(page.getByLabel("Add internal note")).toBeVisible();
  await expect(page.getByText("Confirm the replenishment date.")).toBeVisible();

  await page.getByRole("tab", { name: "Files" }).click();
  // The copy moved in 5.3 batch 7 — `RecordDocumentsPanel`'s empty text is deliberately
  // short, because `RecordTable` used to lay its empty state out across the table's scroll
  // width. 5.5 batch 1 fixed that, but the string is still the one the panel renders.
  await expect(page.getByText("Files uploaded here stay linked to this record.")).toBeVisible();

  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(page.getByText("No linked tasks yet")).toBeVisible();
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByLabel("Task title")).toBeVisible();
  await expect(page.getByLabel("Due")).toBeVisible();
  await expect(page.getByLabel("Priority")).toBeVisible();

  // Audit history hangs off the rail's `Updated` line, not a fifth tab.
  await page.locator('[data-slot="record-spine-meta"]').getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "History" })).toContainText("Updated Camera kit");
});

test("History sheet failures provide retry without backend details", async ({ page }) => {
  await cacheCatalogPermissions(page, { can_edit: true, can_delete: true });
  await page.route(`**/api/v1/catalog/products/${productId}`, (route) =>
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
  await page.locator('[data-slot="record-spine-meta"]').getByRole("button", { name: "History" }).click();

  const sheet = page.getByRole("dialog", { name: "History" });
  await expect(sheet.getByText("Record history could not be loaded.")).toBeVisible();
  await expect(page.getByText("database_password=secret")).toBeHidden();
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
});
