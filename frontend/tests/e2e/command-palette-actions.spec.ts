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

test.beforeEach(async ({ page }) => {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 1,
          name: "sales_leads",
          base_route: "/dashboard/sales/leads",
          description: "Sales leads",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 2,
          name: "sales_contacts",
          base_route: "/dashboard/sales/contacts",
          description: "Sales contacts",
          is_enabled: true,
          actions: { ...fullActions, can_create: false },
        },
        {
          id: 3,
          name: "tasks",
          base_route: "/dashboard/tasks",
          description: "Tasks",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 4,
          name: "contracts",
          base_route: "/dashboard/contracts",
          description: "Contracts",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 5,
          name: "catalog_products",
          base_route: "/dashboard/catalog/products",
          description: "Products",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 6,
          name: "catalog_services",
          base_route: "/dashboard/catalog/services",
          description: "Services",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 7,
          name: "documents",
          base_route: "/dashboard/documents",
          description: "Documents",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 8,
          name: "mail",
          base_route: "/dashboard/mail",
          description: "Mail",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 9,
          name: "client_portal",
          base_route: "/dashboard/client-portal",
          description: "Client Portal",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 10,
          name: "finance_io",
          base_route: "/dashboard/finance/insertion-orders",
          description: "Insertion Orders",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 11,
          name: "finance_pos",
          base_route: "/dashboard/finance/pos",
          description: "Invoices",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 12,
          name: "reports",
          base_route: "/dashboard/reports",
          description: "Reports",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 13,
          name: "message_templates",
          base_route: "/dashboard/settings/message-templates",
          description: "Templates",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 14,
          name: "integrations",
          base_route: "/dashboard/settings/integrations",
          description: "Integrations",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 15,
          name: "custom_projects",
          base_route: "/dashboard/custom/custom_projects",
          description: "Custom module: Projects",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 16,
          name: "sales_organizations",
          base_route: "/dashboard/sales/organizations",
          description: "Sales organizations",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 17,
          name: "sales_opportunities",
          base_route: "/dashboard/sales/opportunities",
          description: "Sales opportunities",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 18,
          name: "sales_quotes",
          base_route: "/dashboard/sales/quotes",
          description: "Sales quotes",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 19,
          name: "sales_orders",
          base_route: "/dashboard/sales/orders",
          description: "Sales orders",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 20,
          name: "calendar",
          base_route: "/dashboard/calendar",
          description: "Calendar",
          is_enabled: true,
          actions: fullActions,
        },
        {
          id: 21,
          name: "support_cases",
          base_route: "/dashboard/support/cases",
          description: "Support cases",
          is_enabled: true,
          actions: fullActions,
        },
      ]),
    }),
  );

  await loginAsAdmin(page);
});

test("shows only permitted module actions and opens routed create workflows", async ({ page }) => {
  await page.keyboard.press("Control+K");

  await expect(page.getByText("Create lead", { exact: true })).toBeVisible();
  await expect(page.getByText("Create task", { exact: true })).toBeVisible();
  await expect(page.getByText("Create product", { exact: true })).toBeVisible();
  await expect(page.getByText("Create service", { exact: true })).toBeVisible();
  await expect(page.getByText("Upload document", { exact: true })).toBeVisible();
  await expect(page.getByText("Compose email", { exact: true })).toBeVisible();
  await expect(page.getByText("Create client page", { exact: true })).toBeVisible();
  await expect(page.getByText("Create insertion order", { exact: true })).toBeVisible();
  await expect(page.getByText("Record payment", { exact: true })).toBeVisible();
  await expect(page.getByText("Build report", { exact: true })).toBeVisible();
  await expect(page.getByText("Create message template", { exact: true })).toBeVisible();
  await expect(page.getByText("Configure integration", { exact: true })).toBeVisible();
  await expect(page.getByText("Add user", { exact: true })).toBeVisible();
  await expect(page.getByText("Create team", { exact: true })).toBeVisible();
  await expect(page.getByText("Create department", { exact: true })).toBeVisible();
  await expect(page.getByText("Create role", { exact: true })).toBeVisible();
  await expect(page.getByText("Create Projects", { exact: true })).toBeVisible();
  await expect(page.getByText("Create contact", { exact: true })).toBeHidden();

  await page.getByText("Create lead", { exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/leads\/new$/);
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
});

test("exposes every accessible module destination and supports Arrow and Enter navigation", async ({ page }) => {
  const moduleDestinations = [
    "/dashboard/sales/leads",
    "/dashboard/sales/organizations",
    "/dashboard/sales/contacts",
    "/dashboard/sales/opportunities",
    "/dashboard/sales/quotes",
    "/dashboard/sales/orders",
    "/dashboard/contracts",
    "/dashboard/catalog/products",
    "/dashboard/catalog/services",
    "/dashboard/documents",
    "/dashboard/calendar",
    "/dashboard/mail",
    "/dashboard/tasks",
    "/dashboard/support/cases",
    "/dashboard/client-portal",
    "/dashboard/finance/insertion-orders",
    "/dashboard/finance/pos",
    "/dashboard/reports",
    "/dashboard/settings/message-templates",
    "/dashboard/settings/integrations",
    "/dashboard/custom/custom_projects",
  ];

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog");
  for (const href of moduleDestinations) {
    await expect(palette.locator(`[data-testid="palette-link"][data-href="${href}"]`)).toHaveCount(1);
  }

  await page.getByLabel("Search records and modules").fill("Create lead");
  await expect(palette.getByText("Create lead", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/sales\/leads\/new$/);
});

test("opens custom-module creation as a routed full-page workflow", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Create Projects", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/custom\/custom_projects\/new$/);
});

test("record-search failures stay recoverable without exposing backend details", async ({ page }) => {
  await page.route("**/global-search?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "database_connection=private-secret" }),
    }),
  );

  await page.keyboard.press("Control+K");
  await page.getByLabel("Search records and modules").fill("private failure");

  await expect(page.getByText("Search is temporarily unavailable. Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("database_connection=private-secret")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("routes administrator actions to their addressable create workflows", async ({ page }) => {
  const workflows = [
    { label: "Add user", path: "/dashboard/settings/users?action=create-user" },
    { label: "Create team", path: "/dashboard/settings/teams?action=create-team" },
    { label: "Create department", path: "/dashboard/settings/teams?action=create-department" },
    { label: "Create role", path: "/dashboard/settings/permissions?action=create-role" },
  ];

  for (const workflow of workflows) {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+K");
    await page.getByText(workflow.label, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${workflow.path.replace(/[?]/g, "\\?")}$`));
  }
});

test("opens team and department dialogs from palette action deep links", async ({ page }) => {
  await page.route("**/admin/users/departments", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, name: "Operations", description: null }]),
    }),
  );
  await page.route("**/admin/users/teams", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto("/dashboard/settings/teams?action=create-team");
  await expect(page.getByRole("heading", { name: "Create Team" })).toBeVisible();

  await page.goto("/dashboard/settings/teams?action=create-department");
  await expect(page.getByRole("heading", { name: "Create Department" })).toBeVisible();
});

test("tracks actual route visits as user-scoped recent pages", async ({ page }) => {
  await page.goto("/dashboard/sales/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

  await page.goto("/dashboard/sales/leads");
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await page.keyboard.press("Control+K");

  const recentPages = page.getByTestId("recent-pages");
  await expect(recentPages.getByText("Contacts", { exact: true })).toBeVisible();
  await expect(recentPages.getByText("Leads", { exact: true })).toBeHidden();

  const storageKeys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.startsWith("lynk:command-palette:recent-pages")),
  );
  expect(storageKeys).toHaveLength(1);
  expect(storageKeys[0]).toMatch(/recent-pages:\d+$/);
});

test("opens contract creation as a routed full-page workflow", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Create contract", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/contracts\/new$/);
  await expect(page.getByRole("heading", { name: "Create contract" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("opens document upload as a routed full-page workflow", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Upload document", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/documents\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload document" })).toBeVisible();
});

test("opens mail composition as a routed full-page workflow", async ({ page }) => {
  await page.route("**/mail/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [{
          provider: "google",
          status: "connected",
          account_email: "admin@example.com",
          can_send: true,
          can_sync: true,
          health_status: "healthy",
          credential_state: "active",
          scopes: ["gmail.send"],
          reconnect_required: false,
        }],
        sync_available: true,
        sync_note: "Ready",
      }),
    }),
  );

  await page.keyboard.press("Control+K");
  await page.getByText("Compose email", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/mail\/compose$/);
  await expect(page.getByRole("heading", { name: "Compose email" })).toBeVisible();
});

test("opens client-page creation as a routed full-page workflow", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Create client page", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/client-portal\/pages\/new$/);
  await expect(page.getByRole("heading", { name: "Create client page" })).toBeVisible();
});

test("opens insertion-order creation as a routed full-page workflow", async ({ page }) => {
  await page.route("**/custom-fields/finance_io", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/module-fields/finance_io", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/users/company", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ operating_currencies: ["USD"] }) }),
  );

  await page.keyboard.press("Control+K");
  await page.getByText("Create insertion order", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/finance\/insertion-orders\/new$/);
  await expect(page.getByRole("heading", { name: "Create insertion order" })).toBeVisible();
});

test("opens payment recording as an edit-authorized routed workflow", async ({ page }) => {
  await page.route("**/finance/pos-invoices?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [],
        range_start: 0,
        range_end: 0,
        total_count: 0,
        total_pages: 0,
        page: 1,
        page_size: 25,
      }),
    }),
  );

  await page.keyboard.press("Control+K");
  await page.getByText("Record payment", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/finance\/payments\/record$/);
  await expect(page.getByRole("heading", { name: "Record payment" })).toBeVisible();
});

test("hides payment recording without invoice edit permission", async ({ page }) => {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 11,
        name: "finance_pos",
        base_route: "/dashboard/finance/pos",
        description: "Invoices",
        is_enabled: true,
        actions: { ...fullActions, can_edit: false },
      }]),
    }),
  );
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await page.keyboard.press("Control+K");

  await expect(page.getByText("Create invoice", { exact: true })).toBeVisible();
  await expect(page.getByText("Record payment", { exact: true })).toBeHidden();

  await page.goto("/dashboard/finance/payments/record");
  await expect(page.getByRole("heading", { name: "You do not have permission to view this page" })).toBeVisible();
});

test("opens report building as a create-authorized palette workflow", async ({ page }) => {
  await page.route("**/reports/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          module_key: "sales_leads",
          label: "Leads",
          dimensions: [{ key: "status", label: "Status", field_type: "select" }],
          metrics: [],
          filter_fields: [],
          default_dimension: "status",
        }],
      }),
    }),
  );
  await page.route("**/reports/modules/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        module_key: "sales_leads",
        dimension: { key: "status", label: "Status", field_type: "select" },
        metric: "count",
        metric_field: null,
        total_count: 0,
        rows: [],
      }),
    }),
  );
  await page.route("**/reports/saved?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }),
  );
  await page.keyboard.press("Control+K");
  await page.getByText("Build report", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/reports#report-builder$/);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.locator("#report-builder")).toBeVisible();
});

test("opens message-template creation as a routed full-page workflow", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Create message template", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/settings\/message-templates\/new$/);
  await expect(page.getByRole("heading", { name: "Create message template" })).toBeVisible();
});

test("opens integration configuration at the provider registry", async ({ page }) => {
  await page.keyboard.press("Control+K");
  await page.getByText("Configure integration", { exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/settings\/integrations#provider-registry$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.locator("#provider-registry")).toBeVisible();
});

test("hides integration configuration without configure permission", async ({ page }) => {
  await page.route("**/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 14,
        name: "integrations",
        base_route: "/dashboard/settings/integrations",
        description: "Integrations",
        is_enabled: true,
        actions: { ...fullActions, can_configure: false },
      }]),
    }),
  );
  await page.evaluate(() => window.sessionStorage.clear());
  await page.reload();
  await page.keyboard.press("Control+K");

  await expect(page.getByRole("dialog").getByText("Configure integration", { exact: true })).toBeHidden();
});

test("hides admin-only actions from non-admin users even with module actions", async ({ page }) => {
  await page.evaluate((modules) => {
    window.sessionStorage.setItem("lynk_user", JSON.stringify({
      id: 99,
      email: "standard@example.com",
      role_level: 10,
      is_admin: false,
    }));
    window.sessionStorage.setItem("lynk_user_verified_at", String(Date.now()));
    window.sessionStorage.setItem("lynk_modules:v4", JSON.stringify(modules));
  }, [{
    id: 14,
    name: "integrations",
    base_route: "/dashboard/settings/integrations",
    description: "Integrations",
    is_enabled: true,
    actions: fullActions,
  }]);
  await page.reload();
  await page.keyboard.press("Control+K");

  const palette = page.getByRole("dialog");
  await expect(palette.getByText("Configure integration", { exact: true })).toBeHidden();
  await expect(palette.getByText("Integrations", { exact: true })).toBeHidden();
  await expect(palette.getByText("Add user", { exact: true })).toBeHidden();
  await expect(palette.getByText("Create team", { exact: true })).toBeHidden();
  await expect(palette.getByText("Create department", { exact: true })).toBeHidden();
  await expect(palette.getByText("Create role", { exact: true })).toBeHidden();
});
