import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * 05 frontend Phase 4: the relationship rail on Contact and Account.
 *
 * What is under test is what the page does with the summary the backend already filters
 * (05 backend Phase 4): a contact's deals carry its role on each, a contact has orders, a
 * section the reader may not view is left out everywhere rather than drawn as "none", a true
 * total larger than the rows says so, and the create action is offered only where allowed.
 */

const contactId = 987655301;
const orgId = 987655401;
const moduleCacheKey = "lynk_modules:v4";

type Access = Partial<Record<"contacts" | "opportunities" | "quotes" | "orders" | "invoices" | "insertion_orders", boolean>>;

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function contactSummary(access: Access, { withRecords }: { withRecords: boolean }) {
  const orders = withRecords
    ? Array.from({ length: 8 }, (_, index) => ({
        id: 7100 + index,
        order_number: `SO-${7100 + index}`,
        status: "confirmed",
        currency: "USD",
        grand_total: "1200.00",
        updated_at: "2099-07-20T09:30:00Z",
      }))
    : [];
  return {
    contact: {
      contact_id: contactId,
      first_name: "Grace",
      last_name: "Hopper",
      primary_email: "grace@acme.test",
      organization_id: orgId,
      assigned_to: 7,
      assigned_to_name: "Ada Owner",
      custom_fields: {},
      updated_at: "2099-07-20T09:30:00Z",
    },
    organization: { org_id: orgId, org_name: "Acme Robotics" },
    related_access: access,
    related_opportunities: withRecords
      ? [
          {
            opportunity_id: 6101,
            opportunity_name: "Acme platform renewal",
            sales_stage: "proposal",
            contact_role_key: "decision_maker",
            contact_role_label: "Decision maker",
            is_primary_contact: true,
          },
          {
            opportunity_id: 6102,
            opportunity_name: "Acme analytics add-on",
            sales_stage: "discovery",
            contact_role_key: "finance",
            contact_role_label: "Finance",
            is_primary_contact: false,
          },
        ]
      : [],
    related_quotes: [],
    related_orders: access.orders === false ? [] : orders,
    related_insertion_orders: [],
    inferred_services: [],
    opportunity_count: withRecords ? 2 : 0,
    quote_count: 0,
    order_count: access.orders === false ? 0 : withRecords ? 12 : 0,
    insertion_order_count: 0,
  };
}

function accountSummary(access: Access) {
  return {
    organization: {
      org_id: orgId,
      org_name: "Acme Robotics",
      primary_email: null,
      assigned_to: 7,
      assigned_to_name: "Ada Owner",
      custom_fields: {},
      updated_at: "2099-07-20T09:30:00Z",
    },
    related_access: access,
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
}

async function stubShared(page: Page, { canCreateDeals }: { canCreateDeals: boolean }) {
  const modules = ["sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes", "sales_orders", "tasks", "documents"].map((name, index) => ({
    id: 600 + index,
    name,
    is_enabled: true,
    actions: {
      can_view: true,
      can_create: name === "sales_opportunities" ? canCreateDeals : true,
      can_edit: true,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
    },
  }));
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.evaluate(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
  await page.route("**/record-layouts/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "none" }) }));
  await page.route("**/linked-record-options/users?**", (route) => route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }], has_more: false })));
  await page.route("**/tasks?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/documents?**", (route) => route.fulfill(json({ results: [], total: 0 })));
  await page.route("**/records/*/*/activity?**", (route) => route.fulfill(json({ items: [], next_cursor: null, has_more: false, limit: 20, available_types: [], omitted_types: [] })));
}

function spine(page: Page) {
  return page.locator("[data-slot='record-spine-collection']");
}

function relatedCard(page: Page, title: string) {
  return page.locator("[data-slot='card']").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("A contact's deals carry its role, and its orders show a true total", async ({ page }) => {
  await stubShared(page, { canCreateDeals: true });
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) =>
    route.fulfill(json(contactSummary({ opportunities: true, quotes: true, orders: true, insertion_orders: true }, { withRecords: true }))),
  );
  await page.goto(`/dashboard/sales/contacts/${contactId}?tab=related`);

  const deals = relatedCard(page, "Deals");
  await expect(deals.getByRole("link", { name: /Acme platform renewal/ })).toContainText("Decision maker · Primary contact");
  await expect(deals.getByRole("link", { name: /Acme analytics add-on/ })).toContainText("Finance");
  await expect(deals.getByRole("link", { name: /Acme analytics add-on/ })).not.toContainText("Primary contact");
  // Two deals and a total of two: no "most recent" line.
  await expect(deals.getByText(/most recent/)).toHaveCount(0);

  const orders = relatedCard(page, "Orders");
  await expect(orders.getByRole("link")).toHaveCount(8);
  await expect(orders.getByText("Showing the 8 most recent of 12.")).toBeVisible();
  await expect(spine(page).filter({ hasText: /^Orders/ })).toContainText("12");
  await expect(spine(page).filter({ hasText: /^Insertion orders/ })).toContainText("0");
});

test("A hidden section is left out; an empty one says none and offers the create", async ({ page }) => {
  await stubShared(page, { canCreateDeals: true });
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) =>
    route.fulfill(json(contactSummary({ opportunities: true, quotes: false, orders: false, insertion_orders: false }, { withRecords: false }))),
  );
  await page.goto(`/dashboard/sales/contacts/${contactId}?tab=related`);

  const deals = relatedCard(page, "Deals");
  await expect(deals.getByText("This contact is on no deals yet. Add the first one")).toBeVisible();
  await expect(deals.getByRole("button", { name: "Deal" })).toBeVisible();
  // Hidden: no card, no spine count, not even a zero.
  for (const title of ["Quotes", "Orders", "Insertion orders"]) {
    await expect(relatedCard(page, title)).toHaveCount(0);
    await expect(spine(page).filter({ hasText: new RegExp(`^${title}`) })).toHaveCount(0);
  }
  await expect(spine(page).filter({ hasText: /^Deals/ })).toContainText("0");
});

test("Without the create right, the empty deal list offers no create", async ({ page }) => {
  await stubShared(page, { canCreateDeals: false });
  await page.route(`**/sales/contacts/${contactId}/summary`, (route) =>
    route.fulfill(json(contactSummary({ opportunities: true, quotes: true, orders: true, insertion_orders: true }, { withRecords: false }))),
  );
  await page.goto(`/dashboard/sales/contacts/${contactId}?tab=related`);

  const deals = relatedCard(page, "Deals");
  await expect(deals.getByText("This contact is on no deals yet.", { exact: true })).toBeVisible();
  await expect(deals.getByRole("button", { name: "Deal" })).toHaveCount(0);
  await expect(page.locator("[data-record-workspace-actions]").getByRole("button", { name: "Deal" })).toHaveCount(0);
  await expect(relatedCard(page, "Orders").getByText("No orders for this contact yet.")).toBeVisible();
});

test("An account follows the server's access: hidden contacts are left out", async ({ page }) => {
  await stubShared(page, { canCreateDeals: true });
  await page.route(`**/sales/organizations/${orgId}/summary`, (route) =>
    route.fulfill(json(accountSummary({ contacts: false, opportunities: true, quotes: true, orders: true, invoices: false, insertion_orders: false }))),
  );
  await page.goto(`/dashboard/sales/organizations/${orgId}?tab=related`);

  await expect(relatedCard(page, "Deals").getByText("No deals with this account yet. Add the first one")).toBeVisible();
  await expect(relatedCard(page, "Deals").getByRole("button", { name: "Deal" })).toBeVisible();
  await expect(relatedCard(page, "Quotes").getByText("No quotes for this account yet.")).toBeVisible();
  for (const title of ["Contacts", "Invoices", "Insertion orders"]) {
    await expect(relatedCard(page, title)).toHaveCount(0);
    await expect(spine(page).filter({ hasText: new RegExp(`^${title}`) })).toHaveCount(0);
  }
});
