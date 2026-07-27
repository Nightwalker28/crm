import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const ioId = 7301;
const moduleCacheKey = "lynk_modules:v3";

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

async function cacheInsertionOrderPermissions(page: Parameters<typeof loginAsAdmin>[0], canEdit: boolean) {
  await page.evaluate(
    ({ cacheKey, editAllowed }) => {
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
        },
      }]));
    },
    { cacheKey: moduleCacheKey, editAllowed: canEdit },
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
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText("Customer name is required.")).toBeVisible();
  await expect(page.getByLabel("Customer")).toBeFocused();

  await page.getByLabel("Customer").fill("New Customer");
  await page.getByText("Create a lightweight contact when this order is saved.").click();
  await expect(page.getByLabel("Customer email")).toBeVisible();
});

test("Insertion Order creation preserves commercial fields and redacts backend failures", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/finance/insertion-orders", async (route) => {
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
  await page.getByLabel("Customer").fill("New Customer");
  await page.getByText("Create a lightweight contact when this order is saved.").click();
  await page.getByLabel("Customer email").fill("customer@example.test");
  await page.getByLabel("Subtotal").fill("1000");
  await page.getByLabel("Tax").fill("100");
  await page.getByLabel("Total").fill("1100");
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
  await page.route(`**/finance/insertion-orders/${ioId}`, async (route) => {
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
  await expect(page.getByLabel("Customer")).toHaveValue("Acme Operations");
  await expect(page.getByLabel("Total")).toHaveValue("1100");

  await page.getByLabel("Total").fill("1250");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/finance/insertion-orders/${ioId}$`));
  expect(submitted).toMatchObject({ customer_name: "Acme Operations", customer_organization_id: 51, total_amount: 1250 });
});

test("Insertion Order detail uses the shared mobile summary and authenticated attachment", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, true);
  await page.route(`**/finance/insertion-orders/${ioId}`, async (route) => {
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
  await expect(page.getByText("Renewal")).toBeVisible();
  await expect(page.getByRole("link", { name: "IO-2099-07301.pdf" })).toHaveAttribute(
    "href",
    "http://localhost:8000/finance/insertion-orders/files/IO-2099-07301",
  );
});

test("Insertion Order detail is read-only without edit permission", async ({ page }) => {
  await cacheInsertionOrderPermissions(page, false);
  await page.route(`**/finance/insertion-orders/${ioId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(orderFixture()) });
  });

  await page.goto(`/dashboard/finance/insertion-orders/${ioId}`);

  await expect(page.getByRole("heading", { name: "IO-2099-07301" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit insertion order" })).toHaveCount(0);
  await expect(page.getByText("Acme Operations")).toBeVisible();
  await expect(page.getByText("$1,100.00")).toBeVisible();
});

test("Insertion Order detail failures do not expose backend details", async ({ page }) => {
  await page.route(`**/finance/insertion-orders/${ioId}`, (route) =>
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
