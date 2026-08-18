import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 2A: Quick Create and the record workspace rolled to Contact and Organization, plus the
 * contextual entry points that stop the CRM asking for context it already has.
 *
 * The layouts are stubbed to mirror the seeded system defaults so the spec exercises real
 * field wiring without depending on tenant layout state.
 */

const moduleCacheKey = "lynk_modules:v4";
const accountId = 987654500;
const contactId = 987654501;
const createdContactId = 987654502;
const createdDealId = 987654503;

function field(
  field_key: string,
  label: string,
  field_type: string,
  position: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    field_key,
    label,
    field_type,
    field_source: "system",
    position,
    width: "half",
    visible: true,
    required: false,
    readonly: false,
    ...overrides,
  };
}

function layout(module_key: string, surface: string, name: string, sections: unknown[]) {
  return {
    layout_id: null,
    module_key,
    surface,
    name,
    source: "system",
    version: 1,
    can_customize: false,
    warnings: [],
    sections,
  };
}

const contactQuickCreateLayout = layout("sales_contacts", "quick_create", "Contact Quick Create", [
  {
    id: "identity",
    label: "Contact",
    position: 0,
    region: "main",
    collapsed_by_default: false,
    fields: [
      field("first_name", "First name", "text", 0),
      field("last_name", "Last name", "text", 1),
      field("primary_email", "Email", "email", 2, { width: "full", required: true }),
      field("contact_telephone", "Phone", "phone", 3),
      field("current_title", "Job title", "text", 4),
    ],
  },
  {
    id: "account",
    label: "Account and ownership",
    position: 1,
    region: "main",
    collapsed_by_default: false,
    fields: [
      field("organization_id", "Account", "organization_reference", 0),
      field("assigned_to", "Owner", "user_reference", 1),
    ],
  },
]);

const contactDetailLayout = layout("sales_contacts", "detail", "Contact Details", [
  {
    id: "identity",
    label: "Contact",
    position: 0,
    region: "main",
    collapsed_by_default: false,
    fields: [
      field("primary_email", "Email", "email", 0, { readonly: true }),
      field("contact_telephone", "Phone", "phone", 1, { readonly: true }),
    ],
  },
]);

const organizationQuickCreateLayout = layout(
  "sales_organizations",
  "quick_create",
  "Account Quick Create",
  [
    {
      id: "account",
      label: "Account",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        field("org_name", "Account name", "text", 0, { width: "full", required: true }),
        field("primary_email", "Primary email", "email", 1, { width: "full", required: true }),
        field("primary_phone", "Primary phone", "phone", 2),
        field("website", "Website", "url", 3),
      ],
    },
  ],
);

const organizationDetailLayout = layout("sales_organizations", "detail", "Account Details", [
  {
    id: "account",
    label: "Account",
    position: 0,
    region: "main",
    collapsed_by_default: false,
    fields: [
      field("primary_email", "Primary email", "email", 0, { readonly: true }),
      field("industry", "Industry", "text", 1, { readonly: true }),
    ],
  },
]);

const dealQuickCreateLayout = layout("sales_opportunities", "quick_create", "Deal Quick Create", [
  {
    id: "deal",
    label: "Deal",
    position: 0,
    region: "main",
    collapsed_by_default: false,
    fields: [
      field("opportunity_name", "Deal name", "text", 0, { width: "full", required: true }),
      field("contact_id", "Contact", "contact_reference", 1, { required: true }),
      field("organization_id", "Account", "organization_reference", 2),
      field("sales_stage", "Stage", "select", 3),
      field("expected_close_date", "Expected close date", "date", 4),
    ],
  },
]);

const accountSummary = {
  organization: {
    org_id: accountId,
    org_name: "Rollout Account",
    primary_email: "ops@rollout.test",
    primary_phone: "+94770000100",
    industry: "Technology",
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  related_contacts: [],
  related_opportunities: [],
  related_quotes: [],
  related_orders: [],
  related_invoices: [],
  related_insertion_orders: [],
  inferred_services: [],
  contact_count: 0,
  opportunity_count: 0,
  quote_count: 0,
  order_count: 0,
  invoice_count: 0,
  insertion_order_count: 0,
};

const contactSummary = {
  contact: {
    contact_id: contactId,
    first_name: "Rollout",
    last_name: "Contact",
    primary_email: "rollout.contact@example.test",
    contact_telephone: "+94770000200",
    email_opt_out: false,
    organization_id: accountId,
    assigned_to_name: "Ada Owner",
    custom_fields: {},
    updated_at: "2099-07-20T09:30:00Z",
  },
  organization: { org_id: accountId, org_name: "Rollout Account" },
  related_opportunities: [],
  related_quotes: [],
  inferred_services: [],
  opportunity_count: 0,
  quote_count: 0,
};

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function listBody(results: Array<Record<string, unknown>>) {
  return {
    results,
    range_start: results.length ? 1 : 0,
    range_end: results.length,
    total_count: results.length,
    total_pages: 1,
    page: 1,
  };
}

/** Every module surface these journeys touch, with create permission on by default. */
function modulePermissions(overrides: Record<string, boolean> = {}) {
  return ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents"].map(
    (name, index) => ({
      id: 200 + index,
      name,
      is_enabled: true,
      actions: {
        can_view: true,
        can_create: overrides[name] ?? true,
        can_edit: true,
        can_delete: false,
        can_restore: false,
        can_export: false,
        can_configure: false,
      },
    }),
  );
}

async function stubModulePermissions(page: Page, overrides: Record<string, boolean> = {}) {
  const modules = modulePermissions(overrides);
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.addInitScript(
    ({ cacheKey, cachedModules }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules));
    },
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
}

async function stubSharedRoutes(page: Page) {
  await page.route("**/users/saved-views/**", (route) => route.fulfill(json({ views: [] })));
  await page.route("**/module-fields/**", (route) => route.fulfill(json([])));
  await page.route("**/custom-fields/**", (route) => route.fulfill(json([])));
  await page.route("**/record-layouts/sales_contacts/quick_create/resolved", (route) =>
    route.fulfill(json(contactQuickCreateLayout)),
  );
  await page.route("**/record-layouts/sales_contacts/detail/resolved", (route) =>
    route.fulfill(json(contactDetailLayout)),
  );
  await page.route("**/record-layouts/sales_organizations/quick_create/resolved", (route) =>
    route.fulfill(json(organizationQuickCreateLayout)),
  );
  await page.route("**/record-layouts/sales_organizations/detail/resolved", (route) =>
    route.fulfill(json(organizationDetailLayout)),
  );
  await page.route("**/record-layouts/sales_opportunities/quick_create/resolved", (route) =>
    route.fulfill(json(dealQuickCreateLayout)),
  );
  await page.route("**/linked-record-options/users?**", (route) =>
    route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }] })),
  );
  await page.route("**/sales/organizations/search/**", (route) =>
    route.fulfill(json({ results: [{ org_id: accountId, org_name: "Rollout Account" }] })),
  );
  await page.route("**/sales/contacts/search?**", (route) =>
    route.fulfill(
      json(
        listBody([
          {
            contact_id: contactId,
            first_name: "Rollout",
            last_name: "Contact",
            primary_email: "rollout.contact@example.test",
            organization_id: accountId,
            organization_name: "Rollout Account",
          },
        ]),
      ),
    ),
  );
  await page.route("**/message-templates?**", (route) => route.fulfill(json({ results: [] })));
  await page.route(`**/sales/organizations/${accountId}/summary`, (route) =>
    route.fulfill(json(accountSummary)),
  );
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) =>
    route.fulfill(json(contactSummary)),
  );
}

test.beforeEach(async ({ page }) => {
  await stubModulePermissions(page);
  await loginAsAdmin(page);
  await stubSharedRoutes(page);
});

test("creates a Contact from the list without losing the active search", async ({ page }) => {
  const searchRequests: string[] = [];
  let created = false;
  let createPayload: Record<string, unknown> | null = null;

  await page.route("**/sales/contacts?**", (route) => route.fulfill(json(listBody([]))));
  await page.route("**/sales/contacts/search?**", (route) => {
    const search = new URL(route.request().url()).searchParams.get("search") ?? "";
    searchRequests.push(search);
    return route.fulfill(
      json(
        listBody(
          created
            ? [{
              contact_id: createdContactId,
              first_name: "Quick",
              last_name: "Rollout",
              primary_email: "quick.rollout@example.test",
              organization_name: "Rollout Account",
            }]
            : [],
        ),
      ),
    );
  });
  await page.route("**/api/v1/sales/contacts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    created = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ contact_id: createdContactId }),
    });
  });

  await page.goto("/dashboard/sales/contacts");
  await page.getByPlaceholder("Search contacts").fill("Rollout");

  await page.getByRole("button", { name: "Create contact" }).click();
  const panel = page.getByRole("dialog", { name: "Create contact" });
  await expect(panel).toBeVisible();
  // The list is still behind the panel with its state intact.
  await expect(page.getByPlaceholder("Search contacts")).toHaveValue("Rollout");

  // Required-field recovery happens on the surface, without posting anything.
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText("Complete 1 required field to create this contact.")).toBeVisible();
  await expect(panel.getByLabel("Email")).toBeFocused();
  expect(createPayload).toBeNull();

  await panel.getByLabel("First name").fill("Quick");
  await panel.getByLabel("Last name").fill("Rollout");
  await panel.getByLabel("Email").fill("quick.rollout@example.test");
  await panel.getByRole("button", { name: "Create", exact: true }).click();

  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/sales\/contacts$/);
  await expect(page.getByPlaceholder("Search contacts")).toHaveValue("Rollout");
  expect(createPayload).toMatchObject({
    first_name: "Quick",
    last_name: "Rollout",
    primary_email: "quick.rollout@example.test",
  });
  expect(new Set(searchRequests)).toEqual(new Set(["Rollout"]));
});

test("creates an Account from the list and reports both required fields", async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null;
  await page.route("**/sales/organizations?**", (route) => route.fulfill(json(listBody([]))));
  await page.route("**/api/v1/sales/organizations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ org_id: accountId }),
    });
  });

  await page.goto("/dashboard/sales/organizations");
  await page.getByRole("button", { name: "Create account" }).click();
  const panel = page.getByRole("dialog", { name: "Create account" });
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText("Complete 2 required fields to create this account.")).toBeVisible();
  await expect(panel.getByLabel("Account name")).toBeFocused();

  await panel.getByLabel("Account name").fill("Rollout Account");
  await panel.getByLabel("Primary email").fill("not-an-email");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText("Enter a valid email address.")).toBeVisible();
  expect(createPayload).toBeNull();

  await panel.getByLabel("Primary email").fill("ops@rollout.test");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel).toBeHidden();
  expect(createPayload).toMatchObject({
    org_name: "Rollout Account",
    primary_email: "ops@rollout.test",
  });
});

test("Account workspace creates a Contact with the account already filled in", async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null;
  await page.route("**/api/v1/sales/contacts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ contact_id: createdContactId }),
    });
  });

  await page.goto(`/dashboard/sales/organizations/${accountId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Rollout Account");

  const trigger = page.getByRole("button", { name: "Contact", exact: true }).first();
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Create contact" });
  await expect(panel).toBeVisible();

  // The account came from the record, so it is shown filled in and not re-asked.
  const accountInput = panel.getByLabel("Account");
  await expect(accountInput).toHaveValue("Rollout Account");
  await expect(accountInput).toBeDisabled();

  await panel.getByLabel("First name").fill("Contextual");
  await panel.getByLabel("Email").fill("contextual@rollout.test");
  await panel.getByRole("button", { name: "Create", exact: true }).click();

  await expect(panel).toBeHidden();
  // The prefilled id travels with the payload; the server re-checks tenant and link permission.
  expect(createPayload).toMatchObject({
    first_name: "Contextual",
    primary_email: "contextual@rollout.test",
    organization_id: accountId,
  });
});

test("Contact workspace creates a Deal with the contact and account already filled in", async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null;
  await page.route("**/api/v1/sales/opportunities", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ opportunity_id: createdDealId }),
    });
  });

  await page.goto(`/dashboard/sales/contacts/${contactId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Rollout Contact");

  await page.getByRole("button", { name: "Deal", exact: true }).first().click();
  const panel = page.getByRole("dialog", { name: "Create deal" });
  await expect(panel).toBeVisible();

  // The required marker is part of the accessible name, so anchor rather than match exactly.
  const contactInput = panel.getByLabel(/^Contact/);
  await expect(contactInput).toHaveValue("Rollout Contact");
  await expect(contactInput).toBeDisabled();
  const accountInput = panel.getByLabel("Account", { exact: true });
  await expect(accountInput).toHaveValue("Rollout Account");
  await expect(accountInput).toBeDisabled();

  await panel.getByLabel("Deal name").fill("Rollout expansion");
  await panel.getByRole("button", { name: "Create", exact: true }).click();

  await expect(panel).toBeHidden();
  expect(createPayload).toMatchObject({
    opportunity_name: "Rollout expansion",
    contact_id: contactId,
    organization_id: accountId,
  });
});

test("hides create surfaces from a user without the matching create permission", async ({ page }) => {
  await stubModulePermissions(page, {
    sales_contacts: false,
    sales_organizations: false,
    sales_opportunities: false,
  });
  await page.route("**/sales/contacts?**", (route) => route.fulfill(json(listBody([]))));
  await page.route("**/sales/contacts/search?**", (route) => route.fulfill(json(listBody([]))));

  await page.goto("/dashboard/sales/contacts");
  await expect(page.getByRole("button", { name: "Create contact" })).toHaveCount(0);

  await page.goto(`/dashboard/sales/organizations/${accountId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Rollout Account");
  await expect(page.getByRole("button", { name: "Contact", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deal", exact: true })).toHaveCount(0);
});

test("renders the contextual Contact surface as a full-width sheet on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`/dashboard/sales/organizations/${accountId}`);
  await page.getByRole("button", { name: "Contact", exact: true }).first().click();

  const panel = page.getByRole("dialog", { name: "Create contact" });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox?.width).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 1);
  await expect(panel.getByRole("button", { name: "Create", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
