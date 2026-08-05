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

const managerModules = modules.map((module) => ({
  ...module,
  actions: {
    ...module.actions,
    can_delete: true,
    can_restore: true,
    can_export: true,
  },
}));

function roleIdFromUrl(url: string) {
  return Number(url.match(/\/roles\/(\d+)\/permissions/)?.[1]);
}

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
    const response = roleIdFromUrl(route.request().url()) === 22 ? managerModules : modules;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
});

test("hydrates the default role only after its permission query succeeds", async ({ page }) => {
  await page.route("**/admin/users/roles/permissions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        roles,
        templates: [],
        modules: [],
      }),
    }),
  );
  await page.route(/\/admin\/users\/roles\/21\/permissions/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) });
  });

  await page.goto("/dashboard/settings/permissions");

  await expect(page.getByLabel("Loading role permissions")).toBeVisible();
  await expect(page.getByText("No modules match this search")).toHaveCount(0);
  await expect(page.getByText("No modules available for this role")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sales Rep Permissions" })).toBeVisible();
  await expect(page.getByText("Leads", { exact: true })).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("shows distinct real-empty and hydrated search-empty states", async ({ page }) => {
  await page.route(/\/admin\/users\/roles\/21\/permissions/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/dashboard/settings/permissions");

  await expect(page.getByText("No modules available for this role")).toBeVisible();
  await expect(page.getByText("No modules match this search")).toHaveCount(0);

  await page.route(/\/admin\/users\/roles\/22\/permissions/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(managerModules) });
  });
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Manager/ }).click();
  await expect(page.getByText("No modules match this search")).toHaveCount(0);
  await expect(page.getByText("Leads", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search modules").fill("does-not-exist");
  await expect(page.getByText("No modules match this search")).toBeVisible();
  await expect(page.getByText("No modules available for this role")).toHaveCount(0);
});

test("switches roles without edits and hydrates the selected role baseline", async ({ page }) => {
  await page.goto("/dashboard/settings/permissions");
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).not.toBeChecked();

  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Manager/ }).click();

  await expect(page.getByRole("heading", { name: "Manager Permissions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("an out-of-order response for the previous role cannot replace the selected role", async ({ page }) => {
  await page.route(/\/admin\/users\/roles\/(21|22)\/permissions/, async (route) => {
    const roleId = roleIdFromUrl(route.request().url());
    if (roleId === 21) await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(roleId === 22 ? managerModules : modules),
    });
  });
  await page.goto("/dashboard/settings/permissions");
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Manager/ }).click();

  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: "Manager Permissions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
});

test("filters grouped modules, applies bulk permissions, and saves from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/permissions");

  await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toBeVisible();
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
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();

  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Manager/ }).click();
  await expect(page.getByRole("heading", { name: "Discard permission changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Sales Rep Permissions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: /Manager/ }).click();
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await expect(page.getByRole("heading", { name: "Manager Permissions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("save success adopts the returned permissions as the new baseline", async ({ page }) => {
  await page.route(/\/admin\/users\/roles\/21\/permissions/, async (route) => {
    if (route.request().method() === "PUT") {
      const saved = modules.map((module) => ({
        ...module,
        actions: { ...module.actions, can_delete: false, can_export: true },
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) });
  });
  await page.goto("/dashboard/settings/permissions");
  await page.getByRole("checkbox", { name: "Delete Leads" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Save Permissions" }).click();

  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Export Leads" })).toBeChecked();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("save failure retains the editable draft", async ({ page }) => {
  await page.route(/\/admin\/users\/roles\/21\/permissions/, async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "unavailable" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) });
  });
  await page.goto("/dashboard/settings/permissions");
  await page.getByRole("checkbox", { name: "Delete Leads" }).click();

  await page.getByRole("button", { name: "Save Permissions" }).click();

  await expect(page.getByText("Permissions could not be saved. Please try again.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Delete Leads" })).toBeChecked();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Permissions" })).toBeEnabled();
});

test("opens Create Role from the palette action deep link", async ({ page }) => {
  await page.goto("/dashboard/settings/permissions?action=create-role");

  await expect(page.getByRole("dialog", { name: "Create Role" })).toBeVisible();
});

test("guards a dirty role draft before closing the drawer", async ({ page }) => {
  await page.goto("/dashboard/settings/permissions");
  await page.getByRole("button", { name: "Create Role" }).click();

  const roleDrawer = page.getByRole("dialog", { name: "Create Role" });
  await roleDrawer.getByLabel("Role Name").fill("Support Lead");
  await roleDrawer.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Discard role draft?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(roleDrawer).toHaveCount(0);
});
