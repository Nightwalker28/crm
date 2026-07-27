import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const initialGroups = [
  {
    id: 1,
    group_key: "default",
    name: "Default",
    description: "Standard customer pricing.",
    discount_type: "none",
    discount_value: null,
    is_default: true,
    is_active: true,
    created_at: "2026-07-27T08:00:00Z",
    updated_at: "2026-07-27T08:00:00Z",
  },
  {
    id: 2,
    group_key: "wholesale",
    name: "Wholesale",
    description: "Wholesale customer pricing.",
    discount_type: "percent",
    discount_value: 10,
    is_default: false,
    is_active: true,
    created_at: "2026-07-27T08:00:00Z",
    updated_at: "2026-07-27T08:00:00Z",
  },
];

async function mockCustomerGroups(page: Page, groups = initialGroups) {
  await page.route("**/client-portal/customer-groups", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(groups) });
  });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("validates percentage pricing and confirms a new tenant default on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCustomerGroups(page);
  let createRequests = 0;
  let savedPayload: Record<string, unknown> | null = null;
  await page.route("**/client-portal/customer-groups", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    createRequests += 1;
    savedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: 3,
        ...savedPayload,
        group_key: "vip_clients",
        created_at: "2026-07-27T09:00:00Z",
        updated_at: "2026-07-27T09:00:00Z",
      }),
    });
  });

  await page.goto("/dashboard/settings/customer-groups");
  await page.getByLabel("Name").fill("VIP Clients");
  await page.getByLabel("Key").fill("vip clients");
  await page.getByLabel("Discount Type").click();
  await page.getByRole("option", { name: "Percent" }).click();
  await page.getByLabel("Discount Value").fill("125");
  await page.getByLabel("Default group").click();
  await page.getByRole("button", { name: "Create Group" }).click();

  await expect(page.getByText("Percent discounts cannot exceed 100.")).toBeVisible();
  await expect(page.getByLabel("Discount Value")).toBeFocused();
  expect(createRequests).toBe(0);

  await page.getByLabel("Discount Value").fill("15");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { name: "Change the default customer group?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(createRequests).toBe(0);

  await page.getByRole("button", { name: "Create Group" }).click();
  await page.getByRole("button", { name: "Change default" }).click();
  await expect.poll(() => createRequests).toBe(1);
  expect(savedPayload).toMatchObject({
    group_key: "vip clients",
    name: "VIP Clients",
    discount_type: "percent",
    discount_value: 15,
    is_default: true,
    is_active: true,
  });
});

test("confirms deactivation and redacts customer-group update failures", async ({ page }) => {
  await mockCustomerGroups(page);
  let updateRequests = 0;
  await page.route("**/client-portal/customer-groups/2", async (route) => {
    updateRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "pricing resolver tenant_id=42 internal stack trace" }),
    });
  });

  await page.goto("/dashboard/settings/customer-groups");
  const wholesaleRow = page.getByRole("row").filter({ hasText: "Wholesale" });
  await wholesaleRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Active").click();
  await expect(page.getByText("You have unsaved customer group changes.")).toBeVisible();

  await page.getByRole("button", { name: "Save Group" }).click();
  await expect(page.getByRole("heading", { name: "Deactivate this customer group?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(updateRequests).toBe(0);

  await page.getByRole("button", { name: "Save Group" }).click();
  await page.getByRole("button", { name: "Deactivate group" }).click();
  await expect.poll(() => updateRequests).toBe(1);
  await expect(page.getByText("Customer group changes could not be saved. Check the group key and discount, then try again.")).toBeVisible();
  await expect(page.getByText(/tenant_id=42|internal stack trace/)).toHaveCount(0);
});

test("shows a retryable fixed error when customer groups cannot load", async ({ page }) => {
  await page.route("**/client-portal/customer-groups", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SELECT customer_groups failed at private-db" }),
    }),
  );

  await page.goto("/dashboard/settings/customer-groups");

  await expect(page.getByText("Customer groups could not be loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/SELECT customer_groups|private-db/)).toHaveCount(0);
});
