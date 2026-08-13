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
3. **This document was the deliverable of the audit.** Implementation is now approved and
   begins at Phase 0.

**Revision — design review, 2026-08-13.** The plan was re-read against the
`frontend-design` skill and against `design.md` itself. The structure held; four things
were missing and are now folded in rather than tracked separately:

- The §7.4 states and §6/§2.3 focus-and-motion floors were **measured in the audit but
  fixed by no phase**. They now have Layer 9 (evidence), a slot in Phases 2, 3 and 4
  (fix), and two new checks in Phase 8 (guard).
- Phase 6 covered vocabulary but not **voice** — the error, empty and confirmation copy
  that the newly-standardised states will render.
- Phase 7's auth item read as "delete the raw `rgba()`", which would have stripped the
  one screen carrying §9 identity. It is now "tokenise it", with the token set added in
  Phase 0 so there is somewhere legal to move it to.
- The convergence rule is now written down: **resolve to documented intent, not to the
  most frequent value** — the failure mode that turns a consistency pass into a
  flattening pass.

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
`<Card>`. It is now **206 vs 65** — the drift is accelerating, so a change to `Card`
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
| `PermissionDeniedState` | **1 of 23** (`settings/record-layouts` only) |
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
- **`gap-5` ×32 and `p-5` ×80** — 112 uses of a step §4.1 does not contain. Card padding
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

But the defect **reappeared elsewhere**: `views/[moduleKey]/page.tsx:141` hand-rolls a
`role="tablist"` from raw buttons with no `onKeyDown`, no roving tabindex, no
`aria-controls` — the exact pattern §11.0 records as fixed.

### Layer 9 — The mandatory floors are the least-consistent thing measured

§7.4 and §6 are not style preferences; they are the two rules in `design.md` written as
non-negotiable. Both are drifting, and neither is guarded — `design-rules.spec.ts` reads
static computed style, so it never focuses an element and never queries a media feature.

| Floor | Rule | Reality |
|---|---|---|
| Permission-denied state | §7.4 — every data view ships one | `PermissionDeniedState` in **15 files repo-wide**; **1 of 23** settings pages |
| Error state | §7.4 | 3 competing idioms in settings, **7 pages have none** |
| Loading state | §7.4 | 4 expressions (`RouteLoadingState`, `Skeleton`, inline `<TableRow>`, plain `<p>`) |
| Empty state | §7.4 — "say what the thing is and offer the create action" | 3 module tables ship no create action (Layer 1) |
| `focus-visible` | §2.3 — focus is never removed | 68 uses across the whole frontend, unguarded and unaudited |
| `prefers-reduced-motion` | §6 — respect it for anything that loops | **13 uses**, all hand-placed; `Skeleton` and `Pagination` have it, most spinners do not |

This matters most for Phase 3. The record-table composition introduces a **keyboard-
activable row** on 13 lists at once. A row that takes focus without showing a ring is a
worse outcome than the mouse-only row it replaces — it moves the focus point somewhere
the operator cannot see. The focus treatment is part of that primitive's contract, not a
follow-up.

Responsive is *not* on this list deliberately. Lynk is a dense desktop CRM, §4.4 sets
gutters at `px-4 sm:px-6`, and no brief asks for a mobile product. The pass adds a narrow-
viewport capture to the visual check (Verification) to confirm nothing *breaks*, and goes
no further.

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

**Converge on documented intent, not on the median.** A consistency pass has one
characteristic failure mode: picking whichever value appears most often and calling it
the standard. That is how a product flattens. Every convergence below resolves to what
`design.md` specifies — and where the doc is silent, the choice is made and written into
the doc first (§12), not inferred from a frequency count. Two places carry Lynk's actual
identity and are protected rather than swept: the §1.3 ink hierarchy, and the §9 hive on
auth (see Phase 7).

**The floors are part of the sweep, not a later pass.** §7.4 makes hover / focus-visible
/ active / disabled and loading / empty / error / permission-denied mandatory, and §6
requires `prefers-reduced-motion` on anything that loops. The audit measured how badly
those have drifted (below) but the original phase list did not fix them; it does now.

Phases are independently shippable. Each ends green on lint, build, and both guards.

**The baseline is not green.** `./scripts/check-design.sh` fails **6 of 14 rules at
HEAD**, before this pass touches anything — so "ends green" means *no new failures and
the phase's own rules cleared*, not a clean run, until Phase 6 closes these out. The
audit did not record them; they are cheap, and each already belongs to a phase:

| Failing rule | Site | Owner |
|---|---|---|
| §2.3 focus ring is its own token | `documents/DocumentList.tsx:173` — `ring-primary/40` on the highlighted row | Phase 2 (focus pass) |
| §4.5/§11.1 no height cap on `ModuleTableShell` | `reports/page.tsx:674` — `max-h-72` | Phase 4 — this is the exact nested-scroll regression §11.1 exists to prevent |
| §4.2 no call-site control heights | `ClientPageCreateForm.tsx:337` — `size-6` on a `Button` | Phase 7 (portal) |
| §4.1 spacing off the 4px grid | 1 match | Phase 6 |
| §6 transitions name their properties | `HexagonBackground.tsx:92`, `sonner.tsx:24` — `transition-all` | Phase 2 |
| §7.2 shadcn is the only component library | `@headlessui/react` is **live in 4 shared primitives** — `ui/dialog.tsx`, `ExportControls`, `ImportControls`, `ModuleImportExportControls` | **Not this pass.** See below |

Run the source guard at the start of a phase as well as the end. It is the cheapest of
the three checks and the only one that reads `package.json`.

**The headlessui one is out of scope and should stay out.** It is not a stale dependency
to delete — `components/ui/dialog.tsx` is built on it, so every dialog and sheet in the
product is a Headless UI dialog, and three import/export menus use its `Menu`. Migrating
the dialog primitive to radix changes focus-trap and close behaviour on every modal
surface at once, which is a behaviour change and fails scoping decision 2. It is also the
one §7.2 violation with a real argument on both sides: Headless UI's dialog is a correct,
accessible implementation, so this is consistency debt, not a defect.

Record it, do not fold it in. It wants its own slice with its own e2e pass, and §7.2 in
`design.md` should be amended to name the exception until then rather than leaving the
guard permanently red.

---

## Phase 0 — Correct the source of truth

No product code. Do this first so later phases have something true to check against.

- §11.0: mark `RecordTabs` / `ColumnPicker` resolved (cite `e6a53f8`); update the
  card-box count to the measured 206 vs 65; add **both** surviving raw-tablist sites
  (`views/[moduleKey]:141`, `settings/module-builder:480`) — the audit found one.
- §4.1: rule on `gap-5` / `p-5`. **Recommendation: declare them out.** A dense-CRM
  ladder of 2/3/4/6/8 is already tight, and the 5-step is why card padding has three
  values.
- §4.4: add the page-shell and record-table contracts from Phases 1 and 3.
- §3.5: note that Title Case is in scope for the sentence-case rule and that the
  `uppercase` guard cannot detect it.
- Record the `PageHeader`/`PageToolbar` convergence decision.
- §7.4: state that the four data-view states are supplied by the composition
  (`PageShell`, `RecordTable`), not re-implemented per page — the reason 7 settings
  pages have no error state is that nothing supplied one.
- §11: add the Layer 9 floors to the Known-drift table (`focus-visible` unaudited,
  `prefers-reduced-motion` at 13 uses, `PermissionDeniedState` at 1 of 23 settings
  pages) so the numbers have a home after this doc is archived.
- §9: record that the auth surface's ambient layers are **intended identity**, and that
  the Phase 7 fix is to tokenise them, not remove them (see Phase 7).

`tokens.md` §10 forbids raw colour in arbitrary values but names no token for ambient
atmosphere, which is why `app/auth/layout.tsx` had nowhere legal to go. Add that token
set here, in Phase 0, so Phase 7 has something to migrate onto.

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
- **Interaction states on every primitive touched** (§7.4): hover, `focus-visible`,
  active, disabled. Audit rather than assume — `outline-none` is only legal paired with a
  `focus-visible:` ring on the same element (§2.3), and this phase is the cheapest place
  to check it, since these are the components every page inherits.
- **`prefers-reduced-motion` on anything that loops** (§6). `Skeleton` and `Pagination`
  already carry `motion-reduce:`; the spinners in `QuickCreateSurface` and the shared
  loading states do not. 13 hand-placed uses repo-wide is not a policy — put it in the
  primitives so pages stop needing to remember.

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
  Enter-vs-Enter+Space disagreement. It ships with a **visible `focus-visible` ring on
  the row** and Enter + Space both bound. A row that takes focus invisibly is a
  regression on the mouse-only row it replaces (Layer 9); the ring is part of the
  contract, not a follow-up.
- **all four §7.4 data-view slots** — empty / loading / error / **permission-denied** —
  defaulting to `EmptyState` + `ModuleTableLoading` + `RouteErrorState` +
  `PermissionDeniedState`, with the create action always wired. Permission-denied is the
  one the audit found missing almost everywhere (Layer 9); supplying it from the
  composition is what stops it being forgotten per page.

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

## Phase 4 — Migrate pages onto the shell, and finish the mandatory states

Mechanical, one area at a time, verifying after each. Every page that moves onto
`PageShell` also gets its §7.4 states settled in the same edit — loading, empty, error,
permission-denied, drawn from the existing `RouteStates` / `EmptyState` /
`PermissionDeniedState` primitives. No page is "migrated" while it still ships only a
success state; that is the rule this pass is enforcing, not a stretch goal.

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
5. **The settings states, explicitly** — this is where the floors are worst (Layer 9).
   One loading expression, one error idiom for the 7 pages with none, and
   `PermissionDeniedState` on all 23 rather than 1. Settings is entirely admin-gated, so
   a missing permission-denied state is what a non-admin actually hits.
6. **Settle the commit model** while the pages are open. `authentication/page.tsx` runs
   autosave at `:45` and an explicit Save/Discard footer 40 lines below, with no visual
   difference between them — the operator cannot tell which half of the page has already
   saved. Pick one model per page and make the choice legible; 8 editing patterns across
   19 pages is the widest single divergence the audit found.
7. Retire the `PageToolbar` alias once call sites hit zero.

---

## Phase 5 — Detail-page archetype

Consistency only — no inline editing, no new panels (Appendix A).

- Pick one archetype: `RecordWorkspace` + `RecordTabs` + `ReadOnlyRecordLayout`, and
  move the other four onto it.
- **Retire the nested-tabs pattern.** `CrmRecordActivitySection` is itself a
  `RecordTabs`; stop rendering it inside another one on the six affected pages.
- Replace the six private `DetailField`/`Summary` components with
  `ReadOnlyRecordLayout`.
- Fix **both** hand-rolled `role="tablist"` sites — `views/[moduleKey]:141` and
  `settings/module-builder:480` — onto `RecordTabs`. `SavedViewSelector.tsx:26` is the
  correct reference if radix genuinely does not fit.
- Give leads' tab order a default that matches its first tab.

---

## Phase 6 — The copy and vocabulary sweep

Cheap, high-signal, and best done once the structure is settled. Copy is design
material here, not labelling: the vocabulary of the interface is the signposting an
operator learns the product by, so it converges on one voice the same way spacing does.

**Vocabulary — one value per role:**

- **One section-heading size** per role (§3.3: `text-base` inside a page).
- **One empty-value string.** "Not set" over the other five — it reads as a field with
  no value yet, which is true, where "Not recorded" and "Unassigned" each imply a
  different reason and "—" implies none. Chosen for what it says, not because it is the
  most frequent.
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
  cases already do. `User #7` is the schema talking; the operator knows a person.

**Voice — the states Phase 4 just standardised now get their words:**

- **An action keeps its name through the flow.** "Create invoice" produces "Invoice
  created", not "Saved successfully". The verb sweep above picks the name; this makes it
  survive to the toast and the confirmation.
- **Errors name the fix, not the failure** (§7.5, already the rule for field errors —
  extend it to the route-level error states Phase 4 adds). No apologies, and never vague
  about what happened.
- **Empty states are an invitation to act** (§7.4): what the thing is, then the create
  action. This is the copy half of the three tables that ship no create button at all.
- **Destructive confirmations name the record and the consequence** (§7.5) — audit these
  while the strings are open; a "Are you sure?" that names nothing is the same defect as
  an error that says "Invalid".
- Sentence case and active voice throughout, per §3.5 and the item above.

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
- `app/auth/layout.tsx:20,22,28` — raw `rgba()` gradients in arbitrary values (a grid
  shimmer, a vignette, and two inner-card radials), a `tokens.md` §10 forbidden pattern,
  on the first screen every operator sees.

  **Tokenise these; do not delete them.** This is the one file in the sweep where the
  drift and the identity are the same lines of code. `/auth` is where §9 puts the hive
  and where §6 permits ambient motion — it is deliberately the least generic screen Lynk
  has, and `HexagonBackground` is still rendering above those layers. Stripping the
  atmosphere to satisfy a colour grep would pass every guard in the repo and leave the
  product's signature screen looking like a login form from any template. The correct fix
  is the ambient token set added in Phase 0: the values move into `tokens.md`, the
  arbitrary values disappear, the screen looks the same.

  §9 already records what happens when this goes wrong — a previous attempt replaced the
  hive with three gradients at 150°/30°/90°, drawing a triangular lattice at a contrast
  low enough to be invisible, and nothing caught it. So: **screenshot `/auth` in both
  themes before and after, and confirm the honeycomb is still a honeycomb.** That check
  is on this phase's exit criteria, not left to the guard, because no assertion in the
  suite can tell the difference.

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
- **Focus is visible** (§2.3, §8) — the spec currently never focuses anything, which is
  why 68 scattered `focus-visible` uses have never been checked. Focus a sampled set of
  interactive elements per route (first row, first control in the toolbar, first
  navigation item) and assert the computed `outline` or `box-shadow` actually changes.
  Cheap, and it is the only check that can catch Phase 3 shipping an invisible row focus.
- **Reduced motion is respected** (§6) — re-run one representative route under
  `page.emulateMedia({ reducedMotion: "reduce" })` and assert nothing reports a running
  animation. This is the only rule in `design.md` that a media query can turn off, so
  static computed style will never see it.

These two are why the guard's blindness is structural rather than incidental: it reads
one static snapshot of one state. Focusing an element and emulating a media feature are
the two cheapest ways to widen what it can see at all.

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

# hand-rolled card boxes vs <Card> — 206 vs 65 today
grep -rn 'rounded-\[var(--radius-card)\]' app components --include='*.tsx' | grep -c border

# type-ramp escapes — 22 today, target 0
grep -rnE 'text-\[[0-9]+px\]' app components --include='*.tsx'

# off-ladder spacing — 112 today
grep -rnE '\b(gap|p)-5\b' app components --include='*.tsx' | wc -l

# the two header primitives — target: PageToolbar at 0
grep -rln 'PageToolbar' app --include='*.tsx' | wc -l

# permission-denied coverage — 15 files repo-wide, 1 of 23 settings pages today
grep -rln 'PermissionDeniedState' app/dashboard/settings | wc -l

# reduced-motion coverage — 13 hand-placed uses today; expect it to move into primitives
grep -rn 'prefers-reduced-motion\|motion-reduce' app components --include='*.tsx' | wc -l

# focus never removed (§2.3) — every hit must pair with focus-visible: on the same element
grep -rn 'outline-none' app components --include='*.tsx' | grep -v 'focus-visible'
```

**Visual pass — both tools, per the owner's call.**

*Playwright* (repeatable, per phase): a screenshot spec over one representative route
per area, captured in **both themes**, before and after each phase. Phase 2 changes card
edges globally and Phase 3 changes every table — both must be eyeballed, not just
asserted. Capture one **narrow viewport** (768px) per area alongside the desktop shot:
Lynk is a desktop product and this pass is not making it responsive, but `PageShell` and
`RecordTable` change every page root and every table wrapper at once, and a narrow shot
is the cheapest way to see if that broke a gutter or forced a horizontal page scroll.
Seed first or detail routes are unreachable:

```bash
docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default
docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
```

*Claude in Chrome* (interactive, for what assertions miss): confirming the Appendix B.1
dropdown clipping, hover/focus/active states, and walking a click path to feel its cost.
Access is verified; the tab needs a signed-in session.

Two things only a human or a browser session can settle, both on the exit criteria of
their phase rather than delegated to an assertion:

- **The hive still renders as a honeycomb** after Phase 7 tokenises the auth
  atmosphere, in both themes (§9 — this has silently broken once before).
- **Tabbing through a migrated list page** after Phase 3: the focus point stays visible
  the whole way across toolbar → rows → pagination. The guard samples; a tab-through is
  what actually proves the row gesture is usable without a mouse.

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
- Not stripping the auth surface's ambient layers. They are §9 identity on the one screen
  licensed to have it; Phase 7 tokenises the raw `rgba()` and leaves the screen looking
  the same.
- Not making Lynk responsive. §4.4 gutters stand; the narrow-viewport capture in
  Verification is a regression check on the new shell, not the start of a mobile pass.
- Not reopening deliberately deferred slices (WhatsApp sending, payment links, broad
  Gmail access, user-created modules) per `CLAUDE.md`.
