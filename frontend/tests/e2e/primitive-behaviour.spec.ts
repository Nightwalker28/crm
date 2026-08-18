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
