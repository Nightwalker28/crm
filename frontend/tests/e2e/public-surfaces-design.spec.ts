// Extends the design and scroll rules to the surfaces a CRM admin session cannot reach:
// the client portal (separate auth boundary), the public booking page, the shared client
// page, and the public quote proposal.
//
// These were previously audited while signed in as a CRM admin, which just redirected to
// the client login - so they were never really checked.
//
// Records and tokens come from `scripts/seed_module_samples.py` and `seed_demo_crm.py`.
import { expect, test } from "@playwright/test";

const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL ?? "hello@bluewave-logistics.example";
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD ?? "Client@123456";
const TENANT = "default";

const UNAUTHENTICATED = [
  "/client/login",
  "/book/maad-mustafa/quickmeetings",
  "/client/pages/public-page-1-23",
  "/public/quotes/proposal/sample-proposal-1-1",
];

const CLIENT_ROUTES = [
  "/client",
  "/client/documents",
  "/client/messages",
  "/client/orders",
  "/client/quotes",
  "/client/catalog",
  "/client/support",
  "/client/bookings",
];

const ALLOWED_RADII = ["0px", "2px", "4px", "6px", "8px", "10px", "12px", "14px", "9999px", "3.35544e+07px"];

async function probe(page: import("@playwright/test").Page) {
  return page.evaluate(
    (args) => {
      const out = { uppercase: [] as string[], mono: [] as string[], radius: [] as string[], scroll: [] as string[], font: [] as string[] };
      const visible = (el: Element) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const label = (el: Element) => {
        const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
        return `<${el.tagName.toLowerCase()} class="${cls.slice(0, 60)}">`;
      };
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        if (!visible(el)) return;
        const cs = getComputedStyle(el);
        if (cs.textTransform === "uppercase" && (el.textContent || "").trim()) out.uppercase.push(label(el));
        const ff = cs.fontFamily.toLowerCase();
        if (/mono|courier|consolas|menlo/.test(ff) && (el.textContent || "").trim() && !el.querySelector("*") && el.tagName !== "CODE" && el.tagName !== "PRE") {
          out.mono.push(label(el));
        }
        for (const c of ["borderTopLeftRadius", "borderBottomRightRadius"] as const) {
          const v = cs[c];
          if (v && v !== "0px" && !args.radii.includes(v) && !v.includes("%")) out.radius.push(`${v} ${label(el)}`);
        }
      });
      // these surfaces scroll as one document; nothing inside them may scroll too
      const docScrolls = document.documentElement.scrollHeight > window.innerHeight + 2;
      if (docScrolls) {
        document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          const oy = getComputedStyle(el).overflowY;
          if (!(oy === "auto" || oy === "scroll")) return;
          if (el.scrollHeight <= el.clientHeight + 2) return;
          if (el.closest('[role="dialog"], [data-slot="sheet-content"], [role="listbox"], [data-bounded-list]')) return;
          out.scroll.push(label(el));
        });
      }
      if (!/inter/i.test(getComputedStyle(document.body).fontFamily)) out.font.push(getComputedStyle(document.body).fontFamily);
      return out;
    },
    { radii: ALLOWED_RADII },
  );
}

test("public and client-portal surfaces follow the design rules", async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  await page.setViewportSize({ width: 1280, height: 700 });

  const v = { uppercase: [] as string[], mono: [] as string[], radius: [] as string[], scroll: [] as string[], font: [] as string[] };
  const visited: string[] = [];
  const collect = async (route: string) => {
    const r = await probe(page);
    visited.push(route);
    for (const k of Object.keys(v) as Array<keyof typeof v>) {
      for (const item of r[k]) if (!v[k].includes(`${route}  ${item}`)) v[k].push(`${route}  ${item}`);
    }
  };

  for (const route of UNAUTHENTICATED) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    await collect(route);
  }

  // client portal has its own auth boundary
  await page.goto(`/client/login?tenant=${TENANT}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.getByLabel(/email/i).fill(CLIENT_EMAIL);
  await page.getByLabel(/password/i).fill(CLIENT_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/client/login"), { timeout: 30000 });

  for (const route of CLIENT_ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    await collect(route);
    // first detail record on this list, if any
    const link = page.locator(`a[href^="${route}/"]`).first();
    if (await link.count()) {
      const href = await link.getAttribute("href");
      if (href) {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(1400);
        await collect(href);
      }
    }
  }

  console.log(`Audited ${visited.length} public/client routes:\n  ${visited.join("\n  ")}`);
  expect(v.font, "body must render in Inter (design.md 3.1)").toEqual([]);
  expect(v.uppercase, "uppercase / faked small caps (design.md 3.5)").toEqual([]);
  expect(v.radius, "radius outside the token scale (design.md 4.3)").toEqual([]);
  expect(v.mono, "monospace outside secrets and raw payloads (design.md 3.2)").toEqual([]);
  expect(v.scroll, "nested scroll inside a scrolling page (design.md 4.5)").toEqual([]);
});
