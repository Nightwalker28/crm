import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const ioId = 7301;
const moduleCacheKey = "lynk_modules:v4";

function orderFixture() {
  return {
    id: ioId,
    io_number: "IO-2099-07301",
    customer_name: "Acme Operations",
    customer_contact_id: null,
    customer_organization_id: 51,
    counterparty_reference: "PO-4821",
    external_reference: "EXT-9",
    issue_date: "2099-07-24",
    effective_date: "2099-08-01",
    due_date: "2099-08-31",
    start_date: "2099-08-01",
    end_date: "2099-12-31",
    status: "active",
    currency: "USD",
    subtotal_amount: 1000,
    tax_amount: 100,
    total_amount: 1100,
    notes: "Renewal placement",
    custom_fields: {
      campaign_type: "Renewal",
      priority_booking: true,
    },
    file_name: "IO-2099-07301.pdf",
    file_url: "http://localhost:8000/finance/insertion-orders/files/IO-2099-07301",
    user_name: "Finance Owner",
    updated_at: "2099-07-24T09:00:00Z",
  };
}

async function cacheInsertionOrderPermissions(
  page: Parameters<typeof loginAsAdmin>[0],
  canEdit: boolean,
  overrides: Partial<{
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_restore: boolean;
    can_export: boolean;
    can_configure: boolean;
  }> = {},
) {
  await page.evaluate(
    ({ cacheKey, editAllowed, moduleOverrides }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify([{
        id: 73,
        name: "finance_io",
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: true,
          can_edit: editAllowed,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
          ...moduleOverrides,
        },
      }]));
    },
    { cacheKey: moduleCacheKey, editAllowed: canEdit, moduleOverrides: overrides },
  );

  // useAccessibleModules revalidates from the API and overwrites the seeded cache, so the
  // stub has to agree with it or the real admin permissions win.
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 73,
        name: "finance_io",
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: true,
          can_edit: canEdit,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
          ...overrides,
        },
      }]),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/custom-fields/finance_io", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/module-fields/finance_io", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/users/company", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ operating_currencies: ["USD", "LKR"] }),
    }),
  );
});

test("Insertion Order creation is routed, responsive, and focuses the required customer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/finance/insertion-orders/new");

  await expect(page.getByRole("heading", { name: "Create insertion order" })).toBeVisible();
  const customerType = page.getByRole("combobox", { name: "Customer type" });
  await expect(customerType).toBeVisible();
  await customerType.click();
  await page.getByRole("option", { name: "Account" }).click();
  await expect(page.getByRole("combobox", { name: "Customer", exact: true })).toHaveAttribute("placeholder", "Search accounts or enter a customer");
  await customerType.click();
  await page.getByRole("option", { name: "Contact" }).click();
  await expect(page.getByRole("combobox", { name: "Customer", exact: true })).toHaveAttribute("placeholder", "Search contacts or enter a customer");

  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText("Customer name is required.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Customer", exact: true })).toBeFocused();

  await page.getByRole("combobox", { name: "Customer", exact: true }).fill("New Customer");
  await page.keyboard.press("Escape");
  await page.getByText("Create a lightweight contact when this order is saved.").click();
  await expect(page.getByLabel("Customer email")).toBeVisible();
});

test("Insertion Order creation preserves commercial fields and redacts backend failures", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/finance/insertion-orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "sql_connection=private-secret" }),
    });
  });

  await page.goto("/dashboard/finance/insertion-orders/new");
  await page.getByRole("combobox", { name: "Customer", exact: true }).fill("New Customer");
  await page.keyboard.press("Escape");
  await page.getByText("Create a lightweight contact when this order is saved.").click();
  await page.getByLabel("Customer email").fill("customer@example.test");
  await page.getByLabel("Subtotal").fill("1000");
  await page.getByLabel("Tax").fill("100");
  await page.getByLabel("Total", { exact: true }).fill("1100");
  await page.getByRole("button", { name: "Create order" }).click();

  expect(submitted).toMatchObject({
    customer_name: "New Customer",
    create_customer_if_missing: true,
    customer_email: "customer@example.test",
    currency: "USD",
    subtotal_amount: 1000,
    tax_amount: 100,
    total_amount: 1100,
  });
  await expect(page.getByText("We could not create this insertion order. Review the fields and try again.")).toBeVisible();
  await expect(page.getByText("sql_connection=private-secret")).toBeHidden();
});

test("Insertion Order detail and edit use routed record workflows", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, true);
  let order = orderFixture();
  let submitted: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/finance/insertion-orders/${ioId}`, async (route) => {
    if (route.request().method() === "PUT") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      order = { ...order, ...submitted };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(order) });
  });

  await page.goto(`/dashboard/finance/insertion-orders/${ioId}`);
  await page.getByRole("link", { name: "Edit insertion order" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/finance/insertion-orders/${ioId}/edit$`));
  await expect(page.getByRole("heading", { name: "Edit IO-2099-07301" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Customer", exact: true })).toHaveValue("Acme Operations");
  await expect(page.getByLabel("Total", { exact: true })).toHaveValue("1100");

  await page.getByLabel("Total", { exact: true }).fill("1250");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/finance/insertion-orders/${ioId}$`));
  expect(submitted).toMatchObject({ customer_name: "Acme Operations", customer_organization_id: 51, total_amount: 1250 });
});

test("Insertion Order detail uses the shared mobile summary and authenticated attachment", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, true);
  await page.route(`**/api/v1/finance/insertion-orders/${ioId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(orderFixture()) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/finance/insertion-orders/${ioId}`);

  await expect(page.getByRole("heading", { name: "Insertion order details" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Finance Owner")).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme Operations" })).toHaveAttribute("href", "/dashboard/sales/organizations/51");
  await expect(page.getByRole("heading", { name: "Custom fields" })).toBeVisible();
  await expect(page.getByText("Campaign Type")).toBeVisible();
  await expect(page.getByText("Renewal", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "IO-2099-07301.pdf" })).toHaveAttribute(
    "href",
    "http://localhost:8000/finance/insertion-orders/files/IO-2099-07301",
  );
});

test("Insertion Order detail is read-only without edit permission", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, false);
  await page.route(`**/api/v1/finance/insertion-orders/${ioId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(orderFixture()) });
  });

  await page.goto(`/dashboard/finance/insertion-orders/${ioId}`);

  await expect(page.getByRole("heading", { name: "IO-2099-07301" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit insertion order" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Acme Operations" })).toBeVisible();
  await expect(page.getByText("$1,100.00")).toBeVisible();
});

test("Insertion Order detail failures do not expose backend details", async ({ page }) => {
  await page.route(`**/api/v1/finance/insertion-orders/${ioId}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "sql_connection=detail-page-secret" }),
    }),
  );

  await page.goto(`/dashboard/finance/insertion-orders/${ioId}`);

  await expect(page.getByRole("heading", { name: "Unable to load insertion order" })).toBeVisible();
  await expect(page.getByText("sql_connection=detail-page-secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Insertion Order list hides ungranted actions and keeps record identity keyboard accessible", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, false, { can_create: false, can_export: false });
  await page.route("**/finance/insertion-orders?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [orderFixture()],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 10,
      }),
    }),
  );

  await page.goto("/dashboard/finance/insertion-orders");

  await expect(page.getByRole("link", { name: "IO-2099-07301" })).toHaveAttribute(
    "href",
    `/dashboard/finance/insertion-orders/${ioId}`,
  );
  await expect(page.getByRole("link", { name: "New Order" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Select current page insertion orders" })).toHaveCount(0);
});

test("Insertion Order list distinguishes filtered empty and fixed failure states", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, false);
  let shouldFail = false;
  await page.route("**/finance/insertion-orders?**", (route) =>
    route.fulfill({
      status: shouldFail ? 500 : 200,
      contentType: "application/json",
      body: shouldFail
        ? JSON.stringify({ detail: "tenant_id=42 sql_connection=private-secret" })
        : JSON.stringify({
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

  await page.goto("/dashboard/finance/insertion-orders");
  await expect(page.getByText("No insertion orders yet")).toBeVisible();
  await page.getByRole("radio", { name: "Active" }).click();
  await expect(page.getByText("No insertion orders match this view")).toBeVisible();
  await page.getByLabel("Insertion orders").getByRole("button", { name: "Clear filters" }).click();

  shouldFail = true;
  await page.reload();
  await expect(page.getByText("Insertion orders could not be loaded")).toBeVisible();
  await expect(page.getByText("Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 sql_connection=private-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
