import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const moduleId = 101;

const modules = [
  {
    id: moduleId,
    name: "sales_leads",
    description: "Leads",
    is_enabled: true,
    import_duplicate_mode: "skip",
    sidebar_tab_key: "sales",
    sidebar_tab_label: "Sales",
    display_name: "Leads",
  },
  {
    id: 102,
    name: "documents",
    description: "Documents",
    is_enabled: false,
    import_duplicate_mode: "merge",
    sidebar_tab_key: "operations",
    sidebar_tab_label: "Operations",
    display_name: null,
  },
];

const sidebarTabs = [
  { id: 1, key: "sales", label: "Sales", sort_order: 10, is_system: true },
  { id: 2, key: "operations", label: "Operations", sort_order: 20, is_system: true },
];

function accessFixture() {
  return {
    module: modules[0],
    departments: [
      { id: 10, name: "Sales", description: "Revenue department", has_access: true },
      { id: 11, name: "Support", description: "Customer support", has_access: false },
    ],
    teams: [
      { id: 21, name: "SMB", description: "Small business", department_id: 10, department_name: "Sales", has_access: false },
      { id: 22, name: "Enterprise", description: "Key accounts", department_id: 11, department_name: "Support", has_access: false },
    ],
  };
}

async function mockModuleSettings(page: Page) {
  await page.route("**/admin/users/sidebar-tabs", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sidebarTabs) }),
  );
  await page.route("**/admin/users/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("aligns module controls and confirms tenant-wide disablement with safe failures", async ({ page }) => {
  await mockModuleSettings(page);
  let updateRequests = 0;
  await page.route(`**/admin/users/modules/${moduleId}`, async (route) => {
    updateRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 permission cache redis://secret-host" }),
    });
  });

  await page.goto("/dashboard/settings/modules");

  const leadsRow = page.getByRole("row").filter({ hasText: "Leads" });
  await expect(leadsRow.getByText("Skip duplicates", { exact: true })).toBeVisible();
  await expect(leadsRow.getByRole("link", { name: "Automation" })).toBeVisible();

  await page.getByRole("button", { name: "Edit Leads settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit module settings" })).toBeVisible();
  await page.getByRole("button", { name: "Disabled", exact: true }).click();
  expect(updateRequests).toBe(0);
  await page.getByRole("button", { name: "Close module settings" }).click();
  await expect(page.getByRole("dialog", { name: "Discard module changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Edit module settings" })).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Disable Leads?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(updateRequests).toBe(0);

  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Disable module" }).click();
  await expect.poll(() => updateRequests).toBe(1);
  await expect(page.getByText("The module setting could not be updated. Review the value and try again.")).toBeVisible();
  await expect(page.getByText(/tenant_id=42|secret-host/)).toHaveCount(0);
});

test("keeps department and team access as an explicit guarded draft", async ({ page }) => {
  let currentAccess = accessFixture();
  let updateRequests = 0;
  let savedPayload: { department_ids: number[]; team_ids: number[] } | null = null;
  await page.route(`**/admin/users/modules/${moduleId}/access`, async (route) => {
    if (route.request().method() === "PUT") {
      updateRequests += 1;
      savedPayload = route.request().postDataJSON() as { department_ids: number[]; team_ids: number[] };
      currentAccess = {
        ...currentAccess,
        departments: currentAccess.departments.map((department) => ({
          ...department,
          has_access: savedPayload?.department_ids.includes(department.id) ?? false,
        })),
        teams: currentAccess.teams.map((team) => ({
          ...team,
          has_access: savedPayload?.team_ids.includes(team.id) ?? false,
        })),
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentAccess) });
  });

  await page.goto(`/dashboard/settings/modules/${moduleId}`);
  await page.getByRole("checkbox", { name: "Allow Support department" }).click();
  await page.getByRole("tab", { name: "Teams (2)" }).click();
  await page.getByRole("checkbox", { name: "Allow Enterprise team" }).click();

  expect(updateRequests).toBe(0);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByText("Department", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Module Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Discard module access changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/settings/modules/${moduleId}$`));

  const saveRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith(`/admin/users/modules/${moduleId}/access`),
  );
  await page.getByRole("button", { name: "Save Access" }).click();
  await saveRequest;

  expect(savedPayload).toEqual({ department_ids: [10, 11], team_ids: [22] });
  await expect.poll(() => updateRequests).toBe(1);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
});

test("shows retryable module load failures without backend detail", async ({ page }) => {
  await page.route("**/admin/users/sidebar-tabs", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sidebarTabs) }),
  );
  await page.route("**/admin/users/modules", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "SELECT tenant_modules failed for tenant_id=42" }),
    }),
  );

  await page.goto("/dashboard/settings/modules");

  await expect(page.getByRole("heading", { name: "Module settings could not be loaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText(/SELECT tenant_modules|tenant_id=42/)).toHaveCount(0);
});
