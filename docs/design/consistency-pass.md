# Lynk frontend: consistency pass

## Context

Lynk's design system is mature and well-guarded. `docs/design/design.md` and
`docs/design/tokens.md` are detailed and authoritative, and two Playwright specs
(`design-rules.spec.ts`, `scroll-containers.spec.ts`) walk every route enforcing
uppercase, font family, radius scale, monospace, control heights, container nesting,
and scroll containment.

So why does the app read as inconsistent? Because **every primitive in this codebase is
element-level, and every guard is element-level. Nothing owns composition.**

That one sentence explains all three audits:

- `Table.tsx` standardizes a *cell*. Nothing standardizes a *table* — so 13 modules
  hand-assemble 3,403 lines of list mechanics against a 202-line primitive.
- `Card`, `Button`, `Input` standardize a *control*. Nothing standardizes a *page* —
  so 27 page roots invent six different stack rhythms.
- `design-rules.spec.ts` reads computed style per element. Every drifted table passes
  it, because the cells genuinely are identical. The differences are structural: a
  column that exists here and not there, a 920px vs 1160px min-width, a sticky offset
  of 10 vs 12.

The headline measurement: `design.md` §4.4 specifies a `space-y-6` section stack.
**One** of 27 dashboard page roots uses it. Settings specifies `space-y-8`; **zero** of
19 settings pages use it. Not because anyone ignored the doc — because no primitive
supplies that rhythm and no guard checks it.

**Decisions taken for this pass** (confirmed with the owner):

1. **Code follows the doc.** `design.md` stays authoritative; pages get swept onto the
   documented ladder. Where the ladder is genuinely short a step, the doc is amended
   first, per §12.
2. **Consistency only — no behaviour change.** No new flows, no quick-create rollout,
   no inline editing. Workflow findings are in **Appendix A**, out of scope.
   Functional bugs surfaced by the audit are in **Appendix B** and need their own call.
3. **This document is the deliverable.** Nothing is implemented in this pass.

---

## Evidence

Three parallel audits covered list pages, detail/form pages, and shell/settings/portal.
Everything below is reproducible with the greps in Verification.

### Layer 1 — Tables: a cell primitive doing a table primitive's job

`components/ui/Table.tsx` (202 lines) exports 11 wrappers over `<table>`/`<thead>`/
`<tr>`/`<th>`/`<td>`. It correctly standardizes cell padding, row stripes, sticky
header, sort icons, and density. Everything above the cell is duplicated 13 times:

| Not in the primitive | Drift |
|---|---|
| Wrapper `min-w-[Npx]` | **9 values**: 840/900/920/960/980/1040/1080/1120/1160. pos (1080) and insertion-orders (1040) differ by 40px for near-identical columns. All fixed regardless of how many columns the user left visible. |
| Selection checkbox | 3 markups. leads/contacts/orgs/deals/quotes compute tri-state `indeterminate`; pos/payments use a plain boolean, so partial selection shows an unchecked box there and a dash elsewhere. |
| Sticky identity column | 6 of 16 have it. `left-12` on four, `left-10` on pos/payments. Quotes' header checkbox isn't sticky (`QuotesTable.tsx:174`) so the sticky number floats over a 48px hole. |
| Row-open gesture | **4 spellings** — whole-row click (7 lists, mouse-only), row click + keydown (cases: Enter+Space; tasks: Enter only), link in one identity cell (orders/quotes/pos/payments), none at all (documents). |
| Empty state | 3 ship no create action (`TasksTable.tsx:202`, `SupportCasesTable.tsx:111`, `OpportunitiesTable.tsx:257`), against §7.4. |

Sizes: `documents/DocumentList.tsx` 436, `insertionOrderList.tsx` 382, catalog 349,
contacts 299, deals 290 … 3,403 lines total.

Aggravating factor: `Table` accepts `className` on every part and defines **no
variants**, so divergence is one prop away and §7.3 has nothing to enforce.

### Layer 2 — Pages: no page shell

No page-shell primitive exists in `components/ui/`. Every page hand-writes its root.

| Page root stack | Count |
|---|---|
| `space-y-3` | 13 |
| `space-y-4` / `space-y-2` | 4 / 4 |
| `space-y-5` / `space-y-1` | 3 / 2 |
| `space-y-6` (**documented**) | 1 |

`PageHeader` and `PageToolbar` are the same component — a right-aligned action row —
with different spacing (`PageToolbar` has `min-h-9`, `PageHeader` doesn't). 14 files use
one, 18 use the other, **0 use both**. `PageHeader` is also the only thing that emits
the `sr-only` `h1`, so pages using `PageToolbar` ship **no `h1` at all** (§8) —
`MessageTemplateRecordFormPage.tsx:126`, `settings/modules/[moduleId]:232`.

Only 14 list pages carry the §11.1 full-height root. `CatalogRecordsPage.tsx:111` lacks
`h-full min-h-0`, so `ModuleTableShell`'s `flex-1` is inert and its toolbar scrolls away
— unique among canonical-toolbar pages.

### Layer 3 — Card, and 205 boxes that aren't one

`design.md` §11.0 recorded 93 hand-rolled card-shaped boxes against 63 files using
`<Card>`. It is now **205 vs 67** — the drift is accelerating, so a change to `Card`
reaches well under half of the things that look like cards.

`Card` itself has three problems:

- **Border tier is wrong.** `Card` uses `border-line-subtle`; `ModuleTableShell` and
  `ModuleListToolbar` use `border-line-default`. Per `tokens.md` §2 those are different
  tiers ("row dividers, seams" vs "panel edges") — a card *is* a panel edge. Every card
  beside a table has a visibly lighter edge.
- `variant="raised"` uses `shadow-lg shadow-black/20` — a raw Tailwind shadow, where
  §4.6 says anchored things get no shadow and dark elevation comes from the
  `bg-surface-raised` ground the variant already sets.
- `CardHeader`/`CardBody`/`CardFooter` pad at `pt-6`/`py-5`/`py-4` — three vertical
  steps in one component.

Same-role boxes split across two radii and two border tokens: activity/comment/task
rows use `radius-control + border-line-default` in
`components/recordActivity/*`, and `radius-card + border-line-subtle` in
`contacts/[contactId]:869`, `organizations/[orgId]:705`, `opportunities:373`,
`pos/[invoiceId]:119`.

### Layer 4 — Detail pages: five archetypes

| Archetype | Records |
|---|---|
| `RecordWorkspace` + rail + `RecordTabs` + `ReadOnlyRecordLayout` | lead, contact, account |
| Hand-rolled `flex flex-col gap-6` + `RecordTabs` | deal |
| Hand-rolled long scroll, no tabs | quote, order |
| `Card`/`CardHeader`/`CardBody` grid, no tabs | insertion order, contract |
| `RecordPageHeader` + tabs | invoice, custom module |

Consequences: **tabs nested inside tabs** on six pages (`CrmRecordActivitySection`
*is* a `RecordTabs`, rendered inside another one — deals show `Overview|Related|Activity`
then a second identical strip inside Activity). Notes/Tasks/Documents live in three
different homes, so "add a note" is 0 clicks, 2 clicks, or impossible depending on
record. **Contracts have no activity, notes, documents or tasks at all.** Contacts and
accounts have no `RecordActivityFeed` though leads do. Support cases carry two comment
systems and two histories on one screen.

Read-only field rendering has **two implementations**: `ReadOnlyRecordLayout` (3 pages)
and six near-identical private `DetailField`/`Summary` components, each drifted on label
ink, weight, and value ink.

Smaller vocabularies that add up:

- **Section heading: 4 sizes** for one role — `text-lg` (29), `text-base` (37),
  `text-sm` (16), bare `font-semibold` (17).
- **Empty value: 6 strings** — "Not set", "Not recorded", "Not provided",
  "Unassigned", "—", "-".
- **Links: 4 classes** — `text-link`, `text-action-primary`, `text-primary`,
  `hover:text-action-primary`. §2.2 says body links are `text-copy-primary` + underline
  offset; none match.
- **Two-column split: 10 different ratios**, breakpoint flipping between `lg` and `xl`.
- **Pending labels** split "Saving…" vs "Saving..." roughly 50/50.
- **Title Case leaks** — "Save Quote", "New Contract", "Add Task", "New Product",
  "Module Settings". The uppercase guard cannot see Title Case.
- `contracts/[contractId]:244` renders raw foreign keys to the user
  (`` `User #${item.owner_id}` ``); support cases resolve the same field to a name.

### Layer 5 — Settings: 19 pages, ~19 archetypes

| Concern | Reality |
|---|---|
| Root stack | `gap-5` ×10, `gap-6` ×5, `gap-4` ×1, 3 bespoke. Documented `space-y-8`: **never**. |
| Header | `PageToolbar` ×10, nothing ×9, `PageHeader` ×0. **No settings page has a visible title or description.** |
| Section heading | 4 sizes (`text-sm`/`text-base`/`text-lg`/bare) |
| Editing container | **8 patterns** — sheet, in-page + sticky page footer, in-page + sticky CardFooter, toolbar save, dialog, inline panel, separate route, **autosave** |
| Tables | `ModuleTableShell` ×8, raw `Table` in a hand-rolled div ×2, bespoke ×4 |
| Default ink | 7 pages redeclare `text-copy-primary`/`-secondary` **on the root**, disagreeing with each other |
| `PermissionDeniedState` | **1 of 20** |
| Error state | 3 competing idioms; 7 pages have none |
| Loading | 4 expressions (`RouteLoadingState`, `Skeleton`, inline `<TableRow>`, plain paragraph) |

`authentication/page.tsx` is the sharpest case: the MFA select at `:45` saves on change,
while the SSO block 40 lines down requires an explicit Save/Discard footer. One page,
two commit models, no visual distinction.

`SettingsSwitchRow` — a purpose-built settings primitive — is used in **2 files**.
`switch.tsx` is used in **zero** settings pages. Everything else is a bare `Checkbox`
with a hand-written label.

Navigation: `settings/layout.tsx` is a 5-line passthrough. **Zero breadcrumbs
repo-wide.** No sub-nav, no back links outside error states. Settings page → settings
page costs 3 clicks through the hub. Two IAs disagree — `SETTINGS_NAV_ITEMS` (flat, 18)
vs the hub's `SETTINGS_SECTIONS` (6 groups, 19) — leaking `record-layouts`, which is
invisible to ⌘K and renders Title Case from a label fallback.

### Layer 6 — Client portal: a second app, not a second theme

`find app/client -name layout.tsx` → **nothing**. All 14 client pages hand-roll the same
shell; 20 repeats of `min-h-screen bg-app`, 21 of the `font-lynk` wordmark. Container
width already drifts `max-w-6xl`/`5xl`/`4xl`/`md`.

The portal imports **one** dashboard primitive of consequence (`Button`) — no `Card`,
no `EmptyState`, no `RouteStates`, no `Pill`. So 18 hand-written loading/empty/error
blocks repeat the shape `EmptyState` exists to provide. Type runs `text-2xl`/`text-3xl`
`h1`s where §3.3 caps product UI at `text-lg`.

**Why this drifted furthest: the guard does not visit it.** `design-rules.spec.ts` walks
10 `/client/*` list routes and **zero** of `/auth/*`, `/book/**`,
`/public/quotes/proposal/[token]`, `/client/pages/[token]`, or any `/client/*/[id]`
detail page. Also unwalked: `/dashboard/views/[moduleKey]`, `/dashboard/custom/**`,
`settings/message-templates/[id]/edit`.

### Layer 7 — Type ramp, spacing vocabulary, elevation

- **22 `text-[Npx]` escapes.** `text-[11px]` ×12 (a token, `text-2xs`, already exists),
  `text-[10px]` ×4 and `text-[9px]` ×3 (below the ramp entirely), `text-[13px]` ×1
  (`SidebarNav.tsx:166` — a size §11 says was never introduced). Two are in shared
  primitives (`ModuleListToolbar.tsx:53`, `InlineSavedViewFilters.tsx:46`) so they
  render on every list page.
- **`gap-5` ×32 and `p-5` ×81** — 113 uses of a step §4.1 does not contain. Card padding
  is simultaneously `p-4` (77), `p-5` (81), `p-6` (25) while `CardBody` uses `px-6 py-5`.
- **5 elevation vocabularies** for floating layers: `shadow-xl`, `shadow-lg`,
  `shadow-sm`, `shadow-[0_32px_100px_rgba(...)]`, `shadow-[var(--shadow-panel)]`.
  §4.6 names one token.
- **Zero arbitrary pixel spacing.** The 4px grid holds; only the vocabulary is too wide.
- `custom-scrollbar` is used on 3 bounded lists and **is not defined in `globals.css`** —
  dead class, so those render native scrollbars while everything else uses
  `.scrollbar-hide`.

### Layer 8 — Stale doc

§11.0 lists `RecordTabs` and `ColumnPicker` as accessibility defects on raw buttons and
an undismissable div. Commit `e6a53f8` rebuilt both on Radix. The doc will keep sending
agents to re-fix solved problems until corrected.

But the defect **reappeared elsewhere**: `views/[moduleKey]/page.tsx:131` hand-rolls a
`role="tablist"` from raw buttons with no `onKeyDown`, no roving tabindex, no
`aria-controls` — the exact pattern §11.0 records as fixed.

---

## Approach

Three ideas carry the plan.

**Add the missing composition layer.** Pages and tables drift because nothing supplies a
correct default. Add a page shell and a record-table composition, migrate onto them, and
the drift has nowhere to live.

**Fix primitives before pages.** Every phase is ordered so shared components land first;
sweeping pages against a primitive that is about to change is wasted work.

**Guard composition, not just elements.** The existing spec is excellent at what it
does and structurally blind to this whole class of problem. Extending it — and widening
its route list to the surfaces that drifted furthest — is what makes the pass permanent.

Phases are independently shippable. Each ends green on lint, build, and both guards.

---

## Phase 0 — Correct the source of truth

No product code. Do this first so later phases have something true to check against.

- §11.0: mark `RecordTabs` / `ColumnPicker` resolved (cite `e6a53f8`); update the
  card-box count to the measured 205 vs 67; add `views/[moduleKey]:131` as a new
  instance of the raw-tablist defect.
- §4.1: rule on `gap-5` / `p-5`. **Recommendation: declare them out.** A dense-CRM
  ladder of 2/3/4/6/8 is already tight, and the 5-step is why card padding has three
  values.
- §4.4: add the page-shell and record-table contracts from Phases 1 and 3.
- §3.5: note that Title Case is in scope for the sentence-case rule and that the
  `uppercase` guard cannot detect it.
- Record the `PageHeader`/`PageToolbar` convergence decision.

**Files:** `docs/design/design.md`, `docs/design/tokens.md`.

---

## Phase 1 — The page shell

Add `components/ui/PageShell.tsx`, owning the page root:

- `variant="list"` → the §11.1 full-height column (`flex h-full min-h-0 flex-col gap-4`)
- `variant="document"` → scrolling form/settings page at the documented section stack
- emits `data-slot="page-shell"` so Phase 8 can guard it

**Converge `PageHeader` and `PageToolbar`.** Keep the `PageHeader` name (the docs
reference it), fold in `PageToolbar`'s `context` slot and `min-h-9`, and re-export
`PageToolbar` as a deprecated alias so 18 call sites keep compiling. This also fixes the
missing-`h1` bug, since the merged component always emits the `sr-only` heading.

Preserve exactly: the `sr-only` `h1` contract (§8 — correct, must not become visible),
and `ModuleTableShell`'s no-max-height rule (§11.1).

**Files:** new `PageShell.tsx`; `PageHeader.tsx`, `PageToolbar.tsx`.

---

## Phase 2 — Fix the shared primitives

Before any page is touched.

- **`Card`**: `surface`/`muted` → `border-line-default` to match the table shell; drop
  `shadow-lg shadow-black/20` from `raised`; settle header/body/footer on one vertical
  step. **Also resolve the `overflow-hidden` clipping bug — see Appendix B.1.**
- **Type-ramp escapes in primitives**: `ModuleListToolbar.tsx:53` and
  `InlineSavedViewFilters.tsx:46` → `text-2xs`. These two fixes correct every list page
  at once. `SidebarNav.tsx:166` `text-[13px]` → `text-sm`.
- **Checkbox contrast**: five call sites override the primitive's `border-line-control`
  with `border-line-strong`, which is a structural hairline below 3:1 — a WCAG 1.4.11
  regression created by copy-paste (`settings/fields:681,735`, `settings/backups:643`,
  `settings/modules/[moduleId]:142,207`, `ColumnPicker.tsx:131`). Delete the overrides;
  the primitive is already correct. Same for the four indicator sizings.
- **Elevation**: collapse the five shadow vocabularies onto `--shadow-panel`.
- Define or remove the dead `custom-scrollbar` class.

Expect a visible-but-correct change: card edges get slightly stronger everywhere.
Screenshot before/after in both themes.

**Files:** `components/ui/Card.tsx`, `ModuleListToolbar.tsx`, `InlineSavedViewFilters.tsx`,
`components/sidebar/SidebarNav.tsx`, the five checkbox call sites, `app/globals.css`.

---

## Phase 3 — The record-table composition

The largest structural win. Add `components/ui/RecordTable.tsx` above the existing
cell primitives, owning what all 13 module tables currently duplicate:

- column-count-derived min-width (replacing 9 hardcoded values, and fixing the bug where
  trimming a view to 3 columns still forces a 1160px scrollbar)
- the selection column: one width, one sticky offset, one indicator size, tri-state
  everywhere
- the sticky identity column
- **one row-open gesture**, keyboard-activable — this fixes 7 mouse-only lists and the
  Enter-vs-Enter+Space disagreement
- empty / loading / error slots, defaulting to `EmptyState` + `ModuleTableLoading` with
  the create action always wired

Then migrate the 13 tables onto it, one module at a time. Expect the 3,403 lines to fall
by well over half.

Add `cva` variants for the two or three legitimate differences (with/without selection,
with/without row actions) so §7.3 has something to enforce and the next divergence has a
named home.

**Files:** new `components/ui/RecordTable.tsx`; `components/{leads,contacts,organizations,
opportunities,orders,quotes,contracts,support,tasks,catalog,documents}/…Table.tsx`,
`components/finance/{pos/InvoicesTable,PaymentsTable,insertionOrderList}.tsx`,
`app/dashboard/custom/[moduleKey]/page.tsx` (whose table is inline in the route file —
extract it while migrating).

---

## Phase 4 — Migrate pages onto the shell

Mechanical, one area at a time, verifying after each.

1. **Sales** — closest to canonical; proves the migration.
2. **Catalog, documents, client-portal** — the lists that never got the §11.1 root.
   `CatalogRecordsPage.tsx:111` is a shared wrapper: fix once, two pages follow.
3. **Finance, contracts, support, tasks, custom modules.**
4. **Settings (19 pages)** — every page onto `PageShell variant="document"` and the
   converged `PageHeader`; delete all 7 root-level `text-copy-*` declarations and both
   `pb-20` magic pads (check what they were clearing first — likely a sticky save bar
   that should be a shell concern). Move the two raw-`Table` pages onto
   `ModuleTableShell`, and drop the `rounded-none border-0` call-site overrides in favour
   of a shell variant.
5. Retire the `PageToolbar` alias once call sites hit zero.

---

## Phase 5 — Detail-page archetype

Consistency only — no inline editing, no new panels (Appendix A).

- Pick one archetype: `RecordWorkspace` + `RecordTabs` + `ReadOnlyRecordLayout`, and
  move the other four onto it.
- **Retire the nested-tabs pattern.** `CrmRecordActivitySection` is itself a
  `RecordTabs`; stop rendering it inside another one on the six affected pages.
- Replace the six private `DetailField`/`Summary` components with
  `ReadOnlyRecordLayout`.
- Fix `views/[moduleKey]:131` — the hand-rolled `role="tablist"` — onto `RecordTabs`.
- Give leads' tab order a default that matches its first tab.

---

## Phase 6 — The copy and vocabulary sweep

Cheap, high-signal, and best done once the structure is settled.

- **One section-heading size** per role (§3.3: `text-base` inside a page).
- **One empty-value string** (recommend "Not set"; 6 in use).
- **One link treatment** — `text-copy-primary` + underline offset per §2.2 (4 in use).
- **Sentence case** — fix the Title Case leaks the `uppercase` guard cannot see, and the
  runtime title-casers at `SupportCaseCreateFormPage.tsx:260`,
  `support/cases/[caseId]:269`, `insertion-orders/[ioId]:186`.
- **One create-button verb** — "Create X" (currently Create/Add/New/Upload).
- **One pending-label ellipsis** — "Saving…".
- One form-section container, one back-button treatment, one dirty-state string, one
  grid breakpoint (`md`, not a mix of `sm`/`md`), one two-column ratio.
- Resolve the `gap-5`/`p-5` sweep per the Phase 0 ruling.
- `contracts/[contractId]:244,264,265` — resolve foreign keys to names, as support
  cases already do.

---

## Phase 7 — Client portal, public, and auth

- Add `app/client/layout.tsx` carrying the shell all 14 pages hand-roll, plus real
  lateral navigation (today the only route between portal sections is the hub).
- Adopt `Card`, `EmptyState`, `RouteStates`, `Pill` — replacing 18 hand-written state
  blocks.
- Bring portal type onto the product ramp (`text-2xl`/`3xl` `h1`s → `text-lg`).
- Decide deliberately whether `/client/login` should match `/auth/login`'s treatment.
  They are currently two different products; either is defensible, but it should be a
  choice written into `design.md` §9.
- `app/auth/layout.tsx:20,22,28` — three raw `rgba()` gradients in arbitrary values, a
  `tokens.md` §10 forbidden pattern, on the first screen every operator sees.

---

## Phase 8 — Guard composition

Extend `tests/e2e/design-rules.spec.ts` — do not add a new spec; it already walks every
route and logging in is the expensive part.

New checks:

- **Type ramp** — computed `font-size` on visible text must be in {11, 12, 14, 16, 18}.
  Catches the `text-[Npx]` class at the rendered layer.
- **Page-root rhythm** — the first element inside the layout's content scroller must
  carry `data-slot="page-shell"`. This makes Phase 1 permanent.
- **Card border tier** — no visible container at panel size may use `border-line-subtle`
  (reuse the existing `isContainer` predicate at line 188; it already computes this).
- **Control border tier** — no `input`/`select`/`checkbox` bounded by a sub-3:1 token.
  Locks in Phase 2's WCAG fix.
- **Title Case** — visible button/heading text where a non-first word is capitalized and
  isn't a known proper noun. Needs an allowlist; worth it, since §3.5 is currently
  enforced for `uppercase` only.

**Widen the route list** to the surfaces that drifted furthest and are currently
unwalked: `/auth/*`, `/book/**`, `/public/quotes/proposal/[token]`,
`/client/pages/[token]`, `/client/*/[id]`, `/dashboard/views/[moduleKey]`,
`/dashboard/custom/**`, `settings/message-templates/[id]/edit`. This is arguably the
single highest-leverage item in the plan — Layer 6 exists *because* the guard stops at
the portal's list pages.

---

## Verification

Per phase:

```bash
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build
docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1
```

Full suite before the last phase — 58 specs, most areas have one, so a page-root or
table change will surface there if it broke a selector:

```bash
docker compose run --rm frontend-e2e npm run test:e2e
```

Reproduce the audit numbers (from `frontend/`):

```bash
# page-root stack drift — should collapse to one value after Phase 4
grep -rhoE 'space-y-[0-9.]+' app/dashboard --include='page.tsx' | sort | uniq -c | sort -rn

# module table line count — 3,403 today, expect <1,500 after Phase 3
wc -l components/*/[A-Z]*Table.tsx components/*/*[Ll]ist.tsx components/finance/pos/InvoicesTable.tsx

# hardcoded table min-widths — 9 values today, target 0
grep -rn 'min-w-\[[0-9]*px\]' components --include='*.tsx'

# hand-rolled card boxes vs <Card> — 205 vs 67 today
grep -rn 'rounded-\[var(--radius-card)\]' app components --include='*.tsx' | grep -c border

# type-ramp escapes — 22 today, target 0
grep -rnE 'text-\[[0-9]+px\]' app components --include='*.tsx'

# off-ladder spacing — 113 today
grep -rnE '\b(gap|p)-5\b' app components --include='*.tsx' | wc -l

# the two header primitives — target: PageToolbar at 0
grep -rln 'PageToolbar' app --include='*.tsx' | wc -l
```

**Visual pass — both tools, per the owner's call.**

*Playwright* (repeatable, per phase): a screenshot spec over one representative route
per area, captured in **both themes**, before and after each phase. Phase 2 changes card
edges globally and Phase 3 changes every table — both must be eyeballed, not just
asserted. Seed first or detail routes are unreachable:

```bash
docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default
docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
```

*Claude in Chrome* (interactive, for what assertions miss): confirming the Appendix B.1
dropdown clipping, hover/focus/active states, and walking a click path to feel its cost.
Access is verified; the tab needs a signed-in session.

---

## Appendix A — Workflow findings (recorded, NOT in scope)

The brief asked about click cost; the scoping decision was consistency only. Recorded so
they are not lost, for a separately-approved pass. Ordered by cost × frequency.

1. **List state is not addressable.** `usePagedList` and `useSavedViews` hold search,
   filters, sort, page and page size in React state — no URL params, no storage. Opening
   a record from page 4 of a filtered list and pressing back returns you to page 1,
   unfiltered, on 15 of 16 lists. Documents is the only page that does it right, and it
   has none of the other machinery.
2. **Hiding a column: 2 clicks on custom modules, 6+ everywhere else.** `ColumnPicker`
   is wired into exactly **1 of 16** pages. Everywhere else you go to `/dashboard/views/
   <key>`, discover system views can't be edited, duplicate the view, name it, toggle the
   column, save, navigate back, re-select — and you now own a saved view you didn't want.
3. **Create is a sheet on 4 pages, a full page nav on 11.** `OpportunityQuickCreate`
   already exists and is wired into contacts and accounts detail pages — but *not* the
   deals list. Creating a deal from a contact is cheaper than from the deal list.
4. **Editing one field is a page round trip on 9 of 12 record types.** Support cases and
   custom records already edit inline in this shell, proving it works. No side-sheet edit
   exists anywhere. Edit from the Files tab and you return to Details — the `Edit` links
   drop `?tab=`.
5. **Search fires a request per keystroke** on all 14 toolbar pages. No debounce
   anywhere in `usePagedList`, `useSavedViews`, or `SearchBar`.
6. **Bulk selection with no verb** on pos: select-all, per-row checkboxes, and a
   highlighted "3 invoices selected" bar — and nothing consumes `selectedIds`. On
   payments, selecting 3 rows yields "Select one invoice to record a payment".
7. **The payments page's primary button is the slower of its two paths** — the header
   navigates to `/record`, while the row offers the same job in a dialog.
8. **Settings has no lateral navigation.** Any two-page settings task round-trips through
   the hub; setting up a team's access is 6 navigations.
9. **Non-admins are routed into permission walls by the shell** —
   `NotificationCenter.tsx:210`, `routes.ts:86` (the notification href *fallback*), and
   `app/dashboard/page.tsx:404` all point at an admin-only route with no `isAdmin` check.
10. **Field config has no deep link** — selection is local state, so every visit starts
    on the default module and Back loses it.
11. **Reports costs 2 clicks** because a single-item module became a collapsible sidebar
    group, and opening it collapses the group you were in.
12. **Quote → order needs 3 actions** (set status → Save Quote → Convert) because the
    status select isn't persisted by the convert button; the disabled state explains
    itself only in a side tile.
13. **Lead convert is a dedicated route with no unsaved-changes guard** — a mistaken
    sidebar click silently drops the selection.

Also worth a decision: `finance/invoice-generator/page.tsx` is now a 3-line
`redirect()` to `/dashboard/finance/pos` — a stale entry point still in the route list.

---

## Appendix B — Bugs found (need a separate call)

These are defects, not inconsistencies. They surfaced during the audit and are outside a
"consistency only" scope, but B.1 is cheap enough to fold into Phase 2 and B.2 is a
correctness problem worth filing now.

**B.1 — `Card` is `overflow-hidden`, clipping every picker inside a form section.**
`Card.tsx:6` sets `overflow-hidden`; `RecordFormLayout.tsx:41` makes `FormSection` a
`Card`; `LinkedRecordPicker.tsx:353` positions its suggestion list `absolute
top-[calc(100%+8px)]`. So the results list is clipped at the card edge — with ~20px of
padding below, a picker in a section's last row loses nearly the whole list. Affects
~10 forms (quotes, orders, POS invoice, contracts, support case create, contacts, deals,
insertion orders, client portal). Six *settings* pages already worked around it with
`Card className="overflow-visible"`; no record form did. **Fix in Phase 2** — this is
the correct-by-default change, and the workarounds can then be removed.

**B.2 — Custom-module filters are collected and silently discarded.**
`custom/[moduleKey]/page.tsx:251` renders `InlineSavedViewFilters` and counts the
conditions into the toolbar badge, but `useCustomModuleRecords`
(`useModuleBuilder.ts:298`) serialises only `page`, `page_size`, `search`, `sort_by`,
`sort_direction`. The badge reads "Filters ②" and the result set is unfiltered. This is
a data-correctness bug, not a style issue — **file it separately**; it likely needs a
backend query-param contract, which is out of scope for a frontend pass.

**B.3 — `custom-scrollbar` is undefined.** Used on 3 bounded lists
(`NotificationCenter:118`, `UserTeamPicker:122`, `TimezonePicker:66`), defined nowhere in
`globals.css`. Those render native scrollbars while every other scroller uses
`.scrollbar-hide`. Trivial; folded into Phase 2.

---

## Explicitly not doing

- No new flows, no inline editing, no quick-create rollout (scoping decision 2).
- Not touching the `sr-only` `h1` in `PageHeader` — §8 says it is correct.
- Not reintroducing a `max-height` on `ModuleTableShell` (§11.1).
- Not re-fixing `RecordTabs` or `ColumnPicker` — done in `e6a53f8`; Phase 0 corrects the
  doc that claims otherwise.
- Not touching the invoice print document's colours (§2.5 exception 2).
- Not reopening deliberately deferred slices (WhatsApp sending, payment links, broad
  Gmail access, user-created modules) per `CLAUDE.md`.
