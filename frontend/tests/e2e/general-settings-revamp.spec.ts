import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const company = {
  id: 12,
  name: "Lynk Holdings",
  primary_email: "hello@lynk.test",
  website: "https://lynk.test",
  primary_phone: "+94 11 555 0100",
  industry: "Software",
  country: "Sri Lanka",
  operating_currencies: ["USD", "LKR"],
  billing_address: "Colombo",
  logo_url: null,
};

async function mockCompany(page: Page) {
  await page.route("**/users/company", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...company, ...payload }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(company) });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("saves responsive company settings with normalized currencies", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCompany(page);
  await page.goto("/dashboard/settings/general");

  await expect(page.getByRole("heading", { name: "General settings" })).toBeVisible();
  const workspace = page.locator('[aria-label="Company settings workspace"]');
  await expect(workspace.getByRole("heading", { name: "Company profile" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Commercial defaults" })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Branding" })).toBeVisible();
  await expect(page.getByLabel("Company name")).toHaveValue("Lynk Holdings");

  await page.getByLabel("Company name").fill("Lynk International");
  await page.getByLabel("Operating currencies").fill("usd, lkr, usd");
  await expect(page.getByText("You have unsaved company changes.")).toBeVisible();

  const saveRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/users/company"),
  );
  await workspace.getByRole("button", { name: "Save company" }).click();
  const request = await saveRequest;

  expect(request.postDataJSON()).toMatchObject({
    name: "Lynk International",
    operating_currencies: ["USD", "LKR"],
  });
  await expect(page.getByText("All company settings are saved.")).toBeVisible();
});

test("uploads a bounded logo without marking persisted branding as unsaved", async ({ page }) => {
  await mockCompany(page);
  await page.route("**/users/company/logo", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ logo_url: "/media/company-assets/company-12/logo.png", company }),
    }),
  );
  await page.goto("/dashboard/settings/general");

  await page.getByLabel("Upload logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from("\u0089PNG\r\n\u001a\nlogo"),
  });

  await expect(page.getByAltText("Company logo preview")).toBeVisible();
  await expect(page.getByText("All company settings are saved.")).toBeVisible();
});

test("redacts backend details and provides a retryable load state", async ({ page }) => {
  await page.route("**/users/company", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "company_profiles tenant_id=12 failed on private-db" }),
    }),
  );
  await page.goto("/dashboard/settings/general");

  await expect(page.getByRole("heading", { name: "Company profile could not be loaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/tenant_id=12|private-db/)).toHaveCount(0);
});
