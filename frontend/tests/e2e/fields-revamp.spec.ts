import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

type CustomField = {
  id: number;
  module_key: string;
  field_key: string;
  label: string;
  field_type: string;
  placeholder: string | null;
  help_text: string | null;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
};

type ModuleField = {
  id: number;
  module_key: string;
  field_key: string;
  label: string;
  field_type: string;
  field_source: string;
  is_enabled: boolean;
  is_protected: boolean;
  sort_order: number;
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);

  let customFields: CustomField[] = [
    {
      id: 301,
      module_key: "sales_contacts",
      field_key: "contract_term",
      label: "Contract Term",
      field_type: "text",
      placeholder: "12 months",
      help_text: "Commercial agreement duration",
      is_required: true,
      is_active: true,
      sort_order: 100,
    },
  ];
  let moduleFields: ModuleField[] = [
    {
      id: 401,
      module_key: "sales_contacts",
      field_key: "linkedin_url",
      label: "LinkedIn",
      field_type: "text",
      field_source: "system",
      is_enabled: false,
      is_protected: false,
      sort_order: 20,
    },
    {
      id: 402,
      module_key: "sales_contacts",
      field_key: "custom:contract_term",
      label: "Contract Term",
      field_type: "text",
      field_source: "custom_field",
      is_enabled: true,
      is_protected: false,
      sort_order: 100,
    },
  ];

  await page.route("**/module-builder?include_deleted=true", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/admin/module-fields/sales_contacts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(moduleFields) }),
  );
  await page.route(/\/admin\/module-fields\/sales_contacts\/.+$/, async (route) => {
    const fieldKey = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    const payload = route.request().postDataJSON() as Partial<ModuleField>;
    const existing = moduleFields.find((field) => field.field_key === fieldKey);
    const updated: ModuleField = {
      id: existing?.id ?? 500 + moduleFields.length,
      module_key: "sales_contacts",
      field_key: fieldKey,
      label: payload.label ?? existing?.label ?? fieldKey,
      field_type: payload.field_type ?? existing?.field_type ?? "text",
      field_source: payload.field_source ?? existing?.field_source ?? "system",
      is_enabled: payload.is_enabled ?? existing?.is_enabled ?? true,
      is_protected: payload.is_protected ?? existing?.is_protected ?? false,
      sort_order: payload.sort_order ?? existing?.sort_order ?? 0,
    };
    moduleFields = [...moduleFields.filter((field) => field.field_key !== fieldKey), updated];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
  });
  await page.route("**/admin/custom-fields/sales_contacts", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Omit<CustomField, "id" | "module_key" | "sort_order" | "is_active">;
      const created: CustomField = {
        ...payload,
        id: 302,
        module_key: "sales_contacts",
        sort_order: customFields.length + 100,
        is_active: true,
      };
      customFields = [...customFields, created];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(customFields) });
  });
  await page.route(/\/admin\/custom-fields\/\d+$/, async (route) => {
    const fieldId = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    const payload = route.request().postDataJSON() as Partial<CustomField>;
    customFields = customFields.map((field) => field.id === fieldId ? { ...field, ...payload } : field);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(customFields.find((field) => field.id === fieldId)),
    });
  });
});

test("filters fields, explains protected controls, and saves inspector changes on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/settings/fields");

  await expect(page.getByRole("heading", { name: "Field Configuration" })).toBeVisible();
  await page.getByRole("button", { name: "disabled", exact: true }).click();
  await expect(page.getByText("LinkedIn", { exact: true })).toBeVisible();
  await expect(page.getByText("Contract Term", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "required", exact: true }).click();
  await page.getByRole("button", { name: /Contract Term/ }).click();
  await page.getByLabel("Label", { exact: true }).fill("Agreement Term");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const customUpdate = page.waitForRequest((request) => request.method() === "PUT" && request.url().endsWith("/admin/custom-fields/301"));
  await page.getByRole("button", { name: "Save Field" }).click();
  const request = await customUpdate;
  expect(request.postDataJSON()).toMatchObject({ label: "Agreement Term", is_required: true, is_active: true });
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.getByRole("button", { name: /Email System.*Protected/ }).click();
  await expect(page.getByText(/protected field stays enabled/i)).toBeVisible();
  await expect(page.getByRole("switch", { name: "Disable Email" })).toBeDisabled();
});

test("creates a required custom field and opens it in the inspector", async ({ page }) => {
  await page.goto("/dashboard/settings/fields");
  await page.getByRole("button", { name: "New Field" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Renewal Window");
  await expect(page.getByLabel("Field Key")).toHaveValue("renewal_window");
  await page.getByLabel("Require a value when records are saved").click();

  const createRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/admin/custom-fields/sales_contacts"));
  await page.getByRole("button", { name: "Create Field" }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({ field_key: "renewal_window", label: "Renewal Window", is_required: true });

  await expect(page.getByRole("heading", { name: "Field inspector" })).toBeVisible();
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue("Renewal Window");
});
