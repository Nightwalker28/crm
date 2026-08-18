import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

const contractId = 7123;
const moduleCacheKey = "lynk_modules:v4";

function contractFixture() {
  return {
    id: contractId,
    tenant_id: 1,
    contract_number: "CTR-2407-001",
    title: "Annual services agreement",
    status: "draft",
    organization_id: null,
    contact_id: null,
    opportunity_id: null,
    quote_id: null,
    order_id: null,
    document_id: null,
    effective_date: "2099-07-24",
    expiration_date: "2100-07-23",
    renewal_date: "2100-06-23",
    value_amount: "12000.00",
    currency: "USD",
    owner_id: null,
    created_by_id: 1,
    created_at: "2099-07-24T08:00:00Z",
    updated_at: "2099-07-24T09:00:00Z",
    parties: [],
    signers: [],
    events: [],
  };
}

function populatedContractFixture() {
  return {
    ...contractFixture(),
    parties: [{
      id: 81,
      contract_id: contractId,
      name: "Northwind Operations",
      email: "operations@northwind.test",
      role: "counterparty",
      created_at: "2099-07-24T08:10:00Z",
    }],
    signers: [{
      id: 91,
      contract_id: contractId,
      party_id: 81,
      name: "Alex Morgan",
      email: "alex@northwind.test",
      signing_order: 1,
      status: "pending",
      signed_at: null,
      created_at: "2099-07-24T08:20:00Z",
    }],
    events: [{
      id: 101,
      contract_id: contractId,
      event_type: "contract_created",
      payload_json: {},
      created_by_id: 1,
      created_at: "2099-07-24T08:00:00Z",
    }],
  };
}

async function cacheContractPermissions(
  page: Parameters<typeof loginAsAdmin>[0],
  canEdit: boolean,
  overrides: Partial<{
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_restore: boolean;
    can_export: boolean;
    can_configure: boolean;
  }> = {},
) {
  await page.evaluate(
    ({ cacheKey, editAllowed, moduleOverrides }) => {
      window.sessionStorage.setItem(cacheKey, JSON.stringify([{
        id: 71,
        name: "contracts",
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: true,
          can_edit: editAllowed,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
          ...moduleOverrides,
        },
      }]));
    },
    { cacheKey: moduleCacheKey, editAllowed: canEdit, moduleOverrides: overrides },
  );

  // useAccessibleModules revalidates from the API and overwrites the seeded cache, so the
  // stub has to agree with it or the real admin permissions win.
  await page.route("**/api/v1/users/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 71,
        name: "contracts",
        is_enabled: true,
        actions: {
          can_view: true,
          can_create: true,
          can_edit: canEdit,
          can_delete: false,
          can_restore: false,
          can_export: false,
          can_configure: false,
          ...overrides,
        },
      }]),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route("**/module-fields/contracts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { module_key: "contracts", field_key: "title", label: "Title", field_source: "system", is_enabled: true, is_protected: true, sort_order: 1 },
        { module_key: "contracts", field_key: "status", label: "Status", field_source: "system", is_enabled: true, is_protected: false, sort_order: 2 },
        { module_key: "contracts", field_key: "value_amount", label: "Value", field_source: "system", is_enabled: true, is_protected: false, sort_order: 3 },
        { module_key: "contracts", field_key: "currency", label: "Currency", field_source: "system", is_enabled: false, is_protected: false, sort_order: 4 },
      ]),
    }),
  );
});

test("Contract creation is responsive and focuses the first invalid field", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/contracts/new");

  await expect(page.getByRole("heading", { name: "Create contract" })).toBeVisible();
  await expect(page.getByLabel("Currency")).toHaveCount(0);
  await page.getByRole("button", { name: "Create contract" }).click();
  await expect(page.getByText("Title is required.")).toBeVisible();
  await expect(page.getByLabel("Title")).toBeFocused();
});

test("Contract creation omits disabled fields and opens the created record", async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;
  await page.route("**/api/v1/contracts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: contractId }),
    });
  });

  await page.goto("/dashboard/contracts/new");
  await page.getByLabel("Title").fill("Annual services agreement");
  await page.getByRole("button", { name: "Create contract" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/contracts/${contractId}$`));
  expect(submittedPayload).toMatchObject({ title: "Annual services agreement", status: "draft" });
  expect(submittedPayload).not.toHaveProperty("currency");
});

test("Contract detail and edit share a routed record workflow", async ({ page }) => {
  await cacheContractPermissions(page, true);
  let contract = contractFixture();
  let updatedPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/contracts/${contractId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      updatedPayload = route.request().postDataJSON() as Record<string, unknown>;
      contract = { ...contract, ...updatedPayload, updated_at: "2099-07-24T10:00:00Z" };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contract),
    });
  });

  await page.goto(`/dashboard/contracts/${contractId}`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("CTR-2407-001");
  await page.getByRole("link", { name: "Edit", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/contracts/${contractId}/edit$`));
  await expect(page.getByRole("heading", { name: "Edit CTR-2407-001" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByLabel("Title").fill("Renewed services agreement");
  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/contracts/${contractId}$`));
  expect(updatedPayload).toMatchObject({ title: "Renewed services agreement", status: "draft" });
  expect(updatedPayload).not.toHaveProperty("currency");
});

test("Contract detail confirms lifecycle changes and keeps the mobile workflow accessible", async ({ page }) => {
  await cacheContractPermissions(page, true);
  let contract = populatedContractFixture();
  let updatedPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/contracts/${contractId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      updatedPayload = route.request().postDataJSON() as Record<string, unknown>;
      contract = { ...contract, ...updatedPayload, updated_at: "2099-07-24T10:00:00Z" };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contract),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/contracts/${contractId}`);

  // Parties and signers are related objects, so 5.3 moved them out of a stack of cards and
  // into the archetype's one module tab. Status stayed in the spine, where every state field is.
  await page.getByRole("tab", { name: "Signing" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/contracts/${contractId}\\?tab=signing$`));
  await expect(page.getByLabel("Name").first()).toBeVisible();
  await expect(page.getByLabel("Email").first()).toBeVisible();
  await expect(page.getByText("Northwind Operations")).toBeVisible();
  await expect(page.getByText("Alex Morgan")).toBeVisible();

  await page.getByRole("combobox", { name: "Status", exact: true }).first().click();
  await page.getByRole("option", { name: "Review" }).click();

  await expect(page.getByText("Move CTR-2407-001 from Draft to Review? This change is recorded in the contract's history.")).toBeVisible();
  await page.getByRole("button", { name: "Change status" }).click();
  await expect.poll(() => updatedPayload).toEqual({ status: "review" });
  await expect(page.locator('[data-slot="save-state-indicator"][data-state="saved"]')).toBeVisible();
});

test("Contract detail is read-only without edit permission", async ({ page }) => {
  await cacheContractPermissions(page, false);
  await page.route(`**/api/v1/contracts/${contractId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(populatedContractFixture()),
    });
  });

  await page.goto(`/dashboard/contracts/${contractId}?tab=signing`);

  await expect(page.locator("[data-record-workspace-title]")).toHaveText("CTR-2407-001");
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add party" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add signer" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveCount(0);
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
});

test("The contract spine links related records by name, not by id", async ({ page }) => {
  await cacheContractPermissions(page, false);
  await page.route(`**/api/v1/contracts/${contractId}`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...contractFixture(),
        contact_id: 41,
        contact_name: "Grace Buyer",
        organization_id: 51,
        organization_name: "Northwind",
        opportunity_id: 61,
        opportunity_name: "Northwind renewal",
        owner_id: 7,
        owner_name: "Ada Owner",
      }),
    }),
  );

  await page.goto(`/dashboard/contracts/${contractId}`);

  await expect(page.getByRole("link", { name: "Grace Buyer" })).toHaveAttribute("href", "/dashboard/sales/contacts/41");
  await expect(page.getByRole("link", { name: "Northwind", exact: true })).toHaveAttribute("href", "/dashboard/sales/organizations/51");
  await expect(page.getByRole("link", { name: "Northwind renewal" })).toHaveAttribute("href", "/dashboard/sales/opportunities/61");
  await expect(page.getByText("Ada Owner")).toBeVisible();
  // A link with no target is not a broken link — the relationship simply has no value yet.
  await expect(page.getByRole("link", { name: /Quote #/ })).toHaveCount(0);
});

test("Contract list uses permission-aware identity links and filtered empty states", async ({ page }) => {
  await cacheContractPermissions(page, false, { can_create: false });
  await page.route("**/contracts?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [contractFixture()],
        range_start: 1,
        range_end: 1,
        total_count: 1,
        total_pages: 1,
        page: 1,
      }),
    }),
  );
  await page.route("**/contracts/search?**", (route) =>
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
      }),
    }),
  );

  await page.goto("/dashboard/contracts");
  await expect(page.getByRole("link", { name: "CTR-2407-001" })).toHaveAttribute("href", `/dashboard/contracts/${contractId}`);
  await expect(page.getByRole("link", { name: "New Contract" })).toHaveCount(0);

  await page.getByPlaceholder("Search contracts").fill("missing");
  await expect(page.getByText("No contracts match this view")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: "CTR-2407-001" })).toBeVisible();
});

test("Contract list failures use fixed recoverable guidance", async ({ page }) => {
  await cacheContractPermissions(page, false);
  await page.route("**/contracts?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "tenant_id=42 database_password=private-secret" }),
    }),
  );

  await page.goto("/dashboard/contracts");

  await expect(page.getByText("Contracts could not be loaded")).toBeVisible();
  await expect(page.getByText("Check your connection and try again.")).toBeVisible();
  await expect(page.getByText("tenant_id=42 database_password=private-secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
