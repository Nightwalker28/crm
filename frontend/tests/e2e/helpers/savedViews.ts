import type { Page } from "@playwright/test";

/**
 * Serves every module an empty saved-view list so the list under test renders the module's
 * current default columns.
 *
 * Without this, a spec that asserts on cell content is really asserting on whatever
 * `user_saved_views` rows the signed-in admin happens to own. Those rows are mutable tenant
 * state: anyone who opens the column picker in the dev tenant, and any system default
 * materialised by an older build, changes what the table renders. Column assertions belong to
 * the module definition, not to one account's history, so the transport is stubbed instead.
 *
 * Only GETs are stubbed. A spec that exercises saving or selecting views should not use this
 * helper — it wants the real endpoint.
 */
export async function stubDefaultSavedViews(page: Page) {
  await page.route("**/api/v1/users/saved-views/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ views: [] }),
    });
  });
}
