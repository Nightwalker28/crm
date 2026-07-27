import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const customModule = {
  id: 71,
  name: "custom_projects",
  base_route: "/dashboard/custom/custom_projects",
  description: "Custom module: Projects",
  is_enabled: true,
  actions: {
    can_view: true,
    can_create: true,
    can_edit: true,
    can_delete: true,
    can_restore: true,
    can_export: true,
    can_configure: true,
  },
};

async function mockCustomModule(page: Page) {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([customModule]) }),
  );
  await page.route("**/custom-modules/custom_projects/schema", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 81,
        name: "Projects",
        key: "custom_projects",
        description: "Track delivery projects.",
        is_active: true,
        module_id: 71,
        base_route: "/dashboard/custom/custom_projects",
        fields: [
          {
            id: 1,
            key: "project_name",
            label: "Project name",
            field_type: "text",
            is_required: true,
            is_unique: false,
            display_in_list: true,
            default_value: "",
            validation_json: null,
            sort_order: 10,
            is_active: true,
            is_protected: false,
          },
        ],
      }),
    }),
  );
  await page.route("**/module-fields/custom_projects", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          module_key: "custom_projects",
          field_key: "project_name",
          label: "Project name",
          field_type: "text",
          field_source: "custom_module",
          is_enabled: true,
          is_protected: false,
          sort_order: 10,
        },
      ]),
    }),
  );
  await page.route("**/custom-modules/custom_projects/records?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], total_count: 0, total_pages: 0, page: 1 }),
    }),
  );
}

test("downloads direct custom-module exports with a safe filename", async ({ page }) => {
  await mockCustomModule(page);
  await page.route("**/custom-modules/custom_projects/export", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/csv",
      headers: { "Content-Disposition": "attachment; filename*=UTF-8''..%2F..%2Fprojects.csv" },
      body: "project_name\nRenewal",
    }),
  );
  await loginAsAdmin(page);
  await page.goto("/dashboard/custom/custom_projects");

  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("button", { name: "Export CSV" }).click();
  await expect(page.getByText("All accessible records")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("projects.csv");
  await expect(page.getByRole("heading", { name: "Export records" })).toBeHidden();
});

test("queues selected-row exports with accessible scope controls", async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/sales/leads?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            lead_id: 701,
            first_name: "Ada",
            last_name: "Lovelace",
            company: "Analytical Engines",
            primary_email: "ada@example.com",
            status: "qualified",
            assigned_to: 7,
            created_time: "2026-07-27T08:00:00Z",
          },
        ],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
      }),
    }),
  );
  let exportPayload: Record<string, unknown> | null = null;
  await page.route("**/sales/leads/export", async (route) => {
    exportPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "background", job_id: 44, job_status: "queued" }),
    });
  });
  await page.goto("/dashboard/sales/leads");

  await page.getByLabel("Select lead ada@example.com").click();
  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("radio", { name: /Selected rows/ }).click();
  await page.getByRole("button", { name: "Run export" }).click();

  expect(exportPayload).toMatchObject({ mode: "selected", selected_ids: [701] });
  await expect(page.getByRole("heading", { name: "Export progress" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Export progress" })).toHaveAttribute("aria-valuenow", "0");
});

test("redacts export-start backend details", async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/sales/leads/export", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "COPY tenant_id=42 failed on private-db" }),
    }),
  );
  await page.goto("/dashboard/sales/leads");

  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("button", { name: "Run export" }).click();

  await expect(page.getByRole("alert")).toContainText("The export could not be started");
  await expect(page.getByText(/tenant_id=42|private-db/)).toHaveCount(0);
});
