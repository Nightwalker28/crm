import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const roles = [
  { id: 21, name: "Sales Rep", level: 20, description: "Works active sales records." },
  { id: 22, name: "Manager", level: 90, description: "Manages sales operations." },
];

const modules = [
  {
    module_id: 101,
    module_name: "Leads",
    module_description: "Prospective customers",
    product_area: "sales",
    actions: {
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  },
  {
    module_id: 102,
    module_name: "Accounts",
    module_description: "Customer organizations",
    product_area: "sales",
    actions: {
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  },
  {
    module_id: 201,
    module_name: "Invoices",
    module_description: "Customer receivables",
    product_area: "finance",
    actions: {
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_restore: false,
      can_export: true,
      can_configure: false,
    },
  },
];

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  await page.route("**/admin/users/roles/permissions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        roles,
        templates: [
          { key: "user", label: "User", description: "Standard access" },
          { key: "superuser", label: "Superuser", description: "Broad access" },
        ],
        modules,
      }),
    }),
  );

  await page.route(/\/admin\/users\/roles\/\d+\/permissions/, async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as {
        permissions: Array<{ module_id: number; actions: typeof modules[number]["actions"] }>;
      };
      const response = modules.map((module) => ({
        ...module,
        actions: payload.permissions.find((item) => item.module_id === module.module_id)?.actions ?? module.actions,
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) });
  });
});

test("filters grouped modules, applies bulk permissions, and saves from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/permissions");

  await expect(page.getByRole("heading", { name: "Roles & Permissions" })).toBeVisible();
  await expect(page.getByText("Sales", { exact: true })).toBeVisible();
  await expect(page.getByText("Finance", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search modules").fill("Accounts");
  await expect(page.getByText("Accounts", { exact: true })).toBeVisible();
  await expect(page.getByText("Leads", { exact: true })).toBeHidden();

  await page.getByRole("checkbox", { name: "Set all permissions for Accounts" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const saveRequest = page.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith("/admin/users/roles/21/permissions"),
  );
  await page.getByRole("button", { name: "Save Permissions" }).click();
  const request = await saveRequest;
  const payload = request.postDataJSON() as { permissions: Array<{ module_id: number; actions: Record<string, boolean> }> };
  const accounts = payload.permissions.find((permission) => permission.module_id === 102);

  expect(payload.permissions).toHaveLength(3);
  expect(Object.values(accounts?.actions ?? {}).every(Boolean)).toBeTruthy();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("warns before discarding changes when switching roles", async ({ page }) => {
  await page.goto("/dashboard/settings/permissions");
  await page.getByRole("checkbox", { name: "Delete Leads" }).click();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("discard unsaved permission changes");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: /Manager/ }).click();
  await expect(page.getByRole("heading", { name: "Sales Rep Permissions" })).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Manager/ }).click();
  await expect(page.getByRole("heading", { name: "Manager Permissions" })).toBeVisible();
});
