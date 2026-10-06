import { expect, test, type Page } from "@playwright/test";
import { api, apiResponse } from "./helpers/api";
import { loginAsAdmin } from "./helpers/auth";

/**
 * 13b Phase 3: the deal as the major players model it (13a H13). One Amount in the base
 * currency, an account or a contact, quotes and orders made from the deal, and a lost stage
 * that asks why. Runs on `e2e.sh`'s disposable database.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);
});

async function seedDeal(page: Page) {
  const stamp = Date.now();
  const account = await api<{ org_id: number; org_name: string }>(page, "/sales/organizations", {
    method: "POST",
    data: {
      org_name: `Deal account ${stamp}`,
      primary_email: `deal-${stamp}@example.com`,
      billing_address: "1 Main Street",
      billing_city: "Colombo",
      billing_country: "LK",
    },
  });
  const deal = await api<{ opportunity_id: number; opportunity_name: string; currency_type: string }>(page, "/sales/opportunities", {
    method: "POST",
    data: { opportunity_name: `Rollout ${stamp}`, organization_id: account.org_id, amount: "12500" },
  });
  return { account, deal };
}

test("a deal needs an account or a contact, and its amount reads in its currency", async ({ page }) => {
  await page.goto("/dashboard/sales/opportunities/new");
  await page.getByLabel("Deal name").fill(`Floating ${Date.now()}`);
  await page.getByRole("button", { name: /^Create deal$/ }).click();
  await expect(page.getByText("Choose an account or a contact.").first()).toBeVisible();

  const { deal } = await seedDeal(page);
  expect(deal.currency_type, "a deal starts in the base currency").toBeTruthy();
  await page.goto(`/dashboard/sales/opportunities/${deal.opportunity_id}`);
  await expect(page.getByRole("heading", { name: deal.opportunity_name, level: 1 })).toBeVisible();
  await expect(page.getByText(/12,500/).first()).toBeVisible();
});

test("Create quote on a deal opens a quote for its customer, linked to it, with the account's address", async ({ page }) => {
  const { account, deal } = await seedDeal(page);
  await page.goto(`/dashboard/sales/opportunities/${deal.opportunity_id}`);
  await page.getByRole("link", { name: "Create quote" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/quotes/new\\?opportunity_id=${deal.opportunity_id}$`));
  await expect(page.getByLabel("Customer name")).toHaveValue(account.org_name);
  await expect(page.locator("#quote-deal")).toHaveValue(deal.opportunity_name);

  await page.getByLabel("name line 1").fill("Implementation");
  await page.getByLabel("unit price line 1").fill("100");
  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/quotes\/\d+/);
  const quoteId = Number(page.url().split("/").pop()?.split("?")[0]);
  const quote = await api<{ opportunity_id: number; billing_city: string | null; shipping_city: string | null }>(page, `/sales/quotes/${quoteId}`);
  expect(quote.opportunity_id).toBe(deal.opportunity_id);
  expect(quote.billing_city, "a blank address takes the account's").toBe("Colombo");
  expect(quote.shipping_city, "no shipping address on the account: ship where it bills").toBe("Colombo");
});

test("moving a deal into a lost stage asks why; cancelling leaves it where it was", async ({ page }) => {
  const { deal } = await seedDeal(page);
  await page.goto(`/dashboard/sales/opportunities/${deal.opportunity_id}`);
  const stage = page.getByRole("combobox", { name: "Stage" });

  await stage.click();
  await page.getByRole("option", { name: "Closed lost" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark deal lost" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await api<{ sales_stage: string }>(page, `/sales/opportunities/${deal.opportunity_id}`)).sales_stage).not.toBe("closed_lost");

  await stage.click();
  await page.getByRole("option", { name: "Closed lost" }).click();
  await expect(dialog.getByRole("button", { name: "Mark lost" })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Lost reason" }).click();
  await page.getByRole("option", { name: "Price" }).click();
  await dialog.getByRole("button", { name: "Mark lost" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await api<{ lost_reason: string | null }>(page, `/sales/opportunities/${deal.opportunity_id}`)).lost_reason).toBe("price");
});

test("the API refuses a move into a lost stage without a reason", async ({ page }) => {
  const { deal } = await seedDeal(page);
  const { status, body } = await apiResponse(page, `/sales/opportunities/${deal.opportunity_id}/stage`, { method: "PATCH", data: { sales_stage: "closed_lost" } });
  expect(status).toBe(422);
  expect((body as { detail: { loc: string[] }[] }).detail[0].loc).toEqual(["body", "lost_reason"]);
});
