import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const fullActions = {
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
  can_restore: true,
  can_export: true,
  can_configure: true,
};

const moduleFixture = {
  id: 71,
  name: "custom_42_custom_projects",
  base_route: "/dashboard/custom/custom_projects",
  description: "Custom module: Projects",
  is_enabled: true,
  actions: fullActions,
};

const recordFixture = {
  id: 91,
  custom_module_id: 81,
  title: "Renewal rollout",
  values: {
    project_name: "Renewal rollout",
    budget: "25000",
    status: "planned",
    tags: ["priority"],
    billable: true,
    notes: "Coordinate the tenant renewal.",
  },
  created_at: "2099-07-24T08:00:00Z",
  updated_at: "2099-07-24T09:00:00Z",
};

const schemaFixture = {
  id: 81,
  name: "Projects",
  key: "custom_projects",
  description: "Track tenant delivery projects.",
  is_active: true,
  module_id: 71,
  base_route: "/dashboard/custom/custom_projects",
  fields: [
    { id: 1, key: "project_name", label: "Project name", field_type: "text", is_required: true, is_unique: false, display_in_list: true, default_value: "", validation_json: null, sort_order: 10, is_active: true, is_protected: false },
    { id: 2, key: "budget", label: "Budget", field_type: "currency", is_required: false, is_unique: false, display_in_list: true, default_value: "", validation_json: null, sort_order: 20, is_active: true, is_protected: false },
    { id: 3, key: "status", label: "Status", field_type: "single_select", is_required: true, is_unique: false, display_in_list: true, default_value: "planned", validation_json: { options: ["planned", "active"] }, sort_order: 30, is_active: true, is_protected: false },
    { id: 4, key: "tags", label: "Tags", field_type: "multi_select", is_required: false, is_unique: false, display_in_list: false, default_value: [], validation_json: { options: ["priority", "renewal"] }, sort_order: 40, is_active: true, is_protected: false },
    { id: 5, key: "billable", label: "Billable", field_type: "boolean", is_required: false, is_unique: false, display_in_list: true, default_value: false, validation_json: null, sort_order: 50, is_active: true, is_protected: false },
    { id: 6, key: "notes", label: "Notes", field_type: "textarea", help_text: "Visible to internal project operators.", is_required: false, is_unique: false, display_in_list: false, default_value: "", validation_json: null, sort_order: 60, is_active: true, is_protected: false },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([moduleFixture]),
    }),
  );
  await page.route("**/custom-modules/custom_projects/schema", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(schemaFixture),
    }),
  );
  await page.route("**/module-fields/custom_projects", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        schemaFixture.fields.map((field) => ({
          module_key: "custom_projects",
          field_key: field.key,
          label: field.label,
          field_type: field.field_type,
          field_source: "custom_module",
          is_enabled: true,
          is_protected: false,
          sort_order: field.sort_order,
        })),
      ),
    }),
  );
  await loginAsAdmin(page);
});

test("refreshes mounted module guards after custom-module access changes", async ({ page }) => {
  let accessibleModules: Array<typeof moduleFixture> = [];
  await page.unroute("**/users/me/modules");
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(accessibleModules),
    }),
  );
  await page.route("**/custom-modules/custom_projects/records?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], total_count: 0, total_pages: 0, page: 1, page_size: 25 }),
    }),
  );

  const emptyRefresh = page.waitForResponse((response) => response.url().includes("/users/me/modules"));
  await page.evaluate(() => {
    window.sessionStorage.removeItem("lynk_modules:v4");
    window.dispatchEvent(new Event("lynk:modules-invalidated"));
  });
  await emptyRefresh;

  accessibleModules = [moduleFixture];
  const accessRefresh = page.waitForResponse((response) => response.url().includes("/users/me/modules"));
  await page.evaluate(() => {
    window.sessionStorage.removeItem("lynk_modules:v4");
    window.dispatchEvent(new Event("lynk:modules-invalidated"));
  });
  await accessRefresh;

  const customModuleLink = page.getByRole("link", { name: "Projects", exact: true });
  await expect(customModuleLink).toBeVisible();
  await customModuleLink.click();
  await expect(page).toHaveURL(/\/dashboard\/custom\/custom_projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toHaveCount(0);
});

async function cachePermissions(
  page: Parameters<typeof loginAsAdmin>[0],
  overrides: Partial<typeof fullActions>,
) {
  await page.evaluate(
    ({ module, actions }) => {
      window.sessionStorage.setItem(
        "lynk_modules:v4",
        JSON.stringify([{ ...module, actions: { ...module.actions, ...actions } }]),
      );
    },
    { module: moduleFixture, actions: overrides },
  );

  // The beforeEach stub still serves the unrestricted fixture, and useAccessibleModules
  // revalidates and overwrites the seeded cache, so the endpoint has to be narrowed too.
  await page.unroute("**/users/me/modules");
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...moduleFixture, actions: { ...moduleFixture.actions, ...overrides } }]),
    }),
  );
}

test("creates a custom-module record from the responsive routed form", async ({ page }) => {
  let submitted: { title?: string; values: Record<string, unknown> } | null = null;
  const record = {
    id: 91,
    custom_module_id: 81,
    title: "Renewal rollout",
    values: {},
  };
  await page.route("**/custom-modules/custom_projects/records", async (route) => {
    submitted = route.request().postDataJSON() as typeof submitted;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...record, title: submitted?.title, values: submitted?.values }),
    });
  });
  await page.route("**/custom-modules/custom_projects/records/91", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(record) }),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/custom/custom_projects/new");

  await expect(page.getByRole("heading", { name: "Create record" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Create record" }).click();
  await expect(page.getByText("Project name is required.")).toBeVisible();
  await expect(page.getByLabel("Project name")).toBeFocused();

  await page.getByLabel("Record title").fill("Renewal rollout");
  await page.getByLabel("Project name").fill("Renewal rollout");
  await page.getByLabel("Budget").fill("25000");
  await page.getByLabel("Tags").getByLabel("priority").click();
  await page.getByLabel("Billable").click();
  await page.getByLabel("Notes").fill("Coordinate the tenant renewal.");
  await page.getByRole("button", { name: "Create record" }).click();

  expect(submitted).toEqual({
    title: "Renewal rollout",
    values: {
      project_name: "Renewal rollout",
      budget: "25000",
      status: "planned",
      tags: ["priority"],
      billable: true,
      notes: "Coordinate the tenant renewal.",
    },
  });
  await expect(page).toHaveURL(/\/dashboard\/custom\/custom_projects\/91$/);
});

test("hides backend details when custom-module creation fails", async ({ page }) => {
  await page.route("**/custom-modules/custom_projects/records", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "custom_values_table=private-secret" }),
    }),
  );

  await page.goto("/dashboard/custom/custom_projects/new");
  await page.getByLabel("Project name").fill("Failed project");
  await page.getByRole("button", { name: "Create record" }).click();

  await expect(page.getByText("We could not create this record.")).toBeVisible();
  await expect(page.getByText("custom_values_table=private-secret")).toBeHidden();
});

test("blocks the routed create form without custom-module create permission", async ({ page }) => {
  await page.unroute("**/users/me/modules");
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...moduleFixture, actions: { ...fullActions, can_create: false } }]),
    }),
  );
  await page.evaluate(() => window.sessionStorage.removeItem("lynk_modules:v4"));

  await page.goto("/dashboard/custom/custom_projects/new");

  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();
});

test("custom-module list uses permission-aware actions and recoverable deletion", async ({ page }) => {
  await page.route("**/custom-modules/custom_projects/records?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [recordFixture],
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 25,
      }),
    }),
  );
  await page.route("**/custom-modules/custom_projects/records/91", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 database_password=secret" }),
    }),
  );

  await page.goto("/dashboard/custom/custom_projects");

  await expect(page.getByRole("link", { name: "Renewal rollout" })).toHaveAttribute(
    "href",
    "/dashboard/custom/custom_projects/91",
  );
  await expect(page.getByRole("link", { name: "New record" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Renewal rollout" }).click();
  await expect(page.getByRole("dialog")).toContainText("An administrator can restore it later.");
  await page.getByRole("button", { name: "Move to Recycle Bin" }).click();

  await expect(page.getByText("We could not delete this record. Try again.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=secret")).toHaveCount(0);
});

test("custom-module viewers receive read-only list and detail routes", async ({ page }) => {
  await cachePermissions(page, {
    can_create: false,
    can_edit: false,
    can_delete: false,
    can_export: false,
  });
  await page.route("**/custom-modules/custom_projects/records?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [recordFixture],
        total_count: 1,
        total_pages: 1,
        page: 1,
        page_size: 25,
      }),
    }),
  );
  await page.route("**/custom-modules/custom_projects/records/91", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(recordFixture),
    }),
  );

  await page.goto("/dashboard/custom/custom_projects");
  await expect(page.getByRole("link", { name: "New record" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Renewal rollout" })).toHaveCount(0);

  await page.goto("/dashboard/custom/custom_projects/91");
  await expect(page.getByText("You have view-only access to this record.")).toBeVisible();
  await expect(page.getByLabel("Record title")).toBeDisabled();
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("custom-module detail validates required fields and redacts save failures", async ({ page }) => {
  await page.route("**/custom-modules/custom_projects/records/91", (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "custom_values_table=private-secret" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(recordFixture),
    });
  });

  await page.goto("/dashboard/custom/custom_projects/91");
  await page.getByLabel("Project name").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Project name is required.")).toBeVisible();
  await expect(page.getByLabel("Project name")).toBeFocused();

  await page.getByLabel("Project name").fill("Renewal relaunch");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("We could not save this record.")).toBeVisible();
  await expect(page.getByText("custom_values_table=private-secret")).toHaveCount(0);
});

test("custom-module routes distinguish not-found and recoverable list failures", async ({ page }) => {
  await page.route("**/custom-modules/custom_projects/records?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 database_password=secret" }),
    }),
  );
  await page.route("**/custom-modules/custom_projects/records/404", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "record 404 for tenant 42" }),
    }),
  );

  await page.goto("/dashboard/custom/custom_projects");
  await expect(page.getByText("Records could not be loaded. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.goto("/dashboard/custom/custom_projects/404");
  await expect(page.getByRole("heading", { name: "Record not found" })).toBeVisible();
  await expect(page.getByText("record 404 for tenant 42")).toHaveCount(0);
});
