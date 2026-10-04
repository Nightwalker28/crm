import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

/**
 * 13-final-fixes §7 Step 3: errors users can see and act on (H2, H23, H12, H11) and the F0.9
 * polish list (H21, H22, H26, H27, I4). Runs on `e2e.sh`'s disposable database.
 */

/** Calls the API from inside the signed-in page, so the session cookies and origin apply. */
async function api<T>(page: Page, path: string, method = "GET", body?: unknown): Promise<T> {
  return page.evaluate(async ({ path, method, body }) => {
    const base = (window.__LYNK_RUNTIME_CONFIG__?.apiBaseUrl ?? "").replace(/\/+$/, "");
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Lynk-Frontend-Origin": window.location.origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data)}`);
    return data;
  }, { path, method, body }) as Promise<T>;
}

const emailValidationError = {
  detail: [
    {
      loc: ["body", "primary_email"],
      msg: "value is not a valid email address: The part after the @-sign is a special-use or reserved name.",
      type: "value_error",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("H2: a server validation error lands on its field, and a 5xx detail never shows", async ({ page }) => {
  let attempt = 0;
  await page.route("**/sales/leads", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempt += 1;
    await route.fulfill(
      attempt === 1
        ? { status: 422, contentType: "application/json", body: JSON.stringify(emailValidationError) }
        : { status: 500, contentType: "application/json", body: JSON.stringify({ detail: "database_password=private-secret" }) },
    );
  });

  // Quick create: the message sits under Email, the field is focused, the summary names it.
  await page.goto("/dashboard/sales/leads");
  await page.getByRole("button", { name: "Create lead" }).first().click();
  const quickCreate = page.getByRole("dialog", { name: "Create lead" });
  await quickCreate.getByLabel("First name").fill("Field");
  await quickCreate.getByLabel("Email").fill("field.error@example.test");
  await quickCreate.getByRole("button", { name: "Create", exact: true }).click();
  await expect(quickCreate.getByText("Enter a valid email address.")).toBeVisible();
  await expect(quickCreate.getByText("Check the highlighted field.")).toBeVisible();
  await expect(quickCreate.getByLabel("Email")).toBeFocused();
  await expect(quickCreate.getByText(/special-use or reserved/)).toHaveCount(0);

  // The full form: the same mapper, then a 5xx shows the form's own sentence only.
  attempt = 0;
  await page.goto("/dashboard/sales/leads/new");
  await page.getByLabel("Email").fill("field.error@example.test");
  await page.getByRole("button", { name: "Create lead" }).click();
  const emailField = page.locator("#lead-primary-email");
  await expect(emailField).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("The lead could not be created. Check the fields and try again.")).toBeVisible();
  await expect(page.getByText("database_password=private-secret")).toHaveCount(0);
});

test("H23: a list whose request never answers shows an error with Try again", async ({ page }) => {
  test.setTimeout(150_000);
  let hang = true;
  await page.route("**/inventory/deliveries?**", async (route) => {
    if (hang) return; // never answered: apiFetch's own deadline has to end it
    await route.continue();
  });
  await page.goto("/dashboard/inventory/deliveries");
  // Two attempts (React Query retries a read once), each ended at 20 s.
  await expect(page.getByText("Deliveries could not be loaded")).toBeVisible({ timeout: 70_000 });
  hang = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Deliveries could not be loaded")).toHaveCount(0, { timeout: 30_000 });
});

test("H11 and H12: conversion opens a deal with its value and the new records' timelines say where they came from", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/dashboard");
  const stamp = Date.now();
  const lead = await api<{ lead_id: number }>(page, "/sales/leads", "POST", {
    first_name: "Step",
    last_name: `Three ${stamp}`,
    company: `Step Three Co ${stamp}`,
    primary_email: `step.three.${stamp}@example.com`,
  });

  await page.goto(`/dashboard/sales/leads/${lead.lead_id}/convert`);
  const createDeal = page.getByRole("group", { name: "Create deal" });
  await expect(createDeal.getByRole("radio", { name: "Yes" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Amount").fill("1250");
  await page.getByLabel("Expected close date").fill("2026-12-31");
  await page.getByRole("button", { name: "Confirm conversion" }).click();

  // The result screen stays, says what was made, and links it.
  await expect(page.getByText("Lead converted", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("New deal")).toBeVisible();
  await expect(page.getByText(/already converted/)).toHaveCount(0);
  const dealHref = await page.getByRole("link", { name: "Open deal" }).first().getAttribute("href");
  const dealId = Number(dealHref?.split("/").pop());
  const deal = await api<{ total_cost_of_project: string | null; expected_close_date: string | null; currency_type: string | null }>(page, `/sales/opportunities/${dealId}`);
  expect(Number(deal.total_cost_of_project)).toBe(1250);
  expect(deal.expected_close_date).toBe("2026-12-31");
  expect(deal.currency_type).toBeTruthy();

  // H11: the deal's timeline opens with its origin.
  await page.goto(`/dashboard/sales/opportunities/${dealId}?tab=timeline`);
  await expect(page.getByText(`Created from lead Step Three ${stamp}`)).toBeVisible({ timeout: 30_000 });

  // H12: a note appears without a reload, and @mention suggestions are asked for what was typed.
  await page.getByRole("radio", { name: "Note", exact: true }).click();
  const mentionRequest = page.waitForRequest((request) => /mentionable-users\?.*query=Ad/.test(request.url()));
  await page.getByLabel("Add internal note").pressSequentially("Checking with @Ad");
  await mentionRequest;
  await page.getByLabel("Add internal note").fill(`Step three note ${stamp}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(`Step three note ${stamp}`)).toBeVisible({ timeout: 15_000 });
});

test("H22 and H27: movements name their documents, and ERP pages sit in their own sidebar groups", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/dashboard");
  const stamp = Date.now();
  const company = await api<{ base_currency: string | null; operating_currencies: string[] }>(page, "/users/company");
  const currency = company.base_currency ?? company.operating_currencies[0] ?? "USD";
  const product = await api<{ id: number }>(page, "/catalog/products", "POST", {
    name: `Step three part ${stamp}`, currency, public_unit_price: "10", cost_price: "4", track_inventory: true, stock_quantity: "0",
  });
  await api(page, `/inventory/products/${product.id}/adjust`, "POST", { change: 3, reason: "Step three" });

  await page.goto(`/dashboard/inventory/movements?product_id=${product.id}`);
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: /^ADJ-/ })).toBeVisible({ timeout: 30_000 });
  await expect(table.getByText(/Adjustment #\d+/)).toHaveCount(0);
  await expect(table.getByText("+3", { exact: true })).toBeInViewport();

  const sidebar = page.getByRole("navigation").first();
  await expect(sidebar.getByText("Inventory", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Purchasing", { exact: true })).toBeVisible();
});

test("H26: permissions name modules, and an overdue backup schedule says so", async ({ page }) => {
  await page.goto("/dashboard/settings/permissions");
  await expect(page.getByLabel("Role permissions").getByText("Contacts", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("sales_contacts", { exact: true })).toHaveCount(0);

  await page.route("**/admin/tenant-backup-settings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, enabled: true, frequency: "daily", next_run_at: "2026-01-01T02:00:00Z" } });
  });
  await page.goto("/dashboard/settings/backups");
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/The scheduled backup has not run/)).toBeVisible();
});
