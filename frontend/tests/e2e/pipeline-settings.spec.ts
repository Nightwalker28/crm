import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 2E: the deal pipeline's settings page — frontend Phase 2 of
 * `docs/crm-evolution/04-pipelines-kanban.md`.
 *
 * The pipeline routes are stubbed over an in-test store, so a change shows on the page only
 * because the page applied the server's answer.
 */

const moduleCacheKey = "lynk_modules:v4";

type Stage = { id: number; key: string; label: string; position: number; semantic_type: string; is_closed: boolean; probability: number; is_active: boolean };

const seed = (): Stage[] => [
  ["lead", "Lead", "open", 10],
  ["qualified", "Qualified", "ongoing", 25],
  ["proposal", "Proposal", "ongoing", 50],
  ["negotiation", "Negotiation", "ongoing", 75],
  ["closed_won", "Closed won", "won", 100],
  ["closed_lost", "Closed lost", "lost", 0],
].map(([key, label, semantic_type, probability], position) => ({
  id: 700 + position,
  key: String(key),
  label: String(label),
  position,
  semantic_type: String(semantic_type),
  is_closed: semantic_type === "won" || semantic_type === "lost",
  probability: Number(probability),
  is_active: true,
}));

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function stubModules(page: Page, canConfigure: boolean) {
  const modules = ["sales_contacts", "sales_organizations", "sales_opportunities"].map((name, index) => ({
    id: 400 + index,
    name,
    is_enabled: true,
    actions: {
      can_view: true, can_create: true, can_edit: true, can_delete: true, can_restore: true, can_export: true,
      can_configure: name === "sales_opportunities" ? canConfigure : false,
    },
  }));
  await page.route("**/api/v1/users/me/modules", (route) => route.fulfill(json(modules)));
  await page.addInitScript(
    ({ cacheKey, cachedModules }) => window.sessionStorage.setItem(cacheKey, JSON.stringify(cachedModules)),
    { cacheKey: moduleCacheKey, cachedModules: modules },
  );
}

async function stubPipeline(page: Page) {
  const store = { stages: seed(), requests: [] as string[] };
  const pipeline = () => ({
    id: 70, module_key: "sales_opportunities", name: "Sales pipeline", is_default: true, is_active: true,
    stages: [...store.stages].sort((a, b) => a.position - b.position),
  });

  await page.route("**/api/v1/sales/opportunities/pipeline", (route) => route.fulfill(json(pipeline())));
  await page.route("**/api/v1/sales/opportunities/pipeline/stage-usage", (route) => route.fulfill(json({
    pipeline_id: 70,
    stages: store.stages.map((stage) => ({ stage_id: stage.id, live_deal_count: stage.key === "negotiation" ? 3 : 0 })),
  })));
  await page.route("**/api/v1/sales/opportunities/pipeline/stages/*", (route) => {
    const id = Number(route.request().url().split("/").at(-1));
    const change = route.request().postDataJSON() as Partial<Stage>;
    store.requests.push(`PATCH ${id} ${JSON.stringify(change)}`);
    if (change.label && store.stages.some((stage) => stage.id !== id && stage.label.toLowerCase() === change.label!.toLowerCase())) {
      return route.fulfill(json({ detail: "Another stage in this pipeline already has that name" }, 400));
    }
    Object.assign(store.stages.find((stage) => stage.id === id)!, change);
    return route.fulfill(json(pipeline()));
  });
  await page.route("**/api/v1/sales/opportunities/pipeline/stages", (route) => {
    const body = route.request().postDataJSON() as { label: string; semantic_type: string };
    store.requests.push(`POST ${JSON.stringify(body)}`);
    if (store.stages.some((stage) => stage.label.toLowerCase() === body.label.toLowerCase())) {
      return route.fulfill(json({ detail: "Another stage in this pipeline already has that name" }, 400));
    }
    const closedAt = [...store.stages].sort((a, b) => a.position - b.position).find((stage) => stage.is_closed)?.position ?? store.stages.length;
    store.stages.forEach((stage) => { if (stage.position >= closedAt) stage.position += 1; });
    store.stages.push({
      id: 800, key: body.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: body.label, position: closedAt,
      semantic_type: body.semantic_type, is_closed: false, probability: 50, is_active: true,
    });
    return route.fulfill(json(pipeline(), 201));
  });
  await page.route("**/api/v1/sales/opportunities/pipeline/stage-order", (route) => {
    const { stage_ids } = route.request().postDataJSON() as { stage_ids: number[] };
    store.requests.push(`PUT ${stage_ids.join(",")}`);
    stage_ids.forEach((id, position) => { store.stages.find((stage) => stage.id === id)!.position = position; });
    return route.fulfill(json(pipeline()));
  });
  return store;
}

test.describe("with configure on deals", () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    await stubModules(page, true);
    await loginAsAdmin(page);
  });

  test("renames a stage on blur and reports it beside the row", async ({ page }) => {
    const store = await stubPipeline(page);
    await page.goto("/dashboard/settings/pipeline");
    await expect(page.getByRole("heading", { name: "Deal pipeline" })).toBeVisible();

    const row = page.getByTestId("pipeline-stage-proposal");
    await expect(row.getByText("Key proposal")).toBeVisible();
    const name = row.getByRole("textbox", { name: "Proposal name" });
    await name.fill("Pricing");
    await name.press("Enter");
    await expect(row.getByText("Saved")).toBeVisible();
    expect(store.requests).toContain(`PATCH 702 {"label":"Pricing"}`);
    await expect(row.getByRole("textbox", { name: "Pricing name" })).toHaveValue("Pricing");
  });

  test("a refused name says why in place and changes nothing", async ({ page }) => {
    await stubPipeline(page);
    await page.goto("/dashboard/settings/pipeline");
    const row = page.getByTestId("pipeline-stage-proposal");
    const name = row.getByRole("textbox", { name: "Proposal name" });
    await name.fill("negotiation");
    await name.press("Enter");
    await expect(row.getByText("Another stage in this pipeline already has that name")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
  });

  test("reorders with the move buttons and keeps focus on the moved stage", async ({ page }) => {
    const store = await stubPipeline(page);
    await page.goto("/dashboard/settings/pipeline");
    await page.getByRole("button", { name: "Move Closed lost up" }).click();
    await expect.poll(() => store.requests.at(-1)).toBe("PUT 700,701,702,703,705,704");
    await expect(page.getByRole("button", { name: "Move Closed lost up" })).toBeFocused();
    const keys = await page.locator('[data-testid^="pipeline-stage-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
    expect(keys.slice(-2)).toEqual(["pipeline-stage-closed_lost", "pipeline-stage-closed_won"]);
  });

  test("deactivating a stage with deals asks first and names the count", async ({ page }) => {
    const store = await stubPipeline(page);
    await page.goto("/dashboard/settings/pipeline");
    const row = page.getByTestId("pipeline-stage-negotiation");
    await expect(row.getByText("3 deals")).toBeVisible();

    await row.getByRole("radio", { name: "Inactive" }).click();
    const dialog = page.getByRole("dialog", { name: "Deactivate Negotiation?" });
    await expect(dialog.getByText(/3 deals are in this stage/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(store.requests.filter((request) => request.startsWith("PATCH"))).toHaveLength(0);

    await row.getByRole("radio", { name: "Inactive" }).click();
    await page.getByRole("dialog", { name: "Deactivate Negotiation?" }).getByRole("button", { name: "Deactivate stage" }).click();
    await expect.poll(() => store.requests.at(-1)).toBe(`PATCH 703 {"is_active":false}`);
    await expect(row.getByRole("radio", { name: "Inactive" })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("adding a stage", () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    await stubModules(page, true);
    await loginAsAdmin(page);
  });

  test("adds a step before the outcomes, and a duplicate name says why", async ({ page }) => {
    const store = await stubPipeline(page);
    await page.goto("/dashboard/settings/pipeline");
    const form = page.getByRole("form", { name: "Add a stage" });

    await form.getByLabel("New stage").fill("Technical review");
    await form.getByRole("button", { name: "Add stage" }).click();
    await expect(page.getByTestId("pipeline-stage-technical_review")).toBeVisible();
    expect(store.requests).toContain(`POST {"label":"Technical review","semantic_type":"ongoing"}`);
    await expect(form.getByLabel("New stage")).toHaveValue("");
    const keys = await page.locator('[data-testid^="pipeline-stage-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
    expect(keys.slice(-3)).toEqual(["pipeline-stage-technical_review", "pipeline-stage-closed_won", "pipeline-stage-closed_lost"]);

    await form.getByLabel("New stage").fill("proposal");
    await form.getByRole("button", { name: "Add stage" }).click();
    await expect(form.getByText("Another stage in this pipeline already has that name")).toBeVisible();
    await expect(form.getByLabel("New stage")).toHaveValue("proposal");
  });
});

test("without configure on deals the page is a permission wall", async ({ page }) => {
  await stubModules(page, false);
  await loginAsAdmin(page);
  await stubPipeline(page);
  await page.goto("/dashboard/settings/pipeline");
  await expect(page.getByTestId("pipeline-stage-lead")).toHaveCount(0);
  await expect(page.getByText(/permission|access/i).first()).toBeVisible();
});
