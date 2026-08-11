import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const moduleCacheKey = "lynk_modules:v4";
const existingLeadId = 987654400;
const createdLeadId = 987654401;
const createdLeadEmail = "quick.create@example.test";

/** Mirrors the seeded Lead quick_create layout so the spec exercises real field wiring. */
const quickCreateLayout = {
  layout_id: null,
  module_key: "sales_leads",
  surface: "quick_create",
  name: "Lead Quick Create",
  source: "system",
  version: 1,
  can_customize: false,
  warnings: [],
  sections: [
    {
      id: "contact",
      label: "Contact",
      position: 0,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "first_name", label: "First name", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
        { field_key: "last_name", label: "Last name", field_type: "text", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: false },
        { field_key: "company", label: "Company", field_type: "text", field_source: "system", position: 2, width: "full", visible: true, required: false, readonly: false },
        { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 3, width: "full", visible: true, required: true, readonly: false },
        { field_key: "phone", label: "Phone", field_type: "phone", field_source: "system", position: 4, width: "half", visible: true, required: false, readonly: false },
      ],
    },
    {
      id: "qualification",
      label: "Qualification",
      position: 1,
      region: "main",
      collapsed_by_default: false,
      fields: [
        { field_key: "status", label: "Status", field_type: "select", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
        { field_key: "assigned_to", label: "Owner", field_type: "user_reference", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: false },
        { field_key: "custom:renewal_tier", label: "Renewal tier", field_type: "text", field_source: "custom_field", position: 2, width: "full", visible: true, required: false, readonly: false },
      ],
    },
  ],
};

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: existingLeadId,
    first_name: "Existing",
    last_name: "Baseline",
    company: "Lynk QA",
    primary_email: "existing.baseline@example.test",
    phone: null,
    title: null,
    source: null,
    status: "new",
    assigned_to: 7,
    assigned_to_name: "Ada Owner",
    created_time: "2099-07-20T09:30:00Z",
    tags: [],
    custom_fields: {},
    ...overrides,
  };
}

function listBody(results: Array<Record<string, unknown>>) {
  return JSON.stringify({
    results,
    range_start: results.length ? 1 : 0,
    range_end: results.length,
    total_count: results.length,
    total_pages: 1,
    page: 1,
  });
}

async function stubLeadsList(page: Page) {
  await page.route("**/users/saved-views/sales_leads?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ views: [] }) }),
  );
  await page.route("**/module-fields/sales_leads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route("**/custom-fields/sales_leads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
  );
  await page.route("**/record-layouts/sales_leads/quick_create/resolved", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quickCreateLayout) }),
  );
  await page.route("**/linked-record-options/users?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }] }),
    }),
  );
  await page.route("**/sales/leads?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: listBody([leadRow()]) }),
  );
}

/**
 * `useAccessibleModules` reads its sessionStorage cache first and then revalidates, so both
 * have to agree or the signed-in admin's real permissions win the race.
 */
async function stubLeadModulePermissions(page: Page, canCreate: boolean) {
  const modules = [{
    id: 101,
    name: "sales_leads",
    is_enabled: true,
    actions: {
      can_view: true,
      can_create: canCreate,
      can_edit: true,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  }];
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modules) }),
  );
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
}

function quickCreatePanel(page: Page) {
  return page.getByRole("dialog", { name: "Create lead" });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await stubLeadsList(page);
});

test("creates a Lead from the list without losing search, filter, or view context", async ({ page }) => {
  const searchRequests: string[] = [];
  let createPayload: Record<string, unknown> | null = null;
  let leadWasCreated = false;

  await page.route("**/sales/leads/search?**", (route) => {
    const search = new URL(route.request().url()).searchParams.get("search") ?? "";
    searchRequests.push(search);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: listBody(
        leadWasCreated
          ? [leadRow({ lead_id: createdLeadId, first_name: "Quick", last_name: "Baseline", primary_email: createdLeadEmail }), leadRow()]
          : [leadRow()],
      ),
    });
  });
  await page.route("**/api/v1/sales/leads", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createPayload = route.request().postDataJSON() as Record<string, unknown>;
    leadWasCreated = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ lead_id: createdLeadId }),
    });
  });

  await page.goto("/dashboard/sales/leads");
  await page.getByPlaceholder("Search leads").fill("Baseline");
  await expect(page.getByText("Existing Baseline", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create lead" }).click();
  const panel = quickCreatePanel(page);
  await expect(panel).toBeVisible();
  // The list is still behind the panel with its state intact.
  await expect(page.getByPlaceholder("Search leads")).toHaveValue("Baseline");

  await panel.getByLabel("First name").fill("Quick");
  await panel.getByLabel("Last name").fill("Baseline");
  await panel.getByLabel("Email").fill(createdLeadEmail);
  // A custom field placed on the layout participates in the same create payload.
  await panel.getByLabel("Renewal tier").fill("Gold");
  await panel.getByRole("button", { name: "Create", exact: true }).click();

  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/sales\/leads$/);
  await expect(page.getByPlaceholder("Search leads")).toHaveValue("Baseline");
  await expect(page.getByText("Quick Baseline", { exact: true })).toBeVisible();
  // Every refetch kept the active search term, including the one triggered by the create.
  expect(new Set(searchRequests)).toEqual(new Set(["Baseline"]));
  expect(createPayload).toMatchObject({
    first_name: "Quick",
    last_name: "Baseline",
    primary_email: createdLeadEmail,
    status: "new",
    custom_fields: { renewal_tier: "Gold" },
  });
});

test("Create & open opens the new Lead record", async ({ page }) => {
  await page.route("**/api/v1/sales/leads", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ lead_id: createdLeadId }),
    });
  });
  await page.route(`**/sales/leads/${createdLeadId}/summary`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lead: {
          lead_id: createdLeadId,
          first_name: "Quick",
          last_name: "Opened",
          company: "Lynk QA",
          primary_email: createdLeadEmail,
          status: "new",
          tags: [],
          custom_fields: {},
        },
      }),
    }),
  );

  await page.goto("/dashboard/sales/leads");
  await page.getByRole("button", { name: "Create lead" }).click();
  const panel = quickCreatePanel(page);
  await panel.getByLabel("First name").fill("Quick");
  await panel.getByLabel("Last name").fill("Opened");
  await panel.getByLabel("Email").fill(createdLeadEmail);
  await panel.getByRole("button", { name: "Create & open" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/sales/leads/${createdLeadId}$`));
  await expect(page.getByRole("heading", { name: "Quick Opened" })).toBeVisible();
});

test("recovers from validation and duplicate responses without losing entered data", async ({ page }) => {
  let createAttempts = 0;
  await page.route("**/api/v1/sales/leads", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createAttempts += 1;
    if (createAttempts === 1) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: `${createdLeadEmail} already exists. Resend with replace_duplicates=true to overwrite, skip_duplicates=true to leave the existing lead unchanged, or create_new_records=true to add a new lead with the same email.`,
        }),
      });
    }
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ lead_id: createdLeadId }),
    });
  });

  await page.goto("/dashboard/sales/leads");
  await page.getByRole("button", { name: "Create lead" }).click();
  const panel = quickCreatePanel(page);

  // 1. Nothing entered: the required field is reported and focused, and nothing is posted.
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText("Complete 1 required field to create this lead.")).toBeVisible();
  await expect(panel.getByText("Email is required.")).toBeVisible();
  await expect(panel.getByLabel("Email")).toBeFocused();
  expect(createAttempts).toBe(0);

  // 2. A malformed address is caught with the same rule the full form uses.
  await panel.getByLabel("First name").fill("Quick");
  await panel.getByLabel("Email").fill("not-an-email");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText("Enter a valid email address.")).toBeVisible();
  expect(createAttempts).toBe(0);

  // 3. The backend's duplicate detail is shown verbatim and the entered data survives it.
  await panel.getByLabel("Email").fill(createdLeadEmail);
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByText(/already exists/)).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("First name")).toHaveValue("Quick");
  await expect(panel.getByLabel("Email")).toBeFocused();

  // 4. Retrying after the fix succeeds from the same surface.
  await panel.getByLabel("Email").fill("resolved.duplicate@example.test");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel).toBeHidden();
  expect(createAttempts).toBe(2);
});

test("More details continues on the canonical create route with the entered values", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  await page.getByRole("button", { name: "Create lead" }).click();
  const panel = quickCreatePanel(page);
  await panel.getByLabel("First name").fill("Handed");
  await panel.getByLabel("Last name").fill("Over");
  await panel.getByLabel("Email").fill(createdLeadEmail);
  await panel.getByLabel("Company").fill("Lynk QA");
  await panel.getByRole("button", { name: "More details" }).click();

  await expect(page).toHaveURL(/\/dashboard\/sales\/leads\/new\?draft=quick-create$/);
  await expect(page.getByRole("heading", { name: "Create lead" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(createdLeadEmail);
  await expect(page.getByRole("group").filter({ hasText: "First name" }).getByRole("textbox")).toHaveValue("Handed");
  await expect(page.getByRole("group").filter({ hasText: "Company" }).getByRole("textbox")).toHaveValue("Lynk QA");
  // Restored values count as unsaved work, so the page guards them.
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();

  // The draft is consumed once: a later visit to the canonical route starts clean.
  await page.goto("/dashboard/sales/leads/new?draft=quick-create");
  await expect(page.getByLabel("Email")).toHaveValue("");
});

test("closing with unsaved data asks before discarding and restores focus", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  const trigger = page.getByRole("button", { name: "Create lead" });
  await trigger.click();
  const panel = quickCreatePanel(page);
  await panel.getByLabel("First name").fill("Unsaved");

  await page.keyboard.press("Escape");
  const discardDialog = page.getByRole("dialog", { name: "Discard this lead?" });
  await expect(discardDialog).toBeVisible();

  // Backing out of the prompt keeps the surface and everything typed into it.
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("First name")).toHaveValue("Unsaved");

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard this lead?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // Reopening starts from a clean form rather than resurrecting the discarded draft.
  await trigger.click();
  await expect(quickCreatePanel(page).getByLabel("First name")).toHaveValue("");
});

test("hides Quick Create from a user without lead create permission", async ({ page }) => {
  await page.goto("/dashboard/sales/leads");
  await stubLeadModulePermissions(page, false);
  await page.reload();

  await expect(page.getByText("Existing Baseline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create lead" })).toHaveCount(0);
});

test("renders Quick Create as a full-width sheet on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/dashboard/sales/leads");
  await page.getByRole("button", { name: "Create lead" }).click();

  const panel = quickCreatePanel(page);
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox?.width).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 1);
  expect(panelBox?.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
  await expect(panel.getByRole("button", { name: "Create", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
