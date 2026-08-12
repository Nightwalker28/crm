// Guards the single-scroll rule across every static route.
//
// Module list pages are full-height columns: the toolbar and pagination stay pinned and
// only the rows scroll. Everywhere else the page scrolls as one document. What must never
// happen is both at once - two scrollbars, with the inner region stealing the wheel.
//
// Exempt, because they are bounded controls rather than page content: dialogs, sheets,
// popovers, listboxes, and anything marked `data-bounded-list`.
//
// See docs/design/design.md 11.1 and 4.5.
import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const ROUTES = [
  "/client",
  "/client/bookings",
  "/client/catalog",
  "/client/documents",
  "/client/login",
  "/client/messages",
  "/client/orders",
  "/client/quotes",
  "/client/setup",
  "/client/support",
  "/dashboard",
  "/dashboard/calendar",
  "/dashboard/catalog/products",
  "/dashboard/catalog/products/new",
  "/dashboard/catalog/services",
  "/dashboard/catalog/services/new",
  "/dashboard/client-portal",
  "/dashboard/client-portal/pages/new",
  "/dashboard/contracts",
  "/dashboard/contracts/new",
  "/dashboard/documents",
  "/dashboard/documents/upload",
  "/dashboard/finance/insertion-orders",
  "/dashboard/finance/insertion-orders/new",
  "/dashboard/finance/invoice-generator",
  "/dashboard/finance/payments",
  "/dashboard/finance/payments/record",
  "/dashboard/finance/pos",
  "/dashboard/finance/pos/new",
  "/dashboard/mail",
  "/dashboard/mail/compose",
  "/dashboard/profile",
  "/dashboard/reports",
  "/dashboard/sales/contacts",
  "/dashboard/sales/contacts/new",
  "/dashboard/sales/leads",
  "/dashboard/sales/leads/new",
  "/dashboard/sales/opportunities",
  "/dashboard/sales/opportunities/new",
  "/dashboard/sales/orders",
  "/dashboard/sales/orders/new",
  "/dashboard/sales/organizations",
  "/dashboard/sales/organizations/new",
  "/dashboard/sales/quotes",
  "/dashboard/sales/quotes/new",
  "/dashboard/settings",
  "/dashboard/settings/activity-log",
  "/dashboard/settings/authentication",
  "/dashboard/settings/automation",
  "/dashboard/settings/backups",
  "/dashboard/settings/calendar-booking",
  "/dashboard/settings/customer-groups",
  "/dashboard/settings/domains",
  "/dashboard/settings/fields",
  "/dashboard/settings/record-layouts",
  "/dashboard/settings/general",
  "/dashboard/settings/integrations",
  "/dashboard/settings/message-templates",
  "/dashboard/settings/message-templates/new",
  "/dashboard/settings/module-builder",
  "/dashboard/settings/modules",
  "/dashboard/settings/permissions",
  "/dashboard/settings/provisioning",
  "/dashboard/settings/recycle-bin",
  "/dashboard/settings/teams",
  "/dashboard/settings/users",
  "/dashboard/support/cases",
  "/dashboard/support/cases/new",
  "/dashboard/tasks"
];

test("no page has both a page scroll and a nested content scroll", async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 1280, height: 620 });

  const findings: string[] = [];
  for (const route of ROUTES) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1600);
    } catch { findings.push(`${route}  NAV-FAILED`); continue; }

    const r = await page.evaluate(() => {
      const pageScroller = document.querySelector<HTMLElement>("main div.overflow-y-auto");
      const nav = document.querySelector<HTMLElement>("nav");
      const nested: string[] = [];
      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const oy = getComputedStyle(el).overflowY;
        if (!(oy === "auto" || oy === "scroll")) return;
        if (el.scrollHeight <= el.clientHeight + 2) return;
        if (el === pageScroller || el === nav || nav?.contains(el)) return;
        // allowed bounded regions: overlays and option lists
        if (el.closest('[role="dialog"], [data-slot="sheet-content"], [role="listbox"], [data-radix-popper-content-wrapper], [data-bounded-list]')) return;
        nested.push(`<${el.tagName.toLowerCase()} class="${typeof el.className === "string" ? el.className : ""}">`);
      });
      return { nested, pageScrolls: pageScroller ? pageScroller.scrollHeight > pageScroller.clientHeight + 2 : false };
    });
    if (r.pageScrolls && r.nested.length) findings.push(`${route}\n     ${r.nested.join("\n     ")}`);
  }
  expect(
    findings,
    `Routes with both a page scroll and a nested content scroll:\n${findings.join("\n")}\n\n` +
      "A page's primary content must not carry its own height cap. Either make the page a " +
      "full-height column (flex h-full min-h-0 flex-col) so one region scrolls, or remove the " +
      "cap so the page scrolls as one document. Genuinely bounded controls - overlays, option " +
      "lists, code blocks - are exempt via role/data-bounded-list. See docs/design/design.md 11.1.",
  ).toEqual([]);
});
