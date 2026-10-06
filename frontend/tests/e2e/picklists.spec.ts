import { expect, test, type Page } from "@playwright/test";
import { api as apiCall, apiResponse } from "./helpers/api";
import { loginAsAdmin } from "./helpers/auth";

/**
 * 13b Phase 1: tenant-managed picklists. An admin adds and renames values in Settings →
 * Picklists; forms offer the list, records keep the key, lists and filters show the label.
 * Runs on `e2e.sh`'s disposable database.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the specs read loose JSON.
const api = (page: Page, path: string, init: { method?: string; data?: unknown } = {}) => apiCall<any>(page, path, init);

test("Settings → Picklists lists the system lists and opens one", async ({ page }) => {
  await page.goto("/dashboard/settings/picklists");
  await expect(page.getByRole("heading", { name: "Picklists", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Lead status", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/picklists\/lead_status$/);
  await expect(page.getByTestId("picklist-value-new")).toBeVisible();
  await expect(page.getByRole("form", { name: "Add a value" }).getByLabel("Meaning")).toBeVisible();
});

test("a value added in settings is offered on the lead form, stored as its key and shown as its label", async ({ page }) => {
  const label = `Trade show ${Date.now()}`;
  await page.goto("/dashboard/settings/picklists/lead_source");
  await page.getByLabel("New value").fill(label);
  await page.getByRole("button", { name: "Add value" }).click();
  await expect(page.getByText(`Key ${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, { exact: false })).toBeVisible();

  await page.goto("/dashboard/sales/leads/new");
  const email = `picklist-${Date.now()}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("combobox", { name: "Source" }).click();
  await page.getByRole("option", { name: label }).click();
  await page.getByRole("button", { name: /^Create lead$|^Save$/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/leads\/\d+/);

  const leads = await api(page, `/sales/leads?search=${encodeURIComponent(email)}`);
  const lead = (leads.results ?? leads.items ?? [])[0];
  expect(lead.source).toBe(label.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  expect(lead.status).toBe("new");
});

test("the API refuses a value outside the list on its field", async ({ page }) => {
  const { status, body } = await apiResponse(page, "/sales/organizations", {
    method: "POST",
    data: { org_name: `Picklist refusal ${Date.now()}`, primary_email: `refuse-${Date.now()}@example.com`, industry: "Space mining" },
  });
  expect(status).toBe(422);
  expect((body as { detail: { loc: string[] }[] }).detail[0].loc).toEqual(["body", "industry"]);
});

test("countries are ISO codes, limited by switching values off", async ({ page }) => {
  const list = await api(page, "/picklists");
  const country = list.results.find((item: { key: string }) => item.key === "country");
  expect(country.is_locked).toBe(true);
  expect(country.values.some((value: { key: string }) => value.key === "LK")).toBe(true);

  await page.goto("/dashboard/settings/picklists/country");
  await expect(page.getByLabel("New value")).toHaveCount(0);
  await page.getByPlaceholder("Search values").fill("Antarctica");
  await expect(page.getByTestId("picklist-value-AQ")).toBeVisible();
});
