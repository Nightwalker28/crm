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

   > **Retired from Phase 5 onward, 2026-08-14.** This decision governed Phases 0–4 and
   > is what they were executed under; it no longer applies. The owner has opened
   > behaviour change and folded all 13 Appendix A findings into the rebuild programme.
   > See [`rebuild.md`](./rebuild.md).
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
with different spacing (`PageToolbar` has `min-h-9`, `PageHeader` doesn't). Across `app/`
and `components/`, **32 files use one, 20 the other, 0 use both**.

**Correction (Phase 1, measured in a browser).** The audit recorded this as "pages using
`PageToolbar` ship no `h1` at all". That is wrong, and the real defect is the opposite
one. Three components emit an `h1` inside the dashboard shell:

| Source | Scope |
|---|---|
| `Sidebar.tsx:188` — the `Lynk` wordmark | every dashboard page |
| `app/dashboard/layout.tsx:141` — `moduleTitle` | every dashboard page with a registry match |
| `PageHeader.tsx` — the `sr-only` title | the 32 pages that use it |

So no page was short an `h1`; pages were carrying **two or three**, and on a
`PageHeader` page the extra one is usually the *same string twice*. An `h1` census after
the wordmark fix:

```
/dashboard                    => 1  ["Dashboard"]
/dashboard/sales/leads        => 1  ["Leads"]
/dashboard/settings/users     => 1  ["Users"]
/dashboard/profile            => 2  ["Profile", "Profile [sr-only]"]
```

§8's wording turns out to be exact about this: it blesses `PageHeader`'s `sr-only` `h1`
and warns against "fixing" it by adding a second **visible** one — which is precisely
what `layout.tsx:141` does. Neither guard checks `h1` count, which is why this survived.

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
the phase's own rules cleared*, not a clean run. The audit did not record them; they are
cheap, and each already belongs to a phase. **Three of the six are now closed; the
remaining three carry into `rebuild.md`:**

| Failing rule | Site | Owner |
|---|---|---|
| ~~§2.3 focus ring is its own token~~ | `documents/DocumentList.tsx:173` — `ring-primary/40` on the highlighted row | **cleared in Phase 2** |
| ~~§4.5/§11.1 no height cap on `ModuleTableShell`~~ | `reports/page.tsx:674` — `max-h-72` | **cleared in Phase 4** |
| ~~§6 transitions name their properties~~ | `HexagonBackground.tsx:92`, `sonner.tsx:24` — `transition-all` | **cleared in Phase 2** |
| §4.2 no call-site control heights | `ClientPageCreateForm.tsx:335` — `size-6` on a `Button` | rebuild **5.8** (portal) |
| §4.1 spacing off the 4px grid | `LynkSplash.tsx:58` — `pl-[0.2em]` | rebuild **5.9** |
| §7.2 shadcn is the only component library | `@headlessui/react` is **live in 4 shared primitives** — `ui/dialog.tsx`, `ExportControls`, `ImportControls`, `ModuleImportExportControls` | Not this pass — recorded as the §11.3 exception. **Now owned by rebuild 5.1**, which retires the exception |

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

### Status: done

All items landed, plus two that the audit had not found and Phase 1 surfaced: §11.3
(the `@headlessui/react` exception, recorded rather than fixed) and the `h1` ownership
paragraph in §8. No product code, so nothing to verify beyond the docs themselves.

The `gap-5` / `p-5` ruling came back **declare them out** — §4.1 now says so, and the
112 call sites are Phase 6's sweep.

---

## Phase 1 — The page shell

Add `components/ui/PageShell.tsx`, owning the page root:

- `variant="list"` → the §11.1 full-height column (`flex h-full min-h-0 flex-col gap-4`)
- `variant="document"` → scrolling form/settings page at the documented section stack
- emits `data-slot="page-shell"` so Phase 8 can guard it

**Converge `PageHeader` and `PageToolbar`.** Keep the `PageHeader` name (the docs
reference it), fold in `PageToolbar`'s `context` slot and `min-h-9`, and re-export
`PageToolbar` as a deprecated alias so its call sites keep compiling.

Preserve exactly: the `sr-only` `h1` contract (§8 — correct, must not become visible),
and `ModuleTableShell`'s no-max-height rule (§11.1).

**Files:** new `PageShell.tsx`; `PageHeader.tsx`, `PageToolbar.tsx`.

### Status: done

Green on lint, build, `check-design.sh` (no new failures against the 6-rule baseline
above), both rendered guards across 86 routes, and the shell specs.

**Visual pass — 8 routes × 2 themes, stashed/restored for a true before-and-after.**
The merged `PageHeader` carries a `min-h-9` the old one did not, so this needed measuring
rather than assuming. Pixel diff of each pair:

| Page shape | Result |
|---|---|
| Old `PageToolbar` pages (`/dashboard`, `reports`, `settings/users`) | **0.00% — pixel-identical.** The alias is a true no-op. |
| `PageHeader` **with** actions (the `/new` forms) | Action row 32px → **36px**; content below shifts down 4px. |
| `PageHeader` **without** actions (`/dashboard/profile`) | Content shifts **up 24px** — a dead `gap` reclaimed. |

Both movements are corrections, not regressions:

- 36px *is* the documented toolbar row (§4.4, `min-h-9`). The old header was 32px — below
  spec — so these pages moved onto the ladder rather than off it.
- Profile was spending a full `gap-6` on an empty heading row, which is exactly what the
  `display: contents` branch exists to prevent. The page gains 24px of usable height.

Screenshots are in `frontend/phase1-visual/` (untracked, safe to delete). Worth keeping
until Phase 4, since that phase migrates every page onto this component and these are the
baseline it should be compared against.

`PageShell` ships three variants against §4.4 — `list` (`h-full min-h-0 gap-4`),
`document` (`gap-6`), `settings` (`gap-8`) — as `cva` variants so §7.3 has something to
enforce, and emits `data-slot="page-shell"` for the Phase 8 guard. `title` is **required**
on it: that is the forcing function that gives every migrated page an `h1`.

Two details worth keeping:

- `PageHeader` renders `display: contents` when it has no context and no actions. As a
  normal flex item an empty heading row would draw a full `gap` of dead space under the
  shell's stack; its `sr-only` children are absolutely positioned and contribute none.
- `title` is optional on `PageHeader` but required on `PageShell`, so the deprecated
  `PageToolbar` alias still compiles while the migration supplies real titles.

**The `h1` fix is sequenced, not done in one step.** Only the sidebar wordmark changed
here — it is a brand mark inside a nav link and was never a page heading, so demoting it
to a `span` has no downside. `layout.tsx:141` **stays an `h1` for now**: demoting it
while most pages still lack a `PageHeader` would take those pages from one heading to
zero, which is the worse defect. It is marked with a comment and flips in Phase 4, once
every page is on `PageShell`. Net effect of this phase: 3 headings → 2 on `PageHeader`
pages, 2 → 1 everywhere else.

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

### Status: done

Green on lint, build, `check-design.sh`, and both rendered guards across 91 routes.
**The source guard went 6 failures → 4**: this phase owned two of the six baseline
rules and cleared both — §2.3 (`ring-primary/40` on the highlighted document row) and
§6 (`transition-all` in `HexagonBackground` and `sonner`). The remaining four belong
to Phases 4, 6, 7 and the recorded §11.3 exception, unchanged.

**Two accessibility defects the audit had not found**, both in shared primitives and
both worse than the ones it did find:

- `Input` was bounded by `border-line-default` — a structural hairline on a control,
  which `tokens.md` §2 names an accessibility bug in so many words — and it *hovered*
  to `border-line-strong`, which is 2.0:1 on the raised ground. Pointing at a text
  field made it less visible. It now reads the control tier, and a new
  `--color-border-control-hover` (4.17:1 dark / 4.02:1 light on the worst ground)
  exists so a control edge can only move away from its ground on hover. `Textarea`,
  `Select` and `InputGroup` got the same hover and lost their `shadow-xs`; they now
  sit on the same ground as `Input`, which they did not before.
- The checkbox override was **20 call sites, not five**. Every one re-typed the
  primitive's own defaults (`size-4 rounded bg-surface-raised` + a `size-3` indicator
  child) and swapped `border-line-control` for `border-line-strong` on the way, so the
  fix was to delete the skin, not to correct it — `<Checkbox />` now, everywhere. The
  four indicator sizings went with it. Same for `permissions/page.tsx`'s
  `CHECKBOX_CLASS` const, three hand-rolled switch tracks, `ColumnPicker`'s raw
  `<input type="checkbox">`, and the document upload dropzone.

**Reduced motion is now a platform property, not 13 remembered classes** (§6, rewritten).
A `prefers-reduced-motion` block in `globals.css` collapses every animation and
transition, and `MotionConfig reducedMotion="user"` in `app/providers.tsx` covers
`motion/react`, which animates in JS and cannot see a media query. That second half
matters more than it looks: `Checkbox`'s only hover feedback was a `whileHover` scale,
so honouring reduced motion would have left it with no hover state at all — it gained
a CSS one in the same edit.

**Elevation: five vocabularies → one token.** `shadow-2xl` ×13, `shadow-xl` ×5,
`shadow-md` ×2, a hand-written `shadow-[0_32px_100px_rgba(...)]`, and the three places
already correct. The token now lives in `sheet`/`dialog`/`popover`/`select`, so a call
site never types an elevation; `DialogPanel` had none at all and now floats. Seven
anchored shadows (switch thumbs, a kanban card, a filter chip, a selected settings row,
a sticky editor bar, the toast action button) are simply gone, per §4.6.

`Card` took the panel border tier, lost `shadow-lg shadow-black/20` from `raised`, and
settled on two vertical steps with named roles — 24px content, 16px action bar — now
written into §4.4. **B.1 and B.3 are fixed**: `overflow-hidden` is off the base (the six
`overflow-visible` workarounds deleted with it, `CardFooter` rounds its own bottom
corners instead), and `custom-scrollbar` is a real utility rather than a class three
pickers referenced and nothing defined.

**Visual pass — 8 routes × 2 themes + 3 narrow, stashed/restored for a true
before-and-after.** Diffs run 0.2%–17%, and every one of them is the same two changes:

| Shape | Diff | Cause |
|---|---|---|
| List pages (`leads`, `settings/users`) | 1.6–1.8% | control edges become visible; layout unchanged |
| Dashboard | ~1.0% | card edges one tier stronger |
| Form pages (`lead/new`, `catalog/new`) | 4.8–5.9% | + card body 20px → 24px, so content below shifts |
| `profile`, `settings/general` | 11–17% | the same shift, compounded over four stacked cards |
| `/auth/login` | 0.17% | the login card's inputs gained an edge. **The hive is still a honeycomb** in both themes |

The large numbers are vertical displacement, not restyling — no page reflowed, no
gutter broke at 768px, and the light-theme captures are where the input fix is most
obvious: text fields that were previously edgeless on the muted ground now read as
controls. Screenshots in `frontend/phase2-visual/` (untracked, safe to delete); the
picker-clipping check is `picker-open.png`, showing a six-row suggestion list
overflowing its form section instead of being cut at the card edge.

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

### Status: done

Green on lint, typecheck, build, `check-design.sh` (**still 4 failures, the same four**
Phase 2 left to Phases 4, 6, 7 and the recorded §11.3 exception — no new ones), and both
rendered guards **across 95 routes**, up from 91 in Phase 2.

All 14 module tables plus the inline custom-module table are on `RecordTable`. The 9
hardcoded `min-w-[Npx]` values are gone from module lists — the only survivors repo-wide
are the kanban and calendar boards, which are not tables.

`renderCell` now returns cell **content**; the primitive supplies the `td`. That single
change is what removes the mechanics: every table used to hand-write the shell, the
`<Table>`, the header row, the selection column, the sticky classes, the `colSpan`
arithmetic and its own empty state. `CustomFieldCell` was a `TableCell` in disguise, so
it became `CustomFieldValue` (content only) — a nested `td` was one call site away.

**Column widths are declared, not measured.** The derived min-width sums a per-column
hint (`sm` 96 / `md` 132 / `lg` 220) plus 48 for selection and 112 for row actions. Coarse
on purpose: the table is `table-auto`, so the hint only decides *when* a horizontal
scrollbar appears, never the rendered widths. Seven default columns land at ~970px against
the 920px that leads used to hardcode.

**Four defects fixed on the way through, all of them invisible until the mechanics had an
owner:**

- **Catalog rendered a header with no cell under it.** `renderCell` returned `null` for
  `sku` / `stock_status` / `stock_quantity` on the *services* catalog while the header row
  still emitted those columns, so every services row was short up to three `td`s and every
  value after the gap sat under the wrong heading. Columns are now filtered before the
  header is built.
- **pos and payments showed an unchecked box for a partial page selection**, where the
  other five lists showed a dash. Tri-state is computed in the primitive from the rows, so
  the five page-level `useMemo`s that each recomputed it are gone with it.
- **Quotes' sticky number floated over a 48px hole** — its header checkbox was not sticky
  (`QuotesTable.tsx:174`). The primitive makes the header cell sticky with the body cell.
- **Modified clicks navigated in place.** Seven lists opened the record on any click,
  including ⌘/ctrl-click. The row gesture now ignores modified clicks and lets the identity
  link handle them natively, so open-in-new-tab works instead of hijacking the tab.

**The row gesture, measured rather than assumed.** A `<tr>` in a `border-collapse` table
does not paint a `box-shadow` reliably, so the focus ring is an `outline`. Verified in the
browser rather than argued: the focused row computes
`outline: 2px solid rgb(143, 154, 168)` — the focus token, not the action colour (§2.3) —
and a real tab-through of `/dashboard/sales/leads` gives 22 stops from the search box to
pagination, **every one of them painting a visible focus point**, rows included. The only
unpainted stop is Next's dev-overlay portal. `phase3-visual/leads-row-focused.png` is the
picture.

**The sticky column took two passes, and only a browser found the second.** Extending the
sticky identity column from 6 lists to all of them exposed a mismatch that had always been
there: the sticky cell declared `bg-surface` while the row it sits in is striped
`even:bg-surface-muted/30` and hovers to `surface-raised/60`, so the identity cell read as
a lighter panel down every alternate row. First fix: `bg-inherit`, so the cell tracks the
stripe and the hover with its row.

That fix was wrong in a way no assertion could see, and no screenshot taken so far could
either — **every capture had been of a table that fitted, so the sticky column had never
actually been stuck.** Scrolling one sideways in the browser showed status pills and
checkboxes bleeding straight through the pinned columns, on even rows only. `bg-inherit`
inherits the row's *translucent* stripe, and a 30%-alpha cell does not occlude what
scrolls beneath it. A pinned column that fails to pin is worse than the mismatch it fixed.

The close is two derived tokens — `--color-bg-surface-row-alt` and
`--color-bg-surface-row-hover`, each a `color-mix` of grounds that already exist, so
neither theme gains a literal and the stripe looks exactly as it did. `TableRow` paints
those instead of the tinted versions, and the inherited ground is opaque. Verified pinned
and occluding in both themes at a viewport narrow enough to force the scroll
(`phase3-visual/pos-scrolled-{dark,light}.png`). `tokens.md` carries the general rule:
anything a sticky element inherits must be opaque.

This is the phase's argument for the browser being on the exit criteria rather than
delegated to an assertion. Lint, typecheck, build, the source guard, both rendered guards
and 99 module specs were all green *with the bug in the tree* — it needed a wide table, a
sideways scroll, and someone looking.

**Line count: 3,496 → 2,909 across the 14 files (−17%), short of the "well over half" the
plan predicted.** The prediction counted lines rather than mechanics. What is left is
per-module cell *content* — a lead's avatar and score pill, an invoice's balance colouring
— which is business rendering, not list machinery, and it does not deduplicate. Two files
(`InvoicesTable`, `PaymentsTable`) even grew, because they were written as 200-character
one-liners; both lost their hand-rolled mechanics regardless. The honest measure of this
phase is the drift table in Layer 1, which is now empty.

**Specs updated, none loosened.** Three lists lost their page-level error banner because
the table now supplies that state, and their specs asserted the banner's one-sentence copy;
they now assert the same title, the same "Check your connection and try again.", the same
absence of leaked backend detail, and the same Try-again button, against the title +
description shape. Four specs targeted the table region by its old generic
`aria-label="Data table"` — regions are named for their module now, which is why
`ModuleTableShell` grew a `label`.

Suite: **89 passed / 4 failed** across the 15 module specs, run serially. All four are in
`docs/e2e-suite-status.md` — `opportunities-revamp:21` (`button "Table"` resolves to 3),
`payments-revamp:56` (`getByText("Paid", exact)` resolves to 2), `payments-revamp:122`
(`getByRole("alert")` also matches Next's route announcer), and `payments-revamp:74`, which
this session confirmed **flaky rather than broken**: fail/pass/pass in isolation, and a DOM
dump in its exact mocked state shows the "Clear filters" button it cannot find is genuinely
rendered. That characterisation is now recorded in the suite-status doc.

Two run-shape traps worth not re-learning. A first cold run reported five sales lists as
unreachable — the documented cold-start timing trap; a warm run discovers every one. And
running these 20 specs in parallel produces a dozen extra failures at the 30–35s timeout
ceiling that all disappear serially, `reports-revamp` included. Judge this suite on
`--workers=1`.

The settings specs that still use raw `Table` — permissions, settings-modules, users,
recycle-bin, reports — were re-run after the row-ground token change, since that one
touches every table in the app. Every failure there is already in the suite-status doc.

Screenshots (8 routes × 2 themes + 3 narrow) are in `frontend/phase3-visual/` (untracked,
safe to delete). Narrow-viewport horizontal overflow is 0px on all three captures.

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
8. **Close the `h1` sequence.** Once every page is on `PageShell` and therefore carries a
   `PageHeader` title, demote `app/dashboard/layout.tsx:141` from `<h1>` to a plain
   element — it names the module, `PageHeader` names the page, and §8 allows one. Re-run
   the census from Layer 2 and expect `1` on every route. Deferring this to the end of
   Phase 4 is deliberate: doing it earlier takes unmigrated pages from one heading to
   zero.

### Status: done, with two items carried forward

Items 1–4, 7 and 8 landed. Measured at HEAD: **53 `PageShell` call sites, 0
`PageToolbar`**, 15 `variant="list"` and 23 `variant="settings"`, and
`app/dashboard/layout.tsx:141` demoted out of `<h1>` with the reason written into the
file. The source guard is at **3 of 14 failing**, down from 6 — `reports/page.tsx`'s
`max-h-72` cleared with it.

Two items did **not** land, and are not to be read as done:

- **Item 5 — the settings states.** `PermissionDeniedState` reaches **1 of 23** settings
  pages (`isPermissionDenied` is passed on exactly one). Settings is entirely
  admin-gated, so this is precisely what a non-admin hits.
- **Item 6 — the commit model.** `settings/authentication/page.tsx` still autosaves a
  select at `:45` while demanding an explicit Save/Discard footer 40 lines below.

Both carry to **rebuild 5.6**.

---

## Phase 5 — the rebuild program

**Phase 5 grew into its own programme. It lives in
[`rebuild.md`](./rebuild.md).**

Why it moved: it outgrew this document, and it carries scoping decisions that
*contradict* decision 2 above. Two opposing scoping rules in one file get read wrong.

**Decision 2 is retired from Phase 5 onward.** "Consistency only — no behaviour change"
governed Phases 0–4 and no longer applies: the owner has folded all 13 Appendix A
workflow findings into the rebuild, and the visual composition is being rebuilt rather
than swept. Phases 0–4 above are unchanged history and were executed under the original
rule.

**Phases 6, 7 and 8 are gone from this document** and land in `rebuild.md` as 5.9
(copy and voice), 5.8 (client portal, public, auth) and 5.10 (guard the composition).

| | Sub-phase | Owns |
|---|---|---|
| 5.0 | Direction, law, census — **done** | The archetypes, the type ladder, the signature, the rulings every later sub-phase needs |
| 5.1 | Cross-cutting primitives | Seven extractions + the `@headlessui/react` → radix dialog migration |
| 5.2 | Panel language | The 206 hand-rolled card boxes |
| 5.3 | Record detail | **7** archetypes → 1 (the audit's Layer 4 recorded 5; catalog and the portal pages were missed) |
| 5.4 | Forms | The create/edit model |
| 5.5 | One table, list workflow | The 18 files still on raw `Table`, + Appendix A's core |
| 5.6 | Settings | All 23 pages, plus Phase 4's two carried-forward items |
| 5.7 | Dashboard, reports, boards, calendars, mail | The surfaces no phase has touched |
| 5.8 | Client portal, public, auth | was Phase 7 |
| 5.9 | Copy and voice | was Phase 6 |
| 5.10 | Guard the composition | was Phase 8 |

Three of the audit's numbers were **stale and are corrected in `rebuild.md`**: the
nested-tabs pattern is at **2 sites, not 6**; the private field renderers are **9–12,
not 6**; and forms had already converged further than Layer 4 implies — 14 of 16 routes
are on `RecordFormLayout`.

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

# module table line count — 3,496 before Phase 3, 2,909 after. The remainder is
# per-module cell content, which does not deduplicate; see the Phase 3 status.
wc -l components/*/[A-Z]*Table.tsx components/*/*[Ll]ist.tsx components/finance/pos/InvoicesTable.tsx

# hardcoded table min-widths — 9 in module lists before Phase 3, 0 after. The remaining
# repo-wide hits are the kanban and calendar boards, which are not tables.
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

- **The hive still renders as a honeycomb** after rebuild 5.8 tokenises the auth
  atmosphere, in both themes (§9 — this has silently broken once before).
- **Tabbing through a migrated list page** after Phase 3: the focus point stays visible
  the whole way across toolbar → rows → pagination. The guard samples; a tab-through is
  what actually proves the row gesture is usable without a mouse.

---

## Appendix A — Workflow findings (out of scope for Phases 0–4; **now in scope**)

The brief asked about click cost; the scoping decision for Phases 0–4 was consistency
only. Ordered by cost × frequency.

**These are no longer deferred.** All 13 are folded into the rebuild programme — see
[`rebuild.md`](./rebuild.md). Owners: **A1, A2, A5, A6, A7** → 5.5 (lists) · **A3** →
5.4 (forms) · **A4, A12, A13** → 5.3 (record detail) · **A8, A9, A10** → 5.6
(settings) · **A11** → 5.7 (reports). The list below stays here as the measurement;
`rebuild.md` is where the work is tracked.

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

**Scope note.** This list governed Phases 0–4. The first bullet is **retired from Phase
5 onward** — see `rebuild.md` for the list that applies now. The rest still hold.

- ~~No new flows, no inline editing, no quick-create rollout (scoping decision 2).~~
  **Retired.** Behaviour change is in scope for the rebuild; Appendix A is folded in.
- Not touching the `sr-only` `h1` in `PageHeader` — §8 says it is correct.
- Not reintroducing a `max-height` on `ModuleTableShell` (§11.1).
- Not re-fixing `RecordTabs` or `ColumnPicker` — done in `e6a53f8`; Phase 0 corrects the
  doc that claims otherwise.
- Not touching the invoice print document's colours (§2.5 exception 2).
- Not stripping the auth surface's ambient layers. They are §9 identity on the one screen
  licensed to have it; rebuild 5.8 tokenises the raw `rgba()` and leaves the screen
  looking the same.
- Not making Lynk responsive. §4.4 gutters stand; the narrow-viewport capture in
  Verification is a regression check on the new shell, not the start of a mobile pass.
- Not reopening deliberately deferred slices (WhatsApp sending, payment links, broad
  Gmail access, user-created modules) per `CLAUDE.md`.
