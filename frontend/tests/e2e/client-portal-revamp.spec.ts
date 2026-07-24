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
