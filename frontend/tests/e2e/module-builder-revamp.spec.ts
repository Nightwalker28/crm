import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type BuilderField = {
  id: number;
  key: string;
  label: string;
  field_type: string;
  help_text: string | null;
  placeholder: string | null;
  is_required: boolean;
  is_unique: boolean;
  display_in_list: boolean;
  default_value: string | null;
  validation_json: null;
  sort_order: number;
  is_active: boolean;
  is_protected: boolean;
};

type BuilderModule = {
  id: number;
  name: string;
  key: string;
  description: string;
  is_active: boolean;
  sidebar_tab_key: string;
  display_name: string;
  deleted_at: null;
  fields: BuilderField[];
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  let builderModule: BuilderModule = {
    id: 11,
    name: "Service Requests",
    key: "service_requests",
    description: "Customer service requests",
    is_active: true,
    sidebar_tab_key: "operations",
    display_name: "Requests",
    deleted_at: null,
    fields: [
      {
        id: 101,
        key: "name",
        label: "Name",
        field_type: "text",
        help_text: null,
        placeholder: null,
        is_required: true,
        is_unique: false,
        display_in_list: true,
        default_value: null,
        validation_json: null,
        sort_order: 0,
        is_active: true,
        is_protected: true,
      },
      {
        id: 102,
        key: "priority",
        label: "Priority",
        field_type: "single_select",
        help_text: null,
        placeholder: null,
        is_required: false,
        is_unique: false,
        display_in_list: true,
        default_value: null,
        validation_json: null,
        sort_order: 1,
        is_active: true,
        is_protected: false,
      },
    ],
  };

  await page.route("**/admin/users/sidebar-tabs", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, key: "operations", label: "Operations", sort_order: 1, is_system: true },
        { id: 2, key: "other", label: "Other", sort_order: 2, is_system: true },
      ]),
    }),
  );
  await page.route("**/module-builder?include_deleted=true", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([builderModule]) }),
  );
  await page.route(/\/module-builder\/11$/, async (route) => {
    const payload = route.request().postDataJSON() as Partial<BuilderModule>;
    builderModule = { ...builderModule, ...payload };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(builderModule) });
  });
  await page.route(/\/module-builder\/11\/fields\/\d+$/, async (route) => {
    const fieldId = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    const payload = route.request().postDataJSON() as Partial<BuilderField>;
    builderModule = {
      ...builderModule,
      fields: builderModule.fields.map((field) => field.id === fieldId ? { ...field, ...payload } : field),
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(builderModule) });
  });
  await page.route("**/module-builder/11/fields", async (route) => {
    const payload = route.request().postDataJSON() as Omit<BuilderField, "id" | "key" | "is_protected">;
    const created: BuilderField = {
      ...payload,
      id: 103,
      key: "status",
      is_protected: false,
      validation_json: null,
    };
    builderModule = { ...builderModule, fields: [...builderModule.fields, created] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(builderModule) });
  });
});

test("edits and reorders fields from one module-level save on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/module-builder");

  await expect(page.getByRole("heading", { name: "Module Builder" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Fields" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /^Priority/ }).click();
  await page.getByLabel("Label", { exact: true }).fill("Request Priority");
  await page.getByRole("button", { name: "Move Request Priority up" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const fieldUpdate = page.waitForRequest((request) =>
    request.method() === "PUT"
    && request.url().endsWith("/module-builder/11/fields/102"),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const request = await fieldUpdate;

  expect(request.postDataJSON()).toMatchObject({ label: "Request Priority", sort_order: 0 });
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("adds a field in the inspector and exposes shared builder destinations", async ({ page }) => {
  await page.goto("/dashboard/settings/module-builder");

  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Status");
  await page.getByLabel("Field type").click();
  await page.getByRole("option", { name: "single select" }).click();
  await page.getByLabel("Options").fill("New\nResolved");

  const createRequest = page.waitForRequest((request) =>
    request.method() === "POST"
    && request.url().endsWith("/module-builder/11/fields"),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    label: "Status",
    field_type: "single_select",
    validation_json: { options: ["New", "Resolved"] },
  });

  await page.getByRole("tab", { name: "Permissions" }).click();
  await expect(page.getByRole("link", { name: "Open permissions" })).toHaveAttribute("href", "/dashboard/settings/permissions");
  await page.getByRole("tab", { name: "Automation" }).click();
  await expect(page.getByRole("link", { name: "Open automation builder" })).toHaveAttribute("href", "/dashboard/settings/automation");
});
