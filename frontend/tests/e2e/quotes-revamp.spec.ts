import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Quote creation uses an itemized full-page workflow", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes/new");
  await expect(
    page.getByRole("heading", { name: "Create quote" }),
  ).toBeVisible();
  await expect(page.getByText("Customer and billing details")).toBeVisible();
  await expect(page.getByText("Line items", { exact: true })).toBeVisible();
  await expect(page.getByText("Review summary")).toBeVisible();

  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page.getByText("Customer name is required.")).toBeVisible();
  await expect(page.getByText(/Each line needs a name/)).toBeVisible();
  await expect(page.getByLabel("Customer name")).toBeFocused();

  await page.getByLabel("Customer name").fill("Browser Customer");
  await page.getByLabel("name line 1").fill("Implementation");
  await page.getByLabel("quantity line 1").fill("2");
  await page.getByLabel("unit price line 1").fill("100");
  await page.getByLabel("discount amount line 1").fill("10");
  await page.getByLabel("tax amount line 1").fill("19");
  await expect(page.getByText("$209.00", { exact: true })).toHaveCount(2);

  await page.getByLabel("name line 1").press("Enter");
  await expect(page.getByLabel("name line 2")).toBeFocused();
});

test("Quotes list routes creation to the dedicated page", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes");
  const createLink = page.getByRole("link", { name: "Create quote" });
  await expect(createLink).toBeVisible();
  await createLink.click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/quotes\/new$/);
});

test("Quote editing hydrates the routed itemized workflow", async ({
  page,
}) => {
  const quoteId = 987654341;
  await page.route(`**/sales/quotes/${quoteId}/summary`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quote: {
          quote_id: quoteId,
          quote_number: "Q-BROWSER-1",
          title: "Browser proposal",
          customer_name: "Browser Customer",
          contact_id: null,
          organization_id: null,
          opportunity_id: null,
          assigned_to: null,
          status: "draft",
          issue_date: "2099-07-01",
          expiry_date: "2099-07-31",
          currency: "USD",
          notes: "Review terms",
          updated_at: "2099-07-10T10:00:00Z",
          custom_fields: {},
          items: [
            {
              name: "Implementation",
              description: "Configured delivery",
              quantity: "2",
              unit_price: "100",
              discount_amount: "10",
              tax_amount: "19",
            },
          ],
        },
        contact: null,
        organization: null,
        opportunity: null,
      }),
    }),
  );

  await page.goto(`/dashboard/sales/quotes/${quoteId}/edit`);
  await expect(
    page.getByRole("heading", { name: "Edit Q-BROWSER-1" }),
  ).toBeVisible();
  await expect(page.getByText(/Last modified/)).toBeVisible();
  await expect(page.getByLabel("Customer name")).toHaveValue(
    "Browser Customer",
  );
  await expect(page.getByLabel("name line 1")).toHaveValue("Implementation");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();

  await page.getByLabel("Customer name").fill("Unsaved Browser Customer");
  page.once("dialog", async (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/sales/quotes/${quoteId}/edit$`),
  );
  await expect(page.getByLabel("Customer name")).toHaveValue(
    "Unsaved Browser Customer",
  );
});
