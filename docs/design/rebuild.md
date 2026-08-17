# Lynk frontend: the rebuild program

**Status:** approved 2026-08-14. **Sub-phase 5.0 done** — direction, law and census landed;
the owner took the record spine on 14 Aug 2026. **5.1 is done** — batches A, B, C, D and E
(cross-cutting primitives, the status sweep that deletes `Pill`, the route-boundary sweep, the
Headless UI → Radix dialog migration, and `InlineFieldEdit`) have landed.

This is Phase 5 of [`consistency-pass.md`](./consistency-pass.md), expanded into its own
programme because it outgrew the pass containing it — and because it carries scoping
decisions that *contradict* that document's decision 2. Two opposing scoping rules in
one file get read wrong. They live here instead.

Phases 6, 7 and 8 of the consistency pass are deleted there and land here as 5.9, 5.8
and 5.10.

---

## Why

Consistency-pass Phases 0–4 added the composition layer that **list pages** were
missing: `PageShell` (53 call sites, `PageToolbar` at zero), `RecordTable` (24
consumers), `Card` on the panel tier, reduced motion as a platform property. The source
guard went 6 failures → 3.

That work fixed lists. Every other surface still has no owner, and the product reads as
templated because of it. Measured 2026-08-14:

| Surface | State |
|---|---|
| Record detail | **7 archetypes** — the audit recorded 5; catalog and the 7 client-portal pages were never listed |
| Tables | 24 files on `RecordTable`, **18 still on raw `Table`** (census in 5.5) |
| Field display | **9–12 private `SummaryTile` / `DetailField` / `LinkedTile` / `MoneyRow` renderers**, 4 container recipes, 3 value inks |
| Panels | **206 hand-rolled card boxes vs 65 `<Card>`** — accelerating |
| Currency | **15 local formatters + 24 raw `Intl.NumberFormat`**, no `lib/currency.ts`. Dates *are* centralised in `lib/datetime.ts` — the contrast is the argument |
| Section headings | **137 hand-written `<h2>`**, no owner |
| Sticky footers | 10 implementations on 3 recipes; one is a verbatim copy of `RecordFormLayout`'s classes |
| Button | 3 dead variants, 4 near-dead; **76 `className` overrides, ~38 external spacing** — the missing thing is an action-row container, not more variants |
| Panel states | `RecordPanelStates` is the right abstraction, trapped in `recordActivity/` — 5 files of ~40 panels |
| Empty value | `"—"` 32, `"-"` 25, `"Not set"` 21, `"Not recorded"` 17 — and `ReadOnlyRecordLayout` emits the one the copy sweep rejected |
| Boards | 2 unshared kanbans, 3 unshared calendar grids, 6 raw HTML5 DnD implementations |

---

## Scoping decisions

Confirmed with the owner. Items 2 and 5 override `consistency-pass.md` decision 2.

1. **The visual language stays.** `design.md` §1.2 (no accent), §3.1 (Inter only), §1.5
   (density) are not up for revision. What changes is *composition*: page archetypes,
   panel language, form layout, detail-page structure, button hierarchy, section
   headings, and the voice of the states.
2. **Behaviour change is in scope.** All 13 Appendix A workflow findings are folded into
   sub-phases. "Consistency only, no behaviour change" is retired.
3. **This programme absorbs consistency-pass Phases 6, 7 and 8.**
4. **Rebuild in place, module by module** — rewrite the surface, hoist the shared
   component out as it emerges, then move the rest of the family onto it. No primitive
   is built ahead of a real call site, with the one exception noted in 5.1.
5. **Total coverage. Every page, every component, no representative subsets.** The
   mechanism is the census below. A surface with no owning sub-phase is a bug in this
   document, not a thing to skip.
6. **One shared table, everywhere.** Differences are `cva` variants on the primitive
   (§7.3), never a second table. Anything that genuinely cannot be a variant is listed
   with its reason in 5.5 and nowhere else.
7. **Testing is scoped, not skipped.** See the policy below.

---

## Settled rulings

Decided with the owner 2026-08-14. These are the answers every later sub-phase builds
against, and they are all in `design.md` now.

**R1–R6** were settled before 5.0 drew a wireframe, and constrained it. **R7–R10** came *out*
of 5.0 — the type ladder, the panel taxonomy, the record archetype and the table variant set
— so they are decisions the design work produced rather than inputs it was given.

### R1 — The commit model is per surface, and visible from the control

| Surface | Model | Why |
|---|---|---|
| Settings toggles, switches, selects | **Autosave** on change | One independent field, reversible, no cross-field validation. A switch with a Save button is a UX smell |
| Detail-page **state** fields — status, stage, owner, priority, assignee | **Autosave** on change | A workflow action performed dozens of times a day |
| Detail-page **content** fields — name, email, amount, notes | **Read-only**; edit on `/[id]/edit` | See R2 |
| `/new` create forms | **Manual save** | The record does not exist yet. Autosaved drafts put half-formed records into lists, counts and reports — a real product defect in a CRM |
| Line-item documents — quote, order, invoice | **Manual save** | Totals are derived from line items, discounts and tax. Field-by-field commit saves states the backend rejects and totals that are briefly wrong |
| Anything with a side effect — a status that fires an automation or an email | **Explicit confirm**, never a silent commit | A mis-click that autosaves an irreversible action is worse than one extra click |

Two consequences that are easy to skip and expensive to retrofit:

- **Autosave needs a save-state indicator** — `Saving…` / `Saved` / `Couldn't save —
  retry`. Removing the button removes the operator's only feedback. It is a shared
  component, built in 5.1.
- **Every write is an activity entry.** Field-by-field autosave on a 30-field record
  would put 30 rows into the `RecordActivityFeed` this app renders on every record.
  Writes must be debounced client-side, and activity entries coalesced within a window
  — **the coalescing is a backend change** and is a dependency of 5.3, not a frontend
  detail.

Concurrent editing stays last-write-wins per field. Noted, not solved here.

### R2 — State is live, content is read-only

The detail page's editable set is **categorical, not arbitrary**. Dropdown-shaped
controls hold *state* and edit in place; text, number, date and relationship fields hold
*content* and are read-only until you open the edit page.

The failure this avoids: a half-editable page where a dropdown edits in place and the
text field beside it silently does not is worse than either pure model, because nothing
tells the operator what is clickable. A categorical boundary is learnable in seconds; a
per-field one never is.

Four affordances, each with an obvious trigger:

```
change a status / stage / owner   →  inline, right there, autosaves
create something fast             →  QuickCreate sheet
create something detailed         →  /new page
edit something detailed           →  /[id]/edit page
```

`/[id]/edit` **stays**, but two defects go with the migration: it drops `?tab=` (edit
from the Files tab and you land back on Details), and the Edit affordance must be
reachable from every tab rather than only the record header. Those are most of why the
round trip currently feels expensive.

This closes **A3** (create is standardised: QuickCreate *and* `/new` on all 15 modules,
rather than a sheet on 4 and a page on 11) and **partly closes A4** — a workflow change
is now one click; correcting a typo is still a page trip, deliberately.

### R3 — Sticky is almost all gone

Sticky is only 14 uses in the frontend, and **ten of them are save bars**:

| Sticky | Count | Ruling |
|---|---|---|
| `sticky top-0` | 2 | **Keep.** Table column headers — a twelve-column list is unreadable without them |
| `sticky bottom-0` | 10 | **Delete.** R1's autosave removes most; the rest move their action into the page header |
| `sticky left-0` | 2 | **Check and remove.** Leftovers from the horizontal pinning §4.4 already took back out |

Not sticky and not affected: the list page's toolbar and pagination are **flex siblings
of the scroll region**, not `position: sticky` (§11.1). Nothing overlaps, nothing hides
content underneath, and the full-height column stays.

### R4 — One control height per action row

§4.2 already says an input and the button beside it resolve to the same token. It never
extended that to buttons beside each other, and nothing guards it — so with `default`
(38px) at 364 call sites and `sm` (32px) at 228, mixed rows are near-certain.

**`ActionBar` sets the size for its children**, so a call site cannot mix them: toolbars
are `sm`, page headers and forms are `default`. `lg` (44px) stays restricted to auth and
empty-state CTAs per §4.2.

Width may still differ — an icon-only button beside a labelled one is the same height and
narrower. That is not a mismatch. Guarded in 5.10 by comparing rendered sibling heights.

### R5 — Colour marks exception, not state. `Pill` is retired

Two faults compounded, and both are measurable in `lib/statusStyles.ts` today.

**Not every enum is a status.** A lead's *source* (Web / Referral / Cold call) is a
**category** — no value is better than another. A quote's *status* is an **outcome**.
Both render as coloured pills now, so colour has stopped meaning "pay attention" and
started meaning "this field is a dropdown".

**Colouring the happy path is most of the noise.** The contract map colours **7 of its 8
values**; insertion orders colour 5 of 6. But an operator scanning a list is looking for
*problems*, not for normal. Green "Paid" on 90% of rows is 90% noise, and it makes the
5% that need attention harder to find — the opposite of what status colour is for.

**The ruling.** Every enum value carries a **tone**, not a colour:

| Tone | Examples | In a list | On a record page |
|---|---|---|---|
| `neutral` | Draft, Sent, Signed, Active, Paid, Open, New | Plain `text-copy-primary` | May take its semantic colour — one instance, so the budget reads |
| `attention` | Expired, Partially signed, Pending, Due soon | `text-state-warning` | same |
| `critical` | Overdue, Cancelled, Rejected, Failed, Void | `text-state-danger` | same |

Roughly **15% of values keep colour in a list**, against ~85% today. Categories —
source, type, industry, priority where it is not an SLA — get no tone at all and render
as plain text.

`lib/statusStyles.ts` stops returning raw Tailwind strings (`{bg, text, border, label}`)
and returns `{tone, label}`. The **renderer** decides the treatment from context: plain
ink in a list, semantic colour on a record header. That is also what fixes the 52 files
currently re-deriving colour at the call site.

**`Pill` is deleted, not restyled.** It is `rounded-full` + border + tinted fill +
`text-xs font-medium` + `backdrop-blur-sm` **plus a noise-texture overlay `<div>`** —
decoration carrying no information, rendered once per chip, hundreds of times per table.
§1.3 is explicit that hierarchy comes from ink rather than boxes, and a capsule in every
row of every list is the clearest violation of it in the app. Where a genuine badge is
still needed (a count, a tag), that is a different component with a different name.

**Two live bugs this sweep clears.** `sent` / `issued` / `imported` map to
`bg-action-primary-muted` + `text-primary`, and §11 records that `--color-primary` was
neutralised and `bg-action-primary` was a dead class emitting no CSS. Those chips are
already rendering wrong; nobody noticed because a pill looks plausible either way.

**Classify richly, render sparsely — this is a build requirement, not a preference.**
R5 is the ruling most likely to be revisited once it is seen on real data, so it must be
built so that revisiting it is a one-line edit rather than a refactor. Two rules:

- **The tone vocabulary includes `success` from day one**, and every value that *is* a
  success is classified as one — even though a list currently renders `success` as plain
  ink. Defining only `neutral` / `attention` / `critical` now would make "colour the
  signed states green" mean *adding a fourth tone*, which is a type change rippling
  through every map and every switch. Classified-but-unpainted costs nothing today and
  makes that decision permanently free.
- **No call site ever names a colour.** `statusStyles.ts` owns *which values carry which
  tone*; `StatusValue` owns *how a tone looks in a given context*. Nothing else
  participates. That is what keeps the two foreseeable changes — reclassifying a value,
  and switching lists to the dot treatment — at one line and one component respectively,
  no matter how many modules have already migrated.

The cost of changing this ruling therefore does **not** grow as the programme runs. It
shrinks: 52 files currently hardcode `bg-state-success-muted`, so the same change today
is a 52-file sweep and after 5.5 it is one line.

**The fallback is named, not improvised.** If plain ink reads as flat rather than calm on
a real list with real data, the fallback is a 6px tone-coloured dot before the label —
per-state differentiation at a fraction of a pill's weight. Judge it on one seeded list
in both themes before it propagates to fifteen.

### R6 — Inline edit is detail-page only, and the affordance is explicit

R2 made state fields editable. R6 bounds *where*: **the record detail page only.** In a
table, status is display-only text — no chevron, no hover affordance, no edit. Changing
it means opening the record.

This keeps the table calm, which is the whole point of R5, and it avoids the three costs
of table-cell editing: an affordance repeated on every row, a keyboard path that has to
coexist with Phase 3's row-open gesture, and an accidental click that changes data.

**The affordance is an always-visible quiet chevron** after the value, in
`text-copy-muted` — not a hover reveal. A hover-only affordance is invisible until you
happen to point at it, which fails discoverability and fails anyone driving by keyboard.
No border on the value at rest (§1.3). Hover raises the ground to `bg-surface-muted`;
focus takes the §2.3 ring.

Fast list triage — re-staging five leads without opening five records — is **not being
built**. If it is wanted later it is a follow-on with its own interaction pass, not a
side effect of this one.

### R7 — The type ladder steps down. Only the surface's name is larger than the body

Decided in 5.0 and written into `design.md` §3.3. **Tight 16px leaves the product ramp**, so
`text-lg` (18px) is the only size above the 14px body and it means exactly one thing: the
name of the surface you are looking at.

Everything below that is separated by **ink and weight, not size**:

| Role | Size | Weight | Ink |
|---|---|---|---|
| Surface title | 18 | semibold | primary |
| Section heading | 14 | semibold | **label** |
| Eyebrow | 11 | semibold | label |
| Field label | 12 | medium | label |
| **Value** | 14 | normal | **primary** |
| Body / cell | 14 | normal | secondary |
| Metadata | 12 | normal | muted |

**A section heading is quieter than the values under it.** That inversion is the ruling, not
a side effect: on a record page the operator came for *Jane Doe*, not for the words *Contact
details*, and a heading that outranks the data is furniture outranking content. Heading and
value differ on two axes (weight, ink) and none of the third, which is a stronger signal
than the 2px it replaces and costs no vertical space.

Why 16px goes rather than being pinned: two pixels above body is not a hierarchy, it reads
as "slightly bigger text", and it is measurably why one role drifted to four sizes —
`text-lg` ×46, `text-base` ×43, `text-sm` ×24, bare `font-semibold` ×23 on `<h2>`. §3.3
already said that a thing needing to be slightly bigger needs weight or space instead; the
step that let people ignore that is now gone. `text-p-base` survives for prose.

Also settled here: **one stat-figure size.** Dashboards ran `text-3xl` ×27, `text-2xl` ×18,
`text-xl` ×15 for one role. It is `text-2xl font-bold tabular-nums`, once (5.7).

**Sweep cost:** 64 tight `text-base` and 46 `text-lg` `<h2>`s. It lands with the surface that
owns each file, not as a separate pass — `SectionHeading` (5.1) is what makes it a one-line
change per site.

### R8 — Three ways to group, and a box is earned

`design.md` §1.3 budgets two levels of visible container but never named them, which is how
**206 hand-rolled card-shaped boxes** accumulated against 65 files using `<Card>`. The
taxonomy, now in §1.3:

| Role | Draws | For |
|---|---|---|
| **Panel** | border `line-default` + `bg-surface` + `radius-card` | A top-level region. Level 1. A panel may not contain a panel. |
| **Ink group** | nothing | A named cluster inside a panel. Where most of the 206 belong. |
| **Row** | border `line-subtle` + `radius-control`, or a bare `divide-y` | A repeated **interactive** item inside a panel. Level 2. |

> **A box is earned by interactivity or by separation. Never by grouping.**

Two things this decides that were live drift: panels take the panel border tier and rows take
the row-divider tier (which is what those tokens already mean), and **a repeated item that
is not interactive is not a box at all** — it is a `divide-y` line. That is what resolves the
activity/comment/task rows currently split between `radius-control + line-default` and
`radius-card + line-subtle` across five files.

### R9 — The record is a spine, and the spine is the only editable region

The owner's call, 14 Aug 2026, against two alternatives (see 5.0). Full contract and
wireframe in `design.md` §4.7, archetype 2.

A fixed `20rem` rail carries the record's identity, state and relationships. The content
region is the only scroller and carries one tab strip — `Details · Activity · Tasks · Files`,
in that order, on every record type.

> **The spine is the only editable region on the page.**
> Every control that writes to the record is in it. Nothing in the content region edits.

This is what makes it a signature rather than a layout, and it is the reason it was chosen
over the two alternatives. R2 draws a categorical boundary and then names its own risk — a
half-editable page where nothing signals what is clickable is worse than either pure model.
A left rail on a CRM is ordinary; a left rail that *is the editable surface of the record* is
specific to Lynk, because R1 and R2 are. The boundary is carried by position, so it is
learnable in one glance and it cannot rot: a control that drifts out of the rail is visibly
in the wrong place, which is not true of a convention.

Consequences that are decisions, not details:

- **The record page becomes a full-height column**, like the list page (§11.1). The content
  region scrolls; the rail is a flex sibling of it, so this adds **no** `position: sticky`
  and needs no R3 exception. That is a behaviour change on all 12 record pages.
- **Every record type carries the spine.** The State block is omitted where a record has no
  state fields; the Connected block is not optional. A rail carrying only "Created /
  Updated" is a signal the record type is under-modelled — raise it, do not answer it with a
  second archetype.
- **One tab strip, owned by the archetype**, so nested tabs have nowhere to recur and
  contracts, contacts and accounts inherit the four panels rather than each page remembering
  them.
- **The cost is width:** ~320px on every record, leaving ~700px of content at 1280px. A
  two-column field grid fits, a three-column one does not. The three line-item documents are
  where it bites; `RecordTable variant="lineItems"` scrolls sideways inside the content
  region rather than the archetype bending for them.
- **Below `lg` the rail stacks and the page reverts to a document scroll.** A fallback, not a
  responsive feature.

### R10 — One table, three variants

Decided in 5.0 so that 5.5 is execution rather than discovery. `RecordTable` carries one
`cva` variant axis and three independent props; there is no second table.

| Variant | Shape | Consumers |
|---|---|---|
| `default` | selection, sort, row-open gesture, pagination | the 24 module lists + the 12 settings/automation/integration lists that move in 5.5 |
| `lineItems` | editable rows, add/remove row, totals footer; no selection, no sort, no pagination | quote, order, POS invoice, `TransactionLineItemsEditor`, and the matching form pages |
| `readOnly` | no selection, no sort, no row-open | the 2 client-portal tables (5.8) |

Independent props, not variants, because they combine freely: `selectable`, `rowActions`,
`density`. A settings list is `default` with `selectable={false}` — not a fourth variant.

`variant="lineItems"` is the load-bearing build of 5.5. **If `RecordTable` genuinely cannot
carry an editable row without contorting, that finding is written into `design.md` and taken
to the owner before a second table is allowed to exist.** It does not get quietly exempted.

The only files permitted to import `components/ui/Table` are the three primitives that
implement it: `RecordTable`, `ModuleTableLoading`, `ModuleListToolbar`. That becomes a
source-level check in 5.10.

---

## The coverage contract

"Every single one" needs a denominator, or it degrades into "the ones we remembered".

| Surface | Count |
|---|---|
| `app/**/page.tsx` | **116** — dashboard 90, client 17, auth 3, public 1, book 1, e2e harness 3 |
| `app/**/layout.tsx` | 4 |
| `app/**` route boundaries and shell | **38** — added by 5.0; see below |
| `components/**` (non-`ui`) | 115 files, ~32,000 lines |
| `components/ui/` | 54 files, 6,273 lines |
| **Total** | **327** |

**The denominator was wrong at 289, and the missing 38 matter.** They are the `error.tsx` /
`loading.tsx` / `not-found.tsx` route boundaries plus `providers.tsx`, `ClientLayout.tsx` and
`AuthCallbackClient.tsx`. **Fourteen `error.tsx` files exist in four different sizes** — 3, 7,
14 and 18 lines — so the §7.4 error state has four shapes in the one place `PageShell` cannot
supply it. The audit measured error-state drift *inside* pages and missed it at the boundary
entirely. They are owned by 5.1, because the fix is one shape drawn from `RouteStates` rather
than 38 decisions.

**5.0 produced [`rebuild-census.md`](./rebuild-census.md)** — every one of those files, one
row each, with its owning sub-phase and a one-word verdict (`rebuild` / `adopt` / `delete` /
`unchanged`). It is updated as each sub-phase closes, so *"did we skip anything"* is answered
by reading a table rather than by memory. **A sub-phase is not done while a row it owns is
unmarked.**

The census also records the rule that keeps "owner" meaningful: the owning sub-phase is the
one that *rebuilds* the file. 5.2 and 5.9 own almost nothing and touch almost everything,
which is why neither is scheduled first.

Three groups are marked `unchanged` up front, with reasons, and they are the only ones:

| Marked unchanged | Reason |
|---|---|
| `app/e2e/**` (3 harness routes) | Test-only, blocked in production by `proxy.ts` |
| `app/dashboard/finance/pos/[invoiceId]/print` | §2.5 exception 2 — the invoice carries its own document theme and must not follow the app theme |
| `HexagonBackground.tsx`, `AnimatedShinyText.tsx`, `LynkSplash.tsx` | §9 identity surfaces. `LynkSplash:58` still gets its off-grid `pl-[0.2em]` fixed in 5.9; the motif itself is not touched |

---

## Testing policy

The 58-spec suite at `--workers=1` is what has been costing the time. **It stops running
per sub-phase.**

**Every sub-phase, always** — cheap, and they are the actual contract:

```bash
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build
./scripts/check-design.sh                      # run at the START of a sub-phase too
docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1
```

The two rendered guards stay. They cannot be narrowed — `design-rules.spec.ts` is a
*single* test that loops ~95 routes internally, so there is no `--grep` that scopes it —
but that is also why it is cheap: one login, one pass. Dropping the design guard from a
design programme would be the wrong economy.

**Only the specs for what changed.** Each sub-phase runs the module specs for the modules
it touched, and nothing else:

```bash
docker compose run --rm frontend-e2e npm run test:e2e -- leads-revamp.spec.ts quotes-revamp.spec.ts --workers=1
```

**Full suite exactly twice** — once at the end of 5.5 (the halfway structural point,
where tables and lists have all moved) and once before 5.10. Not per sub-phase.

**No new e2e specs during the programme.** Existing specs get *updated* where a rebuild
moves the thing they assert. New coverage lands only in 5.10, as checks inside the guard
spec that already exists. Writing eleven sub-phases' worth of new specs is the cost being
cut.

**Screenshots, trimmed.** The stash/restore before-and-after ritual runs only where a
change is global and invisible to assertions — 5.1, 5.2, and 5.8's auth surface. Every
other sub-phase takes plain after-shots of the routes whose structure changed, both
themes, one narrow (768px).

**Two checks stay mandatory and are not delegable to an assertion:**

- the honeycomb still renders as a honeycomb after 5.8 (§9 records it silently breaking
  once already);
- a tab-through of a rebuilt record page after 5.3, focus visible at every stop.

Run-shape traps, already paid for once: a cold run reports sales lists unreachable — warm
the routes first; parallel runs add a dozen timeout failures that vanish serially. Judge
on `--workers=1`, and read `docs/e2e-suite-status.md` before treating a red as new.

Seed before any detail route is reachable:

```bash
docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default
docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
```

---

## The risk in the chosen method, and the mitigation

Rebuilding in place discovers the shared API *late* — the first module's rewrite is also
the API proposal, and modules 2–4 usually force a revision that sends you back. Phase 3
avoided this by building `RecordTable` first.

Mitigation, applied to every sub-phase:

- The **first module of a family is rebuilt in place and its shared components are
  hoisted in the same sub-phase**, before module two starts. A sub-phase that ends with a
  shared shape still living in a page file has not ended.
- The **second module is the API test.** If it needs a `className` to fit, that is a
  missing `cva` variant (§7.3), and the primitive changes before module three.
- 5.1 is the one deliberate exception, explained there.

---

## Sub-phase index

| | Sub-phase | Owns |
|---|---|---|
| 5.0 | Direction, law, census | The archetypes, the type ladder, the signature, the rulings every later sub-phase needs |
| 5.1 | Cross-cutting primitives | The seven extractions + the dialog migration |
| 5.2 | Panel language | The 206 hand-rolled boxes |
| 5.3 | Record detail | 7 archetypes → 1 |
| 5.4 | Forms | The create/edit model |
| 5.5 | One table, list workflow | 18 raw-`Table` files + Appendix A's core |
| 5.6 | Settings | All 23 pages, plus Phase 4's unfinished items |
| 5.7 | Dashboard, reports, boards, calendars, mail | The surfaces no phase has touched |
| 5.8 | Client portal, public, auth | Was Phase 7 |
| 5.9 | Copy and voice | Was Phase 6 |
| 5.10 | Guard the composition | Was Phase 8; all new test coverage lands here |

---

## 5.0 — Direction, law, and the census

**Docs only. No product code.** `design.md` §1.1 and §12 require it: a change that
touches more than one screen's *structure* is a redesign and must be written down first.

Run the `frontend-design` skill's process — brainstorm, explore, plan, critique — against
the real brief, which is `docs/design/`. The skill's own rule applies: *where the brief
pins down a visual direction, follow it exactly.* Palette and face are pinned. Three axes
are open, and that is where the design work goes.

**Type — the intra-page hierarchy.** §11 already records "body copy is still one size in
practice, 872 `text-sm`", and there are four competing section-heading sizes for one
role. Under one face, hierarchy is the *only* place typographic personality can live.
Produce a closed, named ladder — page title → section heading → eyebrow → field label →
value → metadata, each with size, weight and ink token — and write it into §3.3.

**Layout — the five archetypes.** One ASCII wireframe each for list, record, form,
settings, dashboard, decided from the operator's job rather than from the median of what
exists. The record wireframe is load-bearing: it settles where activity, notes, tasks and
documents live, and whether editing happens in place.

**Signature — one element, justified.** Spend the boldness once. The hive is already
Lynk's identity but §9 confines it to auth/splash/ambient, so the product surface needs
its own. Leading candidate: the **record spine** — a persistent rail carrying the
record's relationships and state, because relationships are what a CRM operator navigates
by, and `RecordRelationshipRail` already exists on three pages as a half-built version of
it. Work at least two alternatives before committing, and apply the skill's calibration
test: *would I have produced this for any CRM?* If yes, revise.

**R1–R4 are already decided** and constrain the wireframes: the record wireframe must
render R2's state/content split visibly, and the form wireframe must show a footer only
where R1 says manual save applies.

Still to settle here, because every later sub-phase needs the ruling:

- **Panel taxonomy.** §1.3 budgets two levels of visible container and says hierarchy
  comes from ink, not boxes. Many of the 206 hand-rolled boxes should not be boxes at
  all. Name which roles get a `Card`, which get a borderless ink group, which get a
  `radius-control` row.
- **Button variants.** R4 settled the *sizes*. Cut the variant set to the five with real
  usage (`default`, `outline`, `ghost`, `destructive`, `dangerGhost`) and add
  `destructiveOutline` for the string two dialogs hand-write.
- **The tone classification itself** (**R5**) — every enum value in every module sorted
  into `neutral` / `attention` / `critical`, or marked a category with no tone at all.
  This is a judgement call per field and it is the one piece of R5 that cannot be
  mechanical. Do it once, in the doc, before 5.1 rewrites `statusStyles.ts`.
- **One empty-value string** — `"Not set"`, including inside `ReadOnlyRecordLayout`,
  which currently emits `"Not recorded"`. The primitive contradicts the target.
- **The table variant set** (5.5), so that sub-phase is execution rather than discovery.

**Deliverables:** `design.md` (§3.3, §4.4, the archetype contracts), `tokens.md` only if
the type ladder needs a step that does not exist, this file, `rebuild-census.md`, and the
`consistency-pass.md` edits.

**Gate: the owner reads the direction and the wireframes before 5.1 starts.**

### Status: done — the direction

Docs only, as specified. No product code, so there is nothing to verify beyond the documents
themselves; `check-design.sh` is unchanged at 3 of 14 failing, the same three.

**The three open axes, decided.**

| Axis | Decision | Lives in |
|---|---|---|
| Type | **The ladder steps down.** Tight 16px leaves the product ramp; only the surface's name is larger than the body; a section heading is quieter than the values under it | `design.md` §3.3 · **R7** |
| Layout | **Five archetypes**, one wireframe and contract each | `design.md` §4.7 |
| Signature | **The record spine** — and the rule that the spine is the only editable region on the page | `design.md` §4.7 archetype 2 · **R9** |

**The signature, and what it was chosen over.** Three record structures were drawn at
fidelity in Lynk's own tokens and compared with the owner: the spine, a two-column document
(closest to today — archetype 1 applied to the other nine record types), and a tabs-first
full-width page (cheapest migration — eight of twelve record types are already roughly that
shape). The owner took the spine on 14 Aug 2026.

The reasoning, recorded because the cheap option was genuinely tempting:

- **Tabs-first wins the migration and loses the product.** It puts relationships behind a tab
  on every record in a CRM. That is the audit's "add a note is 0 clicks, 2 clicks, or
  impossible" finding relocated to a different field, not fixed.
- **Two-column is the median answer, and its rail has a hole in it.** Its one distinctive
  claim is a persistent context rail that is not persistent — it scrolls away with the page.
  Making it stay needs a `position: sticky` exception written on the same day R3 deletes ten
  of them. It is also three container levels against §1.3's budget of two.
- **The spine is the only one where the rule is carried by the structure** rather than by a
  convention enforced at review — which is how seven archetypes happened in the first place.

**Signature alternatives worked and rejected**, per the skill's requirement to work at least
two and to apply the calibration test (*would I have produced this for any CRM?*):

| Rejected | Why |
|---|---|
| A **lifecycle track** as the signature | Only means anything on lead, deal, quote and order. A signature that works on a third of the record types is not one. **Kept** as an optional first block of the spine where a real pipeline exists. |
| A **connection strip** of related-record chips under the header | R5 deletes `Pill` on the grounds that a capsule carries no information. Re-introducing a chip row on every record page contradicts that on the same day. |
| A **hairline ledger grid** — rule every surface on one baseline so the app reads as engineering paper | A real look, and a direct contradiction of §1.3, which says hierarchy comes from ink and not from lines. The pinned language wins (decision 1). |
| **The ink ladder itself**, with no structural signature | Genuinely unusual, and it is already happening — it is R7. But it is a rule, not an element; there is nothing to point at. It works better as the ground the signature stands on. |

### Status: done — R5 applied, the tone classification

Every enum value in `lib/statusStyles.ts`, sorted once, in the doc, before 5.1 rewrites the
file. **62 values across 13 maps.** `success` is classified from day one even though a list
renders it as plain ink — R5 requires that, so "colour the signed states green" stays a
one-line edit rather than a type change.

| Map | `neutral` | `success` | `attention` | `critical` |
|---|---|---|---|---|
| Insertion order status | draft · issued · active · imported | completed | — | cancelled |
| Contract status | draft · review · sent · active | signed | partially_signed · expired | cancelled |
| POS invoice status | draft · issued | paid | — | void |
| POS payment status | unpaid · partial · refunded | paid | — | — |
| Opportunity stage | lead · qualified · proposal · negotiation · unstaged | closed_won | — | closed_lost |
| Lead status | new · contacted · qualified · unqualified | converted | — | — |
| Quote status | draft · sent | accepted | expired | declined |
| Order status | draft · confirmed | fulfilled | — | cancelled |
| Task status | todo · in_progress | completed | — | blocked |
| Support case status | new · open · closed | resolved | pending | — |
| Support case priority | low · medium | — | high | urgent |
| Generic fallback | any unmapped value | — | — | — |

**Categories — no tone at all, rendered as plain text:**

| Map | Values | Why it is a category |
|---|---|---|
| Lead score grade | hot · warm · cold | Ordinal, but no value is an outcome and none is a deviation. An operator finds hot leads by sorting the column, which is what a list is for. |
| Task priority | high · medium · low | R5: priority that is not an SLA is a category. A task's priority is set by the person who made the task. |

Support case priority is the deliberate contrast: it **is** effectively an SLA — it drives
response time — so it keeps a tone where task priority does not. That is the distinction R5
draws, applied rather than restated.

**Measured outcome: 13 of 62 values carry colour in a list — 21%,** against roughly 85%
today. R5 predicted ~15%; the gap is contracts, which legitimately has three states an
operator must act on.

Three findings that came out of doing this classification, which are build inputs rather than
observations:

- **The AR list has no attention signal, and adding one to the enum would be wrong.**
  `unpaid` and `partial` are the *normal* state of a recent invoice, so colouring them makes
  an AR list mostly amber and re-creates exactly the noise R5 removes. What deserves
  attention is **overdue** — `due_date < today && status !== "paid"` — which is a **derived
  tone**, not an enum value. `StatusValue` must therefore accept a tone override computed by
  the caller from a condition, not only a tone looked up from a value. That is an API
  requirement on 5.1 and a display requirement on 5.5 and 5.7.
- **`labelize()` is a §3.5 violation in the data layer.** It title-cases every unmapped value
  and the maps hard-code "Closed Won", "In Progress" and "To Do", so sentence case is broken
  on strings that reach every list page in the app — by a helper, not by a designer. Correct
  forms: "Closed won", "Closed lost", "In progress", "To do". Recorded in `design.md` §3.6.
- **Two maps already render wrong and nobody noticed**, because a pill looks plausible either
  way. `sent` / `issued` / `imported` resolve to `bg-action-primary-muted` + `text-primary`,
  and §11 records that `--color-primary` was neutralised and `bg-action-primary` was a dead
  class emitting no CSS. Those chips are broken at HEAD. They are deleted with `Pill`.

### Status: done — the remaining 5.0 rulings

| Ruling | Outcome | Written into |
|---|---|---|
| Panel taxonomy | Three roles — panel / ink group / row. **A box is earned by interactivity or by separation, never by grouping** | `design.md` §1.3 · **R8** |
| Button variants | Cut 9 → **6**: `default` · `outline` · `ghost` · `destructive` · `destructiveOutline` (new) · `destructiveGhost` (renamed from `dangerGhost`). `primary`, `danger`, `secondary`, `link` deleted | `design.md` §2.2 |
| One empty-value string | **`Not set`** in a field, **`—`** in a table cell — the renderer decides from context, no call site picks. `"Unassigned"` survives only as a filter-bucket label | `design.md` §3.6 |
| The table variant set | `default` · `lineItems` · `readOnly`, with `selectable` / `rowActions` / `density` as independent props | **R10** |
| Rail widths | `--width-rail-nav` 16rem, `--width-rail-context` 20rem — the record spine and the form aside are the same width | `tokens.md` §6.1 |
| Page split and field grid | One ratio `lg:grid-cols-[minmax(0,1fr)_20rem]`, one field-grid breakpoint `md:grid-cols-2` — replacing 10 ratios and 78 hand-written grids | `design.md` §4.4 |

**Not settled here, deliberately.** The nine-to-twelve private field renderers are named in
5.3 but their replacement API is 5.1's job — it needs a real call site to be designed
against, per scoping decision 4. 5.0 fixes only the *type roles* they must resolve to (R7).

---

## 5.1 — The cross-cutting primitives

The one place primitives land before their surface is rebuilt, because these are not
speculative: **every one is an extraction of code that already exists in duplicate**, and
5.2–5.9 all need them on day one.

| New / changed | Replaces |
|---|---|
| `lib/currency.ts` + `<Money>` | 15 local formatters, 24 raw `Intl.NumberFormat`, mixed `"en-US"` / `undefined` locale |
| `ActionBar` / `FormFooter` (dirty-state slot) | 10 sticky footers on 3 recipes; absorbs ~38 Button spacing overrides. Per **R4** it owns its children's control height; per **R3** it is not sticky |
| `SaveStateIndicator` — `Saving…` / `Saved` / `Couldn't save — retry` | Nothing. **R1** requires it: autosave removes the button, which was the operator's only feedback |
| `InlineFieldEdit` — the **R2** state-field control | 5 detail pages hand-roll inline editing today, each differently |
| `SectionHeading` | 137 hand-written `<h2>` |
| `Avatar` | 2 bespoke — one square, one circle |
| **Delete `Pill`** (**R5**); `lib/statusStyles.ts` returns `{tone, label}` | 52 files re-deriving colour from raw `bg` / `text` / `border` props, 2 local `StatusPill`, the noise overlay, and two dead-token maps (`bg-action-primary-muted`) |
| `StatusValue` — renders a `tone` per context: plain ink in a list, semantic colour on a record header | The pill, everywhere it was standing in for a status |
| Promote `RecordPanelStates` → `components/ui/` | reaches 5 of ~40 panels today |
| `button.tsx` variant/size cut + `destructiveOutline` | 3 dead variants, 4 near-dead, 2 hand-written destructive strings |

Also here, now that decision 2 is retired: **migrate `components/ui/dialog.tsx` off
`@headlessui/react` onto the shadcn/radix dialog.** It was excluded from the consistency
pass only because it is a behaviour change — focus trap and close semantics, on every
modal at once. It is the last standing `check-design.sh` failure that is not a one-line
fix, and §11.3 exists solely to explain why the guard is red. It needs its own pass over
the 9 dialog and 13 sheet call sites; if it slips, it slips as a unit. Do not half-land
it.

**Files:** `components/ui/{button,Pill,dialog,sheet}.tsx`; new `components/ui/{Money,
ActionBar,SectionHeading,Avatar,PanelStates}.tsx`; new `lib/currency.ts`;
`lib/statusStyles.ts`.

### Status: in progress — batches A and B landed

Six batches, gated by `check-design.sh` + lint + build between each. **A and B are done; C, D
and E are not started.** The source guard is unchanged at 3 of 14 — the same three — and no new
e2e failure was introduced (verified by stashing and re-running: the reds below fail identically
at HEAD).

**Batch A — foundations.** `lib/currency.ts` + `<Money>` (formatters cached; a 50-row money
column was constructing one `Intl.NumberFormat` per cell per render), `EmptyValue`,
`SectionHeading`, `Avatar`, `SaveStateIndicator`, `ActionBar`/`FormFooter`, `PanelStates`
promoted out of `recordActivity/`, `button.tsx` cut 9 variants → 6, rail-width tokens into
`globals.css`.

**Batch B — status.** `lib/statusStyles.ts` returns `{tone, label}` across all 13 maps per
5.0's classification; `StatusValue` renders a tone per context and accepts the caller-computed
override; `Chip` takes the tags and markers; **`Pill` is deleted** — 104 call sites in 52 files,
zero remaining, including the local `StatusPill` / `CasePill` / `MfaStatusPill` wrappers whose
names are gone too, so 5.10's source guard on the identifier is clean.

**Three findings that change this document's assumptions.**

1. **`secondary` was 47 call sites, not 8, and it carried a role.** design.md §2.2 measured
   only the literal prop and ruled it a redundant `outline`; 38 of the 47 are the selected half
   of a two-state control. Deleting it as specified would have made Active/Inactive pairs
   visually identical. **The owner chose to build `SegmentedControl` in 5.1** rather than defer
   it, so the variant set still closes at six and 5.6/5.7 inherit finished controls. It is
   vendored from shadcn's `ToggleGroup`, which also fixes an a11y defect the hand-rolled version
   had: every segment was its own tab stop, and a three-way switcher cost three tabs to pass.
   The correction is written into §2.2.
2. **`sheet.tsx` is already on radix.** This document scopes the dialog migration as "9 dialog
   and 13 sheet call sites" — the 13 sheets need no work. The real headlessui surface is
   `dialog.tsx` plus a `Menu` in the three import/export controls, which needs a vendored
   `dropdown-menu`. `radix-ui` v1.4.3 is already a dependency, so **batch D adds no package, it
   only removes one.** D is smaller than budgeted.
3. **The rendered guard had a blind spot.** `design-rules.spec.ts` measured control height on
   `[data-slot="button"|"input"|"select-trigger"]` only, so a segmented control would have
   escaped it — and the first cut of `SegmentedItem` was 28px, off the closed set. Added
   `segmented-item` to the selector. This is the one place 5.1 touches a spec: the testing
   policy defers *new checks* to 5.10, but shipping a primitive the guard cannot see is a
   defect, and the skill's build order ends with "the guard that keeps it".

**Two pre-existing defects the guard surfaced, recorded rather than fixed here.** Both fail
identically at HEAD:

- `leads-revamp.spec.ts` "narrow viewport" — **table headers compute to `position: relative`,
  not `sticky`.** R3 keeps `sticky top-0` on table headers as one of only two legitimate uses,
  and it is not working. Owner: 5.5.
- `leads-revamp.spec.ts` "denied and missing records" — `PermissionDeniedState titleAs="p"`
  renders no heading, so the spec's `getByRole("heading")` cannot match. Owner: 5.6, which
  already carries `PermissionDeniedState` forward from Phase 4.
- `RecordTasksPanel:357` hand-wrote `h-7` (28px) on a Complete button, breaching §4.2. Fixed in
  passing because it blocked the gate; nominally 5.3's file. It only surfaced once seeding made
  the contact detail route reachable — a cold run reports those lists unreachable and audits 76
  routes instead of 95, so **a green guard run is only evidence if the route count is 95**.

**Spec updates, per the testing policy** ("existing specs get *updated* where a rebuild moves
the thing they assert"). Ten assertions across five specs encoded the deleted pill colours
(`span.bg-state-success-muted`); they now assert `[data-slot="status-value"][data-tone=…]`,
which tests the classification rather than a Tailwind class. Nineteen `aria-pressed` assertions
on hand-rolled switchers became `role="radio"` + `aria-checked`. Two label assertions moved to
sentence case ("To Do" → "To do", "In Progress" → "In progress") — that is §3.6 being applied by
`statusStyles.ts` rather than by a designer, and it is the intended change.

**Still open in 5.1:** batch E (`InlineFieldEdit`, `LinkedRecordPicker`).

### Status: batch C landed — the route boundaries

**The four "sizes" were never four implementations — every one of the 35 files already
called into `RouteStates`.** The drift was in the file shape around that call: some
component definitions were compressed onto one line (up to 165 characters), some were
idiomatic multi-line Next.js boundaries; 13 `error.tsx` files each redefined the same
Next.js error-boundary prop type inline; five `loading.tsx` files omitted the `label` prop
their siblings supplied, so `aria-label="Loading page"` announced on some routes and the
real module name on others; three `error.tsx` files (`pos`, `orders`, `quotes`) explicitly
restated `RouteErrorState`'s own defaults (`backHref="/dashboard"` /
`backLabel="Return to dashboard"`) as if they were a deliberate choice, which made
`payments/error.tsx`'s **genuine** override (`backHref="/dashboard/finance/pos"`, since
payments has no list page of its own) unreadable as one.

**The one shape**, now applied to all 35 rows the census assigns here:

- One shared type — `RouteErrorBoundaryProps`, added to `RouteStates.tsx` — replaces 13
  inline redefinitions of `{ error: Error & { digest?: string }; reset: () => void }`.
- One naming convention — `{Module}Error` / `{Module}Loading` / `{Module}NotFound` — so a
  stack trace or a search for the function name identifies the route without opening the
  file. Generic names (`ErrorState`, `Loading`, `NotFound`) are gone.
- One formatting convention — idiomatic multi-line JSX, no single-line component bodies.
  A file's size still varies (7 lines for a bare title, 18 for one with a real `backHref`
  override) — that variance is now content, not habit.
- `backHref` / `backLabel` are supplied only where they differ from `RouteErrorState`'s own
  default, so a reader can trust that a value present on the call site means something.
- Every `loading.tsx` passes `label`, matching the module name already used in its sibling
  `error.tsx` title.
- `app/loading.tsx` (the cold-boot splash) and `dashboard/{loading,not-found}.tsx` needed no
  content change — they were already the target shape, or (the splash) are a deliberately
  different tier from the in-shell skeleton, per the comment already on
  `dashboard/loading.tsx`. Recorded as `done` in the census rather than left unmarked.

No behaviour change: every route still renders the same `RouteErrorState` /
`RouteLoadingState` / `RouteNotFoundState`, with the same props, at the same routes — this
is invisible unless a route actually errors, loads, or 404s. No new e2e coverage, per the
testing policy; existing specs don't assert boundary-file internals. `check-design.sh` is
unchanged at 3 of 14 failing — none of the three are here.

**Files:** `components/ui/RouteStates.tsx`; all `error.tsx` / `loading.tsx` /
`not-found.tsx` under `app/dashboard/{,finance/{pos,payments},sales/{leads,contacts,
organizations,opportunities,quotes,orders},settings/{fields,permissions,users},
views/[moduleKey]}`; `docs/design/rebuild-census.md` (35 rows marked `done`).

### Status: batch D landed — the dialog migration

`dialog.tsx` is now built on the same `radix-ui` package `sheet.tsx` already used, not
`@headlessui/react`. `@headlessui/react` is removed from `package.json`; `check-design.sh`
moves from 3 of 14 failing to **2 of 14** — §7.2 is closed, §4.1 and §4.2 (owned by 5.9 and
5.8) are the remaining two.

**The two headlessui `Menu` call sites moved to a new vendored primitive, not a bigger
`dialog.tsx`.** `ExportControls` and `ImportControls` each render one menu item into
`ModuleImportExportControls`' dropdown; that is a `DropdownMenu`, not a `Dialog`, and had no
existing radix vendor in the repo (`select.tsx` and `popover.tsx` each vendor their own
primitive directly rather than sharing one). `components/ui/dropdown-menu.tsx` is new:
`DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuItem` only —
no `Group`, `Label`, `Separator`, `Sub`, or checkbox/radio items, because nothing calls them
yet. It follows `select.tsx`'s convention (`focus:` styling — radix moves real DOM focus to
the highlighted item, so no `data-highlighted` variant is needed) rather than `dialog.tsx` /
`sheet.tsx`'s `motion` treatment, matching its nearer sibling `popover.tsx`.

**The behaviour change is real, and it is not confined to the Menu swap.** Headless UI's
`Dialog` and Radix's `Dialog` both trap focus by default, and a second modal Dialog opening
on top of an already-open one (the confirmation from `useConfirm`, stacked over `TaskDialog`,
`CalendarEventDialog`, `ImportControls`' preview dialog, and others) is exactly the
scenario `dialog-layer.tsx` exists for. Previously only `sheet.tsx` consumed
`useDialogLayerCovered()`; `dialog.tsx`'s `Dialog` and `DialogPanel` now do too, releasing
`modal` and guarding `onInteractOutside` / `onEscapeKeyDown` the same way `SheetContent`
already did. Without this, a covered `Dialog` and the confirmation on top of it would fight
over the same focus trap.

**No `as` polymorphism, no `DialogPanel from=` flip-direction carried forward.** Neither was
called anywhere in the nine dialog call sites, so the new implementation doesn't keep the
dead surface — `DialogPanel` always flips in from the top, matching every existing call
site's actual (default) behaviour. Visual output, sizes (`sm`/`md`/`xl`/`3xl` in active use),
radii, shadows and the flip/blur entrance animation are unchanged.

**`GlobalCommandPalette` gained a `DialogTitle`.** It never had one — Headless UI didn't
require it. Radix's `DialogContent` warns without one, and screen reader users genuinely had
no accessible name for the palette either way, so a `sr-only` title using the existing
`SEARCH_LABEL` string closes that gap rather than silencing the warning.

No new e2e coverage for the primitive swap itself, per the testing policy; existing specs
exercise the same dialogs and now assert against Radix's rendered output
(`role="dialog"`, `data-state`) instead of Headless UI's. `import-controls-revamp.spec.ts`
does not click through the dropdown item to trigger the file input — it sets the file
directly on the `aria-label="Import"` input once the menu is open — so it was unaffected by
the primitive swap either way.

**Files:** `components/ui/{dialog,dropdown-menu}.tsx` (new file); `components/ui/
{ExportControls,ImportControls,ModuleImportExportControls}.tsx`;
`components/search/GlobalCommandPalette.tsx`; `frontend/package.json` /
`package-lock.json` (`@headlessui/react` removed); `docs/design/design.md` §11.3 (closed);
`docs/design/rebuild-census.md` (5 rows marked `done`).

### Status: batch E landed — `InlineFieldEdit`, and closing 5.1

`InlineFieldEdit` is built on `Select` (radix) with a new `SelectTrigger variant="ghost"` —
R6's affordance as a variant, not a second component, per §7.3. The closed value renders
through `StatusValue context="record"`, so the field looks like any other status until the
operator notices the chevron. Each field owns one `SaveStateIndicator`, and a `confirm` prop
covers R1's "explicit confirm" row for a value that fires a side effect. Full contract now in
`design.md`, archetype 2.

**The five hand-rolled pages were never five implementations of one thing** — three shapes,
not one:

- **Opportunities' stage** was already the closest to correct (immediate commit, no button) —
  swapped onto `InlineFieldEdit` directly. `updateStage` keeps its existing optimistic
  `setQueryData` / rollback; it now throws on failure instead of swallowing it into a toast,
  which is what `SaveStateIndicator` reads as `error`.
- **Orders' status and contracts' status** were manual: a `Select` staged a draft value and a
  header "Save status" button committed it. Both lost the button and the draft state — the
  field commits on selection. Contracts' commit is gated by the existing `useConfirm` dialog
  (R1's side-effect row), unchanged in copy, now called from `InlineFieldEdit`'s `confirm`
  prop instead of before a button's `onClick`.
- **Support cases bundled three fields — status, priority, category — behind one "Save
  changes"** with an unsaved-changes guard. They are now three independent `InlineFieldEdit`s,
  each autosaving on its own; the guard is gone because nothing stays dirty. This also removed
  a remount-on-save wrinkle: the workspace was keyed by `` `${id}:${updated_at}` `` to reset
  three local drafts whenever the record changed server-side. With no local drafts left to
  reset, the key is just `id` — a per-field save no longer remounts the whole card and drops
  an in-progress reply.

**Quotes' status field is not migrated, on purpose.** It is not a hand-rolled inline edit in
the same sense as the other four — it is one field inside the single `PUT` that saves the
entire quote document, which is exactly the "quotes are secretly a form" defect 5.3 already
owns (line-item content and state field are entangled in one manual save). Pulling the status
field out now would be a partial version of 5.3's own restructuring landing early and outside
its scope. It stays on `RecordFormLayout`'s manual save until 5.3 splits it.

**Contracts' per-signer status list is out of scope**, for the same reason in miniature: it
edits a child record in a list, not the contract's own top-level state field, and R2's
categorical boundary is about the record being viewed, not every nested entity on the page.

**Two findings recorded rather than expanded into new work:**

- **A duplicate now exists on the deal page.** `StatusValue` in the summary strip
  (`opportunities/[opportunityId]:442`) and `InlineFieldEdit`'s own closed-state display both
  render the stage, because the strip badge predates this batch and sits near the quick
  "Won"/"Lost" actions rather than beside the field it duplicates. Left as a product decision
  outside batch E's scope (extraction of the five hand-rolled edits) rather than folded in
  silently; `opportunities-revamp.spec.ts` now asserts `.first()` rather than assuming one match.
- **`ContractStatus`/`statusLabel`** (`contracts/[contractId].tsx:444`) hand-classifies tone
  with a raw if/else instead of `lib/statusStyles.ts`, because it serves both the contract's
  own status and the signer sub-status — two enums `statusStyles.ts` has no shared shape for.
  `InlineFieldEdit`'s own options use `getContractStatus` directly; the local classifier still
  backs the read-only badges and the (out-of-scope) signer list. A pre-existing R5 gap, not
  introduced here.

**Found in passing, fixed because it was the same rule this batch is about.**
`crm/RecordTagInput.tsx` hand-rolled its own removable tag chip — `rounded-full`, which §4.3
reserves for avatars now that `Pill` is gone — instead of `Chip`. Swapped onto `Chip` with the
existing remove button nested inside it; no visual contract change to `Chip` itself.

**`LinkedRecordPicker` needed no change.** The batch E line item was to confirm it is ready to
serve as the spine's Connected-block link control (per the census); it already renders through
current tokens (`bg-surface-muted`, `bg-action-primary-muted`, `focus-visible:ring-focus`),
the `overflow-hidden` clipping defect closed under Phase 2 stays closed, and it has no other
open finding. Its dual role — editable picker in a form, read-only link in the Connected block
— is unbuilt because the Connected block itself is 5.3's, with its first real call site; per
scoping decision 4, the picker's link-rendering mode is not built ahead of that call site.

Spec updates, per the testing policy: `contracts-revamp.spec.ts` and `support-revamp.spec.ts`
drop their "Save status" / "Save changes" assertions and assert the autosave lifecycle
(`[data-slot="save-state-indicator"][data-state="saved"]`) instead; both also switch from
`getByLabel` to `getByRole("combobox", { name: … })` since the field label is no longer
`htmlFor`-linked to the control (`InlineFieldEdit` names itself via `aria-label`, matching the
other three call sites' existing convention).

**Files:** `components/ui/{select,InlineFieldEdit}.tsx` (`InlineFieldEdit.tsx` new);
`components/crm/RecordTagInput.tsx`;
`app/dashboard/sales/opportunities/[opportunityId]/page.tsx`;
`app/dashboard/sales/orders/[orderId]/page.tsx`;
`app/dashboard/contracts/[contractId]/page.tsx`;
`app/dashboard/support/cases/[caseId]/page.tsx`; `docs/design/design.md` (archetype 2);
`docs/design/rebuild-census.md` (3 rows marked `done`); `tests/e2e/{contracts-revamp,
support-revamp,opportunities-revamp}.spec.ts`.

---

## 5.2 — The panel language

The likeliest single cause of the app reading as templated: **206 boxes** where §1.3
permits two levels of container and says to use ink instead.

- Sweep every hand-rolled box per the 5.0 taxonomy — to `Card`, to a borderless ink
  group, or deleted as a nesting level.
- Enforce the two-level budget on every dashboard route. A box inside a box inside a card
  is what makes a dense product look generic.
- Retire the local `SummaryTile` **container** recipes here rather than in 5.3, since they
  are panel decisions: `radius-card` + `line-subtle` vs `radius-control` + `line-default`
  at `py-3` vs the same at `py-4`.

```bash
grep -rn 'rounded-\[var(--radius-card)\]' app components --include='*.tsx' | grep -c border   # 206 today
```

### Status: done — all seven batches landed

At 5.0's measurement this was 206 matches; by the time 5.2 started, 5.1's route-boundary and
dialog work had already resolved some incidentally, so the working baseline was **184 matches
across 74 files**. The sweep closes at **105 remaining matches**, none of them violations:
**24** are the shared `role="alert"` state-banner idiom (unowned box shape, 5.4 consolidates
the literal duplication); the rest are the client portal's already-correctly-tiered top-level
panels (batch 6 fixed only the nested/repeated boxes inside them — the portal has never
adopted `Card`, and giving it one is 5.8's job, not this sub-phase's), the primitive
implementers §1.3 now names as exempt, two `rebuild-census.md` `unchanged` files, and two
rows explicitly deferred to 5.5 (`DashboardSummaryTable`'s raw `Table` wrapper) and 5.7 (the
deal-pipeline stage-summary KPI grid).

Seven batches, gated by `check-design.sh` + lint + build between each, one commit per batch:
dashboard shell & widgets, record detail pages, the `*RecordFormPage` family (where the local
`SummaryTile` recipes were retired, per this section's brief), boards & calendar, settings,
client portal + auth, and this close-out. `check-design.sh` is unchanged at **2 of 14**
failing throughout — neither is here. The rendered guards
(`design-rules.spec.ts`, `scroll-containers.spec.ts`) pass across all 95 routes at close, and
`public-surfaces-design.spec.ts` passes across the 14 public/client routes batch 6 touched.

**The taxonomy needed one addition, not a rewrite: kanban columns and cards.** §1.3's three
roles assume a page with regions; a board is a row of lanes, each holding repeated draggable
items — a shape the taxonomy didn't anticipate. The resolution keeps R8's actual test rather
than stretching "panel" to fit: a column is a `bg-surface-muted` recessed strip (ground alone
already separates it from the board's own `bg-surface`, so it carries no border at rest — the
border reappears only as the active-drop-target signal, which *is* earned by an interaction),
and each card is a `Row` since it is individually draggable and clickable. The empty-column
notice ("No opportunities in this stage") dropped its box entirely, being nested and static.
Applied identically to the deal pipeline and the task board.

**A second, smaller pattern: dialogs and settings sections that nested a full panel one level
too deep.** `TaskDialog`, `CalendarEventDialog`, and `RecordPaymentDialog` each hand-rolled a
`Card`-shaped box directly in the dialog body for one labeled group (Assignments,
Participants, an invoice summary); since the dialog panel itself is already the outer
surface, these dropped to a plain `border-t` ink group, the same shape batch 2 established for
a record page's own nested "billing address" block. Team management's per-department block
followed the batch 4 kanban-column shape (borderless recessed strip) rather than a second
nested panel, since it stacks vertically with no drop-target state to signal.

**One violation surfaced only at close-out, outside the batch scan.** `ExportControls.tsx`'s
`ExportModeOption` — a selectable radio-styled option inside the export dialog's body — lives
in `components/ui/` but consumes `Dialog` rather than drawing its own surface, so it is not
one of §1.3's primitive-implementer exemptions; it follows the same `Row` conversion as
`RecordPaymentPage`'s invoice picker in batch 3. Caught because the close-out re-grep
audited every remaining match by hand rather than assuming the seven batches' file lists were
exhaustive.

**Files:** `components/ui/Card.tsx` (`asChild` added); ~60 application files swept across
`app/dashboard/**`, `app/client/**`, `app/auth/login/page.tsx`, and `components/**`; `docs/
design/design.md` §1.3 (primitive-implementer exemption, written before this note); `docs/
design/rebuild-census.md` (`Card.tsx` → `done`).

---

## 5.3 — Record detail: one archetype

**7 archetypes → 1:**

| # | Archetype | Records |
|---|---|---|
| 1 | `RecordWorkspace` + rail + `RecordTabs` + `ReadOnlyRecordLayout` | lead, contact, account |
| 2 | `Card` grid + `RecordTabs` with activity **nested inside** | deal, invoice |
| 3 | `Card` grid, no tabs, activity appended at the bottom | quote, order, support case, insertion order |
| 4 | `Card`/`CardHeader`/`CardBody` grid, **no activity at all** | contract |
| 5 | `RecordTabs` + `FormSection` inline-edit form | custom module record |
| 6 | `PageShell actions=` with no `RecordPageHeader` | catalog product, catalog service |
| 7 | Hand-rolled `max-w-5xl` + raw `<section>`, no record primitive | 7 client-portal pages (rebuilt in 5.8, onto this same archetype) |

- **`RecordWorkspace` is nearly a no-op** — its own docstring says it forwards to
  `PageShell`. Converging "onto `RecordWorkspace`" really means converging onto
  `RecordWorkspaceHeader` + `Primary` + `Region` + `RelationshipRail`. Name the real
  target, or the sub-phase converges onto a pass-through.
- **Nested tabs: 2 sites, not 6.** `opportunities/[opportunityId]:507` and
  `finance/pos/[invoiceId]:268`. The audit overstated this by four pages.
- **Replace the 9–12 private field renderers** with the 5.1/5.2 family +
  `ReadOnlyRecordLayout` (used by only 3 pages today).
- **Fix both hand-rolled `role="tablist"`** — `views/[moduleKey]:162`,
  `settings/module-builder:479`. `SavedViewSelector.tsx:26` is the correct reference if
  radix genuinely does not fit.
- **Fill the holes the archetype exposes.** Contracts have no activity, notes, documents
  or tasks. Contacts and accounts have no `RecordActivityFeed` though leads do. Support
  cases carry two comment systems and two histories on one screen.
- **Five detail pages are secretly forms** — quotes (**1,335 lines**), support cases,
  orders, contracts and custom records all edit in place with Save in `RecordPageHeader
  primaryAction`, outside `RecordFormLayout` and outside the sticky-footer convention.
  **R1/R2 answer this**: their *state* fields become `InlineFieldEdit` and autosave;
  their *content* fields become read-only and move to `/[id]/edit`; the line-item
  documents among them (quote, order, invoice) keep an explicit manual save for the
  document body, per R1. The header Save disappears with the sticky bar (R3).
- **Fix the `/[id]/edit` round trip while the pages are open** (R2): preserve `?tab=` so
  editing from the Files tab returns to Files, and put the Edit affordance on every tab
  rather than only the record header.
- Give leads' tab order a default that matches its first tab.

**Appendix A here:** A4 (partly closed by R2 — a workflow change is one click; a typo fix
stays a page trip, deliberately), A12 (quote → order needs 3 actions), A13 (lead convert
has no unsaved-changes guard).

**Backend slice — approved, and it lands before the first module ships inline edit.**
R1's autosave turns every state change into an activity entry, and this app renders
`RecordActivityFeed` / `RecordActivityTimeline` on every record. Changing a lead's stage
three times while thinking must not produce three history rows.

The work is server-side, in the activity-log write path: coalesce consecutive entries for
the **same tenant + record + field + actor** inside a short window into one entry that
keeps the *original* previous-value and the *latest* new-value. A same-field change that
returns to its starting value inside the window collapses to nothing. Scope it with
`backend-change`, and keep it tenant-scoped like every other write. Client-side debounce
on the autosave itself is necessary but not sufficient — two operators, or one operator
across a debounce boundary, still generate the noise.

---

## 5.4 — Forms and the create/edit model

Further along than the audit implies: **14 of 16 form routes are on `RecordFormLayout`**
and all 16 call `useUnsavedChangesGuard`.

- Two stragglers: `MessageTemplateRecordFormPage.tsx:205` (a verbatim copy of the sticky
  footer classes) and `DocumentUploadFormPage.tsx:515` (a different footer shape).
- `TextField` defined 4× (lead / contact / organization / opportunity form fields);
  `ToggleRow` 2× despite `SettingsSwitchRow` owning that shape; the responsive field grid
  `grid gap-* sm|md:grid-cols-2` hand-written **78×**.
- `insertion-orders` renders **two Cancel buttons** — `PageShell actions:265` and
  footer:305.
- One pending label (`"Saving…"`), one dirty-state string, one error idiom. Two forms use
  only a toast where the other 14 show a `role="alert"` banner.

**Appendix A here — A3, closed by R2.** Both create paths are kept and both are
standardised across all 15 modules: `QuickCreateSurface` for a fast create, the `/new`
page for a detailed one. Today it is a sheet on 4 and a page on 11, and
`OpportunityQuickCreate` is wired into contacts and accounts but *not* the deals list —
so creating a deal from a contact is currently cheaper than from the deal list.

**Footers follow R1 and R3.** A `/new` page and a line-item document keep a manual save;
that action bar is no longer sticky. Every other form footer disappears with autosave.

---

## 5.5 — One table, and the list workflow

### Every table, and where it goes

24 files are on `RecordTable`. **18 are still on raw `Table`.** All 18 move. The variant
set is decided in 5.0, so this is execution rather than discovery.

**Move to `RecordTable` as-is — lists wearing a different coat (11):**

`settings/customer-groups/page.tsx` · `settings/modules/page.tsx` ·
`settings/modules/[moduleId]/page.tsx` · `settings/permissions/page.tsx` ·
`users/userManagementTable.tsx` (**873 lines**, the largest) ·
`automation/AutomationRulesTable.tsx` · `automation/AutomationRunsTable.tsx` ·
`integrations/IntegrationEventHistory.tsx` ·
`integrations/IntegrationWebhookWorkspace.tsx` ·
`integrations/IntegrationWebsiteWorkspace.tsx` · `dashboard/DashboardPersonalWidgets.tsx`

`reports/page.tsx` uses **both** `RecordTable` and raw `Table` in one file. It resolves to
one.

**`variant="lineItems"` — a variant, not an exemption (5):**

`sales/quotes/[quoteId]` · `sales/orders/[orderId]` · `finance/pos/[invoiceId]` ·
`transactions/TransactionLineItemsEditor.tsx` · and the quote / order / invoice **form**
pages that render the same editable grid.

These are editable line-item grids: add and remove row, per-row inputs, a totals footer,
no selection, no sort, no pagination. That is a different *shape*, not a different
*table* — §7.3 says legitimate differences are `cva` variants on the primitive. One
primitive, two variants, no second implementation.

Building this variant is the load-bearing task of this sub-phase. **If `RecordTable`
genuinely cannot carry an editable row without contorting, that finding is written into
`design.md` and taken to the owner before a second table is allowed to exist.** It does
not get quietly exempted.

**`variant="readOnly"` (2):** `client/orders/[orderId]` · `client/pages/[token]`. Portal
tables — no selection, no sort, no row-open gesture. They land in 5.8, on this primitive.

**No table is exempt.** The only files that keep raw `Table` are the primitives that
*implement* it: `components/ui/{RecordTable,ModuleTableLoading,ModuleListToolbar}.tsx`.

### The list workflow — where Appendix A concentrates

- **A1 — list state is not addressable.** `usePagedList` and `useSavedViews` hold search,
  filters, sort, page and page size in React state. Open a record from page 4 of a
  filtered list, press back, and land on page 1 unfiltered — on **15 of 16 lists**.
  Highest cost × frequency item in the appendix.
- **A2** — `ColumnPicker` is wired into **1 of 16** pages. Elsewhere, hiding a column
  costs 6+ clicks and leaves you owning a saved view you did not want.
- **A5** — search fires a request per keystroke on all 14 toolbar pages. No debounce in
  `usePagedList`, `useSavedViews`, or `SearchBar`.
- **A6** — pos ships select-all, per-row checkboxes and a "3 invoices selected" bar that
  nothing consumes; payments answers a 3-row selection with "Select one invoice to record
  a payment".
- **A7** — payments' header button is the slower of its two paths.
- Two migration stragglers: `documents` has no `ModuleListToolbar` and **no pagination**;
  `client-portal/page.tsx` calls `RecordTable` inline twice with no module table
  component.

**Full suite runs once at the end of this sub-phase.**

---

## 5.6 — Settings (all 23 pages)

- **Carry-forward from Phase 4, which did not finish.** `PermissionDeniedState` reaches
  **1 of 23** settings pages — settings is entirely admin-gated, so this is exactly what a
  non-admin hits — and the commit model was never settled:
  `settings/authentication/page.tsx` autosaves a select at `:45` and demands an explicit
  Save/Discard footer 40 lines below, with no visual difference between them.
  **R1 settles it**: settings controls autosave, so all six sticky Save/Discard footers
  in settings go (R3), and `SaveStateIndicator` replaces them. The eight editing patterns
  across 19 pages collapse to one.
- **A8** — no lateral navigation; any two-page settings task round-trips through the hub.
  Two IAs disagree — `SETTINGS_NAV_ITEMS` (flat, 18) vs the hub's `SETTINGS_SECTIONS`
  (6 groups, 19) — leaking `record-layouts`, which is invisible to ⌘K and renders Title
  Case from a label fallback.
- **A10** — field config has no deep link; selection is local state, so every visit starts
  on the default module and Back loses it.
- **A9** — `NotificationCenter.tsx:210`, `routes.ts:86` and `app/dashboard/page.tsx:404`
  route non-admins into permission walls with no `isAdmin` check.
- The large ones get rebuilt, not patched: `backups` 938, `module-builder` 874, `fields`
  788.

---

## 5.7 — Dashboard, reports, boards, calendars, mail

The surfaces no phase has touched.

- `StatTile` — 5 metric implementations plus 28 inline `text-xl`/`text-2xl font-semibold`
  big-number treatments. **Load the `dataviz` skill** before touching chart colour or
  stat-tile layout.
- `ListRow` / `TimelineItem` — **11 unshared** activity / comment / notification / event
  row implementations.
- `DropZone` + `SortableList` — **6 raw HTML5 drag-and-drop** implementations.
- A shared `Board` for the 2 kanbans, and one calendar grid for the 3 (tasks calendar,
  dashboard calendar with 5 raw `<button>`s, public booking).
- `mail/page.tsx` (760) and `calendar/page.tsx` (631) rebuilt onto the archetypes.
- **A11** — reports costs 2 clicks because a single-item module became a collapsible
  sidebar group, and opening it collapses the group you were in.
- `finance/invoice-generator/page.tsx` is a 3-line `redirect()` still in the route list.

---

## 5.8 — Client portal, public, and auth

Was consistency-pass Phase 7. The portal is a second app, not a second theme: **no
`app/client/layout.tsx`**, 20 repeats of `min-h-screen bg-app`, 21 of the `font-lynk`
wordmark, container width drifting `max-w-6xl` / `5xl` / `4xl` / `md`, exactly one
dashboard primitive imported (`Button`), and 18 hand-written loading / empty / error
blocks. Its 7 detail pages are archetype 7 from 5.3 and land on that archetype.

- Add the layout, real lateral navigation, and adopt `PageShell` / `Card` / `EmptyState` /
  `RouteStates` / `StatusValue` (**not** `Pill` — R5 deletes it) /
  `RecordTable variant="readOnly"`.
- Bring portal type onto the product ramp — `text-2xl`/`text-3xl` `h1`s → `text-lg`
  (§3.3 caps product UI there).
- Decide deliberately whether `/client/login` should match `/auth/login`'s treatment, and
  write the choice into §9. They are currently two different products; either is
  defensible, but it should be a decision.
- `ClientPageCreateForm.tsx:335` — the `size-6` call-site control height, one of the three
  standing guard failures.
- **`app/auth/layout.tsx:20,22,28` — tokenise the raw `rgba()`, do not delete it.** §9
  records a previous attempt replacing the hive with three linear-gradients at
  150°/30°/90°, which draws a *triangular* lattice, at a contrast low enough to be
  invisible — and nothing caught it. **Screenshot `/auth` in both themes before and after
  and confirm the honeycomb is still a honeycomb.** On the exit criteria, because no
  assertion in the suite can tell the two outcomes apart.

---

## 5.9 — Copy and voice

Was consistency-pass Phase 6. Best done once the structure is settled, because copy is
what the newly standardised states render.

**Vocabulary — one value per role:**

- One section-heading size per role (§3.3: `text-base` inside a page).
- One link treatment — `text-copy-primary` + underline offset per §2.2. Four are in use;
  none match.
- One create verb — "Create X" (currently Create / Add / New / Upload).
- One pending label — `"Saving…"`. One dirty-state string. One two-column ratio. One grid
  breakpoint (`md`).
- **Sentence case.** The `uppercase` guard cannot see Title Case. Known leaks: `"Save
  Quote"` (`quotes/[quoteId]:493`), "New Contract", "Add Task", "New Product", "Module
  Settings"; the runtime title-casers at `SupportCaseCreateFormPage.tsx:260`,
  `support/cases/[caseId]:269`, `insertion-orders/[ioId]:186`; and 17 repeats of
  `charAt(0).toUpperCase()` duplicating `lib/module-display.ts#formatSnakeCaseLabel`.
- `contracts/[contractId]:244,264,265` renders raw foreign keys (`` `User #${owner_id}` ``)
  where support cases resolve the same field to a name. The operator knows a person.
- `LynkSplash.tsx:58` `pl-[0.2em]` — the remaining off-grid guard failure.
- Resolve the `gap-5` / `p-5` sweep per the consistency-pass Phase 0 ruling: both are off
  the ladder.

**Voice — the states 5.1–5.8 standardised now get their words:**

- **An action keeps its name through the flow.** "Create invoice" produces "Invoice
  created", not "Saved successfully".
- **Errors name the fix, not the failure** (§7.5) — extended from field errors to the
  route-level error states.
- **Empty states are an invitation to act** (§7.4): what the thing is, then the create
  action.
- **Destructive confirmations name the record and the consequence** (§7.5). An "Are you
  sure?" that names nothing is the same defect as an error that says "Invalid".

---

## 5.10 — Guard the composition

Was consistency-pass Phase 8. Extend `tests/e2e/design-rules.spec.ts` — do not add a
spec; it already walks every route and logging in is the expensive part. **This is where
the programme's new test coverage lands, all of it, once.**

Checks carried from the original Phase 8:

- **Type ramp** — computed `font-size` on visible text must be in {11, 12, 14, 16, 18}.
- **Page-root rhythm** — the first element inside the layout's content scroller carries
  `data-slot="page-shell"`.
- **Card border tier** — no visible container at panel size uses `border-line-subtle`.
- **Control border tier** — no `input` / `select` / `checkbox` bounded by a sub-3:1 token.
- **Title Case** — visible button and heading text where a non-first word is capitalised
  and is not a known proper noun. Needs an allowlist.
- **Focus is visible** (§2.3, §8) — the spec never focuses anything today, which is why 68
  scattered `focus-visible` uses have never been checked. Focus a sampled set per route
  and assert the computed `outline` or `box-shadow` actually changes.
- **Reduced motion is respected** (§6) — re-run one route under
  `emulateMedia({ reducedMotion: "reduce" })` and assert nothing reports a running
  animation.

New checks this programme earns:

- **Nesting depth** — no third level of visible container (§1.3), the rule 5.2 enforces.
- **One archetype per surface** — a record detail route carries the archetype's
  `data-slot`, not a hand-rolled root.
- **One table** — source-level in `check-design.sh`: importing `components/ui/Table`
  outside the three primitives that implement it fails.
- **No page-local field renderer** — a `SummaryTile` / `DetailField` / `LinkedTile` /
  `MoneyRow` defined outside `components/ui/` fails.
- **Currency through `<Money>`** — no `Intl.NumberFormat` with a currency style outside
  `lib/currency.ts`.
- **Sibling control height** (**R4**) — buttons that are siblings in one action row must
  compute to the same height. Rendered, since the mix comes from call-site size props.
- **Sticky allowlist** (**R3**) — source-level in `check-design.sh`: `position: sticky`
  is legal only on a table header. A new `sticky bottom-0` fails.
- **Colour budget in a list** (**R5**) — rendered: count the elements inside a table body
  carrying a non-neutral text or background colour. A list where most rows are coloured
  has re-created the pill problem under another name. `Pill` itself is gone, so the
  source guard also fails on the identifier returning.

**Widen the route list** to the surfaces that are unwalked and drifted furthest:
`/auth/*`, `/book/**`, `/public/quotes/proposal/[token]`, `/client/pages/[token]`,
`/client/*/[id]`, `/dashboard/views/[moduleKey]`, `/dashboard/custom/**`,
`settings/message-templates/[id]/edit`. Layer 6 of the audit exists *because* the guard
stops at the portal's list pages.

**Full suite runs before this sub-phase and again after it.**

---

## Baseline

`./scripts/check-design.sh` fails **3 of 14 rules at HEAD**, before this programme
touches anything. "Green" means *no new failures and the sub-phase's own rules cleared*,
not a clean run, until each owner closes theirs.

| Failing rule | Site | Owner |
|---|---|---|
| §4.1 spacing stays on the 4px grid | `LynkSplash.tsx:58` — `pl-[0.2em]` | 5.9 |
| §4.2 no call-site control heights | `ClientPageCreateForm.tsx:335` — `size-6` | 5.8 |
| §7.2 shadcn is the only component library | `@headlessui/react` in `package.json` | 5.1 |

Run the source guard at the *start* of a sub-phase as well as the end. It is the cheapest
of the three checks and the only one that reads `package.json`.

Phase 3's lesson stands: lint, typecheck, build, both rendered guards and 99 module specs
were all green **with a real bug in the tree**. It needed a wide table, a sideways scroll,
and someone looking.

---

## Explicitly not doing

- Not revisiting the visual language — no accent, no second face, no loosened density
  (decision 1).
- Not touching the `sr-only` `h1` in `PageHeader`; §8 says it is correct.
- Not reintroducing a max-height on `ModuleTableShell` (§11.1), and not re-pinning table
  columns — §4.4 records the two defects that took pinning back out.
- Not re-fixing `RecordTabs` or `ColumnPicker` — resolved in `e6a53f8`.
- Not touching the invoice print document's colours (§2.5 exception 2).
- Not stripping the auth surface's ambient layers — §9 identity, tokenised in 5.8.
- Not making Lynk responsive. §4.4 gutters stand; the narrow-viewport capture is a
  regression check, not the start of a mobile pass.
- Not reopening deliberately deferred slices — WhatsApp sending, payment links, broad
  Gmail access, user-created modules (`CLAUDE.md`).
- **Appendix B.2 stays filed, not fixed here.** Custom-module filters are collected and
  silently discarded (`custom/[moduleKey]:251` vs `useModuleBuilder.ts:298`). It is a
  data-correctness bug that likely needs a backend query-param contract, so it is outside
  a frontend programme's scope.
