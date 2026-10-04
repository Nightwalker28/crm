// Guards the design rules that were applied repo-wide, by reading computed styles from
// every route rather than grepping source. Greps miss what only shows up rendered - a
// `<code>` element inheriting a monospace UA default, or an id column that turns out to
// hold plain integers.
//
// Checks, per route: no uppercase or faked small caps, Inter everywhere, radius on the token
// scale, monospace only for secrets and raw payloads, control heights in {32, 38, 44}, at
// most two levels of visible container, archetype 3's composition (a visible title, a
// `FormFooter`, no sticky save bar), and - added in rebuild 5.10 - the type ramp, the page
// root, both border tiers, Title Case, sibling button heights (R4), the colour budget in a
// table body (R5), the record archetype, the settings rail's current page, and a visible
// focus indicator on a sample of focusable elements.
//
// Checks, once: the settings rail reaches every settings page (A8), the active option in a
// listbox is visible in both themes, and nothing loops under reduced motion (§6).
//
// Three sessions walk three route sets: the CRM admin, nobody (auth, booking, shared page,
// proposal), and a client-portal user. Before 5.10 the portal routes were visited as the
// admin, which only ever audited the portal's login redirect.
//
// Exemptions, all deliberate: <code>/<pre> are monospace by UA default and are the right
// elements for a machine string; textareas are multi-line so the single-line height
// contract does not apply; nav items, card-buttons, sort headers, tabs and pills size to
// their content and are not form controls. Contracts and support are out of the rebuild
// programme (scoping decision 8): they keep the pre-5.10 checks and skip the new ones.
//
// See docs/design/design.md and docs/design/rebuild.md 5.10.
import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import { describeRouteScope, inRouteScope, ROUTE_SCOPE } from "./helpers/routeScope";

const STATIC_ROUTES = [
  "/dashboard",
  "/dashboard/calendar",
  "/dashboard/catalog/products",
  "/dashboard/inventory/stock",
  "/dashboard/inventory/movements",
  "/dashboard/inventory/adjustments",
  "/dashboard/inventory/adjustments/new",
  "/dashboard/inventory/transfers",
  "/dashboard/inventory/transfers/new",
  "/dashboard/inventory/deliveries",
  "/dashboard/inventory/returns",
  "/dashboard/inventory/valuation",
  "/dashboard/inventory/valuation?tab=revaluations",
  "/dashboard/purchasing/orders",
  "/dashboard/purchasing/orders/new",
  "/dashboard/purchasing/receipts",
  "/dashboard/purchasing/reorder",
  "/dashboard/purchasing/bills",
  "/dashboard/purchasing/bills/new",
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
  "/dashboard/finance/payments",
  "/dashboard/finance/payments/record",
  "/dashboard/finance/credit-notes",
  "/dashboard/finance/pos",
  "/dashboard/finance/pos/new",
  "/dashboard/mail",
  "/dashboard/mail/compose",
  "/dashboard/profile",
  "/dashboard/reports",
  "/dashboard/reports/dashboards",
  "/dashboard/reports/forecast",
  "/dashboard/reports/new",
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
  "/dashboard/settings/catalog-categories",
  "/dashboard/settings/warehouses",
  "/dashboard/settings/domains",
  "/dashboard/settings/fields",
  "/dashboard/settings/record-layouts",
  "/dashboard/settings/pipeline",
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
  "/dashboard/tasks",
  "/dashboard/views/sales_contacts",
  "/dashboard/views/sales_leads",
];

// Discovered from a list by following its first record link. `record` marks the suffix that
// lands on archetype 2, so the archetype check knows which routes owe it.
const LISTS: Array<{ list: string; re: string; suffixes: string[]; record?: boolean }> = [
  { list: "/dashboard/sales/leads",             re: "^/dashboard/sales/leads/\\d+$",            suffixes: ["", "/edit", "/convert"], record: true },
  { list: "/dashboard/sales/contacts",          re: "^/dashboard/sales/contacts/\\d+$",         suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/sales/organizations",     re: "^/dashboard/sales/organizations/\\d+$",    suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/sales/opportunities",     re: "^/dashboard/sales/opportunities/\\d+$",    suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/sales/orders",            re: "^/dashboard/sales/orders/\\d+$",           suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/sales/quotes",            re: "^/dashboard/sales/quotes/\\d+$",           suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/contracts",               re: "^/dashboard/contracts/\\d+$",              suffixes: ["", "/edit"] },
  { list: "/dashboard/finance/pos",             re: "^/dashboard/finance/pos/\\d+$",            suffixes: ["", "/edit", "/print"], record: true },
  { list: "/dashboard/finance/insertion-orders",re: "^/dashboard/finance/insertion-orders/\\d+$",suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/catalog/products",        re: "^/dashboard/catalog/products/\\d+$",       suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/catalog/services",        re: "^/dashboard/catalog/services/\\d+$",       suffixes: ["", "/edit"], record: true },
  { list: "/dashboard/inventory/adjustments",     re: "^/dashboard/inventory/adjustments/\\d+$",   suffixes: [""] },
  { list: "/dashboard/inventory/transfers",       re: "^/dashboard/inventory/transfers/\\d+$",     suffixes: [""] },
  { list: "/dashboard/inventory/deliveries",      re: "^/dashboard/inventory/deliveries/\\d+$",    suffixes: [""] },
  { list: "/dashboard/inventory/returns",         re: "^/dashboard/inventory/returns/\\d+$",       suffixes: [""] },
  { list: "/dashboard/purchasing/orders",        re: "^/dashboard/purchasing/orders/\\d+$",       suffixes: [""] },
  { list: "/dashboard/purchasing/receipts",      re: "^/dashboard/purchasing/receipts/\\d+$",     suffixes: [""] },
  // E5 (12c-erp-invoicing.md).
  { list: "/dashboard/purchasing/bills",         re: "^/dashboard/purchasing/bills/\\d+$",        suffixes: [""] },
  { list: "/dashboard/finance/credit-notes",     re: "^/dashboard/finance/credit-notes/\\d+$",    suffixes: [""] },
  { list: "/dashboard/finance/payments",         re: "^/dashboard/finance/payments/\\d+$",        suffixes: [""] },
  { list: "/dashboard/support/cases",           re: "^/dashboard/support/cases/\\d+$",          suffixes: [""] },
  { list: "/dashboard/settings/modules",        re: "^/dashboard/settings/modules/\\d+$",       suffixes: [""] },
  { list: "/dashboard/settings/message-templates", re: "^/dashboard/settings/message-templates/\\d+/edit$", suffixes: [""] },
];

// Records and tokens come from `scripts/seed_module_samples.py` and `seed_demo_crm.py`, the
// same ones `public-surfaces-design.spec.ts` reads.
const PUBLIC_ROUTES = [
  "/auth/login",
  "/auth/setup-password",
  "/auth/forgot-password",
  "/auth/reset-password?token=e2e-placeholder-token",
  "/client/login",
  "/book/maad-mustafa/quickmeetings",
  "/client/pages/public-page-1-23",
  "/public/quotes/proposal/sample-proposal-1-1",
];
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL ?? "hello@bluewave-logistics.example";
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD ?? "Client@123456";
const CLIENT_ROUTES = [
  "/client",
  "/client/bookings",
  "/client/catalog",
  "/client/documents",
  "/client/messages",
  "/client/orders",
  "/client/quotes",
  "/client/setup",
];
// Client lists whose first row opens an archetype-2 record.
const CLIENT_RECORD_LISTS = ["/client/bookings", "/client/catalog", "/client/messages", "/client/orders", "/client/quotes"];

// The invoice print document is a census `unchanged` row (§2.5 exception 2): its own theme,
// its own type. It keeps the pre-5.10 checks.
const OUT_OF_SCOPE = /\/(contracts|support)(\/|$)|\/print$/;

// Tailwind v4 emits calc(infinity * 1px) for rounded-full, which computes to 3.35544e+07px.
const ALLOWED_RADII = new Set(["0px", "6px", "8px", "10px", "12px", "14px", "2px", "4px", "9999px", "3.35544e+07px"]);
const ALLOWED_CONTROL_H = new Set([32, 38, 44]);

// §3.3: four product sizes, plus 16px for prose that wraps at reading length (`text-p-base`).
// 24px is the stat figure and lives only inside `StatTile`. Auth and marketing may go larger.
const TYPE_RAMP = [11, 12, 14, 16, 18];

// Title Case (§3.5): a capital mid-label is a violation unless the word is a name. The list is
// the product's own vocabulary of proper nouns, not the operator's data - labels that render
// data are excluded by container below, not by adding the data here.
const PROPER_NOUNS = [
  "Lynk", "Google", "Microsoft", "Outlook", "Gmail", "WhatsApp", "LinkedIn", "Slack", "Stripe",
  "Excel", "OAuth", "OpenID", "Okta", "Azure", "Inter", "English", "Enter", "Esc", "Escape",
  "Tab", "Shift", "Ctrl", "Cmd", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday", "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December", "Jan", "Feb", "Mar", "Apr", "Jun",
  "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
  "Sun", "I", "OK",
  // Microsoft's product, named alone on its own reconnect button.
  "OneDrive",
];

// Product names of more than one word keep their capitals as a unit.
const PRODUCT_NAMES = ["Google Calendar", "Google Drive", "Microsoft OneDrive", "Microsoft Teams", "Teams webhook"];

type Scope = "dashboard" | "public" | "portal";

const CATEGORIES = [
  "uppercase", "mono", "radius", "controlHeight", "font", "nesting", "formTitle", "formFooter", "formSticky",
  "typeRamp", "pageRoot", "cardBorder", "controlBorder", "titleCase", "siblingHeight", "colourBudget",
  "archetype", "settingsNav", "focus", "controlName",
] as const;
type Category = (typeof CATEGORIES)[number];
type Findings = Record<Category, string[]>;

const emptyFindings = () => Object.fromEntries(CATEGORIES.map((k) => [k, [] as string[]])) as Findings;

async function probeRoute(page: Page, args: { route: string; scope: Scope; record: boolean; inScope: boolean; dataTitled: boolean }) {
  return page.evaluate((a) => {
    const out = Object.fromEntries(a.categories.map((k) => [k, [] as string[]])) as Record<string, string[]>;
    const visible = (el: Element) => {
      const b = (el as HTMLElement).getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const label = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
      const slot = el.getAttribute("data-slot");
      return `<${el.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ""} class="${cls.slice(0, 70)}">`;
    };
    const ownText = (el: Element) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent || "")
        .join("")
        .trim();
    // Resolve a token to the computed value a border would use, so the tier checks compare
    // like with like in whichever theme is active.
    const tokenColour = (name: string) => {
      const probe = document.createElement("div");
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const subtle = tokenColour("--color-border-subtle");
    const subThreshold = new Set([subtle, tokenColour("--color-border-default"), tokenColour("--color-border-strong")]);
    const rgba = (v: string) => {
      const m = v.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const hued = (v: string, minAlpha: number) => {
      const c = rgba(v);
      if (!c || c.a < minAlpha) return false;
      return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 30;
    };

    // --- The pre-5.10 checks, on every route -------------------------------------------------
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      if (!visible(el)) return;
      const cs = getComputedStyle(el);
      if (cs.textTransform === "uppercase" && (el.textContent || "").trim()) out.uppercase.push(label(el));
      const ff = cs.fontFamily.toLowerCase();
      if (/mono|courier|consolas|menlo/.test(ff) && (el.textContent || "").trim() && !el.querySelector("*") && el.tagName !== "CODE" && el.tagName !== "PRE") out.mono.push(label(el) + " :: " + (el.textContent || "").trim().slice(0, 40));
      for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const) {
        const v = cs[corner];
        if (v && v !== "0px" && !a.allowedRadii.includes(v) && !v.includes("%")) out.radius.push(`${v} ${label(el)}`);
      }
    });
    // Only real form controls carry the height contract - nav items, card-buttons,
    // sort headers, tabs and pills size to their content by design.
    const heightChecked = (el: HTMLElement) => !/\bh-auto\b/.test(String(el.className || ""));
    document.querySelectorAll<HTMLElement>(
      '[data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], [data-slot="searchable-select-trigger"], [data-slot="segmented-item"], select',
    ).forEach((el) => {
      if (!visible(el) || !heightChecked(el)) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (!a.allowedH.includes(h) && h > 20) out.controlHeight.push(`${h}px ${label(el)}`);
    });
    // Nesting depth: a visible container is a radius plus a border or a tint, at
    // panel size. Form controls are excluded - a textarea has all three but is a
    // control, not a container. Budget is 2 (design.md 1.3): page -> panel.
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
    {
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
    // Archetype 3 (design.md 4.7, R3). `RecordFormLayout` draws all three of these, so a
    // failure here means a form route stopped going through the primitive - which is how
    // the sticky save bar, the missing title and seventeen private footers happened the
    // first time. `data-slot` is the only DOM signal that says "this came from the
    // primitive" (7.6); a class selector cannot tell a rebuilt page from a regressed one.
    document.querySelectorAll<HTMLElement>('[data-slot="record-form-layout"]').forEach((form) => {
      const heading = form.querySelector<HTMLElement>('[data-slot="form-title"]');
      if (!heading || !visible(heading) || !(heading.textContent || "").trim()) out.formTitle.push("no visible form title");
      if (!form.querySelector('[data-slot="form-footer"]')) out.formFooter.push("no FormFooter");
      form.querySelectorAll<HTMLElement>("*").forEach((el) => {
        // The aside is `lg:sticky lg:top-6` by design - the ruling is about bottom-anchored
        // save bars, which pin themselves to the viewport floor.
        if (el.tagName === "ASIDE") return;
        const cs = getComputedStyle(el);
        if (cs.position === "sticky" && cs.bottom !== "auto") out.formSticky.push(label(el));
      });
    });
    const bodyFont = getComputedStyle(document.body).fontFamily;
    if (!/inter/i.test(bodyFont)) out.font.push(bodyFont);

    if (!a.inScope) return out;

    // --- 5.10 --------------------------------------------------------------------------------

    // Type ramp (§3.3). Text an element renders itself, at the size it renders it.
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      if (!visible(el) || !ownText(el)) return;
      // The wordmark is §9 identity, set in its own face at its own size.
      if (el.closest("svg, code, pre, [data-slot='chart'], .font-lynk")) return;
      const size = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
      if (a.ramp.includes(size)) return;
      if (size === 24 && el.closest('[data-slot="stat-tile"]')) return;
      if ((a.route.startsWith("/auth") || a.route === "/client/login") && size > 18) return;
      out.typeRamp.push(`${size}px ${label(el)} :: ${ownText(el).slice(0, 30)}`);
    });

    // Page root (§4.7): the first thing in the dashboard's content scroller is `PageShell`.
    if (a.scope === "dashboard") {
      const scroller = document.querySelector<HTMLElement>("main div.overflow-y-auto");
      const shell = scroller?.querySelector<HTMLElement>('[data-slot="page-shell"]');
      if (!scroller) out.pageRoot.push("no dashboard content scroller");
      else if (!shell) out.pageRoot.push("no PageShell in the content scroller");
      else {
        for (let node: HTMLElement | null = shell; node && node !== scroller; node = node.parentElement) {
          for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
            if (!visible(prev)) continue;
            out.pageRoot.push(`${label(prev)} renders before PageShell`);
          }
        }
      }
    }

    // Card border tier (§1.3): a panel's edge is `line-default`; `line-subtle` is a row divider.
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      if (!visible(el) || !isContainer(el)) return;
      const cs = getComputedStyle(el);
      // A row (§1.3) is `line-subtle` at the control radius, legitimately. A panel is the
      // card radius or larger, and that is the tier that must not drop to the row divider.
      if ((parseFloat(cs.borderTopLeftRadius) || 0) < 10) return;
      if ((parseFloat(cs.borderTopWidth) || 0) > 0 && cs.borderTopStyle !== "none" && cs.borderTopColor === subtle) {
        out.cardBorder.push(label(el));
      }
    });

    // Control border tier (§8, WCAG 1.4.11): a control's edge holds 3:1, which only
    // `line-control` does. `subtle` / `default` / `strong` are hairline tokens.
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [data-slot="select-trigger"], [data-slot="searchable-select-trigger"], [data-slot="checkbox"], [role="checkbox"], [data-slot="input-group"]',
    ).forEach((el) => {
      if (!visible(el)) return;
      const cs = getComputedStyle(el);
      if ((parseFloat(cs.borderTopWidth) || 0) <= 0 || cs.borderTopStyle === "none") return;
      if (subThreshold.has(cs.borderTopColor)) out.controlBorder.push(label(el));
    });

    // Title Case (§3.5). Labels the product authored: headings, buttons, tabs, table headers,
    // form labels. Anything that renders the operator's data is excluded by where it sits.
    const DATA_CONTAINERS = [
      "tbody", '[data-slot="record-header"] h1', '[data-slot="record-header"] h2',
      '[data-slot^="record-spine"]', '[data-slot="select-trigger"]', '[data-slot="searchable-select-trigger"]',
      '[role="combobox"]', '[role="listbox"]', '[data-user-content]', '[data-slot="stat-tile"]',
    ].join(", ");
    const nouns = new Set(a.nouns);
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"], [data-slot="button"], button, [role="tab"], th, label, legend',
    ).forEach((el) => {
      if (!visible(el) || el.closest(DATA_CONTAINERS)) return;
      // On a record, an edit form, the portal and the public pages, the surface title is the
      // record's own name - "Pavithra Nanayakkara", "Proposal for Sample Customer 1".
      if (a.dataTitled && (el.tagName === "H1" || el.getAttribute("data-slot") === "form-title")) return;
      const text = (el.innerText || "").trim();
      const userText = Array.from(el.querySelectorAll("[data-user-content]")).map((u) => (u as HTMLElement).innerText.trim());
      if (userText.includes(text)) return;
      if (!text || text.length > 80 || text.includes("\n")) return;
      const words = a.products.reduce((t, name) => t.split(name).join("product"), text).split(/\s+/);
      for (let i = 1; i < words.length; i += 1) {
        const w = words[i].replace(/^[("'“‘]+|[)"'”’.,:;!?…]+$/g, "");
        if (!/^[A-Z][a-z]/.test(w)) continue;
        if (nouns.has(w)) continue;
        if (/[.:!?—–-]$/.test(words[i - 1])) continue;
        out.titleCase.push(`"${text}" ${label(el)}`);
        break;
      }
    });

    // Every form control has a name (§8, WCAG 4.1.2). A label drawn beside a control and not
    // tied to it reads visually and announces as "combobox, None": `FieldLabel` without
    // `htmlFor`, or an input without the `id` it points at. Placeholder is not a name.
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="radio"]), select, textarea, [role="combobox"], [role="checkbox"], [role="switch"], [role="radiogroup"], [role="slider"]',
    ).forEach((el) => {
      if (!visible(el) || el.closest('[aria-hidden="true"], [inert]')) return;
      const labelled = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim();
      const labels = Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent?.trim() || "").join(" ").trim();
      const wrapped = el.closest("label")?.textContent?.trim() || "";
      const name = (el.getAttribute("aria-label") || "").trim() || labelled || labels || wrapped || (el.getAttribute("title") || "").trim();
      if (!name) out.controlName.push(label(el));
    });

    // Sibling control height (R4): buttons that share a row compute to one height.
    const rows = new Set<Element>();
    document.querySelectorAll<HTMLElement>('[data-slot="button"]').forEach((b) => {
      if (b.parentElement) rows.add(b.parentElement);
    });
    rows.forEach((row) => {
      const buttons = Array.from(row.children).filter(
        (c) => c.getAttribute("data-slot") === "button" && visible(c) && heightChecked(c as HTMLElement),
      );
      if (buttons.length < 2) return;
      const heights = [...new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().height)))];
      if (heights.length > 1) out.siblingHeight.push(`${heights.join("/")}px in ${label(row)}`);
    });

    // Colour budget in a list (R5): colour marks the exception. Two shapes re-create the pill
    // problem. Good-news ink in a list at all (`StatusValue` paints only warning and danger
    // there), and an action painted on every row. A majority of rows overdue is data and is
    // not caught here, which is why this is not a percentage.
    const success = tokenColour("--color-success");
    const info = tokenColour("--color-info");
    document.querySelectorAll<HTMLElement>("tbody").forEach((tbody) => {
      const bodyRows = Array.from(tbody.querySelectorAll(":scope > tr")).filter(visible);
      if (bodyRows.length < 5) return;
      const table = label(tbody.closest("table") ?? tbody);
      const columns = new Map<string, number>();
      let goodNews = 0;
      bodyRows.forEach((tr) => {
        const seenInRow = new Set<string>();
        Array.from(tr.children).forEach((cell, index) => {
          [cell, ...Array.from(cell.querySelectorAll("*"))].forEach((el) => {
            if (!visible(el) || el.closest("svg")) return;
            const cs = getComputedStyle(el);
            const ink = ownText(el) && hued(cs.color, 0.5) ? cs.color : null;
            const ground = hued(cs.backgroundColor, 0.05) ? cs.backgroundColor : null;
            if (ink === success || ink === info) goodNews += 1;
            // Only an action counts toward a whole coloured column. Data painted on every row
            // can be true - every demo deal really is past its close date - but a red button
            // on every row is the same decoration every time.
            if (!el.closest('button, a, [data-slot="button"]')) return;
            for (const c of [ink, ground]) if (c) seenInRow.add(`${index}|${c}`);
          });
        });
        seenInRow.forEach((k) => columns.set(k, (columns.get(k) ?? 0) + 1));
      });
      if (goodNews) out.colourBudget.push(`${goodNews} success/info marks in ${table}`);
      columns.forEach((count, key) => {
        if (count === bodyRows.length) out.colourBudget.push(`an action in column ${Number(key.split("|")[0]) + 1} is ${key.split("|")[1]} on every row of ${table}`);
      });
    });

    // Record archetype (§4.7, archetype 2): a record route goes through `RecordWorkspace`.
    if (a.record) {
      if (!document.querySelector('[data-slot="page-shell"][data-variant="record"]')) out.archetype.push('no PageShell variant="record"');
      if (!document.querySelector('[data-slot="record-header"]')) out.archetype.push("no record header");
    }

    // Settings navigation (owner ruling 2026-10-01): no second nav rail beside the sidebar.
    // A settings page returns to the hub through the header's back arrow; the hub has none.
    if (a.route.startsWith("/dashboard/settings")) {
      if (document.querySelector('[data-slot="settings-nav-rail"]')) out.settingsNav.push("a settings nav rail is drawn");
      const back = document.querySelector<HTMLAnchorElement>('header [data-testid="settings-back"]');
      if (a.route === "/dashboard/settings") {
        if (back) out.settingsNav.push("the hub draws a back arrow");
      } else if (!back || !visible(back)) out.settingsNav.push("no header back arrow");
      else if (new URL(back.href).pathname !== "/dashboard/settings") out.settingsNav.push(`back arrow goes to ${new URL(back.href).pathname}`);
    }
    return out;
  }, { ...args, categories: [...CATEGORIES], allowedRadii: [...ALLOWED_RADII], allowedH: [...ALLOWED_CONTROL_H], ramp: TYPE_RAMP, nouns: PROPER_NOUNS, products: PRODUCT_NAMES });
}

// Focus is visible (§2.3, §8). One Tab puts the page in keyboard modality, so a programmatic
// focus then matches :focus-visible exactly as a keyboard user's would. Transitions are
// switched off first - a ring that animates in reads as its start value on the same frame.
// The indicator may sit on the element, its wrapper (`input-group`), or a peer (`checkbox`).
async function probeFocus(page: Page, seen: Set<string>) {
  await page.keyboard.press("Tab").catch(() => {});
  const result = await page.evaluate((known) => {
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    document.head.appendChild(style);
    const scope = document.querySelector("main div.overflow-y-auto") ?? document.body;
    const visible = (el: Element) => {
      const b = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const signature = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
      return `<${el.tagName.toLowerCase()} data-slot="${el.getAttribute("data-slot") ?? ""}" role="${el.getAttribute("role") ?? ""}" class="${cls.slice(0, 90)}">`;
    };
    const paint = (el: Element | null) => {
      if (!el) return "";
      const cs = getComputedStyle(el);
      return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.backgroundColor].join("|");
    };
    const around = (el: Element) => [el, el.parentElement, el.parentElement?.parentElement ?? null, el.nextElementSibling];
    const candidates = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="tab"], [role="switch"], [role="checkbox"]',
      ),
    ).filter((el) => visible(el) && el.tabIndex >= 0);
    const fresh: string[] = [];
    const invisible: string[] = [];
    let focused = 0;
    for (const el of candidates) {
      const sig = signature(el);
      if (known.includes(sig) || fresh.includes(sig)) continue;
      if (fresh.length >= 30) break;
      (document.activeElement as HTMLElement | null)?.blur();
      const before = around(el).map(paint);
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue;
      focused += 1;
      fresh.push(sig);
      const after = around(el).map(paint);
      if (before.every((v, i) => v === after[i])) invisible.push(sig);
      el.blur();
    }
    style.remove();
    return { fresh, invisible, focused };
  }, [...seen]);
  result.fresh.forEach((s) => seen.add(s));
  return result;
}

async function setTheme(page: Page, theme: "dark" | "light") {
  return page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
    return getComputedStyle(document.body).backgroundColor;
  }, theme);
}

// The active option in a listbox (§2.3). `aria-activedescendant` is not DOM focus, so the
// focus probe cannot see it: open the list, move the cursor, and measure the row's indicator
// against the popover. 3:1 is the WCAG 1.4.11 floor the focus ring itself is held to.
async function measureActiveOption(page: Page, trigger: string, content: string, activeOption: string) {
  const handle = page.locator(trigger).first();
  if (!(await handle.count())) return null;
  await handle.click();
  await page.locator(content).first().waitFor({ state: "visible", timeout: 5000 });
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  const measured = await page.evaluate(({ contentSel, optionSel }) => {
    const option = document.querySelector<HTMLElement>(optionSel);
    const popover = document.querySelector<HTMLElement>(contentSel);
    if (!option || !popover) return null;
    const parse = (v: string) => {
      const m = v.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    // Composite a stack of grounds onto the page body to get the colour the eye sees.
    const groundOf = (el: HTMLElement | null) => {
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) layers.unshift(c);
        if (c && c.a >= 1) break;
      }
      let out = { r: 0, g: 0, b: 0 };
      for (const l of layers) out = { r: l.r * l.a + out.r * (1 - l.a), g: l.g * l.a + out.g * (1 - l.a), b: l.b * l.a + out.b * (1 - l.a) };
      return out;
    };
    const luminance = (c: { r: number; g: number; b: number }) => {
      const ch = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const contrast = (x: { r: number; g: number; b: number }, y: { r: number; g: number; b: number }) => {
      const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const popoverGround = groundOf(popover);
    const fill = contrast(groundOf(option), popoverGround);
    const cs = getComputedStyle(option);
    // Tailwind stacks five shadows (inset-shadow, inset-ring, ring-offset, ring, shadow), most
    // of them transparent; the ring is whichever one is painted.
    const ring = Math.max(0, ...(cs.boxShadow.match(/rgba?\([^)]+\)/g) ?? [])
      .map(parse)
      .filter((c): c is NonNullable<typeof c> => Boolean(c && c.a > 0))
      .map((c) => contrast(c, popoverGround)));
    const outlineColour = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? parse(cs.outlineColor) : null;
    const outline = outlineColour ? contrast(outlineColour, popoverGround) : 0;
    return { best: Math.max(fill, ring, outline), fill, ring, outline };
  }, { contentSel: content, optionSel: activeOption });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return measured;
}

/**
 * Wait for a row's open gesture to land on its record, not a fixed interval. On a freshly
 * started dev server the record route compiles on first visit, and the deal page took longer
 * than the 1.8s this used to wait: the Deals list was then dropped as unreachable in some runs
 * and not others (Wave 3A close, 2026-09-29).
 */
async function waitForRecordUrl(page: Page, re: string) {
  const pattern = new RegExp(re);
  await page.waitForURL((url) => pattern.test(url.pathname), { timeout: 20000 }).catch(() => {});
}

async function discoverRecord(page: Page, list: string, re: string) {
  await page.goto(list, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Wait for a row rather than a fixed 1500ms. The five largest lists (contacts,
  // organizations, opportunities, POS, leads) were reporting *unreachable* on a warm
  // server purely because their first row had not painted yet — which silently dropped
  // every `/[id]` and `/[id]/edit` route behind them from the audit.
  //
  // A *data* row: `ModuleTableLoading` paints eight skeleton rows first, and waiting for any
  // `tbody tr` resolved on those. The lists whose data arrived slowest in a run were then
  // dropped as unreachable — a different set every run (Wave 3A close, 2026-09-29).
  await page.waitForFunction((src) => {
    const pattern = new RegExp(src);
    return Array.from(document.querySelectorAll("main tbody tr")).some((row) => !row.querySelector('[data-slot="skeleton"]')) ||
      Array.from(document.querySelectorAll("a")).some((x) => pattern.test(new URL(x.href, location.origin).pathname));
  }, re, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  let href: string | null = await page.evaluate((src) => {
    const pattern = new RegExp(src);
    const a = Array.from(document.querySelectorAll("a")).find((x) => pattern.test(new URL(x.href, location.origin).pathname));
    return a ? new URL(a.href, location.origin).pathname : null;
  }, re);
  if (!href) {
    // click a plain cell, not the row centre - rows can contain their own links
    const cell = page.locator("tbody tr").first().locator("td").nth(1);
    if (await cell.count()) {
      try {
        await cell.click({ timeout: 8000 });
        await waitForRecordUrl(page, re);
        const path = new URL(page.url()).pathname;
        if (new RegExp(re).test(path)) href = path;
      } catch { /* ignore */ }
    }
  }
  if (!href) {
    // Route discovery is not a pointer-only audit. RecordTable rows also promise Enter as
    // their open gesture; using that second contract keeps an unrelated overlay defect on
    // one list from silently dropping its record and edit routes from this guard.
    const recordRow = page.locator("tbody tr").first();
    if (await recordRow.count()) {
      try {
        await recordRow.focus({ timeout: 4000 });
        await page.keyboard.press("Enter");
        await waitForRecordUrl(page, re);
        const path = new URL(page.url()).pathname;
        if (new RegExp(re).test(path)) href = path;
      } catch { /* ignore */ }
    }
  }
  return href;
}

test("design rule audit", async ({ page, browser }) => {
  test.setTimeout(75 * 60 * 1000);
  const baseURL = test.info().project.use.baseURL;
  const viewport = { width: 1440, height: 900 };

  const findings = emptyFindings();
  const seen = new Set<string>();
  const focusSeen = new Set<string>();
  const unreachable: string[] = [];
  const emptyLists: string[] = [];
  const audited: string[] = [];
  let focusSampled = 0;

  const audit = async (p: Page, route: string, scope: Scope, record = false) => {
    try {
      await p.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForTimeout(1300);
      // A route that is still loading renders a skeleton in place of its shell, and a probe
      // on the skeleton reports a missing PageShell, rail or header that is not missing.
      await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 10000 }).catch(() => {});
    } catch { unreachable.push(route); return; }
    const inScope = !OUT_OF_SCOPE.test(route);
    const dataTitled = record || scope !== "dashboard" || /\/\d+(\/|$)/.test(route);
    const r = await probeRoute(p, { route, scope, record, inScope, dataTitled });
    if (inScope) {
      const f = await probeFocus(p, focusSeen);
      focusSampled += f.focused;
      r.focus = f.invisible;
    }
    audited.push(route);
    for (const k of CATEGORIES) {
      for (const v of r[k] ?? []) {
        const key = `${k}|${v}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings[k].push(`${route}  ${v}`);
      }
    }
  };

  // --- 1. The CRM admin ------------------------------------------------------------------------
  await loginAsAdmin(page);
  await page.setViewportSize(viewport);

  const routes: Array<{ route: string; record: boolean }> = STATIC_ROUTES.filter(inRouteScope).map((route) => ({ route, record: false }));
  for (const l of LISTS) {
    if (!inRouteScope(l.list)) continue;
    const href = await discoverRecord(page, l.list, l.re);
    if (!href) {
      // A list that rendered its empty state was reached; it has no record to open. Since
      // e2e runs on a fresh database (13a H29), the ERP document lists start empty.
      if (await page.locator('main [data-slot="empty-state"]').count()) emptyLists.push(l.list);
      else unreachable.push(l.list);
      continue;
    }
    for (const s of l.suffixes) routes.push({ route: href + s, record: Boolean(l.record) && s === "" });
  }
  // Custom modules are tenant data, so the route is found in the sidebar rather than named.
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const customBase = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find((x) => /^\/dashboard\/custom\/[^/]+$/.test(new URL(x.href).pathname));
    return a ? new URL(a.href).pathname : null;
  });
  if (!inRouteScope("/dashboard/custom")) {
    // Out of this run's scope (E2E_ROUTES).
  } else if (customBase) {
    routes.push({ route: customBase, record: false }, { route: `${customBase}/new`, record: false });
    const record = await discoverRecord(page, customBase, `^${customBase}/\\d+$`);
    if (record) routes.push({ route: record, record: true }, { route: `${record}/edit`, record: false });
  } else {
    unreachable.push("/dashboard/custom/* (no custom module in this tenant)");
  }

  // Canary: a check that cannot fail is not a guard. Plant one violation per rendered check
  // on a real route, probe it, and require every check to see its canary before trusting a
  // clean walk. The source-level checks were proven the same way, once, by hand (5.10 batch 1);
  // this one runs every time.
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => Boolean(document.querySelector('main div.overflow-y-auto [data-slot="page-shell"]')), undefined, { timeout: 20000 });
  // Plant only once the page has settled: the dashboard re-renders its content as the
  // widgets load, and a canary planted earlier is thrown away with it - which reads as a
  // blind check when the check never saw a canary at all.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "guard-canary";
    host.innerHTML = `
      <span class="guard-canary" style="font-size:13px">canary</span>
      <div class="guard-canary" style="width:320px;height:80px;border:1px solid var(--color-border-subtle);border-radius:12px"></div>
      <input class="guard-canary" aria-label="canary" style="border:1px solid var(--color-border-subtle);height:38px" />
      <div class="guard-canary"><button class="guard-canary" data-slot="button" style="height:32px">Canary Button</button><button class="guard-canary" data-slot="button" style="height:38px">canary</button></div>
      <a class="guard-canary" href="#canary" style="outline:none !important;box-shadow:none !important">canary focus</a>
      <input class="guard-canary" placeholder="no name" style="height:38px" />
      <table class="guard-canary"><tbody>${Array.from({ length: 5 }, () => '<tr><td><span style="color:var(--color-success)">paid</span></td></tr>').join("")}</tbody></table>`;
    document.querySelector("main div.overflow-y-auto")?.prepend(host);
  });
  expect(await page.locator("#guard-canary .guard-canary").count(), "the canary is planted").toBe(9);
  const canary = await probeRoute(page, { route: "/dashboard", scope: "dashboard", record: false, inScope: true, dataTitled: false });
  const canaryFocus = await probeFocus(page, new Set());
  const canaryPresent = await page.locator("#guard-canary a").count();
  const canaryHits = {
    typeRamp: canary.typeRamp, cardBorder: canary.cardBorder, controlBorder: canary.controlBorder,
    titleCase: canary.titleCase, siblingHeight: canary.siblingHeight, colourBudget: canary.colourBudget,
    focus: canaryFocus.invisible, controlName: canary.controlName,
  };
  const blind = Object.entries(canaryHits).filter(([, hits]) => !hits.some((h) => h.includes("guard-canary"))).map(([k]) => k);
  expect(blind, `rendered checks that did not see their planted violation — focus probe: ${JSON.stringify({ ...canaryFocus, present: canaryPresent })}`).toEqual([]);

  for (const { route, record } of routes) await audit(page, route, "dashboard", record);

  // The hub is the one settings index, so it reaches every settings page.
  await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded", timeout: 45000 });
  // The hub renders after the admin check resolves; read it once its links are there.
  await page.locator('[data-slot="settings-hub"] a').first().waitFor({ timeout: 45000 });
  const hubHrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-slot="settings-hub"] a[href^="/dashboard/settings/"]')).map((x) => new URL(x.href).pathname),
  );
  const settingsPages = STATIC_ROUTES.filter((r) => /^\/dashboard\/settings\/[^/]+$/.test(r) && inRouteScope(r));
  for (const destination of settingsPages) {
    if (!hubHrefs.includes(destination)) findings.settingsNav.push(`${destination}  not reachable from the hub`);
  }

  // The active option in a listbox, both themes.
  const listboxes = [
    { name: "SearchableSelect", trigger: '[data-slot="searchable-select-trigger"]', content: '[data-slot="searchable-select-content"]', option: '[role="option"][data-active="true"]' },
    { name: "Select", trigger: '[data-slot="select-trigger"]', content: '[data-slot="select-content"]', option: '[data-slot="select-item"][data-highlighted]' },
  ];
  const listboxEvidence: string[] = [];
  for (const box of listboxes) {
    let measuredOn: string | null = null;
    for (const route of ["/dashboard/sales/leads/new", "/dashboard/sales/opportunities/new", "/dashboard/sales/quotes/new", "/dashboard/tasks", "/dashboard/settings/general"]) {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      if (!(await page.locator(box.trigger).count())) continue;
      for (const theme of ["dark", "light"] as const) {
        const ground = await setTheme(page, theme);
        const m = await measureActiveOption(page, box.trigger, box.content, box.option);
        if (!m) { findings.focus.push(`${route}  ${box.name} (${theme}) opened with no active option`); continue; }
        listboxEvidence.push(`${box.name} ${theme} (body ${ground}): best ${m.best.toFixed(2)}:1 — fill ${m.fill.toFixed(2)}, ring ${m.ring.toFixed(2)}, outline ${m.outline.toFixed(2)}`);
        if (m.best < 3) findings.focus.push(`${route}  ${box.name} active option ${m.best.toFixed(2)}:1 against the popover (${theme})`);
      }
      await setTheme(page, "dark");
      measuredOn = route;
      break;
    }
    if (!measuredOn) unreachable.push(`${box.name} (no trigger on any sampled form)`);
  }

  // Reduced motion (§6): the platform stops every loop, so nothing is left running.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motionRoutes = ["/dashboard", "/dashboard/sales/leads"];
  const running: string[] = [];
  for (const route of motionRoutes) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const loops = await page.evaluate(() =>
      document.getAnimations()
        .filter((anim) => {
          if (anim.playState !== "running") return false;
          const timing = anim.effect?.getComputedTiming();
          return !timing || timing.iterations === Infinity || Number(timing.activeDuration) > 50;
        })
        .map((anim) => {
          const target = (anim.effect as KeyframeEffect | null)?.target as Element | null;
          const name = (anim as CSSAnimation).animationName ?? anim.id ?? "animation";
          return `${name} on <${target?.tagName.toLowerCase() ?? "?"} class="${String((target as HTMLElement | null)?.className ?? "").slice(0, 60)}">`;
        }),
    );
    loops.forEach((l) => running.push(`${route}  ${l}`));
  }
  await page.emulateMedia({ reducedMotion: null });

  // --- 2. Nobody: auth, the booking page, the shared client page, the proposal ------------------
  const anonymous = await browser.newContext({ baseURL, viewport });
  const anonPage = await anonymous.newPage();
  for (const route of PUBLIC_ROUTES.filter(inRouteScope)) await audit(anonPage, route, "public");
  await anonymous.close();

  // --- 3. A client-portal user, a separate auth boundary --------------------------------------
  const clientRoutes = CLIENT_ROUTES.filter(inRouteScope);
  const clientRecordLists = CLIENT_RECORD_LISTS.filter(inRouteScope);
  const portal = await browser.newContext({ baseURL, viewport });
  const portalPage = await portal.newPage();
  if (clientRoutes.length || clientRecordLists.length) {
    await portalPage.goto("/client/login?tenant=default", { waitUntil: "networkidle", timeout: 45000 });
    await portalPage.getByLabel(/email/i).fill(CLIENT_EMAIL);
    await portalPage.getByLabel(/password/i).fill(CLIENT_PASSWORD);
    await portalPage.getByRole("button", { name: /sign in|log in/i }).click();
    await portalPage.waitForURL((u) => !u.pathname.includes("/client/login"), { timeout: 30000 });
    for (const route of clientRoutes) await audit(portalPage, route, "portal");
    for (const list of clientRecordLists) {
      const href = await discoverRecord(portalPage, list, `^${list.replace(/\//g, "\\/")}\\/(?!new$)[^/]+(\\/[^/]+)?$`);
      if (href) await audit(portalPage, href, "portal", true);
      // The seeded client has no bookings, messages or orders, so those lists render their
      // empty state and there is no record to open. That is data, not a route the audit lost.
      else if (await portalPage.locator('[data-slot="empty-state"]').count()) emptyLists.push(list);
      else unreachable.push(`${list}/[id]`);
    }
  }
  await portal.close();

  console.log(`Audited ${audited.length} routes, ${describeRouteScope()}. Unreachable: ${unreachable.join(", ") || "none"}`);
  // A scope that matches nothing would pass while checking nothing.
  if (ROUTE_SCOPE.length) expect(audited.length, `E2E_ROUTES matched no route: ${ROUTE_SCOPE.join(", ")}`).toBeGreaterThan(0);
  console.log(`Empty in this tenant, no record audited: ${emptyLists.join(", ") || "none"}`);
  console.log(`Focus: ${focusSampled} distinct focusable shapes sampled.`);
  console.log(`Listbox: ${listboxEvidence.join("; ") || "not measured"}`);

  expect.soft(findings.uppercase, "uppercase / faked small caps (design.md 3.5)").toEqual([]);
  expect.soft(findings.font, "body must render in Inter (design.md 3.1)").toEqual([]);
  expect.soft(findings.radius, "radius outside the token scale (design.md 4.3)").toEqual([]);
  expect.soft(findings.mono, "monospace outside secrets and raw payloads (design.md 3.2)").toEqual([]);
  expect.soft(findings.controlHeight, "control height outside 32/38/44 (design.md 4.2)").toEqual([]);
  expect.soft(findings.nesting, "more than 2 levels of visible container (design.md 1.3)").toEqual([]);
  expect.soft(findings.formTitle, "a form route with no visible title (design.md 4.7, archetype 3)").toEqual([]);
  expect.soft(findings.formFooter, "a form route not on FormFooter (design.md 4.7, R4)").toEqual([]);
  expect.soft(findings.formSticky, "a bottom-anchored sticky bar inside a form (rebuild.md R3)").toEqual([]);
  expect.soft(findings.typeRamp, "text off the type ramp 11/12/14/16/18 (design.md 3.3)").toEqual([]);
  expect.soft(findings.pageRoot, "a dashboard route whose root is not PageShell (design.md 4.7)").toEqual([]);
  expect.soft(findings.cardBorder, "a panel bounded by line-subtle (design.md 1.3)").toEqual([]);
  expect.soft(findings.controlBorder, "a control bounded by a sub-3:1 token (design.md 8)").toEqual([]);
  expect.soft(findings.titleCase, "Title Case in product copy (design.md 3.5)").toEqual([]);
  expect.soft(findings.siblingHeight, "buttons in one row at different heights (rebuild.md R4)").toEqual([]);
  expect.soft(findings.colourBudget, "most rows of a list carry colour (rebuild.md R5)").toEqual([]);
  expect.soft(findings.archetype, "a record route not on RecordWorkspace (design.md 4.7, archetype 2)").toEqual([]);
  expect.soft(findings.settingsNav, "settings navigation: a rail is back, a page lacks its back arrow, or the hub misses a page").toEqual([]);
  expect.soft(findings.focus, "focus that does not show (design.md 2.3, 8)").toEqual([]);
  expect.soft(findings.controlName, "a form control with no accessible name (design.md 8)").toEqual([]);
  expect.soft(running, "an animation still running under reduced motion (design.md 6)").toEqual([]);
  expect(unreachable.filter((u) => !u.startsWith("/dashboard/custom")), "routes the audit could not reach").toEqual([]);
});
