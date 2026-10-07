// 13b Phase 5: clone, product and service quick create, and *Create "…"* inside pickers.
//
// Runs against the real backend: the clone draft is the server's decision, and the records an
// inline create makes are real. `scripts/e2e.sh` gives each run its own database.
import { expect, test } from "@playwright/test";

import { api } from "./helpers/api";
import { loginAsAdmin } from "./helpers/auth";

const stamp = () => Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("Clone opens a lead's create form with its details but not its email", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  const tag = stamp();
  const lead = await api<{ lead_id: number }>(page, "/sales/leads", {
    method: "POST",
    data: { first_name: "Clone", last_name: `Source ${tag}`, company: "Clone Co", primary_email: `clone-${tag}@example.com`, phone: "555 0100" },
  });

  await page.goto(`/dashboard/sales/leads/${lead.lead_id}`);
  await page.getByRole("button", { name: /^More .* actions$/ }).click();
  await page.getByRole("menuitem", { name: "Clone" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/new\\?clone=${lead.lead_id}$`));

  await expect(page.locator("#lead-last-name")).toHaveValue(`Source ${tag}`, { timeout: 30_000 });
  await expect(page.locator("#lead-company")).toHaveValue("Clone Co");
  // The email identifies the source lead, and a second lead may not share it.
  await expect(page.locator("#lead-primary-email")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Create lead" })).toBeEnabled();
});

test("A cloned quote keeps its customer and lines, with a new number", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes");
  const tag = stamp();
  const quote = await api<{ quote_id: number; quote_number: string }>(page, "/sales/quotes", {
    method: "POST",
    data: {
      customer_name: `Clone Customer ${tag}`,
      title: `Rollout ${tag}`,
      billing_city: "Lisbon",
      items: [{ name: `Clone line ${tag}`, quantity: "2", unit_price: "40" }],
    },
  });

  await page.goto(`/dashboard/sales/quotes/new?clone=${quote.quote_id}`);
  await expect(page.locator('[data-record-layout="sales_quotes:full_form"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Customer name")).toHaveValue(`Clone Customer ${tag}`);
  await expect(page.locator("#quote-billing-city")).toHaveValue("Lisbon");
  await expect(page.getByLabel("name line 1")).toHaveValue(`Clone line ${tag}`);
  await expect(page.getByLabel("quantity line 1")).toHaveValue(/^2(\.0+)?$/);
  await expect(page.getByText(quote.quote_number)).toHaveCount(0);
});

test("A clone of a record the user cannot reach shows an error, not an empty form", async ({ page }) => {
  await page.goto("/dashboard/sales/leads/new?clone=999999999");
  await expect(page.getByText("This lead could not be copied")).toBeVisible({ timeout: 30_000 });
});

test("Products have a quick create, and More details carries the entries to the full form", async ({ page }) => {
  await page.goto("/dashboard/catalog/products");
  await page.getByRole("button", { name: "Create product" }).click();
  const sheet = page.getByRole("dialog", { name: "Create product" });
  await expect(sheet).toBeVisible();
  const name = `Quick product ${stamp()}`;
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByRole("button", { name: "More details" }).click();
  await expect(page).toHaveURL(/\/dashboard\/catalog\/products\/new\?draft=quick-create/);
  await expect(page.locator("#catalog-name")).toHaveValue(name, { timeout: 30_000 });
});

test("A quote line creates a product it cannot find, and the line takes it", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes/new");
  await expect(page.locator('[data-record-layout="sales_quotes:full_form"]')).toBeVisible({ timeout: 30_000 });
  const name = `Inline product ${stamp()}`;
  await page.getByLabel("name line 1").fill(name);
  await page.getByRole("option", { name: `Create product "${name}"` }).click();

  const sheet = page.getByRole("dialog", { name: "Create product" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Name")).toHaveValue(name);
  // Opened from inside a form: nothing that would leave it.
  await expect(sheet.getByRole("button", { name: "More details" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Create & open" })).toHaveCount(0);
  await sheet.getByLabel("List price").fill("75");
  await sheet.getByRole("button", { name: "Create", exact: true }).click();

  await expect(sheet).toBeHidden();
  await expect(page.getByLabel("name line 1")).toHaveValue(name);
  await expect(page.getByLabel("unit price line 1")).toHaveValue(/^75/);
  await expect(page.getByRole("button", { name: "Unlink line 1 from the catalog" })).toBeVisible();
});

test("A purchase order's vendor picker creates a vendor", async ({ page }) => {
  await page.goto("/dashboard/purchasing/orders/new");
  await expect(page.locator('[data-record-layout="purchase_orders:full_form"]')).toBeVisible({ timeout: 30_000 });
  const name = `Inline vendor ${stamp()}`;
  await page.locator("#po-vendor").fill(name);
  await page.getByRole("option", { name: `Create vendor "${name}"` }).click();

  const sheet = page.getByRole("dialog", { name: "Create vendor" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("The new account is marked as a vendor")).toBeVisible();
  await sheet.getByRole("button", { name: "Create", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#po-vendor")).toHaveValue(name);
  await expect(page.getByRole("button", { name: "Clear linked record" })).toBeVisible();

  // The vendor search now finds it: it was saved with *Vendor* on.
  const found = await api<{ results: Array<{ label: string }> }>(page, `/purchasing/vendors/search?query=${encodeURIComponent(name)}`);
  expect(found.results.map((row) => row.label)).toContain(name);
});
