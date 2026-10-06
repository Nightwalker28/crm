import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

/**
 * 13-final-fixes §7 Step 4, the visible part of the code foundations: one line editor for
 * every document (E8) laid out so Item is widest and Total and remove stay in view (H15), and
 * inputs that never go from uncontrolled to controlled (H10). Nested links (H9) are checked on
 * every route by `design-rules.spec.ts`. Runs on `e2e.sh`'s disposable database.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);
});

/** The grid fits its region: nothing scrolls sideways, and the last column is in view. */
async function expectGridFits(page: Page, grid: Locator, itemInput: Locator, numberInputs: Locator) {
  const region = grid.locator("xpath=ancestor-or-self::*[@role='region'][1]");
  const overflow = await region.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, "the line grid scrolls sideways at 1280px").toBeLessThanOrEqual(1);

  const itemWidth = (await itemInput.boundingBox())?.width ?? 0;
  const widths = await numberInputs.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const width of widths) expect(itemWidth, "Item is the widest column").toBeGreaterThan(width);

  const regionBox = await region.boundingBox();
  const remove = grid.getByRole("button", { name: /^Remove / }).first();
  const removeBox = await remove.boundingBox();
  expect(regionBox && removeBox, "the remove button is drawn").toBeTruthy();
  expect(removeBox!.x + removeBox!.width, "remove sits inside the grid's visible width").toBeLessThanOrEqual(regionBox!.x + regionBox!.width + 1);
}

test("H15: a quote's line grid fits a 1280px form, item widest, total and remove in view", async ({ page }) => {
  await page.goto("/dashboard/sales/quotes/new");
  const grid = page.getByRole("region", { name: "Line items" });
  await expect(grid).toBeVisible();
  await expectGridFits(page, grid, page.getByLabel("name line 1"), grid.locator('input[type="number"]'));
  await expect(grid.getByRole("columnheader", { name: "Total" })).toBeInViewport();
});

test("E8: the purchase order grid is the shared editor — Enter walks down a column and adds a line", async ({ page }) => {
  await page.goto("/dashboard/purchasing/orders/new");
  const grid = page.getByRole("region", { name: "Purchase order lines" });
  await expect(grid).toBeVisible();
  await expectGridFits(page, grid, page.getByLabel("Product, line 1"), grid.locator('input[type="number"]'));

  const firstQuantity = grid.locator('[data-line-row="0"][data-line-field="quantity"]');
  await firstQuantity.fill("3");
  await firstQuantity.press("Enter");
  // The last line's Enter adds a line and lands on the same field in it.
  await expect(grid.locator('[data-line-row="1"][data-line-field="quantity"]')).toBeFocused();
  await expect(page.getByLabel(/^Product, line \d$/)).toHaveCount(2);
  await grid.getByRole("button", { name: /^Remove / }).last().click();
  await expect(page.getByLabel(/^Product, line \d$/)).toHaveCount(1);
  // The last line cannot be removed.
  await expect(grid.getByRole("button", { name: /^Remove / })).toBeDisabled();
});

test("E8: a standalone bill and an adjustment use the same grid", async ({ page }) => {
  await page.goto("/dashboard/purchasing/bills/new");
  const bill = page.getByRole("region", { name: "Bill lines" });
  await expect(bill).toBeVisible();
  await bill.getByLabel("Description, line 1").fill("Freight");
  await bill.getByLabel("Description, line 1").press("Enter");
  await expect(bill.getByLabel("Description, line 2")).toBeFocused();

  await page.goto("/dashboard/inventory/adjustments/new");
  const adjustment = page.getByRole("region", { name: "Document products" });
  await expect(adjustment).toBeVisible();
  await adjustment.getByLabel("Change, line 1").fill("2");
  await adjustment.getByLabel("Change, line 1").press("Enter");
  await expect(adjustment.getByLabel("Change, line 2")).toBeFocused();
  await expect(page.getByRole("button", { name: "Add product" })).toBeVisible();
});

test("H10: editing a deal with empty optional fields raises no controlled/uncontrolled warning", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/uncontrolled|controlled input|`value` prop on `(input|textarea)` should not be null/i.test(message.text())) warnings.push(message.text());
  });
  // The deals page opens on the board, so find a deal through the API.
  await page.goto("/dashboard");
  const dealId = await page.evaluate(async () => {
    const base = (window.__LYNK_RUNTIME_CONFIG__?.apiBaseUrl ?? "").replace(/\/+$/, "");
    const response = await fetch(`${base}/sales/opportunities?page=1&page_size=1`, {
      credentials: "include",
      headers: { Accept: "application/json", "X-Lynk-Frontend-Origin": window.location.origin },
    });
    const body = await response.json();
    return body.results?.[0]?.opportunity_id as number | undefined;
  });
  expect(dealId, "the e2e tenant has a deal").toBeTruthy();
  await page.goto(`/dashboard/sales/opportunities/${dealId}/edit`);
  await expect(page.getByRole("button", { name: /^Save/ }).first()).toBeVisible();
  // Type into a field, which is when an uncontrolled input turns controlled.
  const name = page.getByLabel("Deal name");
  await name.fill(`${await name.inputValue()} `);
  expect(warnings).toEqual([]);
});
