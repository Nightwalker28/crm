// Guards the design rules that were applied repo-wide, by reading computed styles from
// every route rather than grepping source. Greps miss what only shows up rendered - a
// `<code>` element inheriting a monospace UA default, or an id column that turns out to
// hold plain integers.
//
// Checks: no uppercase or faked small caps, Inter everywhere, radius on the token scale,
// monospace only for secrets and raw payloads, control heights in {32, 38, 44}.
//
// Exemptions, all deliberate: <code>/<pre> are monospace by UA default and are the right
// elements for a machine string; textareas are multi-line so the single-line height
// contract does not apply; nav items, card-buttons, sort headers, tabs and pills size to
// their content and are not form controls.
//
// See docs/design/design.md.
import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const STATIC_ROUTES = [
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

const LISTS: Array<{ list: string; re: string; suffixes: string[] }> = [
  { list: "/dashboard/sales/leads",             re: "^/dashboard/sales/leads/\\d+$",            suffixes: ["", "/edit", "/convert"] },
  { list: "/dashboard/sales/contacts",          re: "^/dashboard/sales/contacts/\\d+$",         suffixes: ["", "/edit"] },
  { list: "/dashboard/sales/organizations",     re: "^/dashboard/sales/organizations/\\d+$",    suffixes: ["", "/edit"] },
  { list: "/dashboard/sales/opportunities",     re: "^/dashboard/sales/opportunities/\\d+$",    suffixes: ["", "/edit"] },
  { list: "/dashboard/sales/orders",            re: "^/dashboard/sales/orders/\\d+$",           suffixes: ["", "/edit"] },
  { list: "/dashboard/sales/quotes",            re: "^/dashboard/sales/quotes/\\d+$",           suffixes: ["", "/edit"] },
  { list: "/dashboard/contracts",               re: "^/dashboard/contracts/\\d+$",              suffixes: ["", "/edit"] },
  { list: "/dashboard/finance/pos",             re: "^/dashboard/finance/pos/\\d+$",            suffixes: ["", "/edit", "/print"] },
  { list: "/dashboard/finance/insertion-orders",re: "^/dashboard/finance/insertion-orders/\\d+$",suffixes: ["", "/edit"] },
  { list: "/dashboard/catalog/products",        re: "^/dashboard/catalog/products/\\d+$",       suffixes: ["", "/edit"] },
  { list: "/dashboard/catalog/services",        re: "^/dashboard/catalog/services/\\d+$",       suffixes: ["", "/edit"] },
  { list: "/dashboard/support/cases",           re: "^/dashboard/support/cases/\\d+$",          suffixes: [""] },
  { list: "/dashboard/settings/modules",        re: "^/dashboard/settings/modules/\\d+$",       suffixes: [""] },
];

// Tailwind v4 emits calc(infinity * 1px) for rounded-full, which computes to 3.35544e+07px.
const ALLOWED_RADII = new Set(["0px", "6px", "8px", "10px", "12px", "14px", "2px", "4px", "9999px", "3.35544e+07px"]);
const ALLOWED_CONTROL_H = new Set([32, 38, 44]);

test("design rule audit", async ({ page }) => {
  test.setTimeout(40 * 60 * 1000);
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const routes: string[] = [...STATIC_ROUTES];
  const unreachable: string[] = [];

  for (const l of LISTS) {
    await page.goto(l.list, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    let href: string | null = await page.evaluate((src) => {
      const re = new RegExp(src);
      const a = Array.from(document.querySelectorAll("a")).find((x) => re.test(new URL(x.href, location.origin).pathname));
      return a ? new URL(a.href, location.origin).pathname : null;
    }, l.re);
    if (!href) {
      // click a plain cell, not the row centre - rows can contain their own links
      const row = page.locator("tbody tr").first().locator("td").nth(1);
      if (await row.count()) {
        try {
          await row.click({ timeout: 8000 });
          await page.waitForTimeout(1800);
          const path = new URL(page.url()).pathname;
          if (new RegExp(l.re).test(path)) href = path;
        } catch { /* ignore */ }
      }
    }
    if (!href) { unreachable.push(l.list); continue; }
    for (const s of l.suffixes) routes.push(href + s);
  }

  const violations: Record<string, string[]> = { uppercase: [], mono: [], radius: [], controlHeight: [], font: [], nesting: [] };
  const seen = new Set<string>();

  for (const route of routes) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1300);
    } catch { continue; }

    const r = await page.evaluate((args) => {
      const { allowedRadii, allowedH } = args;
      const out = { uppercase: [] as string[], mono: [] as string[], radius: [] as string[], controlHeight: [] as string[], font: [] as string[], nesting: [] as string[] };
      const visible = (el: Element) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const label = (el: Element) => {
        const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
        return `<${el.tagName.toLowerCase()} class="${cls.slice(0, 70)}">`;
      };
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        if (!visible(el)) return;
        const cs = getComputedStyle(el);
        if (cs.textTransform === "uppercase" && (el.textContent || "").trim()) out.uppercase.push(label(el));
        const ff = cs.fontFamily.toLowerCase();
        if (/mono|courier|consolas|menlo/.test(ff) && (el.textContent || "").trim() && !el.querySelector("*") && el.tagName !== "CODE" && el.tagName !== "PRE") out.mono.push(label(el) + " :: " + (el.textContent || "").trim().slice(0, 40));
        for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const) {
          const v = cs[corner];
          if (v && v !== "0px" && !allowedRadii.includes(v) && !v.includes("%")) out.radius.push(`${v} ${label(el)}`);
        }
      });
      // Only real form controls carry the height contract - nav items, card-buttons,
      // sort headers, tabs and pills size to their content by design.
      document.querySelectorAll<HTMLElement>(
        '[data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], [data-slot="segmented-item"], select',
      ).forEach((el) => {
        if (!visible(el)) return;
        if (/\bh-auto\b/.test(String((el as HTMLElement).className || ""))) return;
        const h = Math.round(el.getBoundingClientRect().height);
        if (!allowedH.includes(h) && h > 20) out.controlHeight.push(`${h}px ${label(el)}`);
      });
      // Nesting depth: a visible container is a radius plus a border or a tint, at
      // panel size. Form controls are excluded - a textarea has all three but is a
      // control, not a container. Budget is 2 (design.md 1.3): page -> panel.
      {
        const CONTROLS = new Set(["TEXTAREA", "INPUT", "SELECT", "BUTTON", "IMG", "SVG"]);
        const isContainer = (el: Element) => {
          if (CONTROLS.has(el.tagName)) return false;
          if ((el as HTMLElement).closest('[data-slot="button"]')) return false;
          const cs = getComputedStyle(el);
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.width < 200 || b.height < 60) return false;
          if ((parseFloat(cs.borderTopLeftRadius) || 0) <= 0) return false;
          const bordered = (parseFloat(cs.borderTopWidth) || 0) > 0 && cs.borderTopStyle !== "none";
          const tinted = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
          return bordered || tinted;
        };
        const BUDGET = 2;
        const walk = (el: Element, depth: number, trail: string[]) => {
          const here = isContainer(el);
          const d = depth + (here ? 1 : 0);
          const t = here ? [...trail, label(el)] : trail;
          if (d > BUDGET) { out.nesting.push(t.join(" > ")); return; }
          Array.from(el.children).forEach((c) => walk(c, d, t));
        };
        const root = document.querySelector("main") ?? document.body;
        Array.from(root.children).forEach((c) => walk(c, 0, []));
      }

      const bodyFont = getComputedStyle(document.body).fontFamily;
      if (!/inter/i.test(bodyFont)) out.font.push(bodyFont);
      return out;
    }, { allowedRadii: [...ALLOWED_RADII], allowedH: [...ALLOWED_CONTROL_H] });

    for (const k of Object.keys(violations)) {
      for (const v of (r as Record<string, string[]>)[k]) {
        const key = k + "|" + v;
        if (seen.has(key)) continue;
        seen.add(key);
        violations[k].push(`${route}  ${v}`);
      }
    }
  }

  console.log(`Audited ${routes.length} routes. Unreachable: ${unreachable.join(", ") || "none"}`);

  expect(violations.uppercase, "uppercase / faked small caps (design.md 3.5)").toEqual([]);
  expect(violations.font, "body must render in Inter (design.md 3.1)").toEqual([]);
  expect(violations.radius, "radius outside the token scale (design.md 4.3)").toEqual([]);
  expect(violations.mono, "monospace outside secrets and raw payloads (design.md 3.2)").toEqual([]);
  expect(violations.controlHeight, "control height outside 32/38/44 (design.md 4.2)").toEqual([]);
  expect(violations.nesting, "more than 2 levels of visible container (design.md 1.3)").toEqual([]);
});
