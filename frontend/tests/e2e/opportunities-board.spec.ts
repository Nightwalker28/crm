import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers/auth";

/**
 * Wave 2E: the deal board — frontend Phase 3 of `docs/crm-evolution/04-pipelines-kanban.md`.
 *
 * The list, the pipeline and the stage move are stubbed over one store, so a card changes
 * column only because the page applied a move the "server" accepted — or put it back when
 * the server refused.
 */

type Deal = { opportunity_id: number; opportunity_name: string; sales_stage: string | null };

const stages = [
  ["lead", "Lead", "open", true],
  ["proposal", "Proposal", "ongoing", true],
  ["negotiation", "Negotiation", "ongoing", false],
  ["closed_won", "Closed won", "won", true],
  ["closed_lost", "Closed lost", "lost", true],
].map(([key, label, semantic_type, is_active], position) => ({
  id: 900 + position, key, label, position, semantic_type, is_closed: semantic_type === "won" || semantic_type === "lost", probability: 50, is_active,
}));

const stageRef = (key: string | null) => {
  const stage = stages.find((item) => item.key === key);
  return stage ? { id: stage.id, key: stage.key, label: stage.label, semantic_type: stage.semantic_type, probability: 50, is_active: stage.is_active } : null;
};

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function stubBoard(page: Page) {
  const store = {
    deals: [
      { opportunity_id: 987655001, opportunity_name: "Alpha deal", sales_stage: "proposal" },
      { opportunity_id: 987655002, opportunity_name: "Beta deal", sales_stage: "negotiation" },
    ] as Deal[],
    moves: [] as string[],
    listFields: [] as string[],
  };
  const listBody = () => ({
    results: store.deals.map((deal) => ({ ...deal, pipeline_stage_id: stageRef(deal.sales_stage)?.id ?? null, pipeline_stage: stageRef(deal.sales_stage), assigned_to_name: "Ada Owner" })),
    range_start: 1, range_end: store.deals.length, total_count: store.deals.length, total_pages: 1, page: 1,
  });

  await page.route("**/api/v1/sales/opportunities?**", (route) => {
    store.listFields.push(new URL(route.request().url()).searchParams.get("fields") ?? "");
    return route.fulfill(json(listBody()));
  });
  await page.route("**/api/v1/sales/opportunities/pipeline-summary?**", (route) => route.fulfill(json({ total_count: 2, stages: [] })));
  await page.route("**/api/v1/sales/opportunities/pipeline", (route) => route.fulfill(json({
    id: 90, module_key: "sales_opportunities", name: "Sales pipeline", is_default: true, is_active: true, stages,
  })));
  await page.route("**/api/v1/sales/opportunities/*/stage", (route) => {
    const id = Number(route.request().url().split("/").at(-2));
    const { sales_stage } = route.request().postDataJSON() as { sales_stage: string };
    store.moves.push(`${id} ${sales_stage}`);
    // Stands in for a stage an administrator deactivated after this page loaded.
    if (sales_stage === "closed_lost") return route.fulfill(json({ detail: "Pipeline stage is inactive" }, 400));
    store.deals.find((deal) => deal.opportunity_id === id)!.sales_stage = sales_stage;
    return route.fulfill(json({ ...store.deals.find((deal) => deal.opportunity_id === id), pipeline_stage: stageRef(sales_stage) }));
  });
  return store;
}

const column = (page: Page, key: string) => page.locator(`[data-board-column="${key}"]`);

test.describe("the deal board", () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("columns are the pipeline's stages, and an inactive one shows only while occupied and takes no cards", async ({ page }) => {
    const store = await stubBoard(page);
    await page.goto("/dashboard/sales/opportunities?display=pipeline");
    await expect(column(page, "proposal").getByText("Alpha deal")).toBeVisible();
    await expect(column(page, "negotiation").getByText("Beta deal")).toBeVisible();
    // The board always asks for the stage, whatever the table shows.
    expect(store.listFields.at(-1)).toContain("sales_stage");

    await page.getByRole("combobox", { name: "Change stage for Alpha deal" }).click();
    const options = page.getByRole("option");
    await expect(options).toHaveText(["Lead", "Proposal", "Closed won", "Closed lost"]);
    await page.keyboard.press("Escape");
  });

  test("a keyboard move is saved and the card changes column", async ({ page }) => {
    const store = await stubBoard(page);
    await page.goto("/dashboard/sales/opportunities?display=pipeline");
    await page.getByRole("combobox", { name: "Change stage for Alpha deal" }).click();
    await page.getByRole("option", { name: "Closed won" }).click();
    await expect.poll(() => store.moves.at(-1)).toBe("987655001 closed_won");
    await expect(column(page, "closed_won").getByText("Alpha deal")).toBeVisible();
    await expect(page.getByText("Deal stage updated.")).toBeVisible();
  });

  test("a refused move puts the card back and says why", async ({ page }) => {
    const store = await stubBoard(page);
    await page.goto("/dashboard/sales/opportunities?display=pipeline");
    await page.getByRole("combobox", { name: "Change stage for Alpha deal" }).click();
    await page.getByRole("option", { name: "Closed lost" }).click();
    await expect.poll(() => store.moves.at(-1)).toBe("987655001 closed_lost");
    await expect(page.getByText("Deal stage was not changed: Pipeline stage is inactive.")).toBeVisible();
    await expect(column(page, "proposal").getByText("Alpha deal")).toBeVisible();
    await expect(column(page, "closed_lost").getByText("Alpha deal")).toHaveCount(0);
  });
});

test.describe("a saved view remembers its display", () => {
  test.slow();

  test("selecting a board view opens the board, and the table view brings the table back", async ({ page }) => {
    await loginAsAdmin(page);
    await stubBoard(page);
    const baseConfig = {
      visible_columns: ["opportunity_name", "sales_stage"],
      filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
      sort: null,
    };
    await page.route("**/api/v1/users/saved-views/sales_opportunities?**", (route) => route.fulfill(json({
      views: [
        { id: null, module_key: "sales_opportunities", name: "All deals", is_default: true, is_system: true, config: { ...baseConfig, display: null } },
        { id: 4401, module_key: "sales_opportunities", name: "Pipeline board", is_default: false, is_system: false, config: { ...baseConfig, display: "pipeline" } },
      ],
    })));

    await page.goto("/dashboard/sales/opportunities");
    await expect(page.getByRole("radio", { name: "Table", exact: true })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("tab", { name: "Pipeline board" }).click();
    await expect(page.getByRole("radio", { name: "Pipeline" })).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/display=pipeline/);
    await expect(column(page, "proposal").getByText("Alpha deal")).toBeVisible();

    await page.getByRole("tab", { name: /All deals/ }).click();
    await expect(page.getByRole("radio", { name: "Table", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page).not.toHaveURL(/display=/);
  });
});
