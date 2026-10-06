// Guards the primitives that were rebuilt on Radix in August 2026.
//
// All were hand-rolled and all had real defects: the tab strips announced role="tablist"
// with no arrow-key navigation and no roving tabindex, and ColumnPicker was an
// absolutely-positioned panel with no Escape handler and no outside-click dismissal.
// These assert the behaviour, not the implementation, so they stay valid if the
// primitives change again.
//
// The tabs test runs over EVERY tab strip in the app, not just the record page. That is
// the lesson of rebuild 5.3 batch 5: a single-route test proved the archetype's strip was
// correct while two more strips shipped the role with none of the contract behind it, for
// as long as nobody opened those two pages. A new strip is added to the table below.
//
// See docs/design/design.md 7.2 and 7.7.
import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const TAB_STRIPS = [
  { name: "record archetype", url: "/dashboard/sales/contacts/23" },
  { name: "saved view editor", url: "/dashboard/views/sales_leads" },
  { name: "module builder", url: "/dashboard/settings/module-builder" },
  { name: "module access rules", url: "/dashboard/settings/modules/1" },
];

for (const strip of TAB_STRIPS) {
  test(`${strip.name} tabs support the ARIA tabs keyboard pattern`, async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);
    await loginAsAdmin(page);
    await page.goto(strip.url, { waitUntil: "domcontentloaded" });
    await page.locator('[role="tab"]').first().waitFor({ state: "visible", timeout: 30000 });

    const tabs = page.locator('[role="tab"]');
    console.log(`[${strip.name}] tabs found: ${await tabs.count()}`);

    await tabs.first().focus();
    await page.waitForTimeout(200);

    // roving tabindex: read after focus, since the roving group initialises on focus
    const tabindexes = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("tabindex")));
    console.log(`[${strip.name}] tabindex per tab:`, JSON.stringify(tabindexes));

    await page.keyboard.press("ArrowRight");
    // A web-first assertion rather than a fixed wait: the record archetype pushes its tab
    // through `router.replace`, so its selection lands a frame or several later than the
    // three card strips, which are local state. A sleep long enough for one is a flake for
    // the other.
    await expect(tabs.nth(1), "ArrowRight moves the selection to the next tab")
      .toHaveAttribute("aria-selected", "true");
    await expect(tabs.first(), "and off the first").toHaveAttribute("aria-selected", "false");

    // aria-controls must point at a real panel
    const controls = await tabs.first().getAttribute("aria-controls");
    const panelExists = await page.evaluate(
      (id) => (id ? (document.getElementById(id) ? 1 : 0) : 0),
      controls,
    );
    console.log(`[${strip.name}] aria-controls -> "${controls}", panel present: ${panelExists > 0}`);

    expect(tabindexes.filter((value) => value === "0").length, "exactly one tab in the tab order").toBe(1);
    expect(panelExists, "aria-controls must resolve to a panel").toBeGreaterThan(0);
  });
}

test("column picker closes on Escape and on outside click", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  await page.goto("/dashboard/custom/testing_new_custom_module", { waitUntil: "domcontentloaded" });
  const trigger = page.getByRole("button", { name: /columns/i }).first();
  await trigger.waitFor({ state: "visible", timeout: 30000 });

  const panel = page.locator('[data-slot="popover-content"]');

  await trigger.click();
  await expect(panel, "panel opens").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel, "Escape closes it").toBeHidden();

  // Escape is the path that must return focus, so a keyboard user is not stranded.
  // An outside click deliberately does not, since that would fight the click target.
  const focusIsTrigger = await trigger.evaluate((el) => el === document.activeElement);
  console.log("focus returns to trigger after Escape:", focusIsTrigger);
  expect(focusIsTrigger, "Escape returns focus to the trigger").toBe(true);

  await trigger.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(5, 400); // click well away from the panel
  await expect(panel, "outside click closes it").toBeHidden();


});

// The `/[id]/edit` round trip, over every module that has one.
//
// R2 makes the page trip routine rather than rare — the spine autosaves a record's state,
// so `/[id]/edit` is now how an operator fixes a typo — and §4.7 requires `?tab=` to
// survive it in *both* directions. The outbound half shipped on eleven detail pages in
// batches 1–4; the return half did not, and a single-module assertion on leads never saw
// it, which is the same blind spot the table above exists to close.
//
// Nothing here is hardcoded but the list route: the record is whichever row the list
// opens first, and the tab is whichever one the strip ends with. So a module that gains a
// tab, or reseeds under different ids, still guards the contract rather than the fixture.
const RECORD_MODULES = [
  { name: "lead", list: "/dashboard/sales/leads" },
  { name: "contact", list: "/dashboard/sales/contacts" },
  { name: "account", list: "/dashboard/sales/organizations" },
  { name: "deal", list: "/dashboard/sales/opportunities" },
  { name: "quote", list: "/dashboard/sales/quotes" },
  { name: "order", list: "/dashboard/sales/orders" },
  { name: "POS invoice", list: "/dashboard/finance/invoices" },
  { name: "catalog product", list: "/dashboard/catalog/products" },
  { name: "catalog service", list: "/dashboard/catalog/services" },
  { name: "custom record", list: "/dashboard/custom/testing_new_custom_module" },
];

for (const record of RECORD_MODULES) {
  test(`${record.name} carries ?tab= through the /[id]/edit round trip`, async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);
    await loginAsAdmin(page);

    await page.goto(record.list, { waitUntil: "domcontentloaded" });
    const firstRow = page.locator('tbody tr[tabindex="0"]').first();
    await firstRow.waitFor({ state: "visible", timeout: 30000 });
    await firstRow.click();

    // Scoped to the content region, not `[role="tab"]` at large: the list page's saved-view
    // selector announces the same role, so an unscoped locator resolves on the list before
    // the row's navigation has even landed. (That strip is `SavedViewSelector`, which the
    // census hands to 5.5 — noted here so the next reader does not take it for a defect.)
    await page.waitForURL(new RegExp(`${record.list}/\\d+`), { timeout: 30000 });
    const tabs = page.locator('[data-slot="record-content"] [role="tab"]');
    await tabs.first().waitFor({ state: "visible", timeout: 30000 });
    const recordPath = new URL(page.url()).pathname;

    // A record type with a single tab has nothing to carry, and that is a legitimate
    // rendering rather than a skip: the archetype omits a tab whose slot is not passed, and
    // a custom module is not in the backend's `RECORD_COMMENT_MODULES`, so Timeline, Tasks
    // and Files cannot resolve one of its records at all. The assertion inverts — the hook
    // must not invent a tab — and the row stays in the table, so the day custom modules gain
    // a collaboration surface this starts guarding them without anyone remembering to.
    const tabCount = await tabs.count();
    const editLink = page.getByRole("link", { name: "Edit", exact: true }).first();

    if (tabCount < 2) {
      console.log(`[${record.name}] record ${recordPath}, single tab — nothing to carry`);
      await expect(editLink, "a single-tab record carries no ?tab=")
        .toHaveAttribute("href", `${recordPath}/edit`);
      return;
    }

    // The last tab is never the fallback, so selecting it must put `?tab=` on the URL.
    await tabs.last().click();
    await expect(page).toHaveURL(/[?&]tab=/);
    const tab = new URL(page.url()).searchParams.get("tab");
    console.log(`[${record.name}] record ${recordPath}, tab "${tab}"`);
    expect(tab, "selecting the last tab writes ?tab=").toBeTruthy();

    // Outbound: Edit carries the tab to the form.
    await expect(editLink, "Edit is in the header row, reachable from every tab")
      .toHaveAttribute("href", new RegExp(`${recordPath}/edit\\?tab=${tab}$`));

    await editLink.click();
    await expect(page).toHaveURL(new RegExp(`${recordPath}/edit\\?tab=${tab}$`));

    // Return: Cancel goes back to the tab the operator left, not to Details.
    const cancel = page.getByRole("link", { name: "Cancel", exact: true }).first();
    await cancel.waitFor({ state: "visible", timeout: 30000 });
    await expect(cancel, "Cancel returns to the tab the operator left from")
      .toHaveAttribute("href", `${recordPath}?tab=${tab}`);
  });
}
