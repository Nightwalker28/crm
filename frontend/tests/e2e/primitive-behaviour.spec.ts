// Guards the two primitives that were rebuilt on Radix in August 2026.
//
// Both were hand-rolled and both had real defects: RecordTabs announced role="tablist"
// with no arrow-key navigation and no roving tabindex, and ColumnPicker was an
// absolutely-positioned panel with no Escape handler and no outside-click dismissal.
// These assert the behaviour, not the implementation, so they stay valid if the
// primitives change again.
//
// See docs/design/design.md 7.2.
import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("record tabs support the ARIA tabs keyboard pattern", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await loginAsAdmin(page);
  await page.goto("/dashboard/sales/contacts/23", { waitUntil: "domcontentloaded" });
  await page.locator('[role="tab"]').first().waitFor({ state: "visible", timeout: 30000 });

  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  console.log(`tabs found: ${count}`);

  const first = tabs.first();
  await first.focus();
  await page.waitForTimeout(200);

  // roving tabindex: read after focus, since the roving group initialises on focus
  const tabindexes = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("tabindex")));
  console.log("tabindex per tab:", JSON.stringify(tabindexes));
  const beforeSelected = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("aria-selected")));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  const afterSelected = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("aria-selected")));
  const focusedAfter = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}[role=${el.getAttribute("role")}] "${(el.textContent ?? "").trim().slice(0, 30)}"` : "none";
  });

  console.log("aria-selected before ArrowRight:", JSON.stringify(beforeSelected));
  console.log("aria-selected after  ArrowRight:", JSON.stringify(afterSelected));
  console.log("focused element after ArrowRight:", focusedAfter);

  // aria-controls must point at a real panel
  const controls = await tabs.first().getAttribute("aria-controls");
  const panelExists = await page.evaluate(
    (id) => (id ? (document.getElementById(id) ? 1 : 0) : 0),
    controls,
  );
  console.log(`aria-controls -> "${controls}", panel present: ${panelExists > 0}`);

  expect(afterSelected, "ArrowRight must move the selected tab").not.toEqual(beforeSelected);
  expect(tabindexes.filter((t) => t === "0").length, "exactly one tab in the tab order").toBe(1);
  expect(panelExists, "aria-controls must resolve to a panel").toBeGreaterThan(0);
});

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
