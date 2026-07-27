import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/sales/contacts/search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          contact_id: 41,
          first_name: "Ada",
          last_name: "Customer",
          primary_email: "ada@example.test",
        }],
      }),
    }),
  );
});

async function completeRequiredFields(page: import("@playwright/test").Page) {
  await page.getByLabel("Page title").fill("Renewal proposal");
  await page.getByLabel("Customer").fill("Ada");
  await page.getByRole("button", { name: /Ada Customer/ }).click();
  await page.getByLabel("Item").fill("Annual support");
  await page.getByLabel("Public unit price").fill("1200");
}

test("Client page creation is routed, responsive, and validates the first required field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/client-portal/pages/new");

  await expect(page.getByRole("heading", { name: "Create client page" })).toBeVisible();
  await expect(page.getByLabel("Search documents")).toBeDisabled();

  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page.getByText("Page title is required.")).toBeVisible();
  await expect(page.getByLabel("Page title")).toBeFocused();

  await page.getByLabel("Page title").fill("Renewal proposal");
  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page.getByText("Select one contact or account.")).toBeVisible();
});

test("Client page creation sends a customer-scoped pricing snapshot and hides backend details", async ({ page }) => {
  await page.route("**/client-portal/pages", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({
      title: "Renewal proposal",
      contact_id: 41,
      organization_id: null,
      pricing_items: [{
        name: "Annual support",
        quantity: 1,
        currency: "USD",
        public_unit_price: 1200,
      }],
    });
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "document_storage_path=/private/tenant-secret" }),
    });
  });

  await page.goto("/dashboard/client-portal/pages/new");
  await completeRequiredFields(page);
  await page.getByRole("button", { name: "Create page" }).click();

  await expect(page.getByText("We could not create this client page. Review the customer and attached documents, then try again.")).toBeVisible();
  await expect(page.getByText("document_storage_path=/private/tenant-secret")).toBeHidden();
});

test("Client Portal confirms signed-link publishing and access changes", async ({ page }) => {
  const clientPage = {
    id: 9,
    title: "Renewal proposal",
    summary: "Private pricing package",
    status: "draft",
    contact_id: 41,
    organization_id: null,
    contact_name: "Ada Customer",
    organization_name: null,
    pricing_items: [{ public_unit_price: "1200", currency: "USD" }],
    action_count: 0,
    latest_action: null,
    public_link: null,
    updated_at: "2026-07-26T08:00:00Z",
  };
  const account = {
    id: 12,
    email: "ada@example.test",
    status: "active",
    contact_id: 41,
    organization_id: null,
    contact_name: "Ada Customer",
    organization_name: null,
    setup_token_expires_at: null,
    last_login_at: null,
    updated_at: "2026-07-26T08:00:00Z",
  };
  let publishRequests = 0;
  let statusRequests = 0;

  await page.route("**/client-portal/pages", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([clientPage]) }),
  );
  await page.route("**/client-portal/accounts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([account]) }),
  );
  await page.route("**/client-portal/pages/9/publish-link", async (route) => {
    publishRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...clientPage, status: "published", public_link: "https://client.example.test/scoped-link" }),
    });
  });
  await page.route("**/client-portal/accounts/12/status", async (route) => {
    statusRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...account, status: "inactive" }),
    });
  });

  await page.goto("/dashboard/client-portal");
  await expect(page.getByLabel("Client email")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Customer type" })).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Publish client page?" })).toBeVisible();
  await expect(page.getByText(/customer-specific pricing snapshot and attached documents/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(publishRequests).toBe(0);

  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish page" }).click();
  await expect.poll(() => publishRequests).toBe(1);

  await page.getByRole("combobox", { name: "Access status for ada@example.test" }).click();
  await page.getByRole("option", { name: "Inactive" }).click();
  await expect(page.getByRole("heading", { name: "Deactivate client access?" })).toBeVisible();
  await page.getByRole("button", { name: "Deactivate access" }).click();
  await expect.poll(() => statusRequests).toBe(1);
});

test("Client Portal list failures use fixed recoverable guidance", async ({ page }) => {
  await page.route("**/client-portal/pages", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "signed_link_secret=private-value" }),
    }),
  );
  await page.route("**/client-portal/accounts", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "password_hash=private-value" }),
    }),
  );

  await page.goto("/dashboard/client-portal");

  await expect(page.getByText("Client pages could not be loaded.")).toBeVisible();
  await expect(page.getByText("Client accounts could not be loaded.")).toBeVisible();
  await expect(page.getByText(/signed_link_secret|password_hash/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(2);
});
