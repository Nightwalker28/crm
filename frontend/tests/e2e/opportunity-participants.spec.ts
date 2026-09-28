import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 2D: participant management on the deal — frontend Phase 2 of
 * `docs/crm-evolution/05-relationships-data-model.md`.
 *
 * The participant routes are stubbed over a small in-test store, so each write is visible only
 * because the page refetched the deal summary — the same contract the real server gives it.
 */

const moduleCacheKey = "lynk_modules:v4";
const dealId = 987654700;
const accountId = 987654701;
const graceId = 987654702;
const linusId = 987654703;
const createdContactId = 987654704;

type Participant = {
  id: number;
  opportunity_id: number;
  contact_id: number;
  role_key: string;
  role_label: string;
  is_primary: boolean;
  contact_name: string;
  contact: { contact_id: number; first_name: string; last_name: string; primary_email: string; current_title: string | null };
};

const roles = [
  { key: "decision_maker", label: "Decision maker" },
  { key: "champion", label: "Champion" },
  { key: "technical", label: "Technical" },
  { key: "other", label: "Other" },
];
const roleLabel = (key: string) => roles.find((role) => role.key === key)?.label ?? key;

function participant(id: number, contactId: number, first: string, last: string, roleKey: string, isPrimary: boolean): Participant {
  return {
    id,
    opportunity_id: dealId,
    contact_id: contactId,
    role_key: roleKey,
    role_label: roleLabel(roleKey),
    is_primary: isPrimary,
    contact_name: `${first} ${last}`,
    contact: { contact_id: contactId, first_name: first, last_name: last, primary_email: `${first.toLowerCase()}@example.test`, current_title: null },
  };
}

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function modulePermissions(opportunityActions: Record<string, boolean>) {
  return ["sales_contacts", "sales_organizations", "sales_opportunities", "tasks", "documents"].map((name, index) => ({
    id: 300 + index,
    name,
    is_enabled: true,
    actions: {
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: false,
      can_restore: false,
      can_export: false,
      can_configure: false,
      ...(name === "sales_opportunities" ? opportunityActions : {}),
    },
  }));
}

async function stubModulePermissions(page: Page, opportunityActions: Record<string, boolean>) {
  const modules = modulePermissions(opportunityActions);
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.addInitScript(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
}

/** The deal, its participants, and every participant route, over one mutable store. */
async function stubDeal(page: Page, initial: Participant[], options: { canViewContacts?: boolean } = {}) {
  const store = { participants: [...initial], removed: [] as Participant[], nextId: 900, requests: [] as string[] };

  await page.route("**/linked-record-options/users?**", (route) =>
    route.fulfill(json({ results: [{ id: 7, label: "Ada Owner", email: "ada@example.test" }], has_more: false })),
  );
  await page.route("**/record-layouts/**", (route) => route.fulfill(json({
    layout_id: null, module_key: "x", surface: "detail", name: "Details", source: "system", version: 1,
    can_customize: false, warnings: [], sections: [],
  })));
  await page.route(`**/sales/opportunities/${dealId}/summary`, (route) => {
    const primary = store.participants.find((item) => item.is_primary);
    return route.fulfill(json({
      opportunity: {
        opportunity_id: dealId, opportunity_name: "Participant Deal", sales_stage: "proposal",
        contact_id: primary?.contact_id ?? null, organization_id: accountId, organization_name: "Acme",
        assigned_to: 7, assigned_to_name: "Ada Owner", custom_fields: {},
      },
      contact: primary ? { ...primary.contact } : null,
      organization: { org_id: accountId, org_name: "Acme" },
      participant_contacts: options.canViewContacts === false ? [] : store.participants,
      can_view_contacts: options.canViewContacts !== false,
      related_quotes: [], related_insertion_orders: [], inferred_services: [], insertion_order_count: 0,
    }));
  });
  await page.route("**/sales/opportunities/participant-roles", (route) => route.fulfill(json({ results: roles })));
  await page.route("**/sales/contacts/search?**", (route) => route.fulfill(json({
    results: [{ contact_id: linusId, first_name: "Linus", last_name: "Tech", primary_email: "linus@example.test", organization_name: "Acme" }],
    range_start: 1, range_end: 1, total_count: 1, total_pages: 1, page: 1,
  })));

  const base = `**/api/v1/sales/opportunities/${dealId}/participants`;
  await page.route(base, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { contact_id: number; role_key: string | null; is_primary: boolean };
    store.requests.push(`POST ${JSON.stringify(body)}`);
    if (store.participants.some((item) => item.contact_id === body.contact_id)) {
      return route.fulfill(json({ detail: "That contact is already a participant on this deal." }, 409));
    }
    const names: Record<number, [string, string]> = { [linusId]: ["Linus", "Tech"], [createdContactId]: ["Nora", "New"] };
    const [first, last] = names[body.contact_id] ?? ["Someone", "Else"];
    if (body.is_primary) store.participants.forEach((item) => { item.is_primary = false; });
    const created = participant(store.nextId++, body.contact_id, first, last, body.role_key ?? "other", body.is_primary);
    store.participants.push(created);
    return route.fulfill(json(created, 201));
  });
  await page.route(`${base}/*/role`, async (route) => {
    const id = Number(route.request().url().split("/").at(-2));
    const { role_key } = route.request().postDataJSON() as { role_key: string };
    store.requests.push(`PATCH ${id} ${role_key}`);
    const target = store.participants.find((item) => item.id === id)!;
    Object.assign(target, { role_key, role_label: roleLabel(role_key) });
    return route.fulfill(json(target));
  });
  await page.route(`${base}/*/primary`, async (route) => {
    const id = Number(route.request().url().split("/").at(-2));
    store.requests.push(`PRIMARY ${id}`);
    store.participants.forEach((item) => { item.is_primary = item.id === id; });
    return route.fulfill(json(store.participants.find((item) => item.id === id)));
  });
  await page.route(`${base}/*/restore`, async (route) => {
    const id = Number(route.request().url().split("/").at(-2));
    store.requests.push(`RESTORE ${id}`);
    const target = store.removed.find((item) => item.id === id)!;
    store.removed = store.removed.filter((item) => item.id !== id);
    store.participants.push(target);
    return route.fulfill(json(target));
  });
  await page.route(`${base}/*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const id = Number(route.request().url().split("/").at(-1));
    store.requests.push(`DELETE ${id}`);
    const target = store.participants.find((item) => item.id === id)!;
    store.participants = store.participants.filter((item) => item.id !== id);
    store.removed.push(target);
    return route.fulfill(json(target));
  });
  return store;
}

async function openParticipants(page: Page) {
  await page.goto(`/dashboard/sales/opportunities/${dealId}?tab=related`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Participant Deal");
  return page.getByRole("list", { name: "Participants" });
}

const grace = () => participant(801, graceId, "Grace", "Buyer", "decision_maker", true);

test.describe("with full deal permissions", () => {
  // Each journey is several writes and refetches on one page, after a login; the default
  // 30s is sized for a single assertion against a warm route.
  test.slow();

  test.beforeEach(async ({ page }) => {
    await stubModulePermissions(page, { can_edit: true, can_delete: true, can_restore: true });
    await loginAsAdmin(page);
  });

  test("adds a participant with a role from the deal, and a duplicate says why in place", async ({ page }) => {
    const store = await stubDeal(page, [grace()]);
    const list = await openParticipants(page);
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByText("Decision maker · Primary contact")).toBeVisible();

    await page.getByRole("button", { name: "Participant", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Add participant" });
    await expect(panel).toBeVisible();

    // Submitting with no contact is caught before a request, next to the field.
    await panel.getByRole("button", { name: "Add participant", exact: true }).click();
    await expect(panel.getByText("Select a contact to add.")).toBeVisible();
    expect(store.requests).toHaveLength(0);

    await panel.getByRole("combobox", { name: "Contact", exact: true }).fill("Lin");
    await page.getByRole("option", { name: /Linus Tech/ }).click();
    await panel.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Technical" }).click();
    await panel.getByRole("button", { name: "Add participant", exact: true }).click();

    await expect(panel).toBeHidden();
    expect(store.requests[0]).toBe(`POST ${JSON.stringify({ contact_id: linusId, role_key: "technical", is_primary: false })}`);
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByText("Technical", { exact: true })).toBeVisible();

    // The same contact again: the server's sentence is shown, and the entries survive.
    await page.getByRole("button", { name: "Participant", exact: true }).click();
    await panel.getByRole("combobox", { name: "Contact", exact: true }).fill("Lin");
    await page.getByRole("option", { name: /Linus Tech/ }).click();
    await panel.getByRole("button", { name: "Add participant", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText("That contact is already a participant on this deal.");
    await expect(panel.getByRole("combobox", { name: "Contact", exact: true })).toHaveValue("Linus Tech");

    // Closing a panel holding an unsaved pick asks first.
    await panel.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(panel).toBeHidden();
  });

  test("changes a role, moves the primary contact, and removes with an undo", async ({ page }) => {
    const store = await stubDeal(page, [grace(), participant(802, linusId, "Linus", "Tech", "technical", false)]);
    const list = await openParticipants(page);

    // The primary cannot be removed until someone else is primary — said in the menu.
    await page.getByRole("button", { name: "Actions for Grace Buyer" }).click();
    await expect(page.getByRole("menuitem", { name: "Make someone else primary to remove" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menuitem", { name: "Make primary contact" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Actions for Linus Tech" }).click();
    await page.getByRole("menuitem", { name: "Change role" }).click();
    const panel = page.getByRole("dialog", { name: "Change role" });
    await panel.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Champion" }).click();
    await panel.getByRole("button", { name: "Save role" }).click();
    await expect(panel).toBeHidden();
    expect(store.requests).toContain("PATCH 802 champion");
    await expect(list.getByText("Champion", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Actions for Linus Tech" }).click();
    await page.getByRole("menuitem", { name: "Make primary contact" }).click();
    await expect(list.getByText("Champion · Primary contact")).toBeVisible();
    // The spine's Contact follows the primary, because it reads the same deal summary.
    await expect(page.getByRole("link", { name: /Linus Tech/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Actions for Grace Buyer" }).click();
    await page.getByRole("menuitem", { name: "Remove from deal" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    expect(store.requests).toContain("DELETE 801");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    expect(store.requests).toContain("RESTORE 801");
  });

  test("creates a contact in place and returns to the participant with it selected", async ({ page }) => {
    let contactPayload: Record<string, unknown> | null = null;
    const store = await stubDeal(page, []);
    await page.route("**/record-layouts/sales_contacts/quick_create/resolved", (route) => route.fulfill(json({
      layout_id: null, module_key: "sales_contacts", surface: "quick_create", name: "Contact Quick Create", source: "system",
      version: 1, can_customize: false, warnings: [],
      sections: [{
        id: "identity", label: "Contact", position: 0, region: "main", collapsed_by_default: false,
        fields: [
          { field_key: "first_name", label: "First name", field_type: "text", field_source: "system", position: 0, width: "half", visible: true, required: false, readonly: false },
          { field_key: "last_name", label: "Last name", field_type: "text", field_source: "system", position: 1, width: "half", visible: true, required: false, readonly: false },
          { field_key: "primary_email", label: "Email", field_type: "email", field_source: "system", position: 2, width: "full", visible: true, required: true, readonly: false },
          { field_key: "organization_id", label: "Account", field_type: "organization_reference", field_source: "system", position: 3, width: "half", visible: true, required: false, readonly: false },
        ],
      }],
    })));
    await page.route("**/module-fields/**", (route) => route.fulfill(json([])));
    await page.route("**/custom-fields/**", (route) => route.fulfill(json([])));
    await page.route("**/api/v1/sales/contacts", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      contactPayload = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill(json({ contact_id: createdContactId }, 201));
    });
    await page.route(`**/api/v1/sales/contacts/${createdContactId}`, (route) =>
      route.fulfill(json({ contact_id: createdContactId, first_name: "Nora", last_name: "New", primary_email: "nora@example.test" })),
    );

    await openParticipants(page);
    await expect(page.getByText("No contacts are involved in this deal yet. Add the people who decide, approve, or use it.")).toBeVisible();
    await page.getByRole("button", { name: "Participant", exact: true }).click();
    await page.getByRole("dialog", { name: "Add participant" }).getByRole("button", { name: "Create a contact" }).click();

    const quickCreate = page.getByRole("dialog", { name: "Create contact" });
    await expect(quickCreate.getByLabel("Account")).toHaveValue("Acme");
    await expect(quickCreate.getByLabel("Account")).toBeDisabled();
    await quickCreate.getByLabel("First name").fill("Nora");
    await quickCreate.getByLabel("Email").fill("nora@example.test");
    await quickCreate.getByRole("button", { name: "Create", exact: true }).click();
    expect(contactPayload).toMatchObject({ first_name: "Nora", organization_id: accountId });

    const panel = page.getByRole("dialog", { name: "Add participant" });
    await expect(panel.getByRole("combobox", { name: "Contact", exact: true })).toHaveValue("Nora New");
    // The first participant on a deal defaults to primary; the operator can still untick it.
    await expect(panel.getByRole("checkbox", { name: "Primary contact" })).toBeChecked();
    await panel.getByRole("button", { name: "Add participant", exact: true }).click();
    await expect(panel).toBeHidden();
    expect(store.requests[0]).toBe(`POST ${JSON.stringify({ contact_id: createdContactId, role_key: null, is_primary: true })}`);
  });
});

test("a reader without deal edit sees participants but no way to change them", async ({ page }) => {
  test.slow();
  await stubModulePermissions(page, { can_edit: false, can_delete: false, can_restore: false });
  await loginAsAdmin(page);
  await stubDeal(page, [grace()]);
  const list = await openParticipants(page);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Participant", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
});

test("a reader without Contacts access gets no participant panel at all", async ({ page }) => {
  test.slow();
  await stubModulePermissions(page, { can_edit: true, can_delete: true, can_restore: true });
  await loginAsAdmin(page);
  await stubDeal(page, [grace()], { canViewContacts: false });
  await page.goto(`/dashboard/sales/opportunities/${dealId}?tab=related`);
  await expect(page.locator("[data-record-workspace-title]")).toHaveText("Participant Deal");
  await expect(page.getByRole("heading", { name: "Insertion orders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Participants" })).toHaveCount(0);
});
