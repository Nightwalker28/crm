# Lynk frontend: the rebuild program

**Status:** approved 2026-08-14. **Sub-phase 5.0 done** — direction, law and census landed;
the owner took the record spine on 14 Aug 2026. **5.1 is done** — batches A, B, C, D and E
(cross-cutting primitives, the status sweep that deletes `Pill`, the route-boundary sweep, the
Headless UI → Radix dialog migration, and `InlineFieldEdit`) have landed. **5.2, 5.3 and
5.4 are done.** **5.5 is done** — seven batches, `7cb268e` through `8577c87`. Its browser pass
found a layout defect every automated check had passed over; that is written up at the end of
the sub-phase. **5.6 is done** — all 23 settings pages, batches 1–8, closing at `9923ceb`.
**5.7 is done** — batches 1–8b and the close-out, `4961c25` through the close-out's correction
commits. **5.8 is next.**

A review pass on 2026-08-18 reopened and closed one item in each: 5.2's local `SummaryTile`
container recipes, which its own grep could not see, and 5.1's `lib/currency.ts`, which had
been built but never reached its call sites. Both are written up under their sub-phase. The
review's other finding — `SectionHeading`, `ActionBar`, `Avatar` and `PanelStates` are built
and unadopted — is **the plan, not drift**: R7 assigns that sweep to the surface that owns
each file. It is recorded at the end of 5.1 so 5.3–5.7 inherit the number rather than
rediscover it.

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
8. **Contracts and support cases are out of scope for the rest of the programme** — every
   remaining sub-phase, 5.4 through 5.10, not just the one this was decided in. Decided by
   the owner 2026-08-20 and restated 2026-08-20 after the first wording scoped it too
   narrowly: the modules may be removed entirely, so effort spent making them consistent is
   effort spent on something that may not ship.

   **Do not read, edit, verify or reason about** `components/contracts/**`,
   `components/support/**`, `app/dashboard/contracts/**` or `app/dashboard/support/**` — not
   even to keep an app-wide sweep tidy, and not when a later sub-phase's own table lists one
   of them. An idiom sweep that would otherwise touch all N modules touches N minus these
   two, and says so in its commit and its status block.

   **This overrides scoping decision 5 for these thirteen files.** Total coverage was the
   rule and the census was its mechanism; these rows are now the documented exception rather
   than a gap. **The denominator drops from 327 to 314.** Their census rows are marked
   *out of scope*, not *done* — nothing will do them. The thirteen are the four
   `contracts/**` routes, the three `support/**` routes, `ContractRecordFormPage`,
   `SupportCaseCreateFormPage`, `ContractsTable`, `SupportCasesTable`, and the client
   portal's two support surfaces (`client/support/page.tsx`,
   `client/support/[caseId]/page.tsx`) — the customer-facing half goes with the module.

   **Not covered by this:** `e2e/contract-transport/page.tsx` and
   `ContractTransportHarness.tsx`. Those are the generated **API contract** transport
   harness and have nothing to do with the contracts module. Do not delete them by name
   match.

   What landed before the decision stays: 5.3 gave both record pages the archetype and 5.4
   batches 1–3 swept them with the other fifteen forms. That is already paid for; nothing
   gets reverted.
9. **Verification is per sub-phase, not per batch.** Decided by the owner 2026-08-20.
   Per-batch gating was turning a phase into a loop of per-batch perfection. See the policy
   below for the new cadence.

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
region is the only scroller and carries one tab strip — `Details · Timeline · Tasks · Files`,
in that order, on every record type. (R9 wrote that second tab as `Activity`; the owner
renamed it during 5.3, which is recorded there with the rest of the tab-set decisions.)

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

### The cadence, revised 2026-08-20 — per sub-phase, not per batch

Batches 1–3 of 5.4 each ran lint + build + `check-design.sh` + both rendered guards + a module
spec sweep + a browser pass, and batch 3 additionally ran an 18-spec HEAD baseline to attribute
its failures. That is roughly 90 minutes of verification per batch to protect a change the
compiler and two greps had already checked. **The owner's call: stop doing that.**

| When | What runs |
|---|---|
| **Per batch** | `npm run lint` and `npm run build`. Nothing else. Commit on green. |
| **End of the sub-phase** | `check-design.sh`, both rendered guards, the module specs for every surface the *whole* sub-phase touched, and one browser pass covering the sub-phase's surfaces |
| **One correction run per sub-phase** | Fix whatever that pass found, in a single commit, then close the sub-phase |

**A batch is still one commit and still writes its `Status` block** — that part is the handover
and does not get cheaper. What goes away is re-proving the suite between batches.

**The HEAD baseline is not free and is not routine.** Run it only when the end-of-phase pass
produces a failure that is (a) not on a documented list and (b) on a surface the sub-phase
actually touched. Batch 3 ran one and every single unexplained failure turned out to be
inherited — the priors were right and the measurement cost 28 minutes.

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

### How a run ends — not optional

**Every run updates this file and `rebuild-census.md` before it stops, even a partial one.**
A session can end at any point and the next one starts with no memory of this one: the
sub-phase's `Status` section and its "What is left" table are the entire handover. A batch
that landed but is unwritten reads to the next session as work still to do, and the census
row it owns reads as untouched.

What a run writes down, at minimum: which batch landed and under which commit, what the
verification actually was (including which failures were pre-existing and how that was
measured), any rule it added to `design.md`, and the next batch's starting point. Decisions
and rejected alternatives belong here too — §12 requires the rule before the code, and the
reason is that future agents read this file, not the PR description.

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

### Status: follow-up — `lib/currency.ts` reached its call sites, and two batch D nits

From the same 2026-08-18 review pass. Two of these are corrections; the third is a
measurement worth carrying into 5.3, not a defect.

**`lib/currency.ts` had two consumers and 12 shadowing duplicates.** Batch A built it and
stopped; the table above says it *replaces* 15 local formatters and 24 raw
`Intl.NumberFormat`, and it had replaced neither. Worse, six files defined their own
`formatMoney` — the same name the lib exports — so an import would have collided rather
than resolved. All of them now delegate:

- **Six spellings of absent collapsed to two.** The local formatters invented `"Not set"`,
  `"-"`, `"—"`, `"Unspecified"`, `"USD 0.00"` and `0`. Call sites now take
  `EMPTY_FIELD_VALUE` / `EMPTY_CELL_VALUE` from `EmptyValue` per §3.6, or render `<Money>`,
  which picks by context. That is `EmptyValue`'s first adoption outside `Money`.
- **The locale bug the lib was written for is actually fixed.** Ten of the twelve passed
  `undefined` — the browser locale — so the same invoice total rendered `$1,234.50` for one
  operator and `1.234,50 $` for another. Two files (`client-portal`, contracts) were not
  using `Intl` at all and hand-built `"USD 1,234.50"`; those two change visibly, to `$1,234.50`.
- **Four helpers keep a local name because their null semantics are genuinely different**,
  and each says so on the line: `formatDashboardCurrency` and reports' `formatCurrency` want
  zero (a forecast with no rows is a zero pipeline, not an absent field), the two catalog
  `formatAmount` twins and `insertionOrderList`'s want `""` because their call sites branch
  on it. They delegate the formatting and keep only the fallback.

**Zero currency-style `Intl.NumberFormat` now exist outside `lib/currency.ts`** — 5.10's
planned guard would pass today. The four remaining `Intl.NumberFormat` calls format plain
numbers, not money. `finance/pos/[invoiceId]/print` is untouched: it is a census `unchanged`
row, and it was already on the pinned `en-US`.

**Batch D nits.** Five of the eleven dialogs rendered no `DialogDescription`, so Radix logged
a missing-description warning on every open; they now pass `aria-describedby={undefined}`,
Radix's documented opt-out, which asserts *named by its title alone* rather than silencing a
real gap. Inventing description copy is 5.9's call, not a warning-suppression exercise. And
`DialogPanel`'s `2xl` size was dead surface the migration said it would not carry forward —
removed. `lg` stays: it is the default and is reached by call sites that pass no `size`.

**Not fixed, and deliberately: the other five primitives are still unadopted.**

| Primitive | App consumers | Named target |
|---|---|---|
| `SectionHeading` | **0** (only `PanelStates`) | 137 hand-written `<h2>` |
| `ActionBar` / `FormFooter` | **0** (only `button.tsx` reads the context) | 10 footers, ~38 spacing overrides |
| `Avatar` | 2 | 2 bespoke |
| `PanelStates` | 5 — unchanged by the promotion | ~40 panels |

This is the documented plan, not drift: **R7 assigns the `<h2>` sweep to "the surface that
owns each file, not a separate pass"**, and the same logic carries the rest. `Pill` was
*deleted*, which forced its 104 call sites; these were *added*, which forces nothing. Two
consequences to carry forward rather than rediscover:

- **R4 is not in force anywhere in the app.** `ActionBar` is the mechanism that makes mixed
  control heights impossible, and nothing uses it — so 5.10's rendered sibling-height check
  will be measuring a codebase that never received the fix. 5.4 and 5.6 own the adoption.
- **Converting one `<h2>` in isolation makes a page worse, not better.** A `SectionHeading`
  at 14px beside four hand-written `text-lg` siblings reads as a mistake. The swap has to be
  per-surface, which is exactly why R7 scoped it that way.

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

### Status: reopened and closed — the sweep's instrument had a blind spot

A review pass on 2026-08-18 found the sub-phase's second bullet unshipped. Recorded here
rather than quietly fixed, because the *reason* it survived matters more than the fix.

**The close-out grep only reads one radius tier.** Every count above —
206 → 184 → 105 — comes from `rounded-[var(--radius-card)] | grep border`. The panel
taxonomy has two drawing tiers, and the row tier takes `--radius-control`. So the
"re-grep audited every remaining match by hand" claim above was true of what the grep
returned and not of the codebase: **~159 `--radius-control` + `border-line-*` boxes were
never in scope of any count this sub-phase ran.** Most are legitimate Rows. The ones that
were not are exactly what this bullet named:

> Retire the local `SummaryTile` **container** recipes here rather than in 5.3, since they
> are panel decisions: `radius-card` + `line-subtle` vs `radius-control` + `line-default`
> at `py-3` vs the same at `py-4`.

**The named drift was still there, verbatim.** Seven page-local `SummaryTile`s and four
`LinkedTile`s. Batch 2 converted contacts and organizations to borderless ink groups and
left contracts, orders, quotes, support cases and profile as boxes — `radius-control` +
`line-default`, at `py-4` on four of them and `py-3` on the fifth. Same component, same
batch, two answers.

They are also a §1.3 violation as 5.2 itself wrote that section: static, non-interactive
content, sitting inside a `Card`, so *"a border around static content inside a panel is the
third level §1.3 forbids, wearing a smaller radius"* — and on `line-default`, the panel tier,
which the same paragraph names as reading one tier as the other.

**All eleven now render as ink groups** on R7's ladder — label `text-xs font-medium
text-copy-label`, value `mt-1 text-sm text-copy-primary`, no container. That also drops the
`font-medium` three of them put on the value, which is off R7 (a value is normal weight;
weight is what the *heading* gives up to sit below it). **Replacing the renderers with a
shared primitive is still 5.3's**, per that sub-phase's own line item — this closes the
container decision only, which is what 5.2 owns.

**One nested static box outside the renderer family**, same rule: the deal page's "No quotes
are linked yet" dashed box (`opportunities/[opportunityId]`), which is the shape batch 4
already deleted on the kanban's empty-column notice. Now unboxed. Headline count 105 → 104.

**Two remaining matches the close-out did not account for, deliberately left.**
`app/dashboard/layout.tsx`'s "Checking access…" and `custom/[moduleKey]/[recordId]`'s
"view-only access" notice are the same full-width state-banner idiom as the 24 counted
`role="alert"` boxes, minus the role (correctly — neither is an alert). Both are level-1
siblings of the page's panels, so both are earned by separation. They belong with the
banner consolidation 5.4 carries, not with a new answer invented here.

**Lesson for 5.10.** The nesting-depth guard has to read the DOM, not a class grep, or it
inherits this blind spot. That is what §7.6 and `data-slot="card"` are now for.

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
- ~~**Fix both hand-rolled `role="tablist"`**~~ (**closed in batch 5** — it was three
  strips wearing three skins, not two broken ones: `settings/modules/[moduleId]` was
  already on `RecordTabs`, which is `SectionTabs` now and carries all three. Radix fit, so
  `SavedViewSelector.tsx:26` was not needed as a reference and is untouched).
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
stays a page trip, deliberately), ~~A12~~ (**closed in batch 3** — three actions became two,
and the disabled-button-with-a-distant-explanation became a button that is only there when
it works), A13 (lead convert has no unsaved-changes guard — still open, batch 5's).

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

### Decided before the first line — the tab set, and what the archetype absorbs

Settled with the owner 2026-08-18. R9 fixed the tab strip at four but did not say where
today's extras land, and 5.3 cannot start without that answer: `CrmRecordActivitySection`
supplies a second strip (Activity · Notes · Documents · Tasks · Follow-up), leads carry an
`Audit history` tab, and support cases carry two comment systems and three histories on
one screen. All of it is now in `design.md` §4.7.

**The tab is `Timeline`, not `Activity`.** The owner's call on the name. It also removes a
collision the rename exposed: `RecordActivityTimeline` is the *audit* component, so
"timeline" already meant the opposite thing in the code. That component is renamed with
the surface it moves to.

**Four decisions, and what each rejected:**

| | Decided | Rejected, and why |
|---|---|---|
| Notes | No tab. The composer moves to the top of `Timeline` | A `Notes` tab renders rows the feed already emits as `type="note"` — the same content twice, with nothing saying which copy is authoritative |
| Follow-up | A composer mode in `Timeline` | A spine block. It reads like state, but it creates a `RecordFollowUp` row and only *stamps* `last_contacted_at`; it is an event, and it does not fit a rail built from `InlineFieldEdit` dropdowns |
| Audit history | A sheet off the spine's `Updated` line | A fifth tab (cheapest, but breaks the fixed four on day one and parks a rarely-opened tab beside three constant ones); a filter inside the feed (best to use — Pipedrive's answer — but `activity_logs` and `record_activity` are deliberately separate stores with different permission surfaces, so it means a backend merge or two interleaved cursors) |
| Support-case replies | A `support_case_reply` feed adapter, so the conversation *is* the Timeline | A `Replies` module tab after `Files` — free, but the two comment systems survive; and leaving the conversation as a Details panel, which is the defect the census names |

**The precedent was checked, and the archetype is not unusual.** HubSpot, Pipedrive,
Dynamics and Attio all put notes *in* the timeline and the composer at its top; Salesforce
is the only one that separates collaboration (Chatter) from Activity. None of the six
gives field/audit history a top-level tab beside the timeline — it is a related list
(Salesforce, Dynamics), a link off the property (HubSpot), or a filter (Pipedrive). The
spine itself is the HubSpot/Attio consensus. What is Lynk's, and what the calibration test
turns on, is the rule that the rail is the *only* place fields change — and, downstream of
it, hanging history off `Updated 2h ago` so the answer sits where the question is asked.

**One clarification R9 needed and did not have.** "Nothing in the content region edits"
reads as a contradiction the moment the Tasks tab creates a task. The boundary is the
record's own fields versus related objects, and §4.7 now carries the one-line test.

### Status: done — the archetype, fourteen modules on it, the tab strips, and close-out

Thirteen commits. **5.3 is closed.** All 35 census rows are marked, the eight deferred
questions are answered above, and the full gate set is green. The next sub-phase is
**5.4 — forms**, which inherits the two archetype-3 defects batch 6 found, the
`SearchableSelect` primitive and `Owner` → State.

| Commit | What landed |
|---|---|
| `07183cf` | The backend coalescing slice — R1's dependency, done before any module shipped inline edit |
| `3a592bc` | The `support_case_reply` feed adapter |
| `aea493d` | `RecordSpine`, `PageShell variant="record"`, the archetype shell, `RecordTimeline` + composer, `RecordAuditHistory`, and leads onto all of it |
| `49e70ce` | Three defects the browser pass found, and the two §4.7 rules they produced |
| `d099b39` | contacts + organizations onto the archetype; `RecordWorkspaceLegacy.tsx` deleted; three archetype defects the browser pass found |
| `1ada2c3` | deal + contract onto the archetype, with the backend slice each needed |
| `0dfa1cd` | quote, order and POS invoice onto the archetype, with the record-layout surface each needed |
| `86aeb71` | insertion order, support case, custom record and catalog onto the archetype; `CrmRecordActivitySection` and its four panels deleted; the rail's own scroll fixed in the primitive |
| `4967bf2` | the three card-scoped tab strips onto `SectionTabs` (was `RecordTabs`); §7.7 written; the tabs guard parameterised over every strip |
| `c45cd16` | the `/[id]/edit` round trip's return half on twelve edit surfaces, `useRecordTabHref` replacing the two helpers, `/convert` joining the rule, and A13 |
| `270e395` | close-out: the three scheduled deletions, the five unswept census rows, §7.9 |

**What batch 1 decided, and the two §4.7 rules it wrote first.** Both pages carried
information the archetype had no shape for yet, and both answers are now rules rather than
page-local choices:

- **The rail's counts became links.** `RecordSpineCollection` — label, count, and the way
  into the module tab that lists them — replaces the tile grid the legacy relationship rail
  used (`Open deals 3`, `Quotes 2`, and six of them on an account). A count with nowhere to
  click was the densest inert region on the page. Connected now carries two entry shapes: a
  record (`RecordSpineLink`) and a collection.
- **The contact's WhatsApp panel became the composer's WhatsApp mode.** It is a tracked
  endpoint — `/whatsapp/contacts/{id}/click` picks a template, writes a `WhatsAppInteraction`
  and can create the reminder — and that interaction is exactly what the feed underneath
  renders as `type="whatsapp"`. So the panel's own "Last contacted" line was duplication, and
  the header's `CommunicationActions` WhatsApp button was a *second, untracked* path to the
  same action. §4.7 now says the tracked endpoint is the mode, and the page offers no raw
  `wa.me` beside it.

**Neither page had state to speak of, and that is worth recording.** A contact's and an
account's only dropdown-shaped own-field is `customer_group_id`, so each State block holds
one `InlineFieldEdit`. That is not the archetype failing — it is R9's "a thin rail is a
signal the record type is under-modelled" landing exactly where it said it would. Raise it
rather than answer it with a second archetype.

**Accounts have no follow-up endpoint**, so their composer is note-only: you call a person,
not a company. Contacts keep call/email from `/sales/contacts/{id}/follow-up` and take
WhatsApp from the tracked one.

**The browser pass found three defects again, and all three were in the archetype rather
than in the new pages — so leads had them too.** Two are keyboard-only; the third is
visible on every record page and had been shipped for a batch. Neither lint, build, either
rendered guard nor 21 module assertions saw any of them:

- **The `History` sheet dropped focus on close.** `RecordSpineMeta` opened it from a plain
  `onClick` with no `SheetTrigger` registered, so Radix had no element to restore focus to
  and it fell to the body — the next `Tab` restarted at the sidebar, several screens away
  from the rail the operator was in. Now a `SheetTrigger asChild`.
- **The tab panel is a focus stop with its ring removed.** Radix makes `Tabs.Content`
  focusable so the keyboard can reach panel content that holds no control of its own, and
  the archetype's class list said `focus-visible:outline-none` with nothing behind it. It
  takes the §2.3 ring, inset.
- **`Details` was a box inside a box.** `ResolvedRecordLayout` already renders each section
  as a `Card`, and all three record pages wrapped the whole layout in another one — a
  second container level earned by nothing, which §1.3 gives only to interactivity or
  separation. The wrapper is gone from contacts, accounts *and* leads; `Card` stays on the
  layout's loading and error panel, which is a single box around a single thing.

**One thing left open deliberately** (**answered 2026-08-19** — see "The eight deferred
questions, answered": the account keeps its channels because it owns `primary_email` and
`primary_phone`; the deal and quote lose theirs). An account's header now carries six actions plus the
overflow (`Deal` filled, `Contact`, `Email`, `WhatsApp`, `Call`, `Edit`) — down from nine,
but still fuller than §4.7's wireframe. Which channels an account should offer at all is a
product question rather than an archetype one, so it is noted here for close-out rather
than answered by trimming during a migration.

The method that found the defects is worth repeating verbatim in the next batch: seed, open a real
record, and **tab through it recording `document.activeElement` and whether the computed
style carries an outline or a shadow at every stop**. A screenshot cannot show this and an
assertion nobody wrote cannot fail.

**The archetype's shape, so the next module does not re-derive it.**
`RecordWorkspace` owns the geometry and **the only tab strip on the page**. The four tabs
are *named props* (`details`, `timeline`, `tasks`, `files`) rather than an array, which is
deliberate and load-bearing: an array API would let the next page reorder them, rename one,
or nest a second strip inside the first — which is what `opportunities/[opportunityId]` and
`finance/pos/[invoiceId]` do today. Named slots make all three unrepresentable, `extraTabs`
appends after `Files`, and a tab whose slot is omitted is not rendered, so permission gating
is "pass nothing". It builds its own Radix strip rather than using `RecordTabs`, because the
archetype's tab must live in `?tab=` unconditionally for R2's round trip; `RecordTabs` keeps
its opt-in `urlParam` and its other call sites, and is still **not** to be re-fixed.
(**Superseded in batch 5**: it had one call site left and none of them a record, so it is
`SectionTabs` now and owns the card-scoped strip. The `urlParam` contract is unchanged.)

**Two rules came out of looking at the first rebuilt page, and both are now in §4.7.** A
field the spine owns is not drawn again in `Details` (`ReadOnlyRecordLayout` /
`ResolvedRecordLayout` take `omitFieldKeys`, filtered where sections are built so an emptied
section disappears rather than drawing a blank panel). And the header carries one filled
button — the record's primary workflow action — with destructive and rare actions in the
`[⋯]` menu `RecordWorkspace` supplies through `overflowActions`.

**A third finding was a backend one.** `available_types` returned the whole adapter list, so
a lead was offered a "Replies" filter that could never match. Adapters now declare
`applies_to`, gating both the fetch and the reported types.

**What batch 2 decided — deal and contract, and the backend slice each needed.** Both pages
were archetype rebuilds that could not be done in the frontend alone, and both gaps were
already written down as somebody's job:

- **The deal's `detail` record layout was reserved for this slice in a code comment.**
  `record_layouts.py` said Opportunity was "deliberately quick_create-only" because "the
  Opportunity workspace owns its `detail` surface" — this is that workspace, so the surface
  opens, and the eight delivery fields a private renderer used to draw (`campaign_type`,
  `tactics`, `cpl`, …) join the shared catalog where a tenant can reorder or disable them.
  The demo tenant has all eight disabled, which is how it was confirmed that a section left
  with nothing renders nothing rather than an empty panel.
- **Contracts had no entry in `RECORD_COMMENT_MODULES`**, and that one dict is what
  comments, tasks, documents, mail association and the activity projection all resolve a
  record through. The census row said "no activity, notes, tasks or documents"; the cause
  was a missing 6-line registry entry, not four missing features. With it and
  `TIMELINE_ALLOWED_MODULES` — the contract routes already wrote `activity_logs` — the
  archetype's four tabs and the History sheet all came up at once.
- **The raw FKs were a response-shape defect, not a page defect.** `ContractResponse`
  carried six ids and no names, so `Contact #12` was the most the page could draw. The
  service resolves them in-tenant now, and a link whose target no longer resolves renders as
  `EmptyValue` rather than a dead link.

**Two rules came out of it, both in §4.7 now.**

- **A module's own event log renders *inside* the History sheet, merged into the audit list.**
  Contracts write `contract_events` (created, status changed, party added, signer signed)
  *and* `activity_logs`, and the old page drew the first as a full-width `Events` card at
  the foot of the screen. Two immutable lists answering *what happened to this record* in
  two places is the duplication the archetype removes — and the domain list is the one with
  the coverage, because `activity_logs` never sees a signer sign. `RecordAuditHistory` takes
  `moduleEvents`. This is **not** the merge §4.7 rejects for the interaction feed: these
  arrive whole with the record, so there is no second cursor. **Batch 3 inherits it** — it is
  exactly what that batch's row means by "`item.events` joins the History sheet".
- **A record whose forward motion *is* its state field carries no filled button.** The deal
  is the case, and it is the archetype rather than a gap: a deal advances by changing stage,
  the rail owns that field, and the pre-5.3 page shipped *three* controls for that one
  column — a six-button stage grid, a `Won`/`Lost` pair in a summary strip, and an
  `InlineFieldEdit`. All three are gone; the header is `Email · WhatsApp · Call · Edit` plus
  the overflow, and §2.2's one fill is simply unspent.

**A third rule was a clarification.** "A field the spine owns does not appear in `Details`"
now reads "the spine **or the header**". The contract exposed it: `contract_number` is the
record's name in the header, and the first seed drew it again as a labelled field. Every
existing detail seed already omits its module's name field, so this was an unwritten rule
being followed by habit.

**What went into the content region, and what did not.** Contract parties and signers are
rows pointing at the contract rather than columns on it, so by §4.7's own test they are
related objects: they became a `Signing` module tab after `Files`, and their two `Add` forms
went with them. The deal's quotes, participants and insertion orders became a
`Related records` tab plus `RecordSpineCollection` counts, the same shape accounts use — and
that shape is now the shared `RecordRelatedList` / `RecordRelatedCard` / `RecordRelatedLink`
rather than two copies. Extracting it fixed a real defect for free: the account's version had
**no focus ring on its row links**, which no guard caught because the rule is about controls
and this is an anchor.

**The browser pass found the sixth defect across three batches, and this one was fatal.**
`CONTRACT_TRACK_STEPS` is built at module scope from `statusLabel()`, which reads a `const`
declared below it — a temporal-dead-zone `ReferenceError` that took the whole route to
"Unable to load this dashboard page". Lint passed. `next build` passed. `check-design.sh`
passed. Both rendered guards passed *because they only visit routes that render*. Only
opening the page found it, which is the third time the note below has been right.

**Two things left open, and the owner confirmed both deferrals on 2026-08-18.** (**Both
answered 2026-08-19** — channels resolved by ownership of the address; contracts frozen. See
"The eight deferred questions, answered".) Neither is a
defect; both are product questions a migration is not entitled to answer by trimming.
They are batch 6's, and the row below carries them so they cannot be lost in prose:

- **Header channels on records that are not a person.** The account-header note from batch 1
  now covers the deal too: `CommunicationActions` puts Email, WhatsApp and Call in the header
  while the Timeline composer offers the same three as *log* modes. They are different
  actions — one performs, one records — and leads shipped the same pair, so this is
  consistent rather than new. Whether a deal or an account should offer channels *at all*,
  when the person lives on the contact record, is the open question. If the answer is no it
  is a three-line deletion per page, and it would apply to leads too.
- **Contracts are under-modelled.** A contract with no links shows six `Not set` rows in
  `Connected` — six optional foreign keys and almost no state of its own. That is R9's "a
  thin rail is a signal the record type is under-modelled" arriving exactly where it said it
  would. **Rejected in the moment:** hiding unlinked relationships, which fixes the density
  and costs the operator the ability to see what a contract *can* link to. Raise it; do not
  answer it with a second archetype, and do not answer it with real contract state inside a
  rebuild sub-phase.

**What batch 3 decided — quote, order and POS invoice, the three line-item documents.**
All three needed the same backend slice and for the same reason batch 2 met twice: the
archetype's `Details` tab is `ReadOnlyRecordLayout` over a resolved layout, so a module
without a `detail` surface would be the only page still rendering its fields a private way.
`sales_quotes`, `sales_orders` and `finance_pos` join `contracts` as **detail-only** modules
— none of them gains a Quick Create, because R1 keeps a document body on an explicit save.

- **Quote was the largest file in `app/` and is now the smallest of the three rebuilds.**
  1,335 lines went to ~640. Almost all of the deletion is one thing: the page was an edit
  form with fifteen inputs, three `LinkedRecordPicker`s, a custom-field block, an unsaved
  changes guard and a header `Save Quote`. R2 sends every one of those to `/[id]/edit`,
  and what is left is a status field in the rail.
- **`payment_status` is the exception R2's shape rule cannot see, and it is now a §4.7
  rule.** A POS invoice's payment status is enum-shaped, so the categorical boundary says
  "editable". It is written by recording a payment, from `amount_paid` — so an
  `InlineFieldEdit` on it could put `Paid` in the rail above a balance of $400. It renders
  read-only beside the status it qualifies, and the field catalog marks it `readonly` so a
  tenant adding it to `Details` does not get an editable copy either. The test the rule
  states is **"is this column written by an operator, or derived by a service?"**
- **A12 closes, and the shape of the close is also a rule.** Convert took three actions
  because the status select was not persisted by the convert button, and the button itself
  was drawn permanently, disabled, with its reason in a summary tile on the far side of the
  screen. The rail autosaves the status, so that is one action; the header renders `Convert
  to order` **only when the quote is accepted and unconverted**, so the second is a press
  rather than a hunt. Rejected in writing: a disabled button with the explanation moved
  next to it (still furniture nine visits out of ten), and one button that accepts *and*
  converts (cheapest, but it makes an irreversible two-record change out of one press,
  which is R1's side-effect row).
- **Three response-shape defects, all the same class batch 2 found on the contract.** An
  order carried `quote_id` and no `quote_number`, so the rail could only have drawn `Quote
  #12`; a quote carried `assigned_to` and no name; a POS invoice had no `created_at` at all,
  so its spine had no `Created` line. Each is a property and a schema field, resolved
  in-tenant through relationships the models already load.
- **Two module event logs joined the History sheet**, which is batch 2's rule paying off
  twice. The quote's `proposal_events` were a `Lifecycle` tile inside the Proposal card;
  they are `moduleEvents` now. That leaves the Proposal itself — a `QuoteDocument` row
  pointing at the quote, so a related object, so a `Proposal` tab after `Files` with the
  recipient, `Generate`, `Send` and the signed link.

**The nested tab strip at `finance/pos/[invoiceId]` is gone**, which was the second of the
two §4.7 named. `opportunities/[opportunityId]` went in batch 2; there is now no page in
`app/dashboard` that nests a strip inside a strip.

**What went into the rail rather than a panel.** The invoice's `Balance` card was six money
rows and a button. Its rows are the seeded layout's `Totals` section; the two figures an
operator acts on — payment status and balance due — moved into `State` beside the status
they qualify; and `Open payments` went to the `[⋯]` menu with `Print`, which is what keeps
the header to one `Edit` and §2.2's one fill unspent. All three of these records advance by
changing their status, so none of them carries a filled button except the quote at the one
moment `Convert` exists.

**The browser pass found three, and for the first time in four batches none of them was
structural.** The archetype held: every stop in the tab-through rang, including the tab
panel's inset ring, the History sheet restored focus to its trigger, and the rail stacked
cleanly at 768px in both themes. What it found instead was three ways a *value* was drawn
wrong, and only one of the three was in this batch's code:

- **`capitalize` turned "Not sent" into "Not Sent"** in the Proposal panel — §3.5, on a
  string a source-level grep cannot see because the shouting is applied by CSS. Only the
  status is an enum, so only the status is cased now.
- **`payment_method` drew `card`.** It was `text` in the field catalog, and
  `ReadOnlyRecordLayout` sentence-cases a `select` and nothing else. The values are a closed
  set, so the catalog was wrong, not the renderer.
- **The demo seed's `tax_rate` contradicts the service.** `seed_demo_crm.py` wrote
  `Decimal("0.15")` and multiplied by it directly; `pos_invoice_services._recalculate`
  divides by 100, as does the invoice form's own preview. So every demo invoice read
  `0.15%` beside 15% of tax. Fixed in the seed. **Records seeded before this are not
  corrected** — `get_or_create` is a no-op on an existing invoice number — so an old demo
  invoice still shows `0.15%` until its row is rebuilt.

**One thing the pass proved was *not* a defect, recorded because it cost half an hour.**
Measuring a focus ring by calling `element.focus()` from the console and reading
`--tw-ring-shadow` reports `0 0 #0000` on elements that ring perfectly under a real `Tab`:
Chrome's `:focus-visible` heuristic does not survive scripted focus, and the computed
custom property follows it. `a.matches(':focus-visible')` returns `true` while the ring is
absent, which makes the reading look like a genuine finding. **Drive the keyboard, do not
script it** — press `Tab` through the extension and read `document.activeElement` after each
press.

**Line items stay read-only, and §4.7 now says why.** The batch row below reads "the
existing line-item editor drops into `Details` behind a manual save", and the editor it
names lives on `/[id]/edit`, not on the detail page — all three detail pages rendered a
read-only table. They still do, under the layout, and 5.5 restyles them as `RecordTable
variant="lineItems"`. What settles it is not the census wording but the write: items are
saved by a whole-document `PUT`, so an in-place editor is `/[id]/edit` rebuilt inside the
record page — the "the detail page is secretly a form" defect this sub-phase removes. Items
being *rows pointing at the document* would otherwise let §4.7's own test wave them through,
so the rule is written down rather than left to the next reader.

**What batch 4 decided — insertion order, support case, custom record and catalog.** The
last four detail pages, and the batch that kills `CrmRecordActivitySection`. All four needed
the same backend slice batches 2 and 3 needed, for the same reason: `Details` is
`ReadOnlyRecordLayout` over a resolved layout, so `finance_io`, `support_cases`,
`catalog_products` and `catalog_services` join the `detail`-only modules. None of them gains
a Quick Create.

- **`CrmRecordActivitySection` is deleted, and `RecordCommentsPanel`, `FollowUpPanel`,
  `RecordActivityTimeline` and `RecordPageHeader` went with it.** Five files, one deletion:
  the first was the nested-tabs cause and the next three were its only importers. Nothing in
  `app/dashboard` now renders a tab strip inside a tab strip, and nothing renders a record
  header that is not `RecordWorkspace`'s.
- **The support case's conversation *is* the Timeline**, which is what the `support_case_reply`
  adapter was built for three commits earlier. The `Conversation` card with its own reply box
  and the `Case history` card beside it are both gone — the first became the composer's reply
  mode over the feed that already rendered those rows, and the second became `moduleEvents` in
  the History sheet. That is the census row "two comment systems and two histories on one
  screen" closing as one change rather than four.
- **The case's name is its `subject`, not its `case_number`** — the reverse of the three
  line-item documents, and deliberate. A quote's number *is* its identity in the ledger; a
  case's number is the reference you quote when you already know which case you mean. The
  header answers "which record is this", so the subject wins and the number is the subtitle.
- **Two runtime title-casers died**, as the batch row promised. The support case's became a
  static `CASE_EVENT_LABELS` map, which also fixed what the title-caser could not see:
  `client_replied` was rendering as `Client Replied` — §3.5 shouting, and a `client_` prefix
  that said "portal" to nobody. It reads `Customer replied in the portal` now. The catalog's
  `stockLabel()` became `CATALOG_STOCK_STATUS` in `statusStyles.ts`, where the tone
  classification belongs.
- **Custom module records needed a route that did not exist.** R2 sends a record's content
  fields to `/[id]/edit`, and this was the one module whose detail page *was* the form — so
  removing the form would have made the record uneditable. `/dashboard/custom/[moduleKey]/[recordId]/edit`
  is the create page with a record behind it: same `RecordFormLayout`, same validation, same
  guard. It is the only new route in the sub-phase, and it is 5.4's to finish with the other
  15 form routes.

**Two rules came out of it, both in §4.7 now.**

- **The `Connected` block is omitted where the record type has no relationship columns at
  all.** §4.7 said it was "not optional", written when every record in view had six of them.
  A catalog product and a custom-module record have none — not unset, *absent from the
  schema* — so the heading would have promised a link the data model cannot make. The narrow
  half of the rule still stands: a relationship that exists and is unset still draws, because
  `Not set` tells the operator what this record *can* link to. **Rejected: inventing one to
  fill the block** — a `POS invoices 3` collection on a product, which only
  `finance_pos_items` carries a foreign key for, so quote and order lines would silently not
  count and the number would be wrong. This is R9's "a thin rail is a signal the record type
  is under-modelled" arriving for the third time; it is raised, not answered with a second
  archetype.
- **A boolean whose two values are named states is a state field and edits in the rail.**
  R2's shape test says "dropdown-shaped", and read literally that sends a product's
  `is_active` to `/[id]/edit` — a page trip to flip one switch, on a column that is state by
  any reading. What the test is really about is a closed set the operator picks from, and two
  is a closed set. **Rejected: a `Switch` in the rail** — a second control shape for the job
  `InlineFieldEdit` already does, whose `SaveStateIndicator` pairing would have to be
  re-solved, and which commits on a click where a select commits on a choice. The naming is
  what qualifies a boolean: a field whose honest labels are "Yes" and "No" is answering a
  question about the record rather than naming a state it is in, and it stays content. The
  custom-module rail follows the same line — `single_select` and `boolean` are State, every
  other field type is content.

**Two response-shape defects, the same class every batch since 2 has found.** An insertion
order had no `created_at` at all, so its spine had no `Created` line — exactly the POS
invoice's defect from batch 3. And a support case's `SupportCaseEvent` carried
`created_by_id` and no name, so every operator-caused row in the merged History sheet would
have read `Unknown user`; it is a model property and an eager load now, resolved in-tenant.

**A third was worse than a shape defect, and it was in code batch 3 shipped.** Every finance
timestamp went through `finance_date_to_iso`, which truncates a `datetime` to `YYYY-MM-DD` —
correct for `issue_date` and `due_date`, which are `Date` columns, and wrong for `created_at`
and `updated_at`, which are not. Every consumer renders them with `formatDateTime`, so
`new Date("2026-08-18")` parsed as UTC midnight and a record page west of Greenwich read
`Updated Aug 17, 8:00 PM` for a row saved on the 18th — a wrong clock time and, often enough,
the wrong day. `finance_datetime_to_iso` is the fix, and it corrects the POS invoice spine
as well as the insertion order's.

**The browser pass found the seventh defect across four batches, and this one was in the
archetype's own geometry.** §4.7's contract says the content region is the only scroller and
the rail is a flex sibling of it. The rail had no height constraint, so once its blocks
outgrew the row it grew the row instead, and the dashboard shell's scroller absorbed the
overflow. On a support case — a lifecycle track, three State fields, six Connected entries
and the meta footer — `Updated` and its `History` trigger sat **222px below the fold** at a
695px viewport, and reaching them scrolled the *page*, dragging the record's name and actions
off the top. **It shipped in batch 1**: the contract page carried the same defect at 130px,
through three batches, four rounds of gates and every module spec. `RecordSpine` owns its own
scroll now.

**Fixing it walked straight into the trap `check-design.sh` already names.** Adding
`overflow-y-auto` silently computes `overflow-x` to `auto` as well, and
`RecordSpineLink`'s `-mx-2` bleed — the 8px that lets a hover ground and a focus ring reach
the rail's edges — became 8px of horizontal overflow with a scrollbar under it. The rule's
prescribed fix is `overflow-x-clip`, and here that would have clipped the focus ring §8
requires, so the scroller takes matching `-mx-2 px-2` instead and the bleed has somewhere to
land. Worth recording: the rule was right about the mechanism and wrong about the remedy for
this one case.

**Two things the pass proved were *not* defects, both of which looked like findings.** The
Timeline appeared to render one of two replies — the second was below the fold inside the tab
panel's own scroller. And the tab strip appeared to be a focus stop with no ring: it is
radix's `RovingFocusGroup` delegating, so one `Tab` press fires two `focusin` events and
focus *rests* on the trigger, which rings. The lesson from batch 3 repeated in a new form —
**read where focus comes to rest, not every event on the way** — and the ring itself still
has to be looked at, because the resting trigger's computed `box-shadow` reads as a
transparent shadow while the ring is plainly visible on screen.

**One inherited redundancy, observed and left.** The seeded `Notes` section holds a single
field also labelled `Notes`, so the word is drawn twice — on the quote and order from batch 3
and now on the insertion order. It is one seed line per module to change and no renderer
special case would be right, so it is recorded here for 5.9's copy sweep rather than churned
now.

**What batch 5 decided — the two hand-rolled `role="tablist"`, and the primitive that was
already there.** The row named two sites. Looking at them found a third, and the third is
what turned two local fixes into one decision: `settings/modules/[moduleId]` is the same
composition — a `Card`, a header, a full-bleed strip, panels, a sticky footer — and it was
*already* on `RecordTabs`. So the app had one job wearing three skins, and fixing only the
two broken ones would have left the third.

- **`RecordTabs` is `SectionTabs`, and the rename is the fix rather than a tidy-up.** The
  §4.7 archetype builds its own strip (R2 needs its tab in `?tab=` unconditionally), so no
  record page has used this file since batch 1 — it had **one** call site left, and that one
  is a settings page. A primitive named for a surface it no longer serves is a primitive the
  next author does not find, which is exactly what happened twice. What it actually owns is
  the card-scoped case, and it is named for that now. **This contradicts the census note
  that said "do not re-fix"**, which was written when the file was believed to have several
  record call sites; the row is corrected rather than left to mislead.
- **§7.7 is the rule the sub-phase was missing.** Two controls in this app change what the
  operator is looking at, and nothing said which was which: tabs (a panel switcher — the
  ARIA pattern, `SectionTabs` or the archetype's strip) and `SegmentedControl` (a value
  switcher — a toggle group, no panel relationship). The module builder's strip had picked
  the second one's *skin* for the first one's *job*, which is §1.6 inverted. Tabs are
  underlined; the recessed pill belongs to the segmented control.
- **`role="tablist"` is not a styling hook, and that is now written down.** All three
  hand-rolled strips announced the role with no arrow keys, no roving tabindex and no
  `tabpanel` behind `aria-controls` — a strip that promises a keyboard contract and supplies
  none of it reads *worse* to a screen reader than the plain buttons it is made of.
- **What went into the primitive rather than a call site.** `panelPadding` — a panel takes
  the card's content inset unless it *is* a `ModuleTableShell`, which owns its own edges
  (module access is the case). And a controlled `value`/`onValueChange`, because the module
  builder gates a field inspector on which tab is open; without it the page would have kept
  a second copy of the tab state beside the primitive's.

**Two defects, both in the primitive, both shipped for four batches.** Neither is in the
pages the row named:

- **`Tabs.Content` had `focus-visible:outline-none` with nothing behind it** — §2.3, and
  the *identical* defect batch 1 found and fixed in `RecordWorkspace`. The fix went to the
  archetype's copy and not to the file the archetype was copied from, so it survived in the
  primitive while the rendered guard visited only the archetype.
- **The trigger's class list was a byte-identical duplicate** across `RecordWorkspace` and
  `RecordTabs`. It is `sectionTabTriggerClassName`, exported and shared, so the record page
  and a settings card cannot drift into two underlines.

**One thing rejected in writing, because it looked like a refinement.** The active trigger's
2px underline sits directly on the band's own hairline, and `-mb-px` would have lifted it
onto the rule so the strip read as one line rather than two. That walks straight into the
trap `check-design.sh` names and 5.3 already paid for once in `RecordSpine`:
`overflow-x-auto` computes `overflow-y` to `auto` as well, so a 1px overhang becomes
scrollable overflow with a scrollbar under it. The band keeps the honest two lines.

**Two small things the rendered pass turned up, both fixed here.** The module-access card
hand-rolls its header row at `px-5` instead of using `CardHeader`, so the strip's 24px
label inset — the thing §7.7 says lines up with the header — was 4px off on exactly one of
the three pages. It is `px-6` now; the rest of that page's drift stays 5.6's. And a spec
that was red at HEAD, `view-manager-revamp.spec.ts:123`, passes with the change: the run
is **8 failed / 7 passed** against a stashed baseline of **9 failed / 6 passed**.

**The guard is the finding, not the fix.** `primitive-behaviour.spec.ts` has asserted the
full ARIA tabs contract since 5.1 — arrow keys move the selection, exactly one trigger is in
the tab order, `aria-controls` resolves to a real panel — and it passed every run for four
batches **while two strips in the app satisfied none of it**, because it visited one route.
It is parameterised over every strip now (`TAB_STRIPS`), and a new strip is a row in that
table. Parameterising it exposed a flake in the assertion itself: the archetype pushes its
tab through `router.replace` while the three card strips are local state, so the fixed
600ms wait that had always been long enough for one route was not long enough for that one
under load. It is a web-first `toHaveAttribute` now, which retries. This is the rendered-guard blind spot batch 4 found in a different shape: a guard
that visits a route list only guards the routes somebody remembered.

**The browser pass ran through Playwright, not the extension** — the Chrome extension was
not connected this session. That is not a downgrade for what had to be measured here: the
method the traps section prescribes is *drive the keyboard, do not script it*, and
Playwright's `keyboard.press` is a real key event, so `:focus-visible` behaves as it does
for an operator. Both themes and 768px were checked the same way.

**What batch 6 decided — the round trip's return half, and A13.** The row named the last
two open items, and they turned out to be one shape: both are about what an operator loses
when a record sends them somewhere else.

- **`recordEditHref` and `recordReturnHref` became one hook, `useRecordTabHref`, and the
  merge *is* the fix.** Two exported helpers wrapping the same three lines had shipped since
  batch 1, and the outbound one was adopted on all eleven detail pages while the return one
  had exactly one call site — the custom-module edit page batch 4 wrote from scratch. Naming
  a round trip as two directions is what let one direction go unbuilt for five batches: a
  page author reaches for the helper named for the link they are writing, and nobody was
  writing the return link. One hook, one job, and the eleven detail pages each dropped a
  hand-rolled `searchParams.get("tab")` on the way. §4.7 carries the rule now, including
  both rejected alternatives (`?from=<encoded href>`, and `router.back()` on Cancel).
- **Convert is a trip off the record too.** R2's wording is about `/[id]/edit`, but a lead's
  `/convert` leaves the record and comes back through the same Cancel, and dumping the
  operator on `Details` there is the identical defect. It carries the tab now, which is what
  makes A13 and the round trip one batch rather than two.
- **A13's dirty test is a snapshot against the state the page opened in**, not against
  empty. Conversion's defaults come from the operator's permissions — `Create account` and
  `Create contact` arrive pre-set — so a test against empty would prompt on the way out of a
  page nobody touched, which trains the operator to dismiss the prompt. Arriving and leaving
  costs nothing; toggling one switch costs a confirm. The guard also lifts once the
  conversion has run: the records exist at that point, so the completion panel's links are
  the next step rather than an escape from unsaved work.
- **The single-tab case is a rule rather than an exception.** A custom-module record has one
  tab, because `RECORD_COMMENT_MODULES` is a static registry keyed by model class and a
  tenant's own module cannot be in it — so Timeline, Tasks and Files cannot resolve one of
  its records at all. The archetype already renders that honestly (a tab whose slot is not
  passed is not drawn); what was missing was the statement that the hook must not *invent* a
  tab to carry. It is in §4.7 and it is asserted, inverted, in the guard below.

**The guard is parameterised, which is batch 5's lesson applied before it could bite again.**
`primitive-behaviour.spec.ts` gained `RECORD_MODULES` — twelve rows, one per module with an
`/[id]/edit` — and each row opens the module's *list*, clicks the first row, selects the
*last* tab in the strip, and then asserts the tab survives out to the form and back to the
record. Nothing is hardcoded but the list route: not the record id, not the tab name. So a
module that reseeds under different ids, or gains a tab, still guards the contract rather
than the fixture — and the tabs it happened to select (`related`, `proposal`, `signing`,
`files`) prove module-specific tabs round-trip as well as the fixed four.

**Writing it found something worth recording, and it is not in this batch's code.** The
first version located tabs with `[role="tab"]` and passed its wait on the *list* page, which
also announces that role — `SavedViewSelector` renders `new view · Default View · new view`
as a tab strip. The locator is scoped to `[data-slot="record-content"]` now. That selector is
5.5's row and is untouched here, but it is the third strip-shaped thing found by looking for
something else, so: **`[role="tab"]` is not a record-page selector in this app.**

**The browser pass found two defects and neither is in this batch's code — both are in
archetype 3, and both are already 5.4's.** Recorded here rather than fixed, because changing
the shared form layout inside a record-detail sub-phase restyles sixteen screens:

- **`RecordFormLayout.tsx:21` is `sticky bottom-0 z-20 … backdrop-blur`.** R3 says the action
  bar sits at the end of the document, not stuck to the viewport, and §4.7's archetype 3
  wireframe says so in as many words. It overlays the form content it is scrolling over. This
  is 5.4's "that action bar is no longer sticky" row, and it is one line in one primitive.
- **A form page draws no visible title.** `PageShell`'s `h1` is `sr-only` by §8, and the
  record archetype supplies its own visible `h2` — archetype 3 supplies nothing, so an
  operator editing a contact sees the form with the record's name nowhere on screen. The
  archetype 3 wireframe shows a title; no primitive draws it.

**What the pass did prove.** The full round trip works by keyboard alone — focus `Edit`,
`Enter`, land on `/[id]/edit?tab=files`, tab to `Cancel`, `Enter`, land back on the record
with `Files` selected — in both themes, and at 768px where the rail stacks and the page does
not scroll sideways. Fourteen stops on the record page, every one ringing. The tab-through
also repeated a lesson in a new form: started from the document, 22 presses never left the
sidebar, so it measured nothing about the page under test. **Focus into the region you are
testing before you count stops** — a clean tab-through of the app shell looks exactly like a
clean tab-through of the record.

**One measurement trap, paid for again.** Reading `boxShadow !== "none"` as "it has a focus
ring" reports a ring on every element whose class list carries Tailwind's empty shadow
variables — the computed value is a pair of transparent shadows, not `none`. It is the same
trap batch 3 and batch 4 both recorded from the other direction. The stop list is worth
reading with the raw `outline` and `box-shadow` strings printed beside it, and the
screenshots are what actually settle it.

**What close-out decided — and the finding is that the sweep was not mechanical.** The row
said "all 34 census rows, the status note, and the full gate set", and the honest reading of
that is that a row cannot be marked `done` while the file it names still carries the shape
the row was opened for. Five rows were unmarked, and reading them found the reason: the
batches rebuilt the *pages* and the two panels the archetype **inherited** were never
looked at.

- **`RecordDocumentsPanel` is the one 5.3 row no batch ever touched.** It is the Files tab
  on all eleven record pages, and it opened on a card headed `Documents` — the tab's own
  label, one word away from it, in a *second vocabulary* for the same thing (§1.6). Under
  that heading sat three hand-rolled state boxes — a loading div, a tinted error div, a
  `DocumentList` with its own empty state — against a `PanelStates` family 5.1 promoted to
  `components/ui/` for exactly this, plus `Upload Document` in title case that §3.5's grep
  cannot see because it only catches SHOUTING. It is on `PanelLoading` / `PanelError` now,
  the empty state went back to `DocumentList`'s own `RecordTable` (§7.4 — the states come
  from the composition), and what the heading's description said is the empty state's
  description, which is where §7.4 already puts *what this thing is*.
- **The rule that came out of it is the one worth keeping: the tab is the panel's name.**
  `RecordTimeline` — the panel 5.3 *authored* — draws no heading, because the strip above it
  says `Timeline`. The two panels it inherited both did, and neither was noticed for six
  batches because a heading is not a defect anywhere else in the app; it is only furniture
  *inside a tab*. §4.7 carries it, and `RecordTasksPanel` lost `Tasks & reminders` with it.
- **The green `Complete` button.** `RecordTasksPanel` painted it
  `border-state-success/40 bg-state-success-muted text-state-success` at the call site.
  Completing a task is the ordinary forward action on a task, not an exception, so R5 says
  it carries no colour — and §7.3 says a call site does not paint a `Button` in any case.
  It is `outline` now, like every other secondary action in that panel.

**The three scheduled items landed as scheduled, and one of them earned a rule.**

- **Deal and quote lost their header channels**, which is deferred question 1 executed. The
  §4.7 rule was already written when the question was answered, so this was a deletion, not
  a decision. Both pages were passing `summary?.contact?.primary_email` into their own
  header. Their Timeline composer's *follow-up* mode keeps that address and is untouched:
  it logs that a call happened, which is a different act from placing one, and §4.7 draws
  the line there rather than at the address.
- **`/dashboard/finance/invoice-generator` is deleted.** Its own census row is 5.7's, and it
  is marked done there with the reason — a 3-line `redirect()` with zero inbound links was
  costing both rendered guards a route visit each. `design-rules.spec.ts` now audits 94.
- **B.2 produced §7.9, and that is the part that generalises.** The fix itself is small: the
  custom-module list stops rendering `InlineSavedViewFilters` and the toolbar's filter
  group, because `useCustomModuleRecords` serialises `page`, `page_size`, `search`,
  `sort_by`, `sort_direction` and nothing else — so the badge read `Filters ②` over a result
  set that had been filtered by nothing. What made it worth a rule is that this is the only
  failure mode in `design.md` where **the interface lies rather than nags**: §4.7's A12 rule
  removes controls that are *inert*, and an inert control at least tells the truth about
  itself. So `ModuleListToolbar`'s filter group is optional now and a module that cannot
  filter passes none of it. Search and sort do reach the backend and stay.
  **And fixing the list page alone would have left the back door open**, which is the part
  worth writing down: `views/[moduleKey]` — 5.3's own row, closed in batch 5 — builds a
  `SavedViewConditionEditor` over `buildCustomModuleViewDefinition`'s `filterFields`, so an
  operator could still author conditions there, save the view, apply it on the list, and get
  every row back. §7.9 says *not rendered anywhere*, and one surface is not anywhere. The
  view manager gates the editor and its `N conditions` summary on the same test now.

**The A12 rule turned out to have a second half nobody had applied.** §4.7 says a workflow
action absent in this state is not rendered rather than rendered disabled — settled in
batch 3 for `Convert to order`. `CommunicationActions` was failing the identical test three
ways and had never been read against it: `Email` and `Call` were drawn permanently and
disabled whenever the column was empty, and opt-out produced a *third* disabled shape
labelled `Email Opt Out`. A contact with no phone is the common case, so the header's most
frequent state was two inert buttons beside one live one. Each channel renders only when it
can be used now. **The opt-out case is the one worth arguing and it still loses**:
`email_opt_out` is a field and `Details` already draws it as `Opted out`, so the disabled
button was a worse place to learn a compliance fact than the field that states it.
**Rejected:** keeping the opt-out button alone as a warning — it makes one channel behave
unlike the other two, and then the operator has to know that a *missing* Email button and a
*disabled* one mean different things.

**Five props had zero call sites, and the shape of that is a lesson about migrations.**
`showCopyActions` was passed `false` at every one of five call sites — so its `true` default,
the two `Copy` buttons and `Log Follow-up` behind it were unreachable. `followUpTargetId`,
`onWhatsAppClick`, `whatsAppDisabled` and `whatsAppBusy` had none at all: batch 1 moved the
tracked WhatsApp click into the Timeline composer and left the props that used to drive it,
because deleting a prop is not required to make a page work. Six batches of "adopt" left a
component whose defaults nobody had rendered since batch 1. **A prop every call site
overrides is a default that is wrong**, and it is invisible to lint, to the build and to
every assertion.

**One control was audited against the rule and kept its disabled state, which is the
counter-example the rule needs.** `DocumentReferenceActions` disables `View` when the
provider link is broken. That is not A12's shape: a missing address means the action does
not exist, and a `permission_lost` provider means the action exists and is *broken*, which
is a state the operator has to see in order to fix. It stays disabled — but its reason had
been a `title` attribute only, which is pointer-only and invisible to the keyboard and to a
screen reader (§8). It is an `sr-only` line with `aria-describedby` now.

**Two counts were wrong and are corrected.** 5.3 owns **35** census rows, not 34 — batch 4
added `custom/[moduleKey]/[recordId]/edit/page.tsx`, and the summary table at the foot of the
census was never updated. And the census's own summary is the thing the coverage contract
leans on, so a row added mid-sub-phase has to reach it in the same change.

**Verification.** `check-design.sh` 12/14, the same two documented failures at HEAD
(`LynkSplash.tsx:58` is 5.9's, `ClientPageCreateForm.tsx:335` is 5.8's) and no new ones;
lint and `next build` clean; `design-rules.spec.ts` and `scroll-containers.spec.ts` both
green over 94 routes; and the module specs for every touched area — **66 passed / 8 failed,
all eight confirmed pre-existing by stashing.** Five are batch 6's documented set
(`accounts-revamp:46`, `contacts-revamp:45`, `leads-revamp:340` and `:832`,
`opportunities-revamp:22`), two are `view-manager-revamp:91`/`:141`, already written up in
`docs/e2e-suite-status.md` and verified unchanged at `fe3855e` *after* this batch edited that
page — and one is `documents-revamp:294`, which is `/dashboard/documents`, a page this batch
does not touch, failing identically at HEAD.

**Two assertions moved, and the pair is the honest measure of the guards.**
`leads-revamp.spec.ts:509` asserted `getByRole("heading", { name: "Documents" })` was
*visible* on the Files tab — so the one assertion in 58 specs that pinned the duplicated
heading was pinning it as **correct**. It is inverted now: no heading matching
`/Documents|Files/` inside `record-content`, and the panel identified by `Upload document`,
which is what it lets you do. The other, `:599`, asserted `Upload Document` at
`toHaveCount(0)` on a view-only lead, so it would have passed against either casing. That is
the shape of the gap: **a rendered heading nobody had questioned was load-bearing in a spec,
and the string that actually changed was asserted only where it could not fail.**

**The browser pass found one defect, and it is not this batch's — but the two things it
*rejected* are worth more than the finding.**

- **The finding, and it is 5.5's.** `RecordTable` lays its empty state out across the
  table's `scrollWidth` rather than its visible width, so on a record's narrower content
  region the empty state renders off-centre and clips. Measured: the Files tab's region is
  `clientWidth 580 / scrollWidth 920` and the empty state is an 888px box at `left: 662`.
  It has been there since batch 1, and `/dashboard/documents` is `1280 / 1280` so a
  full-width list never shows it. Written into 5.5 with the measurement;
  `RecordDocumentsPanel`'s empty copy is kept short so it reads correctly either way.
- **A rejected finding: two spine controls that reported no focus ring, and did not have a
  defect.** The first tab-through recorded `Customer group` (the rail's `InlineFieldEdit`)
  and `History` (the spine's sheet trigger) with `:focus-visible` matching and a computed
  `box-shadow` of nothing but transparent placeholders. That reads exactly like batch 1's
  two keyboard defects, in the same component. It was the **transition**: `Button` animates
  `box-shadow` over 150ms and the style was read on the same tick as the key press. Waiting
  260ms, both paint `rgb(11, 13, …)`. This is the third form of the measurement trap this
  sub-phase has recorded — batch 3 and 4 hit it as a false *positive*, batch 6 as
  `!== "none"` on empty Tailwind variables, and this one is a false *negative* off a
  transition. **The rule that survives all three: read the raw strings, wait out the
  animation, and let a screenshot settle it.** All 8 record stops ring.
- **A rejected screenshot: two "light theme" captures that were dark.** `next-themes` maps
  light to a `.light` class from localStorage, so `setAttribute("data-theme", "light")` is
  stomped on hydration. The screenshots looked plausible — a dark record page is a normal
  record page — and only reviewing them against the dark set showed they were identical.
  Asserting `html.light` before the shot is the fix. **A theme capture that does not assert
  the theme is a capture of the default twice.**

The pass otherwise: both themes on all four tabs, 768px with no sideways scroll, deal and
quote confirmed channel-free in the header, and the custom-module list and view manager
confirmed to offer no filter control while `/dashboard/sales/leads` still does.

### What is left, in order

Each row is one batch, gated by lint + build + `check-design.sh` between them, one commit
each — the shape 5.2 used.

| # | Batch | Notes |
|---|---|---|
| ~~1~~ | ~~**deal + contract**~~ | **Done** — see "What batch 2 decided", above |
| ~~2~~ | ~~**quote, order, POS invoice**~~ | **Done** — see "What batch 3 decided", above. A12 closed; the second nested tab strip died with it |
| ~~3~~ | ~~**insertion order, support case, custom record, catalog product/service**~~ | **Done** — see "What batch 4 decided", above. `CrmRecordActivitySection` and its three panels deleted; the rail's own scroll fixed in `RecordSpine` |
| ~~4~~ | ~~**The two hand-rolled `role="tablist"`**~~ | **Done** — see "What batch 5 decided", above. It was three strips, not two: `RecordTabs` is `SectionTabs` and all three are on it. `SavedViewSelector.tsx:26` is untouched and stays 5.5's |
| ~~5~~ | ~~**`/[id]/edit` round trip + A13**~~ | **Done** — see "What batch 6 decided", above. The two helpers became one hook, `useRecordTabHref`; twelve edit surfaces carry the tab back; `/convert` joined the rule; A13 closed. The guard is parameterised over all twelve modules |
| ~~6~~ | ~~**Close-out**~~ | **Done** — see "What close-out decided", above. All 35 census rows marked (the count was wrong too), the three scheduled deletions, and five rows that were unmarked because the panels the archetype *inherited* had never been swept. §7.9 is new. The two archetype-3 defects batch 6 found are 5.4's and stay there |

### The eight deferred questions, answered

Settled with the owner on **2026-08-19**, in one pass, deliberately: R9's "raise it, do not
answer it with a second archetype" had fired four times across five batches, and a question
raised four times and never answered is not being deferred, it is being avoided. Each answer
below is final for the programme — a later sub-phase implements them, it does not re-open
them.

| # | Question | Answer |
|---|---|---|
| 1 | Header channels on non-person records | **A record offers a channel only if it owns the address.** Deal and quote lose Email/WhatsApp/Call; lead, contact, account keep them. §4.7 |
| 2 | Contracts under-modelled | **Frozen.** See below |
| 3 | Owner, and the thin rails on contacts/accounts | **Owner moves to State and edits inline on all 8 record types**, behind a new `SearchableSelect` primitive. §4.7, §7.8 |
| 4 | Catalog disconnected from quoting | **Link quote/order line items to the catalog** — its own slice, after 5.9 |
| 5 | Custom modules are second-class | **Make the filter UI honest now; one first-class slice scheduled** |
| 6 | Support cases have no `/[id]/edit` | **Frozen.** See below |
| 7 | `sla_due_at` is written by nothing | **Frozen.** Stays dead |
| 8 | Archetype 3 draws no visible title | **The record's name on edit, the noun on create.** 5.4. §4.7 |

**The one that reframed itself, and is the most valuable answer here.** Question 3 arrived
as "contacts and accounts have a one-field rail". Looking at it found that `Owner` renders
as a read-only `RecordSpineLink` inside `Connected` on **all eight** record types — and
`assigned_to` / `owner_id` is a column on *this* row, chosen from a closed set, which
§4.7's own test puts in **State**. So the thin rail was not under-modelling at all: it was a
state field drawn in the wrong block, making reassignment a page trip for the
second-most-common edit after status. One rule fixes three complaints at once. Recorded
because it is the pattern: **three of the four "under-modelled" signals turned out to have a
cause that was not modelling.**

**What the owner added to question 3, and why it is the better instinct.** The proposal was
a searchable picker for Owner. The owner's answer was that a searchable dropdown is a
primitive, not a feature of one field — build it once and give it to every select where
search makes sense. That is §0's "reuse before extending" applied before the duplication
happened rather than after, and the count justified it immediately: `TimezonePicker`,
`UserTeamPicker` and `LinkedRecordPicker` had each hand-rolled `Popover` + search `Input` +
filtered list + `Check`, independently. §7.8 is the rule, and the load-bearing clause is
that **the primitive decides by counting its own options** — a `searchable` prop at 17 call
sites is the prop that drifts.

**Support cases and contracts are frozen, and the freeze was priced.** The owner's position
is that this is a CRM + ERP and neither module is its direction. Both were measured before
deciding: support is ~2,870 lines across backend, frontend and tests with 24 external
references **and a customer-facing client-portal surface** (portal users can raise, view and
comment on cases); contracts is ~3,055 lines with 45 external references. Both are already
rebuilt onto the archetype. **Removal was rejected as the most expensive option on the
table** — de-integration across 24 and 45 files, migrations to drop seven tables, and a
tenant-backup format change, to delete something that costs nothing to carry. So they are
frozen instead.

> **Freeze means no module-specific investment. It does not mean excluded from app-wide
> sweeps.** Contracts and support cases still receive `Owner` → State, `SearchableSelect`,
> 5.5's table work and 5.9's copy pass, because applying a shared primitive to six of eight
> record types is the drift the programme exists to remove.

**Accepted consequences, written down so nobody re-raises them as defects:** the support
dashboard reports `0 overdue` permanently (`sla_due_at` keeps five readers and no writer); a
support case cannot be corrected after create, including cases raised through the portal;
and a contract's `Connected` block keeps its six `Not set` rows.

**What this schedules, and where it lands.** Nothing below is 5.3's:

| Work | Home |
|---|---|
| ~~Deal + quote lose header channels~~ | ~~5.3 close-out~~ — **done** |
| ~~Delete `/dashboard/finance/invoice-generator`~~ | ~~5.3 close-out~~ — **done** |
| ~~Hide the custom-module filter control (B.2)~~ | ~~5.3 close-out~~ — **done**, and it produced §7.9 |
| `SearchableSelect` primitive; `TimezonePicker` collapses into it | **5.4** — it is a form control as much as a rail one |
| `Owner` → State on 8 record types, editable | **5.4**, immediately after the primitive |
| Archetype 3's visible title; `RecordFormLayout.tsx:21` sticky footer (R3) | **5.4** |
| Custom modules become first-class: dynamic module registry (Timeline/Tasks/Files), a `lookup` field type, EAV filtering over `custom_module_record_values` | **New slice, after 5.9** |
| Catalog ↔ quote/order line items (`catalog_product_id` / `catalog_service_id`, matching `finance_pos_items`) | **New slice, after 5.9** |

Two things deliberately *not* scheduled, recorded so they are not mistaken for oversights:
contract renewal modelling (`auto_renew`, `notice_period_days` — the one genuine gap in that
module, frozen with it), and an SLA policy engine.

---

### Traps already paid for once

- **`RecordWorkspaceLegacy.tsx` is gone** — deleted in batch 1 with its last two consumers,
  as planned. Nothing may reintroduce it.
- **`CrmRecordActivitySection` is gone**, deleted in batch 4 with its last three consumers,
  and `RecordCommentsPanel`, `FollowUpPanel` and `RecordActivityTimeline` went with it — it
  was their only importer. `RecordPageHeader` died in the same commit for the same reason.
  `RecordActivityFeed` was already deleted. Nothing may reintroduce any of them: their
  composers live in `RecordTimelineComposer` and their panels are the archetype's tabs.
- **`leads-revamp.spec.ts` has 2 failures that predate this sub-phase** — narrow-viewport
  list, and denied/missing records (the route states render `titleAs="p"` and the spec asks
  for a heading). Measure the baseline by stashing before blaming a rebuild for a red.
- **The browser pass is not optional. It has now found seven defects across four batches**
  while lint, build, both rendered guards and every module spec were green — and two of them
  had been shipped for batches: batch 2's `ReferenceError` took a whole route down, and batch
  4 found the rail overflowing the page, which batch 1 introduced and three batches of gates
  missed. Seed, then drive a real record — and tab through it, which is what batch 1's two
  needed. **Measure the geometry too**: `scroll-containers.spec.ts` only visits static routes,
  so no rendered guard has ever opened a record page, which is exactly where the rail defect
  lived. `support-revamp.spec.ts` now carries a record-page scroll assertion; a batch that
  changes the rail should extend it rather than trust the route list.
  `scripts/seed_demo_crm` seeds tenant 1 (`default`): leads at ids 3–5, and batch 1 used
  contact 23 and account 13, which carry a phone, an account, a customer group and related
  records. Batch 2 used deal 14 (a `proposal` with a contact, an account and an insertion
  order) and contracts 1 and 3 — **3 is the only one with events**, so it is the one that
  shows the merged History sheet. `scripts/seed_module_samples` is what creates the
  contracts. The demo tenant's own records (ids 5–20) are **not** the admin's tenant and read
  as "not found". Batch 3 used quote 3 (`SAMPLE-QT-0002`, the only `accepted` one, so the only
  one that can show `Convert to order`), quote 2 (the only one with proposal events, so the
  one that shows them merged into the History sheet), and POS invoice 15 (`issued` /
  `partial`, so the only one with a real balance due). **The sample quotes and orders seed
  flat** — no items, no contact, no account, no deal — so a rail and a line-item table are
  both empty on them; batch 3 filled quote 3 by hand before driving it, and `Convert to
  order` then rejects unless the quote's account matches its deal's. Batch 4 used insertion
  order 15 (`active`, an account, and a real `.pdf` rather than the `.manual` sentinel the
  first two carry), support case 3 — **the only one with events** — after linking it to
  contact 23 and account 13 and adding two replies by hand, catalog product 13 (the only
  `preorder` one) and custom module `testing_new_custom_module`, whose seeded fields are all
  content, so a `single_select` and a `boolean` were added by hand to see a State block at
  all. **No seeded custom module has a state field**, which is worth knowing before assuming
  the rail is broken.
- **Specs get updated, not written** (testing policy). 10 lead assertions moved with the
  rebuild; expect a similar count per batch.
- **`[role="tab"]` is not a record-page selector.** The list page's `SavedViewSelector`
  announces the role too, so an unscoped locator resolves on the list before a row's
  navigation has landed — which reads as "the tab strip is broken" when it is the wrong
  strip. Scope to `[data-slot="record-content"]`.
- **Focus into the region under test before counting tab stops.** Tabbing from the document
  start walks the whole sidebar first: batch 6's first tab-through spent 22 presses in the
  nav and never reached the record, and looked perfectly clean doing it.
- **Batch 6's `RECORD_MODULES` guard needs warm routes.** It opens twelve list routes and
  twelve record routes; on a cold dev server one module's first compile exceeded the 30s
  wait and failed, then passed in every warm run. Same run-shape trap as the sales lists —
  warm first, judge on `--workers=1`.
- **Pre-existing reds measured for batch 6, all confirmed by stashing:**
  `leads-revamp` narrow-viewport + denied/missing (2), `accounts-revamp` and
  `contacts-revamp` "usable on mobile" (2 — note these now fail *in isolation* too, where
  `docs/e2e-suite-status.md` records accounts passing 3/3 that way, so that entry has drifted),
  `opportunities-revamp:22` (1), `catalog-revamp:246` (1), `invoices-revamp:140` and `:175`
  (2 — a strict-mode collision between `PageShell`'s `sr-only` h1 and the archetype's visible
  h2, which is the same shape as the tab-strip specs' known ambiguities).
- **The three tab-strip specs have 8 failures that predate this sub-phase**, all of them
  already written up in `docs/e2e-suite-status.md`: `module-builder-revamp` `:132`/`:163`/`:182`
  (an ambiguous `getByLabel('Label')`), `settings-modules-revamp` `:93`/`:209`/`:242`
  (Headless UI's zero-box dialog root, and the route announcer matching `getByRole('alert')`),
  and `view-manager-revamp` `:91`/`:141`. Measured by stashing, as the note above says to.

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

### Decided before the first line — the batch order, and why a primitive is first

5.4 is the first sub-phase that starts with its answers already written. R1 fixes the commit
model per surface, R2 makes content read-only, R3 unsticks the footer, §4.7's archetype 3
says the form draws the record's name, and §7.8 went into `design.md` during 5.3's close-out
— before a line of `SearchableSelect` existed, which is §12's order and the whole point of
it. What 5.4 has to decide is **sequence**, and the sequence is forced rather than chosen:
`Owner` → State cannot land before the primitive it is drawn with, and fifteen form routes
cannot be swept before the layout they all sit on has moved.

So the two primitives come first, and each is followed immediately by the sweep that proves
it — the mitigation this programme applies everywhere (*the second call site is the API
test*). `SearchableSelect` ships with three adopters in its own batch rather than alone,
because a primitive with no consumers is what `ActionBar`, `SectionHeading`, `Avatar` and
`PanelStates` already are: built, correct, and unenforced.

### Status: batch 1 — verified end to end, committed as `0761061`

**Read this first if you are picking the run up.** Batch 1 is done and committed. Lint,
`npm run build`, `check-design.sh` (2 of 14 failing — the known baseline, unchanged) and
**both rendered guards are green, re-run after the `design-rules.spec.ts:175` edit**
(`design-rules` 94 routes, no unreachable, 3.4m; `scroll-containers` 2.4m; 5.8m total,
`--workers=1`). The two unexplained module-spec failures **were measured against HEAD and are
not ours**. The browser pass is **done** — the hand-rolled listbox that replaced a
Radix-managed one on 17 call sites has been driven by keyboard on both forms and both
themes.

**The module spec run: 55 passed, 6 failed** (`leads`, `contracts`, `catalog`,
`custom-modules`, `insertion-orders`, `opportunities`, `profile`, 7.7m, `--workers=1`). Four
failures are on the pre-existing list in 5.3's traps — `leads-revamp:340` (narrow viewport),
`leads-revamp:832` (denied/missing), `opportunities-revamp:22`, `catalog-revamp:246`. **Two
are not on any list and are the first thing the next run does:**

- `catalog-revamp.spec.ts:397` — *"The record archetype's Timeline, Tasks and Files tabs
  replace the nested activity section"*. A record page carrying `InlineFieldEdit`.
- `profile-revamp.spec.ts:146` — *"Profile presents one-time recovery codes after enabling
  MFA"*, failing on `getByText("MFA enabled")` at `:173`. `/dashboard/profile` is one of
  `TimezonePicker`'s two call sites.

Both are on surfaces this batch touched, so the priors were bad. **Measured: both fail at
HEAD with the batch stashed out** (`git stash push -u`, both greps, `git stash pop` — run as
one shell command with the pop in a `trap`, so an interrupted run cannot strand the batch in
a stash). They fail on the same assertions with and without the batch:
`catalog-revamp:478` waiting on `No documents are linked to this record yet.`, and
`profile-revamp:173` waiting on `MFA enabled`. Neither assertion is near a select or a
combobox. **They join the pre-existing list — six failures, all inherited, none ours.**

**What landed.**

- **`components/ui/SearchableSelect.tsx` is new** — §7.8's primitive. `Popover` + listbox at
  every count, with the search `Input` rendered only at or above
  `SEARCHABLE_SELECT_MIN_OPTIONS` (10). No call site passes a flag.
- **`selectTriggerVariants` is exported from `select.tsx`** and worn by the new trigger, so
  the two forms of a select are one class source rather than two that drift (§1.6).
- **`InlineFieldEdit` renders through it** — all 17 call sites, unchanged at the call site.
- **`TimezonePicker` collapsed into it**: 93 lines → 59, and the file now holds only what is
  about timezones. Its two call sites are unchanged.

**Four decisions worth the words, and three of them are about not being seen.**

- **`role="combobox"` on the trigger and `role="option"` on the rows are the compatibility
  contract, not a detail.** Radix `Select` announced exactly those, and 20-odd specs across
  nine modules locate this control as `getByRole("combobox", { name })` then
  `getByRole("option", { name })`. A `Popover` combobox that announced anything else would
  have been a rewrite of every one of them — and §7.8's "one DOM shape, always" says the two
  forms must be indistinguishable to a screen reader for the same reason.
- **The search input is named `Search`, not `Search <field>`.** Playwright's `getByLabel`
  matches substrings, so `Search Timezone` makes `getByLabel("Timezone")` ambiguous the
  moment the popover opens — `profile-revamp.spec.ts:48` asserts exactly that locator. The
  listbox carries the field's name instead, which is where a screen reader wants it.
- **The empty state says two different things.** `Nothing matched that search` and
  `There is nothing to choose from yet` are not the same fact, and rendering the first for
  the second is §7.9's shape at a small scale.
- **`TimezonePicker`'s `slice(0, 100)` is deleted, and it was a live instance of §7.9.** It
  capped *every* query including the empty one, so an operator who scrolled without typing
  reached the end of a list that was not the end. `Intl.supportedValuesOf` returns ~400
  zones; all of them render now, inside a popover that only mounts when open.

**One guard blind spot closed in the same change.** `design-rules.spec.ts:175` collects the
§4.2 control-height set by `data-slot`, and a new trigger slot would have escaped it
silently — the same shape as 5.2's `SummaryTile` sweep, whose own grep could not see the
thing it was sweeping. `[data-slot="searchable-select-trigger"]` is in the selector list now.
`/dashboard/profile` and `/dashboard/settings/calendar-booking` are both on the audited route
list, so the default variant is height-checked for real. **Re-run after that edit and green** —
the trigger clears §4.2 at both sizes.

**Deliberately not written: a keyboard spec for the primitive.** The testing policy is
explicit that new coverage lands in 5.10, and this is new coverage rather than a moved
assertion. It is listed there instead: arrow/Home/End/Enter/Escape, typeahead on the
unsearchable form, and the search form's `aria-activedescendant`. Until then the browser
pass is the only thing standing behind a hand-written listbox.

**The browser pass — done, and it found one thing.** Driven on `/dashboard/profile`
(`TimezonePicker`, 418 options, the searchable form) and `/dashboard/sales/leads/5`
(`InlineFieldEdit` status, 5 options, the unsearchable form), reading
`aria-activedescendant` rather than trusting highlights, in both themes:

| | |
|---|---|
| Tab to trigger, `ArrowDown` opens | ✓ both forms |
| Searchable: search takes focus, first option active | ✓ |
| Unsearchable: listbox takes focus, active starts on the *selected* row | ✓ `fallbackIndex` |
| Arrow roving, `Home`, `End` | ✓ `End` lands on the true last option |
| `ArrowUp` at the top clamps, no wrap | ✓ as `move()` documents |
| `Escape` — closes, no commit, focus back on trigger | ✓ |
| `Enter` — commits, unmounts, focus back on trigger | ✓ |
| Typeahead `q`→Qualified, `co`→Contacted, `conv`→Converted, reset after 600ms | ✓ |

Nothing was mutated: `Enter` was pressed on the *already selected* row, where `commit()`
short-circuits on `option.value !== value`.

**`End` was the one real find, and it is fixed here.** It was the only branch that did not
skip disabled rows — `visible.length - 1` against `Home`'s
`findIndex((o) => !o.disabled)` — so a disabled last option would take the active ring and
then swallow `Enter`, since `commit()` refuses a disabled option. It is now
`findLastIndex((o) => !o.disabled)`, which is what `move()`'s comment already says the
control does. **Latent, not live**: no call site passes `disabled: true` today. Found by
reading the branch, not by the browser — the browser could not have reached it.

### Trap: a Chrome tab that has stopped painting looks exactly like a stuck popover

Cost most of an hour in the browser pass, and it will read as a real defect to the next run.
**Symptom:** after `Enter` or `Escape` the popover stays visible and mounted, `data-state` is
`closed`, focus never returns to the trigger. It looks precisely like a broken exit path in
`SearchableSelect`. **It is not.** Radix `Presence` unmounts on `animationend`, and the tab
had stopped producing frames, so the 0.15s `exit` animation never advanced.

**The discriminator, before blaming any component that unmounts on animation:**

```js
requestAnimationFrame(() => …)          // never fires
document.timeline.currentTime            // still advances — this is the misleading part
probe.animate(…).currentTime             // frozen at 0 on a *brand new* animation
```

A fresh probe animation frozen at 0 means the document is not rendering, not that the
component is broken. `document.visibilityState` is `"visible"` and `document.hasFocus()` is
`true` throughout, so neither is worth checking. Screenshots keep working the whole time —
they are captured on demand — which is what makes the phantom so convincing. Bring the window
to the foreground and every stuck popover unmounts itself at once.

### Status: batch 2 — verified end to end, committed as `e62474e` + `853bc33`

**Read this first if you are picking the run up.** Batch 2 is done and committed. Two commits,
as the batch row said it would be: the backend line (`e62474e`), then the sweep that consumes
it (`853bc33`).

**It is nine record types, not eight, and the ninth is the one the count kept missing.**
Support cases draw the same field under the module's own word — `Assignee` — so a survey
looking for `Owner` did not see it, and question 3 was answered as "all eight". The rule §4.7
states is categorical (*a field that points at a user is state*), the freeze on support
explicitly keeps app-wide sweeps in scope, and support is the one record type with **no
`/[id]/edit` route at all** — so leaving it out would have made the case's assignee the only
user field in Lynk that cannot be changed anywhere. It is in, with the label it already had.

**What landed — the backend line (commit 1).**

- **`/linked-record-options/users` can list, not only search.** `query` was `min_length=1`, so
  the empty query was a 422 and the service short-circuited to `[]`; it now filters only when
  a query is given. `limit`'s ceiling goes 20 → 500 (`USER_OPTIONS_MAX_LIMIT`), and **the
  default stays 10** — `LinkedRecordPicker` types first and wants a screen of matches, the
  rail wants the set. Nothing else about the endpoint moves: the three-layer access check, the
  tenant scope and the `is_active` filter are untouched, and `action` stays `edit` for the
  rail because the only reason to list users there is to write one. **It is not a new
  disclosure**: a caller who could search this endpoint could already walk the directory
  twenty rows at a time, so listing changes the number of requests and nothing about who can
  see whom.
- **The response carries `has_more`.** A list that quietly stops reads as *that person does
  not exist*, which is a stronger and more wrong claim than *this list is capped* — §7.9 at
  the scale of one dropdown, and exactly the defect `TimezonePicker`'s `slice(0, 100)` was.
  One extra row is fetched to learn it.
- **The insertion order could not carry the write at all.** `InsertionOrderUpdateRequest` had
  no `user_id` and the response had no `user_id` either — only a `user_name` — so the one of
  nine that had never been checked against its own contract turned out to have no contract.
  Both are added, the serializer emits the id (so the audit's before/after states record a
  reassignment), and the service validates the user in-tenant the way the other eight already
  do. Found by reading each module's update schema before writing the frontend, which is the
  cheap half of this kind of sweep.

**What landed — the sweep (commit 2).** `RecordOwnerField` in `components/recordWorkspace/`,
`useUserOptions` beside it, and all nine call sites in the same commit. `Owner` leaves
`Connected` on every one of them.

| Record | Column | Write |
|---|---|---|
| Lead, contact, account, deal, quote | `assigned_to` | `PUT` |
| Contract, order | `owner_id` | `PATCH` |
| Insertion order | `user_id` | `PUT` (new) |
| Support case | `assigned_to_id` | `PATCH` |

**Four decisions, and the first is the one that stops this being nine copies.**

- **The component owns the options; the call site keeps the write.** The render is six lines
  and duplicating it would have been survivable. The *options* are not: every one of the nine
  needs the tenant's users, the unassigned value, the current owner kept selectable when the
  list does not contain them, and the cap disclosure — and `customer_group_id` had already
  drifted between the two pages that hand-rolled the same thing. The write stays at the call
  site because the nine disagree about the column, the verb, and the cache shape the
  optimistic update has to move, which is why their `updateStatus` functions differ too.
  Hiding that behind an `endpoint` prop would have bought nothing and cost the rollback.
- **`Unassigned` is a value, not an empty.** A record can be handed back to the pool, so the
  option exists and the closed field renders its name rather than `EmptyValue`'s `Not set` —
  the same call `No group` makes on the customer-group field directly beside it. Written into
  §4.7 rather than decided per page, because the alternative is the field reading `Not set`
  with the permission and `Unassigned` without it.
- **Owner sits directly under the record's status field, or first where there is none.** §4.7
  now says so. It is the second-most-common edit after status, and the two read in one glance
  — which is also the answer to the thin rails: contacts and accounts now have two state
  fields, `Owner` above `Customer group`, and an account's `Connected` block is collections
  only.
- **No permission, or no user list, and the field is read-only.** Not a disabled picker: a
  select whose only options are `Unassigned` and the person already in it looks like a choice
  and is not (§7.9). The request failing is the interesting half — it is the one case where
  the control would have been drawn over an answer the request layer never gave.

**Rejected, with reasons, because the shape recurs:**

- *Keep `Owner` in `Connected` and make it a `LinkedRecordPicker`.* It is the pre-5.3 answer
  with an editor bolted on. `assigned_to` is a value on this row chosen from a closed set, not
  a reference to another record — §4.7's own test — and `LinkedRecordPicker` is a form control
  that resolves references over a server search (§7.8's boundary).
- *A `components/ui` primitive taking `options` as a prop.* It would have pushed the fetch,
  the sentinel and the fallback option back out to nine call sites, which is precisely the
  duplication worth removing. The render was never the expensive part.
- *No cap at all on the listing form.* Honest, and an unbounded list endpoint. `has_more`
  keeps the honesty and the bound.

**Two consequences, recorded rather than fixed.**

- **A user-scoped reader who reassigns an insertion order loses it.** `get_finance_user_scope`
  limits a non-admin outside the finance department to their own records, so handing one to a
  colleague makes the next read a 404 and the page falls to its error state. That is what
  happened, and the alternative — hiding the control from a reader whose scope the frontend
  cannot see — would be inventing a permission the API does not expose.
- **The insertion order's rail no longer says `You`.** `user_name` is `"You"` when the owner
  is the reader, and the rail now renders the option's own label. The other eight always
  showed the real name; this makes nine.

**Deferred, deliberately, to batch 3.** §7.8's "the same field behaves the same in both places
it appears" is not closed: the rail lists users in memory and `/[id]/edit` still resolves them
through `LinkedRecordPicker`'s server search. Both are searchable comboboxes, so this is drift
rather than a defect — and the forms are batch 3's, which is where the decision belongs.

**Verification.** Backend: the full suite, **1023 tests, green**, with four new ones — the
listing form, the cap, and the insertion order's reassignment (in-tenant, cleared, and
refused across tenants). Frontend: lint, `npm run build`, `check-design.sh` (2 of 14 — the
known baseline, unchanged), both rendered guards, and the module specs for the nine surfaces.
Fixtures that carried a `*_name` and no id had to gain one — a rail that selects by id cannot
render a name it has no value for, and `insertion-orders-revamp` was the case that proved it.

### The browser pass — and the defect it found is in the primitive, not the field

**The Chrome extension was not connected this run**, so the pass was driven through
Playwright instead: a throwaway spec against real seeded data and the real backend, deleted
before the commit (new coverage lands in 5.10, and this is not that). Same browser, and it had
one advantage over clicking — it reads `aria-activedescendant` and computed style rather than
trusting a highlight.

| | |
|---|---|
| Field order in State | ✓ `Status`, `Owner`, `Next follow-up` |
| Option set | ✓ 13, searchable (≥ 10), `Unassigned` first, each user's email as the second line |
| Active on open | ✓ the *selected* option, not the first |
| `End`, `Home`, `ArrowUp` clamping at the top | ✓ |
| `Enter` on `Unassigned` — a real write | ✓ committed, and it survived a reload |
| Search, then `Enter` — a second real write | ✓ filtered to 1, active tracked the filter, restored |
| `Escape` | ✓ closes, does not commit |
| Focus ring on the trigger after a keyboard exit | ✓ 2px ring on a 2px ground |
| Both themes, and 768px | ✓ sampled rather than eyeballed — page ground `rgb(18,22,28)` dark, `rgb(255,255,255)` light |

**What it found: every keyboard commit dropped focus to `<body>`.** `InlineFieldEdit` disables
its trigger while the write is in flight, and **a disabled element cannot hold focus** — so
Radix's restore-on-close handed focus to a button that was about to be taken away, the browser
dropped it to the body, and the operator's next Tab restarted at the top of the page. This is
**not** new in batch 2: it is every state field on every record type, and it has been there
since `InlineFieldEdit` shipped in 5.1. Nothing could see it, because the value saved
correctly the whole time — the same shape as the History sheet's missing `SheetTrigger`, found
the same way, by tabbing.

Fixed in the primitive: when the control leaves `saving`, if focus went nowhere, it goes back
to the trigger. Guarded on `document.activeElement === document.body`, so an operator who has
already moved on keeps their place. Verified on two real writes — which is why the pass was
re-run with a value that actually *changed*: the first attempt re-selected the current owner,
`commit()` short-circuited on `option.value !== value`, and the save path was never exercised
at all. **A green browser pass that never took the branch is worth less than no pass**, and
this one nearly shipped as evidence.

**One measurement handed to 5.10 rather than changed here.** The listbox's active row is
`bg-accent` (`--color-primary-muted`), and against the popover ground that is **1.24:1 in dark
and 1.08:1 in light**. It is the keyboard focus indicator inside the listbox and 1.08:1 is
thin. It is also the app's existing menu-highlight vocabulary — `select.tsx` uses the same
token for the same job — so raising it is a token decision affecting every menu in the app,
not a fix to this field. Recorded with numbers, and 5.10 gains the check that can see it.

**Next.** Batch 3 — `RecordFormLayout`: archetype 3's visible title, the sticky footer (R3),
the 78 hand-written field grids and the four `TextField`s, and the Owner control's form half.


### Status: batch 3 — verified end to end, committed as `b1a51dd`

**Read this first if you are picking the run up.** Batch 3 is done and committed as
`b1a51dd`. Archetype 3 now draws itself: the visible title, the `FormFooter`, and the field grid all come from the primitive,
and none of the three can be re-invented at a call site.

**The audit's three numbers were all a little wrong, and the corrections matter.**

- **"16 form routes" is 17 call sites.** `LeadConversionForm` is on `RecordFormLayout` too —
  it is a `/convert` route rather than a `/new` or `/[id]/edit` one, so a survey of the form
  routes did not count it. It gets the archetype with the others.
- **"78 hand-written field grids" is 61 app-wide** with the idiom as written
  (`grid gap-N (sm|md):grid-cols-2`), of which **26 are in 5.4's scope**. The rest are
  settings pages, dashboard widgets and dialogs, and belong to 5.6 and 5.7. All 26 moved.
- **"four `TextField`s" is five.** `OrganizationFormFields` defines `TextField` *and*
  `RequiredTextField` — the same component with a `RequiredMark` and a `FieldError` bolted
  on, which is the shared one's `required` and `error` props. All five are gone.

**What landed.**

- **`RecordFormLayout` takes `title`, `status` and `actions`; `footer` is gone.** Both the
  title and the footer were slots before, and both were then written by hand at every call
  site — the §4.4 failure again, where the rule exists and no primitive supplies it. There is
  now no slot to put an eighteenth footer recipe in.
- **`FormFooter` and `ActionBar` have their first consumers.** Measured at HEAD: both were
  imported by **nothing outside `components/ui/`** — `ActionBar` only by `button.tsx`, which
  reads its size context, and `FormFooter` by no one at all. They were built in 5.1 batch D
  and had been sitting correct and unused since. `SectionHeading` was in better shape at 9
  files, but not one of them was a form.
- **The sticky bar that covered 17 routes is deleted (R3).** Ten `sticky bottom-0` save bars
  were counted; this was one implementation standing behind seventeen of them, so the count
  is now **eight**, all in settings, saved views and automation — 5.6's and 5.5's.
- **`FormSection`'s heading goes through `SectionHeading`.** It was drawing
  `text-base font-semibold text-copy-primary`, which is the *pre-R7* section heading: one ink
  step **louder** than the values under it, and at a size R7 removed from the ramp. **66**
  headings corrected in one edit.
- **And 14 more that `FormSection` could not reach.** Seven form files hand-roll
  `Card` + `<h2 class="text-base|text-sm font-semibold text-copy-primary">` instead of using
  `FormSection` — `SupportCaseCreateFormPage` uses *no* `FormSection` at all. Fixing the
  primitive and leaving fourteen identical twins in the same seven files would have left two
  heading treatments side by side on one page, which is worse than the state before. The
  `Card` structure is untouched (it is already the right panel, §1.3); only the heading role
  moved. `SectionHeading` goes from 9 files to 17.
- **Three `text-base font-semibold` sites deliberately left**: the grand-total rows in the
  quote, order and POS line-item summaries. Those are *values*, not section headings, and the
  line-item documents are batch 5's.
- **`FieldGroup` gains `columns={1|2|3}`** — the responsive field grid as a variant rather
  than a second component, because `<FieldGroup className="grid gap-4 md:grid-cols-2">` was
  already being written 26 times. That class string *was* the missing variant, spelled out by
  hand. `3` is in the union because two form sections legitimately need it — a contract's
  effective/expiration/renewal dates, an insertion order's subtotal/tax/total — and §4.7 now
  names the constraint: three columns are for short values of the *same kind* and nothing
  else. Without it those two would have stayed `className` grids, which is the drift.
- **`components/forms/TextField.tsx` is the one labelled input**, replacing five private
  copies.

**One real accessibility defect, found by making `id` required.**

`LeadFormFields`' `TextField` took no `id`. It rendered a `FieldLabel` with no `htmlFor`
beside an `Input` with no `id` — so on the lead form, *First name*, *Last name*, *Company*,
*Job title*, *Phone* and *Source* had **no accessible name at all**, and clicking a label did
nothing. On screen it was indistinguishable from the other four copies, which is why nobody
saw it: the label is *there*, it is just not attached to anything. `check-design.sh` cannot
see it (it is an absent attribute, not a written class), and the rendered guards check
contrast and geometry rather than label association. §7.5 now says a label is *associated*,
not merely adjacent, and the shared `TextField` takes `id` as a required prop — which is the
only thing that stops the sixth copy being written.

The same pass added `aria-required` where `RequiredMark` is used. The mark is `aria-hidden`
by design — it is the visual half — so without the attribute the requirement reached sighted
operators only.

**And the scaffold was emitting the same defect.**
`docs/module-template/frontend/components/__modules__/__Module__Form.tsx` — what
`scripts/create-module.py` copies into every new module — wrote `<FieldLabel>Name</FieldLabel>`
beside a bare `<Input>`, with no `id` and no `htmlFor`, twice. So the fix would have held
exactly until the next module was scaffolded. It is on the shared `TextField` now, its
`Select` is wired by `htmlFor`/`id`, and its field grid is `columns={2}`. A rule that the
generator contradicts is not a rule.

**Two decisions, and the second is the one that recurs.**

- **The layout owns the title; the call site supplies the string.** `/[id]/edit` passes the
  record's name and `/new` passes the noun, because only the page knows which field is the
  name — `io_number` on an insertion order, `quote_number` on a quote, `first_name last_name`
  on a contact. What the layout owns is that there *is* one, at the R7 surface-title role, in
  the same position on all seventeen.
- **`FieldGroup columns={2}`, not a new `FieldGrid`.** §0's *reuse before extending, extend
  before adding*. A `FieldGrid` would have been a second container primitive for a container
  that already exists, differing only in `flex-col` vs `grid` — and the call sites were
  already reaching through `FieldGroup`'s `className` to get exactly that.

**Rejected, with reasons:**

- *Make `PageShell`'s `h1` visible on `variant="document"`.* §8 says the h1 is deliberately
  `sr-only` and archetype 2 draws its own name for the same reason. It would also have made
  the title visible on every document page, not the form ones.
- *Keep `footer` and let call sites pass `<FormFooter>`.* That is exactly the state
  `ActionBar` and `FormFooter` were already in: built, correct, imported by nobody. A slot a
  call site *may* fill correctly is a slot seventeen call sites filled seventeen ways.
- *Convert the two private `ToggleRow`s to `SettingsSwitchRow` here.* They are a boolean-row
  idiom and batch 4 owns the idioms. More to the point, `SettingsSwitchRow` renders a
  `role="group"` of two `aria-pressed` buttons and the catalog copy renders a `checkbox`, so
  it is a semantics change with spec consequences rather than a restyle. A §7.5 rule saying
  "a boolean field is `SettingsSwitchRow`" was **written and then removed from `design.md`
  in the same pass**, because a rule with no code behind it is exactly what §4.4 records
  going wrong.

**The guard.** `design-rules.spec.ts` gains three checks on every route that renders
`[data-slot="record-form-layout"]`: a visible `[data-slot="form-title"]`, a
`[data-slot="form-footer"]`, and no bottom-anchored `position: sticky` inside the form. All
17 routes are already on its audited route list. `data-slot` is the only DOM signal that says
*this came from the primitive* (§7.6) — a class selector cannot tell a rebuilt page from a
regressed one, which is the whole reason the sticky bar could be copied verbatim into
`MessageTemplateRecordFormPage` and nothing noticed. The aside is exempt by name: it is
`lg:sticky lg:top-6` by design, and R3 is about bars pinned to the viewport *floor*.

**One trap for the next run.** `getByRole("heading", { name })` is substring matching by
default, and a form route now has two headings — `PageShell`'s `sr-only` h1 (*Convert Browser
Fixture*) and the archetype's visible h2. The conversion form's title was written as
`Convert ${leadName}` first, which made both headings carry the same accessible name and
would have failed `leads-revamp:539` on strict mode. It is `leadName` now, which is also what
§4.7 actually says: the visible title is the record's **name**. Check the pair on any new
form route before assuming a heading assertion is safe.

**A second heading shape, recorded rather than changed.** On a document module the h1 already
carried the record's number before this batch, so `/dashboard/sales/quotes/4/edit` now reads
h1 *Edit SAMPLE-QT-0003*, h2 *SAMPLE-QT-0003* — the h2 is a **substring of the h1**, and a
future spec written as `getByRole("heading", { name: "SAMPLE-QT-0003" })` will match both.
The clean answer is to make the h1 the page (*Edit quote*) and leave the number to the h2, as
leads and contacts already do. Not done here: it is five existing spec assertions
(`contracts-revamp:209`, `insertion-orders-revamp:279`, `invoices-revamp:165`,
`quotes-revamp:123`, `catalog-revamp:300`) for a redundancy that is inaudible rather than
wrong, and none of those five currently breaks. It belongs with batch 4's copy idioms.

### The browser pass — driven through Playwright, and one apparent defect that was not one

The Chrome extension was connected this run, but `/auth/login` needs a password typed into a
field, which is not something to do from the agent side. So the pass ran the same way batch 2's
did: a throwaway spec against the real backend and real seeded data, deleted before the
commit, reading computed style and `document.activeElement` rather than trusting a screenshot.
Thirteen create routes plus three `/[id]/edit` routes — 16 renders — in both themes, at 1440
and 768.

| | |
|---|---|
| Visible title is an `h2` at the R7 surface role | ✓ `18px/600`, `rgb(244,247,251)` dark / `rgb(16,19,25)` light, on all 16 |
| `/new` draws the noun, `/[id]/edit` the record's name | ✓ *New lead* … *New invoice*; *Sample Lead 3*, *SAMPLE-QT-0003*, *Sample Service Agreement 3* |
| Footer is **not** sticky (R3) | ✓ `position: static` on every route, bottom at 908–2068px against a 900px viewport — it scrolls away with the document |
| Both footer buttons at one height (R4) | ✓ 38px / 38px on all 16 |
| Section headings are quieter than the values (R7) | ✓ `14px/600 rgb(153,164,180)` — `copy-label`, against a `copy-primary` value |
| `FieldGroup columns={2}` resolves to two columns | ✓ `333px 333px` in the content column, `442px 442px` on the wider line-item forms |
| 768px | ✓ still 2 columns (`md` *is* 768), `scrollWidth - clientWidth = 0` — no sideways overflow |
| Light theme | ✓ ground `rgb(247,248,250)`, title `rgb(16,19,25)`, heading `rgb(93,101,116)` — the R7 inversion holds in both weights |
| Every input on the lead form has an accessible name | ✓ all seven resolve by `getByRole("textbox", { name, exact: true })` — this failed before the batch |
| Tab from the first field to the commit | ✓ 22 stops, a visible focus indicator at **every** one, ending `Cancel` → `Create lead` |

**The tab-through is the check that only R3 makes possible.** The footer is now the last two
stops of the document rather than a bar floating over it, so the keyboard order and the visual
order are the same thing.

**The apparent defect: `/dashboard/sales/contacts/new` reported no `record-form-layout` at
all.** It looked like the one route the batch had broken. It was a **1600ms wait against a
dev-server route that had not finished hydrating** — at 6000ms the form is there, the title is
*New contact*, the footer is there, and the console is empty. Recorded because the first
reading was alarming and wrong, and because the same shape cost the design guard something
real:

**The design guard can silently audit 82 routes instead of 94, and nothing says so except one
log line.** `design-rules.spec.ts` discovers `/[id]` and `/[id]/edit` by finding a row link on
each list, and it waited a flat 1500ms before looking. Measured across four runs today on a
warm server: **82 routes / 5 unreachable**, then **90 / 2**, then **94 / 0** at HEAD. So it is
load-dependent rather than a standing condition — but when it bites, every record and edit
route behind the missed list is dropped from the audit and the run is still green. The five
that dropped are the largest lists: contacts, organizations, opportunities, POS, leads. It
waits for `tbody tr` now. **Read the `Audited N routes. Unreachable:` line before trusting a
pass** — a guard that quietly stops looking at a sixth of its routes is worse than one that
fails.

### Status: batch 4 — the stragglers and the idioms, committed as `3d86163`

**Read this first if you are picking the run up.** Batch 4 is done and committed as
`3d86163`. It is the **first batch under the revised cadence** (scoping decision 9): lint + build only, no guards, no specs, no
browser pass. Those run once, in batch 7, over everything batches 1–6 touched.

**What landed.**

- **`components/forms/FormErrorBanner.tsx`** — the `role="alert"` save-failure banner, which
  **12 form routes had hand-written identically** and two more did not have at all. `mail` and
  `insertion-orders` showed only a toast; both now set a persistent banner *and* keep the
  toast, and both clear it when the next attempt starts. A toast is the wrong instrument on
  its own — transient, not in the tab order, and usually gone before the operator has finished
  reading the field it was about.
- **One dirty string, 27 replacements.** `Unsaved changes` / `No unsaved changes`, no closing
  period, because it is a status label rather than a sentence. It replaced six spellings of
  the same fact: `You have unsaved changes.`, `No unsaved changes.`, `All changes saved`,
  `No changes to save.`, `Unsaved client page`, `Unsaved message`.
- **One ellipsis.** Five pending labels used three ASCII periods and twelve used `…`. The verb
  still varies by action — `Saving…`, `Creating…`, `Sending…`, `Recording…`, `Uploading…` —
  because the verb is information and the ellipsis is not.
- **`MessageTemplateRecordFormPage`'s sticky footer is gone.** It was a *verbatim copy* of
  `RecordFormLayout`'s class string, which is what a layout detail with no primitive behind it
  costs. It also coloured its dirty line `text-state-warning` / `text-state-success` — colour
  carrying state, which R5 retires. Unsaved work is the normal condition of an open form, not
  an exception.
- **`DocumentUploadFormPage` is on `FormFooter`** without becoming a `RecordFormLayout`: it is
  a batch upload queue, not a record, so it has no spine and no single title. It gets R4's one
  control height and nothing else. Its `aria-live` moved from the whole footer row onto the
  summary — otherwise every button appearing or disappearing was announced.
- **`insertion-orders` renders one Cancel.** The header's became `Back to insertion order`,
  matching the other fifteen.

**Deferred, with the reason, because it is not a copy idiom.** The two private `ToggleRow`s
were on this batch's row and are **moved to 5.6**. Measured: one boolean field is drawn three
ways — `LeadConversionForm` uses a Radix `Switch` (`role="switch"`), `CatalogRecordFormPage`
uses a `Checkbox` (`role="checkbox"`), and `SettingsSwitchRow` — the primitive that supposedly
owns the shape — is a `role="group"` of two `aria-pressed` buttons. `leads-revamp:651–655`
asserts `getByRole("switch", { name: "Create account" })` with `toBeChecked()`, which the
primitive's shape cannot satisfy. **Which role a boolean field carries is a design decision,
not a sweep**, and 5.6 owns `SettingsSwitchRow`'s own surface.

**Out of scope and staying that way:** the idiom sweep skipped
`ContractRecordFormPage` and `SupportCaseCreateFormPage` (scoping decision 8). They still
carry `You have unsaved changes.` and the hand-written banner, deliberately.

**Also left, and it is not the same idiom:** `RecordPaymentPage:146` is a `role="alert"` row
with a *Try again* button for a failed **load**, not a failed save. `FormErrorBanner` takes no
action slot, and a load failure inside a panel is `PanelStates`' job.

**Verification: lint and `npm run build`, both green — and that is the whole gate now.** The
sweep's one real defect was caught by lint rather than by a spec: the banner regex turned four
interpolated titles into `title={We could not {mode === "edit" ? …} this order.}`, which is
mixed text and JSX where a template literal was needed. Three of those files then needed the
import the other ten got automatically. Both classes of error are exactly what lint and the
compiler are for, which is the argument for the revised cadence.

### Verification — the failure sets were diffed, not argued about

Lint, `npm run build`, `check-design.sh` (2 of 14 — the known baseline, unchanged), both
rendered guards, and **18 module specs run serially twice**: once with the batch, once with it
stashed out, same spec list, same order, same flags.

| | With the batch | At HEAD |
|---|---|---|
| | **97 passed / 17 failed** | **95 passed / 19 failed** |

Diffing the two failure sets is the whole point of running it twice:

- **15 failed in both.** Inherited, and that now includes the four this run could not find on
  any list — `invoices-revamp:140` and `:175`, `client-portal-revamp:155`,
  `command-palette-actions:504`. The two invoice ones were the real scare: both assert
  `getByRole("heading", { name: "INV-BROWSER-1" })` on the POS *detail* page, which is
  archetype 2 and untouched here, and both fail without the batch.
- **4 failed only at HEAD** — `leads-revamp:441`, `:788`, `:954`, `orders-revamp:82`. Not
  fixed by the batch; the suite is simply noisy in a long serial run.
- **2 failed only with the batch** — `command-palette-actions:320` and `support-revamp:189`.
  Neither is on a surface this batch touches (`:320` visits two list pages and reads the
  palette's recent-pages store; `:189` is a 390px list). **Re-run twice in isolation:
  `support-revamp:189` passed both times, `:320` failed once and passed once.** In the same
  two isolation runs `command-palette-actions:196` and `:285` also flipped — that spec
  produced **three different failure sets across four runs**, which is what
  `e2e-suite-status.md` already suspected of it ("passes 19/19 standalone; suspect
  order-dependence or shared state"). **No reproducible regression.**

**Run-shape mistake worth not repeating:** the first module-spec run was thrown away because
`npm run build` was executed while it was in flight. The build writes `.next/` under the same
container the dev server is reading, so the run was measuring a tree that was changing
underneath it. Restart the frontend and re-warm before judging anything.

### What is left, in order

Each row is one batch, gated by lint + build + `check-design.sh` between them, one commit
each — the shape 5.2 and 5.3 used.

**Scope from here: contracts and support cases are out of the whole programme** (scoping
decision 8), and **verification is once at the end of 5.4, not per batch** (decision 9). Batches 4–6 run lint +
build and commit; batch 7 is the single verification-and-correction pass that closes the
sub-phase.

| # | Batch | Notes |
|---|---|---|
| ~~1~~ | ~~**`SearchableSelect`**~~ | **Done** — `0761061`, see the status above. The §7.8 primitive, `InlineFieldEdit` onto it, `TimezonePicker` collapsed into it |
| ~~2~~ | ~~**`Owner` → State, on all 8 record types**~~ | Editable inline, behind batch 1's primitive. Measured: the eight are contract, lead, contact, insertion order, order, account, deal, quote, and the column is `assigned_to` on five, `owner_id` on two, `user_id` on one. **It needs a backend line**: `/linked-record-options/users` requires `query` at `min_length=1` and caps `limit` at 20, so it can search users but cannot *list* them, and `SearchableSelect` holds its options in memory (§7.8). Relaxing that query is the slice's first commit. **Done** — `e62474e` + `853bc33`, see the status above. It was **nine**, not eight: support cases draw the same field as `Assignee`. The insertion order's update contract had no owner field at all and gained one |
| ~~3~~ | ~~**`RecordFormLayout`**~~ | **Done** — `b1a51dd`. The visible title, `ActionBar`/`FormFooter` adopted, the sticky footer deleted (R3), the hand-written field grids, the local `TextField`s. See the status above. It was **17** call sites (the convert form is on the archetype too), **26** in-scope field grids of 61 app-wide, and **five** private `TextField`s. `FormSection` also moved to `SectionHeading`, which was still pre-R7, and 14 hand-rolled twins moved with it. One real a11y defect found: six lead-form inputs had no accessible name |
| ~~4~~ | ~~**The stragglers and the idioms**~~ | **Done** — `3d86163`. `FormErrorBanner` (12 hand-written copies + 2 toast-only forms), one dirty string (27 replacements), one ellipsis (5 ASCII), both stragglers, one Cancel on insertion-orders. The two `ToggleRow`s moved to **5.6** — three ARIA roles for one boolean field is a design decision, not a sweep |
| ~~5~~ | ~~**The line-item documents**~~ | **Done** — `TransactionTotals` and three adopters, the invoice's missing `Total` row, the order's either-or `RequiredMark`s, the section names taken from the record layout, 18 unassociated labels. See the status below |
| ~~6~~ | ~~**A3 — one quick-create pattern, and the deals list**~~ | **Done** — `ac5b16c`. The shared layout/custom-field renderer owns the repeatable frame while four module renderers keep their domain rules; Lead joined the shared state machine; the deals list and its empty state open `OpportunityQuickCreate`; every in-scope form Owner uses `SearchableSelect`. Quick create on the nine modules that lack one stays with the crm-evolution roll |
| ~~7~~ | ~~**Close-out, and 5.4's only verification pass**~~ | **Done** — `ac5b16c`. Source guard at the two known failures, rendered guards green, 118 module tests swept and the in-scope correction set rerun, dark/light browser pass, all 74 census rows marked |

### Status: batch 5 — the line-item documents, committed as `cafa456`

**Read this first if you are picking the run up.** Batch 5 is done and committed. Cadence
unchanged from batch 4 (scoping decision 9): lint + `npm run build`, plus `check-design.sh`
because the batch retires a class-level rule. Both green; the design check is **2 of 14, the
known baseline, unchanged**. No guards, no specs, no browser pass — those are batch 7's.

**What the three documents actually had in common was one component written three times.**
`SummaryRow` — 15 lines, `flex items-center justify-between` over a `dt`/`dd` — was defined
in `QuoteRecordFormPage`, `OrderRecordFormPage` and `PosInvoiceRecordFormPage`, character for
character. It is `components/transactions/TransactionTotals.tsx` now, and **each of the three
things the primitive took ownership of was wrong in at least one copy**:

- **`text-base font-semibold text-copy-primary` on every grand total** — the 16px step §3.3
  removed from the ramp, and the same string batch 3 deleted from `FormSection`'s heading,
  arriving here as a *value* instead. Batch 3 saw all three and deferred them by name
  (*"those are values, not section headings, and the line-item documents are batch 5's"*),
  which was right about the role and did not make 16px legal. The ledger separates the
  resolved figure by **weight** (§3.4): same 14px, `font-semibold`, `tabular-nums`.
- **The minus sign was assembled at the call site**, three times, as
  `` `− ${formatTransactionMoney(...)}` `` — so the sign belonged to the sentence rather than
  to the row. The ledger takes a magnitude and a `negative` flag.
- **`formatTransactionMoney` is not the app's money renderer.** It passes
  `maximumFractionDigits: 2`, which is a no-op for USD and wrong for a zero-decimal currency
  (`¥209.00`). The ledger renders `Money`, which is 5.1's single formatter.

**The real find: the invoice ledger withheld a figure it had already computed.** It read
Subtotal → Discount → Tax → Paid → Balance, and **never drew `Total`** — although `totals.total`
is computed on every keystroke and `validate()` rejects `amount_paid > totals.total`. So the
operator typed a payment against a number the form knew, used to judge them, and would not
show. §7.9 says a control the backend cannot honour is not drawn; this is the same rule
pointed the other way, and it is now written into §4.7: **a row the ledger can compute is a
row the ledger renders.** Nothing could see it — the three ledgers were never side by side,
and each one looked internally consistent.

**The section names came from the record layout, not from taste.** All three titled the money
block *Review summary*; `record_layouts.py` has seeded that exact field set as **`Totals`**
since 5.3, and the operator moves between a record and its edit page constantly. Same for the
order's *Delivery and payment details* (delivery date, payment terms, delivery address),
which the record calls **`Fulfillment`** — the identical three fields. Where the form draws a
group the record has no name for, because a record splits it between its header, its rail and
its sections, the section is named after the document:

| | Quote | Order | Invoice |
|---|---|---|---|
| aside 1 | `Totals` | `Totals` | `Totals` |
| aside 2 | `Quote details` | `Order details` | `Pricing and tax` |
| aside 3 | `Ownership` | `Ownership` | `Payment` |
| aside 4 | | | `Invoice details` |
| aside 5 | | | `Print` |
| content | … `Terms and notes` | … `Fulfillment`, `Terms and notes` | … `Terms and notes` |

**The invoice's aside was a nine-field grab bag and is now four blocks.** *Delivery and
payment details* held the invoice's number, currency, two dates, two statuses, the payment
method, the print template and the accent colour — document identity, workflow state and
*print presentation* in one panel — while `amount_paid` sat in a different panel from
`payment_status`. Reconciling a part-paid invoice meant reading two panels to answer one
question. **The invoice has no `Ownership` block and that is correct**: batch 2 measured nine
record types with an owner and POS was not one of them. `finance_pos_invoices.user_id` exists,
but `pos_invoice_services.py:415` sets it to `current_user.id` at creation and neither the
create nor the update schema accepts it — it is the cashier who rang the sale, not an
assignable owner. Drawing a picker over it would be §7.9 exactly: a control the request layer
cannot carry.

**Two accessibility defects, and both are batch 3's rule catching up with its own files.**

- **The order form marked *Account* and *Contact* required, and validated `account || contact`
  against a backend that requires neither.** `SalesOrderCreateRequest` has both as
  `int | None = None` and nothing enforces one-of. So the mark was wrong twice: it claimed
  each field individually, and it claimed a backend constraint that does not exist —
  §4.7's *"required sets match the backend exactly"*. `RequiredMark` is `aria-hidden` (§8),
  so the actual rule reached sighted operators only. Both marks are gone, the requirement is
  one clause in the section's description, and the section-level `role="alert"` that already
  existed does the enforcing. The hand-rolled `<span id="order-customer-anchor" tabIndex={-1} />`
  and the `mt-3` that compensated for it went with them — the error focuses the Account field
  now, which it could not before because that field had no `id`.
- **18 labels were adjacent to their control and not associated with it** — six in each
  file, and every bare `<FieldLabel>` in the three is gone. Every
  `LinkedRecordPicker` and every `Select` in the three files rendered a bare
  `<FieldLabel>Account</FieldLabel>` beside a control with no `id` — so *Account*, *Contact*,
  *Deal*, *Owner*, *Currency*, *Status*, *Payment status* and *Print template* had **no
  accessible name at all** across the three documents, and clicking the label did nothing.
  §7.5 already says a label is associated, not merely adjacent; batch 3 wrote that rule after
  finding six such inputs on the lead form and made `TextField` take a required `id`. It
  could not reach these, because `LinkedRecordPicker` and `SelectTrigger` are not `TextField`
  — both already accepted `inputId` / `id`, and no call site here passed one.

**One vague error became three that name their fix.** The invoice's `pricingError` covered
discount, tax rate and amount paid with *"Discount, tax, or paid amount is outside the
allowed range."* — a message naming none of the three fields it fails, against §7.5's *name
the fix, not the failure*. It is `discountError` / `taxRateError` / `paidError` now, each
under its own field with `aria-invalid`, and `validate()` focuses the first one that failed.

**Spec updates, per the testing policy** (existing specs get updated where a rebuild moves
what they assert; no new coverage). `quotes-revamp:16`, `orders-revamp:18–19` and
`invoices-revamp:110–112` follow the renamed sections. `invoices-revamp:124` goes
`toBeVisible()` → `toHaveCount(2)`, because `$209.00` is now drawn as `Total` *and* as
`Balance` — the assertion is the evidence that the missing row is there. The order and quote
`toHaveCount(2)` assertions are untouched; their ledgers gained no rows.

**Scheduled here rather than done, both because 3-of-N is the drift this programme exists to
remove:**

- **Owner on a form is still `LinkedRecordPicker`, on 13 call sites → batch 6.** §7.8 says in
  as many words that *"a select reached through the rail and the identical select on
  `/[id]/edit` are one control, so forms render through this primitive too"*, and §4.7 says a
  field pointing at a user is state rather than a reference. The rail has been
  `RecordOwnerField` since batch 2, which deferred the form half to batch 3, which did not
  take it. It is 13 files — leads, contacts, accounts, deals, quotes, orders, contracts,
  support and the four quick-create layouts — and batch 6 is *"both create paths, all 15
  modules"*, which touches every one of them anyway.
- **`h1` ⊃ `h2` on the document modules** — `Edit SAMPLE-QT-0003` over `SAMPLE-QT-0003`.
  Batch 3 recorded it and pointed at five existing assertions; batch 4 did not take it. Three
  of the five are these documents and two are contracts / catalog / insertion-orders, so it
  is a document-module sweep, not a line-item one. **Batch 7**, with the other corrections.
- **Order and invoice have no custom fields and no `useModuleFieldConfigs` gating; the quote
  has both.** That is a product gap rather than a design one — the two forms would need the
  hooks, the payload picker and a `Custom fields` section — and it is not 5.4's to open.

### Scoping decision 10 — A3's rollout half belongs to the crm-evolution roll

**Decided by the owner 2026-08-20, before batch 6 was written.** A3 asked for both create
paths on all 15 modules. Measured, that splits cleanly in two, and only one half is a design
problem:

- **Quick create is layout-driven**, and `quick_create` is opened for exactly four modules —
  `sales_leads`, `sales_contacts`, `sales_organizations`, `sales_opportunities`
  (`record_layouts.py:41–44`). Six more in-scope modules already carry a system field catalog
  (`sales_quotes`, `sales_orders`, `finance_pos`, `finance_io`, `catalog_products`,
  `catalog_services`), so opening the surface for them is a seed plus a set-membership line.
  **Three carry no catalog at all** — custom modules, message templates, client-portal pages —
  and would need a second, frontend-declared mechanism.
- `CODEX-RUNBOOK.md` **already owns that rollout**: Wave 2A rolls Quick Create to Contact and
  Organization, Wave 2D to Opportunity, each "using the resolved layouts", each seeding a
  module's layout before rendering it. Building the same thing here would land it twice.

**So batch 6 keeps the pattern work and hands over the rollout.** What 5.4 owes the roll is
*one* quick create to roll, not nine hand-built ones — and today there are two:
`ContactQuickCreate`, `OrganizationQuickCreate` and `OpportunityQuickCreate` are on
`useQuickCreateRecord` + the `quickCreateLayout` helpers, while **`LeadQuickCreate` is on
neither** (199 lines of its own state machine, 285 lines of its own per-field `Field` frame) —
the pilot the pattern was proven on is the copy that never adopted it. That is 3-of-N drift
pointed at the exact surface the next roll will multiply.

**Next.** Batch 6 — the shared layout-driven quick-create field renderer, the four existing
quick creates collapsed onto it (Lead included), `OpportunityQuickCreate` wired into the deals
list to close A3's named defect, and the Owner-on-form sweep above (13 call sites minus
contracts and support, so **11**). Quick create for the nine modules without one is **not
5.4's** — it is the crm-evolution roll's, off the layouts this batch leaves behind.

### Status: batch 6 — the quick-create pattern and Owner on forms

**Batch 6 is done.** It followed the revised cadence: lint and `npm run build` are green;
`check-design.sh` remains at the documented two unrelated failures. Rendered guards, module
specs and the browser pass belong to batch 7, the sub-phase's single close-out.

**The shared renderer owns the repeatable frame, not the domain.** Two alternatives were
worked before implementation:

- A config-driven renderer mapping every system field key to a generic control was rejected.
  Contact selection fills its account, contextual Deal creation locks only the relationship
  it arrived with, and Lead owns teams and tags. Encoding those as generic modes would turn
  one renderer into the domain matrix §0 warns against.
- `LayoutDrivenQuickCreateFields` was chosen. It owns resolved-layout traversal, custom-field
  construction, locked/read-only state, ids, ARIA/error wiring and invalid-section opening.
  Each module still renders its system fields. The four private files lost their repeated
  layout and custom-field scaffolding without losing the rules that make them different.

**Lead is no longer the pilot that missed its own pattern.** `LeadQuickCreate` now uses
`useQuickCreateRecord`, the same layout/state/validation/submit state machine as Contact,
Account and Deal. The shared path now has four adopters, so the crm-evolution roll has one
quick-create pattern to extend rather than two.

**A3's named Deal defect is closed.** The Deals list's primary action and empty-state action
both open `OpportunityQuickCreate`; create permission gates both, focus returns to the
trigger, and the existing `/new` route remains behind *Full deal form*. The contextual Contact
and Account entry points still pass their locked relationship; the list passes no context.

**Owner is a value select everywhere in scope.** `OwnerSelect` is the form wrapper over
`SearchableSelect`, and its option builder is shared with `RecordOwnerField`: active tenant
users, `Unassigned`, the current deactivated/loading owner, email disambiguation and the
500-user cap disclosure are one implementation. `useUserOptions` keys and authorizes the
request by `create` / `edit`, so a form asks for the same permission as the write it serves.
The ten in-scope call sites are the four full CRM forms, their four quick-create renderers,
Quote and Order. The plan's **11** was a counting error: there are 12 total, and the other two
are exactly Contract and Support, both out of scope by decision 8. Insertion Order has a
read-only creator stamp, not an assignable form owner, so §4.7 correctly excludes it.

**Existing specs moved with the control.** Assertions that drove Owner as a server-search
text input now drive the `combobox` and select its in-memory option; the Deals list assertion
expects the new quick-create button. No new spec was added ahead of batch 7's one verification
pass.

**Next.** Batch 7 — 5.4 close-out and its single full verification/correction pass.

### Status: batch 7 — 5.4 close-out

**Batch 7 is done, and 5.4 is closed.** Final lint and the production build are green.
`check-design.sh` remains at the same two separately owned failures (`LynkSplash` in 5.9 and
`ClientPageCreateForm` in 5.8); no 5.4 file adds a source-rule failure. Both rendered guards
are green. The design audit now reaches **all 94 discovered routes with none unreachable**, and
the scroll-container guard passes.

**The one module sweep did its job as a correction pass, not as a claim that the inherited
suite is clean.** Across the 118 selected tests, 88 passed and 30 exposed the already tracked
responsive, portal, route-state and assertion debt. The affected correction set was rerun:
Lead Quick Create, Contact/Account/Deal contextual Quick Create, the shared surface at narrow
and full widths, and the Account, Contact, Lead, Deal, Quote and Order form workflows pass.
The Deals spec passes **3/3** on its supported viewport, including list Quick Create, pipeline
and record/edit. The remaining reduced-motion assertion observes Chromium's `0.00001s`
normalisation rather than a 5.4 behaviour regression.

**The browser pass covered the new surface in both themes.** Deal Quick Create was inspected
in light and dark mode with the layout-driven sections, required marks and Owner select
visible. The hierarchy and control states remain readable in both. Temporary visual fixtures
and screenshots were removed after inspection.

**The guard was corrected where it had been hiding coverage.** Pointer clicks can be consumed
by the known narrow-list overlay defect, so route discovery now retries keyboard activation
before declaring a link unreachable. That changed the audit from silently dropping whichever
record route lost the race to deterministically walking all 94 routes; it does not relax any
rendered rule.

**The census is fully marked.** The final denominator is **74 5.4 rows**, not the provisional
55: the earlier count omitted route shims, data helpers and the new shared `OwnerSelect` row.
Every row is now either done or explicitly out of scope under decision 8. The final diff adds
no backend, persistence, public-surface or delete behaviour; tenant user options stay behind
the existing tenant-scoped endpoint and create/edit permission action.

### Post-close review pass — three corrections, and one defect left open

**A read-through on 2026-08-20, after batch 7 closed, found three things in the Owner sweep.
All three are fixed; no test run accompanied the fix.**

- **`Unassigned` was asserting something untrue on create forms.** `SearchableSelect` resolves
  its trigger label by exact value match, and `UNASSIGNED_OWNER` is `""` — the same value an
  empty create form carries. So the `Unassigned` option always matched, the trigger drew
  `Unassigned`, and `OwnerSelect`'s own create placeholder was unreachable code. An owner left
  empty on create is the creator, not nobody. `OwnerSelect` now passes `renderValue`: the empty
  **create** state draws `Select owner (defaults to you)`, and only `edit` — where the value is
  a real saved state — draws `Unassigned`. The record spine is unchanged; `Unassigned` is
  correct there. `LeadFormFields` also gained the `FieldDescription` its three siblings already
  had.
- **A failed user list left an inert box.** `disabled={disabled || isLoading || isError}` went
  quiet with nothing to explain it, where the old picker at least stayed typeable. The control
  still disables — there is no list to offer — but `OwnerSelect` now renders the reason beneath
  it, worded for the action: create says the record will be assigned to you, edit says the owner
  cannot be changed right now. It carries `data-slot="owner-load-error"` rather than
  `field-error`, so it is not picked up by the specs' single-element `field-error` locator.
- **The resolved layout's own `placeholder` was being dropped for owner fields.** The contact
  quick create used to pass `field.placeholder ?? …`; `OwnerSelect` hardcoded its own. It now
  takes an optional `placeholder` and all four quick-create renderers pass `field.placeholder`,
  so a tenant-configured placeholder survives.

**~~Open — the narrow-list overlay defect is still unidentified.~~ Closed 2026-08-20 in 5.5's
close-out, and it was not what this paragraph said it was.** The original note read: *"That is
a real interaction defect on a real list — a row that cannot be clicked open — hiding behind a
green guard."* It is neither an overlay nor a defect, and the correction is kept here rather
than deleted because the wrong version would have sent someone hunting for a phantom element.

**What was actually measured.** A probe walked every module list at 1440, 1280, 1024, 900 and
768. **At 1440 — the viewport `design-rules.spec.ts` actually runs at — nothing is intercepted
on any list.** Two lists intercept at 768, and the geometry says why. On
`/dashboard/documents` the scroll region is `l:264 → r:744` (`clientWidth 478 /
scrollWidth 1047`, `scrollLeft 0`) while the row's second cell is `l:707 → r:787`. The cell
**extends past its scroll container's clip**, so its geometric centre lands at `cx 747` —
three pixels beyond the container — and `elementFromPoint` there returns the dashboard's own
content scroller (`app/dashboard/layout.tsx:155`, `relative z-30`), which is the row's
*ancestor*, not something drawn over it. `/dashboard/tasks` is the same class: the centre
falls outside the viewport entirely.

**So nothing is drawing over the rows.** A synthetic click computed from a bounding rect
lands on a clipped point; a person clicking a visible part of the row opens it normally.
There is no product bug and nothing to fix — Lynk's tables scroll sideways at narrow widths
by design (§4.5).

**The keyboard retry in the guard stays**, on its own merits rather than as a workaround: a
`RecordTable` row promises Enter as an open gesture, so exercising that contract is worth
doing, and it keeps route discovery independent of cell geometry. What changes is the
comment's claim about *why*.

**The trap worth keeping.** "Playwright says the click was intercepted" reads as *something is
covering the element*. It can equally mean *the element's centre is not where you can click
it* — which is the normal state of any cell in a horizontally scrolled table. Check the
geometry before looking for an overlay.

---

## 5.5 — One table, and the list workflow

### Every table, and where it goes

24 files are on `RecordTable`. **18 are still on raw `Table`.** All 18 move — **except
`ContractsTable.tsx` and `SupportCasesTable.tsx`, which are out of scope for the whole
programme** (scoping decision 8), so **16 move**. `contracts/page.tsx` and
`support/cases/page.tsx` drop out of 5.5's list-workflow sweep for the same reason. The variant
set is decided in 5.0, so this is execution rather than discovery.

**Move to `RecordTable` as-is — lists wearing a different coat (11).** *Corrected below:
these eleven, and `reports/page.tsx`, are owned by 5.6 and 5.7 and move when their pages
are rebuilt. Read "What the measurement says now" before acting on this list.*

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

**One defect found and measured in 5.3 close-out, handed here rather than fixed there.**
`RecordTable` lays its **empty state out across the table's `scrollWidth`, not its visible
width** — so wherever the table is narrower than its own columns, the empty state renders
off-centre and clips at the scroller's edge. Measured on the contact record's Files tab: the
region is `clientWidth 580 / scrollWidth 920`, and the empty state is an 888px box starting
at `left: 662`, running well past the visible right edge. It has been there since batch 1 and
was invisible for two reasons — `/dashboard/documents` is `1280 / 1280`, so it never shows on
a full-width list, and the record panels' empty copy was short enough to look merely
off-centre rather than cut. **`scroll-containers.spec.ts` passes on it**, correctly: the
region *is* a scroll container and the page does not scroll sideways. The bug is the empty
state participating in the scroll width at all.

It is not fixed in 5.3 because the fix is in `RecordTable` and lands on every list in the
app — the same reasoning batch 6 used to leave archetype 3's two defects to 5.4. The likely
shape is rendering the empty state outside the overflow container, or `position: sticky;
left: 0` at the visible width. `RecordDocumentsPanel`'s empty copy is kept short so it reads
correctly either way.

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

### What the measurement says now — re-measured 2026-08-20, at the start of the sub-phase

The brief above was written in 5.0. Three of its numbers have moved, and one of them
changes what gets built.

- **18 files import `components/ui/Table` outside the three primitives — and only four of
  them are 5.5's.** Neither out-of-scope table is among the 18: `ContractsTable` and
  `SupportCasesTable` reached `RecordTable` before decision 8 was taken, so the "18 raw,
  16 move" arithmetic is stale in the harmless direction. What is *not* harmless is the
  ownership. **The census assigns every one of the twelve settings, automation,
  integration, reports and dashboard tables to 5.6 or 5.7**, and `settings/modules/
  [moduleId]` already carries the precedent in writing — 5.4 took its tab strip and left
  the row reading *"the raw `Table` stays 5.6's"*.

  **That is the ruling, and 5.0's list is corrected by it.** The census rule is that the
  owner is the sub-phase which *rebuilds* the file, and 5.6 rebuilds all 23 settings pages
  while 5.7 rebuilds reports and the dashboard. Swapping those tables here and rebuilding
  the pages around them one sub-phase later is the same file done twice, which is exactly
  the cost decision 9 was taken to stop paying. **So 5.5 owns the table *primitive* and
  the list *workflow*; each of the twelve moves when its own page is rebuilt**, and their
  census rows keep their existing owner.

  The consequence to carry forward: **R10's "only three files may import `Table`" becomes
  true at the end of 5.7, not 5.5.** The source-level check that enforces it is 5.10's
  either way, so nothing is lost — but a run reading R10 at the end of 5.5 and finding
  twelve importers should read this paragraph, not open a defect.

  What is left here is four files: `TransactionLineItemsEditor` and the three record
  line-item tables.

- **`variant="lineItems"` has one editable consumer, not five.** The three form pages
  share `TransactionLineItemsEditor` already — 5.4 batch 5 hoisted their totals and left
  the grid. The three *record* line-item tables (quote, order, POS invoice) are
  **read-only**: they render `item.line_total`, carry no inputs and no add-row. They are
  `readOnly`, the same variant the two portal tables take. R10's consumer column is
  corrected below; **the variant set itself does not change** — it is still three.
- **`density` is not a prop on `RecordTable` and must not become one.** R10 listed it
  beside `selectable` and `rowActions`. It is already an app-wide preference:
  `useTableDensity` feeds a context inside `Table`, which picks the cell padding. It is
  satisfied one level below `RecordTable` and stays there.

**R10, corrected:**

| Variant | Shape | Consumers, measured |
|---|---|---|
| `default` | selection, sort, row-open, pagination | the 24 module lists + the 12 settings / automation / integration / reports lists that move here |
| `lineItems` | editable rows, add and remove row, Enter walks the column; no selection, no sort, no pagination | **1** — `TransactionLineItemsEditor`, behind the quote, order and POS invoice form pages |
| `readOnly` | no selection, no sort, no row-open | **5** — the quote / order / invoice record line-item tables, plus the two portal tables (5.8) |

### The design decision — the address bar holds the draft saved view

The table half of this sub-phase is mechanical. The workflow half is not, and it does not
survive being done sixteen times.

**What the measurement shows.** `app/dashboard/sales/leads/page.tsx` is 158 lines, and
about ninety of them are a composition every list repeats verbatim: `useModuleCustomFields`
→ `useModuleFieldConfigs` → `buildModuleViewDefinition` → `useSavedViews` →
`resolveVisibleColumns` → `resolveSavedViewFilters` → a hand-rolled sort mapping → a
hand-rolled selection pair → toolbar → inline filters → table → `Pagination`. **That
repetition is why A1, A2 and A5 are the shape they are.** A1 is 15 of 16 because no owner
holds the state; A2 is 1 of 16 because `ColumnPicker` writes into `draftConfig`, and a
draft that only exists in React state has nowhere to go except a saved view the operator
did not want; A5 is 14 of 14 because there is no single place a keystroke passes through.
Three appendix items, one missing owner.

**The decision: the URL is the draft saved view.** Lynk already has a canonical shape for
list state — `SavedViewConfig`: `visible_columns`, `filters`, `sort` — and a server-side
place to persist it. What it lacks is the *unsaved* copy. So the address bar holds exactly
that object, one serializer, every list:

```
/dashboard/sales/leads?view=12&q=acme&sort=-updated_at&cols=name,status,owner&page=4
```

`view` names what the draft started from; everything after it is the divergence.
"Save view" stops being a way to keep your filters and becomes what it says — a promotion
of the state already in the address bar. Back from a record lands on page 4 of the
filtered list because the list state *is* the address, not because a page remembered it.

**Why this and not the two cheaper answers:**

- **Per-page `useSearchParams` wiring.** Sixteen pages read and write their own params.
  Cheapest per page, and it rebuilds the exact drift this sub-phase exists to delete —
  sixteen param vocabularies, `?search=` on one list and `?q=` on the next, and A2 still
  unanswered because the columns are still not in an address.
- **`sessionStorage`, or Next's history state, restored on back.** Fixes the back-button
  symptom and nothing else. The list still cannot be sent to a colleague, `ColumnPicker`
  still has nowhere to write, and state silently resurrecting on a *fresh* open is a worse
  default than page 1.

**Calibration.** *Would I have produced this for any CRM?* Putting filters in the query
string, yes — that is ordinary. What is Lynk's is that the serialized object is not a bag
of query params invented for the address bar: it is `SavedViewConfig`, the same type the
saved-view API already stores, so there is one vocabulary and the URL and the server are
two destinations for one shape. That only works because saved views were built first.

**Where it lives.** `lib/savedViewQuery.ts` already serializes a `SavedViewFilters` into
`URLSearchParams` for the *request*. The address-bar codec is its sibling in the same file,
and `useSavedViews` gains the URL as its state backing rather than each page gaining a
`useSearchParams`.

### What is left, in order

Cadence is decision 9: per batch, `npm run lint` + `npm run build`, one commit, one
`Status` block. `check-design.sh`, both rendered guards, the module specs and the browser
pass run once, in the close-out batch — which for 5.5 also carries **the first of the
programme's two full-suite runs**.

| # | Batch | Notes |
|---|---|---|
| ~~1~~ | ~~**`RecordTable`'s two variants, and the empty-state defect**~~ | **Done** — `7cb268e`. `lineItems` and `readOnly` as `cva` variants; the 5.3 close-out finding that the empty state is laid out across `scrollWidth`; `TransactionLineItemsEditor` and the three record line-item tables adopt them. Four raw-`Table` files leave, which is all of 5.5's four |
| ~~2~~ | ~~**The codec, and A1 + A5 in the hook**~~ | **Done** — `ed41566`. The address-bar codec beside `appendSavedViewFilterParams`, `useListAddress` as the single writer, `useSavedViews` and `usePagedList` backed by the URL, the debounce in one place. It landed on all sixteen lists with no page edited: A1 was never at the call site |
| ~~3~~ | ~~**A2, and the search-pending state**~~ | **Done** — `a63091e`. `ColumnPicker` into the toolbar archetype 1 already draws it in and one page already wires it; `isSearchPending` into the toolbar's refreshing state. Minus `contracts` and `support/cases` (decision 8) |
| ~~4~~ | ~~**A6 and A7 — the selections with no verb**~~ | **Done** — `8f6fa20`. POS's selection deleted, payments' selection deleted and its apologetic sentence with it, the header button demoted out of the primary slot |
| ~~5~~ | ~~**The documents straggler**~~ | **Done** — `f36283d`. The toolbar, real pagination, and the backend param it needed |
| ~~6~~ | ~~**The client-portal straggler**~~ | **Done** — `f77a968`. Two page-local tables extracted, both `shellVariant="nested"`, the page 456 → 330 lines |
| ~~7~~ | ~~**Close-out**~~ | **Done** — `8577c87`. Source guard at the known 2 of 14, both rendered guards green at 94/94 routes, the full suite (236/64) with a pre-5.5 baseline proving **zero regressions on every touched surface**, the documents module tests, and all 55 census rows marked. See the status block below |

### Status: batch 1 — the two variants, and the empty state that was never centred

**Read this first if you are picking the run up.** Batch 1 is done. Cadence is decision 9:
`npm run lint` and `npm run build`, both green, nothing else. `check-design.sh` was run at
the *start* of the sub-phase as the policy requires and is at **2 of 14, the known
baseline** (`LynkSplash` 5.9, `ClientPageCreateForm` 5.8). The rendered guards, the specs
and the browser pass are batch 5's.

**The load-bearing question of 5.5 was answered, and the answer was not the one the census
predicted.** R10 asked whether `RecordTable` could carry an editable row without
contorting, and required the finding to be written down and taken to the owner if it could
not. It can, and it needed **one `cva` variant and no new structure**: `lineItems` is
`px-2 py-2` on the cell, no selection column, no sort affordance, no row-open gesture. The
Enter-walks-the-column behaviour that makes the grid usable was always call-site logic
inside the cell renderers, and it stays there — `RecordTable` never needed to know about
it. No second table, no exemption, nothing to escalate.

**What the census got wrong was the count, not the design.** It listed five `lineItems`
consumers: three form pages, `TransactionLineItemsEditor`, and the three record pages. In
fact the three form pages *are* `TransactionLineItemsEditor` — 5.4 batch 5 shared it — so
there is exactly **one** editable grid in the app. And the three record line-item tables
are **read-only**: they render `item.line_total`, hold no inputs and have no add-row. They
are `readOnly`, the same variant the two portal tables take in 5.8. So the variant set is
unchanged at three, and its consumer split is 1 editable / 5 read-only.

**The three record tables were one component written three times** — the `SummaryRow` story
from 5.4 batch 5, one level up. Quote and order were character-identical at six columns;
POS is the same table at four. They are
`components/transactions/TransactionLineItemsTable.tsx` now, and each page's copy went from
~40 lines of hand-assembled `thead`/`tbody` to one element. Three hand-rolled
`overflow-x-auto` wrappers went with them: `ModuleTableShell` is the scroll region, and
`shellVariant="nested"` stops it drawing a second panel edge inside the `Card`'s (§4.5).
Two local `money()` closures and their `EMPTY_CELL_VALUE` imports went too — `Money` is the
primitive and it already spells the empty cell.

**The empty-state defect is fixed, and the fix moved three states, not one.** 5.3 close-out
measured it on the contact record's Files tab: `clientWidth 580 / scrollWidth 920`, an
888px empty state starting at `left: 662`. The cause is that a `td colSpan` is laid out
across the table's derived `min-width`, so any table wider than the region it scrolls
inside pushes its own empty state out of view. Permission-denied, error and empty now
render as a **block sibling of the table inside the shell**, which takes the scroll
container's *content* width — the visible one — with `sticky left-0` holding it at the
visible left edge while the columns scroll under it. It carries
`data-slot="record-table-state"`, so 5.10 has something to assert on.

**Loading deliberately stayed inside the table.** Skeleton rows are column-shaped and
*should* span the columns they stand in for; they were never the bug. What changed is that
`renderBody` now returns `null` whenever a state is showing, so the header row survives and
the box appears under it rather than inside it.

**Two smaller decisions, recorded because they are contracts now:**

- **The variant is enforced, not advisory.** A `readOnly` table handed a `selection` draws
  no checkboxes; sort heads only appear on `default`. The wrong variant is visible
  immediately instead of shipping as a subtle difference.
- **`emptyState` is a discriminated union, not an optional prop.** §7.4 makes the empty
  state mandatory precisely because every page that *could* omit it did. `lineItems` may
  omit it — a form's grid never empties, it has a minimum of one row — and the two list
  variants still cannot.

**Row hover is now variant-aware.** `TableRow` always lit up under the pointer. On a
`readOnly` or `lineItems` row that is an affordance pointing at nothing, so both are
`quiet`.

**Also removed:** the public props no longer intersect the row `cva`. `interactive`,
`highlighted` and `quiet` are computed from `variant` and the gesture props, and a call
site that could pass `highlighted` would be styling a row without telling the table why.
No call site was using them.

**Batch 5 must verify in the browser**, because this batch's headline fix is invisible to
every assertion the repo has — §5 of the design skill records the sticky column that passed
lint, typecheck, build, both guards and 99 specs with a real bug in the tree. The specific
check: open a `RecordTable` narrower than its own columns with no rows — the contact
record's Files tab is the measured case — and confirm the empty state is centred in the
*visible* region and stays there when the columns are scrolled sideways.

**Next.** Batch 2 — the address-bar codec, and A1 + A5 inside `useSavedViews`, proven on
two lists.

### Status: batch 2 — the address bar, and the two hooks that never needed sixteen call sites

**Read this first if you are picking the run up.** Batch 2 is done. Lint and build green;
cadence unchanged (decision 9).

**The plan said "proven on two lists". It is on all sixteen, and that is not scope creep —
it is where the code turned out to live.** Every list page reads its state from
`useSavedViews` and its paging from a module hook that re-exports `usePagedList`'s
controls. Nothing about A1 is at the call site. So backing those two hooks with the URL
gives every list addressable state with **no page edited at all**, and the batch that was
going to be "the roll" has almost nothing left to roll.

**The three params each hook owns.** `useSavedViews` writes `view`, `search`,
`filters_all`, `filters_any`, `sort` and `cols`; `usePagedList` writes `page` and
`page_size`. The filter three are spelled exactly as `appendSavedViewFilterParams` spells
them for the API, because two names for one thing is the drift this sub-phase exists to
delete — the address and the request speak one vocabulary, which is the whole point of
serializing `SavedViewConfig` rather than inventing query params.

**Two hooks, one query string, and the race that would have followed.** If each hook held
its own copy of the params, the later `router.replace` in a tick would drop the earlier
one's write. `hooks/useListAddress.ts` is the single owner: neither hook touches the
router, both call `updateAddress`, and it reads `window.location.search` **at call time**
rather than from a captured render before applying the mutation. Concurrent writers
commute. It is `replace`, never `push`, so typing does not fill the back stack, and
`scroll: false` so the row being read does not jump.

**The mount problem, and the shape of the answer.** A list must not rewrite its own URL on
mount: the state was just read *from* the address, and a write in the same pass replaces a
shared link's state with the defaults. Both hooks solve it the same way — the first pass
**adopts** the signature it computed instead of writing it. There is no `isReady` flag and
no mount effect; the first comparison is simply against `null` and returns early. The
earlier draft used a `useState` + effect for this and tripped
`react-hooks/set-state-in-effect`, correctly: it was a lifecycle flag pretending to be
state.

**Only divergence is written.** A list on its default view at page 1 has a clean URL. A
param appears when, and only when, the operator moved away from what the selected view
says — which is what makes **"Save view" visibly the promotion of the address**, and what
keeps a shared link readable.

**Reading is layered, not replacing.** An absent param means "whatever the view says", not
"empty", so `?search=acme` on a list narrows the current view instead of blanking its
columns and sort. The address is applied to the **first** view that resolves and never
again: switching views afterwards must show that view, not re-apply a URL the operator has
moved on from.

**A5 went into `usePagedList`, not `SearchBar`, and only the search string waits.** The
census predicted `SearchBar` would be rebuilt for the debounce. That would have been the
wrong place: the input must stay instant, and a control that debounced its own value makes
the *field* feel behind the typing. What waits is the query. So `usePagedList` holds a
debounced copy of `filters.search` — 300ms — and passes everything else through as it
arrives, because a filter chip is a deliberate single action and delaying it reads as lag
rather than as batching. `SearchBar` is unchanged.

`isSearchPending` is exposed and **not yet consumed** — during the debounce window
`isFetching` is false, so a list looks idle while the operator types. Wiring it into the
toolbar's refreshing state is batch 3's, and it is the one loose end this batch leaves.

**One opt-out, and it is the right one.** `useSavedViews(…, address)` and
`usePagedList({ address })` default on. `app/dashboard/views/[moduleKey]` passes `false`:
it is the saved-view **editor**, not a list, it already has its own deep link (`?viewId=`),
and an in-progress column edit there is a draft of the view being written rather than the
state of a list anyone would share. All sixteen real lists are the route's subject and
need no flag.

**Two vocabulary clashes found, neither of them live.** `settings/automation` uses
`?view=runs|rules` for a workspace switch — it does not call `useSavedViews`, so nothing
collides today, but the word means "saved view id" everywhere else and that page is 5.6's
to reconcile. `documents` already reads `?search=`, which is the key this codec chose, so
the straggler in batch 4 converges rather than conflicts.

**Contracts and support inherited this without being opened** (decision 8). Both call
`useSavedViews`, so both get addressable state from the hook. That is not a sweep touching
them — no file under either path was read or edited — and it is the correct outcome either
way, since the change cannot be withheld from one caller of a shared hook.

**Next.** Batch 3 — A2 (`ColumnPicker` into the toolbar, wired on 1 of 16 today) and the
`isSearchPending` wiring. Much smaller than planned, for the reason at the top of this
block.

### Status: batch 3 — A2, and the reason it was stuck at one page

**Read this first if you are picking the run up.** Batch 3 is done. Lint and build green.

**`ColumnPicker` was not missing — it was unplaceable.** It has existed since Phase 3 and
reached exactly one page, `custom/[moduleKey]`, where it sits in `actionControls` as a
nine-line block next to the import/export controls. That is the whole of A2: not a control
that needed building, but a control with no home, so hiding a column cost six clicks
through the saved-view editor and left the operator owning a view they did not ask for.

**It belongs to the toolbar, and archetype 1 already said so.** The §4.7 wireframe draws
`[search] [view ▾] [filters ②] [columns]` and has since 5.0. So `ModuleListToolbar` owns
it now, in the filter group, and a page contributes three props instead of assembling a
block: `columnOptions`, `visibleColumns`, `onVisibleColumnsChange`. Eleven lists gained it,
and `custom/[moduleKey]`'s hand-placed copy moved into the slot — the picker is drawn in
the same place on every list for the first time.

It draws only when there is something to pick (§7.9): a list whose view definition has not
resolved yet gets no dead control rather than an empty popover.

**A2 only became safe to do *after* batch 2, which is why it is here and not earlier.** The
appendix's complaint was that hiding a column "leaves you owning a saved view you did not
want" — true while the only durable place to put a column choice was a saved view. Now the
choice goes into `cols` in the address: it survives the trip to a record and back, it can
be sent to a colleague, and it is discarded by closing the tab. The saved view is what you
get when you *ask* for one.

**`isSearchPending` is consumed, and the loose end batch 2 left is closed.** `usePagedList`
now folds the debounce window into `isFetching`, so all sixteen lists show the shell's
"Refreshing" marker while a typed search is still settling. Without it the list looked
frozen for 300ms after every keystroke — nothing in flight, so the marker was off while the
operator could plainly see the rows did not match what they had typed. The strict
react-query flag is still available on the returned `query` for anything that needs it.

**Two lists were deliberately not touched.** `settings/users` draws its toolbar through
`components/users/userFilters.tsx`, which has its own filter-value shape rather than a
`SavedViewConfig` draft — it is 5.6's, with the rest of settings, under the same ruling
batch 1 recorded. `documents` and `client-portal` have no toolbar at all yet; they are
batch 4's stragglers and get the picker when they get the toolbar.

**Next.** Batch 4 — A6 (POS's selection with no verb, payments' 3-row answer), A7
(payments' header button is the slower path), and the two migration stragglers.

### Status: batch 4 — two selections deleted, and a primary action demoted

**Read this first if you are picking the run up.** Batch 4 is done. Lint and build green.
The two stragglers moved to batch 5 — they are a page rebuild each, not an appendix fix,
and pairing them with A6/A7 made one batch out of two unrelated jobs.

**A6 on POS: the selection was deleted, not given a verb.** POS shipped per-row checkboxes,
select-all and a "3 invoices selected" bar, and **nothing consumed any of it** — no bulk
action, no export-selected, no import/export controls on the page at all. §7.9 already
says a control the backend cannot honour is not drawn; a selection with no verb is the same
rule one level up. Giving it a verb would mean inventing a bulk operation to justify a
control, which is the tail wagging the dog.

**A6 on payments: the same deletion, and it removed a sentence that was apologising for the
interface.** Payments answered a three-row selection with *"Select one invoice to record a
payment"* — a line of copy explaining why what you just did was wrong. The reason it
existed is that payments' only verb is single-record, and `PaymentsTable` **already has it
as a row action**. So the selection was a second, worse path to a button already on every
row, and the sentence was the seam showing. Both are gone.

**A7: the header button kept its place and lost its fill.** From the payments list the fast
path is the row's own `Record payment` against an invoice already on screen; the standalone
page at `/payments/record` makes you search for the invoice you were just looking at. That
path is not wrong — it is the one that works when the invoice is not in the current view —
but it was wearing the primary fill, which is the interface saying *this is the thing you
came here to do*. It is an outline control beside `Open invoices` now, **under the same
name**, because an action keeps its name for the whole flow (§7.4). The payments list has
no primary action at all any more, and that is the correct answer for a list whose verbs
are per row (§2.2, R4).

**Nothing referenced the removed UI** — no spec, no other component. Checked before
deleting rather than after.

**Next.** Batch 5 — the two migration stragglers: `documents` has no toolbar and no
pagination, and `client-portal/page.tsx` calls `RecordTable` inline twice with no module
table component.

### Status: batch 5 — documents, and the pagination that needed a backend line

**Read this first if you are picking the run up.** Batch 5 is done. Lint and build green,
plus the backend checks the change earned: `compileall`, `verify_openapi` (357 paths, 469
schemas), the documents module tests (46, all passing, one new), and the generated-contract
drift check. The client-portal straggler moved to batch 6 — see the note at the end.

**"No pagination" was not a missing control, it was missing data.** `documents/page.tsx`
asked for `limit: 100` and drew whatever came back. A tenant with more than a hundred
documents had documents **it could not reach from its own library** — not a slow list, an
unreachable one. `GET /documents` took a `limit` and no offset, so no amount of frontend
work could have fixed it.

**The backend change is one parameter and the shared envelope.** `list_documents` takes an
`offset` (repository and service), and the route takes `page` / `page_size` and returns
`build_paged_response(...)` — the same `app/core/pagination.py` envelope every other list
route returns, so `usePagedList` consumes it with no special casing.

Two compatibility decisions, both deliberate:

- **`limit` stays**, as the alias `page_size` falls back to. The same route serves the
  record panels and the mail composer, which ask for one window of 25 and do not page. The
  skill's rule is to preserve existing offset list routes, and inventing a second concept
  for those callers would have been the drift, not the fix.
- **`total` stays beside the envelope's `total_count`**, for the same two callers. The
  envelope fields are optional on `DocumentListResponse`, so a paged list is an *addition*
  to this route rather than a replacement of it.

**Then documents became an ordinary list.** It goes through `usePagedList` now, which means
it inherits batch 2's work without asking: page and page size in the address, the search
debounce, the refreshing marker. The hand-built header row — an `h2`, a description, a
`Select`, a bare `SearchBar` and the upload button in a three-column grid — was the toolbar
written again by hand, and it is `ModuleListToolbar` now. `PageShell` takes
`variant="list"`, so the rows are the only scroller like everywhere else.

**No filter group and no column picker on this one, on purpose.** Documents has no
saved-view definition, so neither control has anything to offer, and §7.9 says a control
with nothing behind it is not drawn. The type filter (`All documents` / `Templates` /
`Non-templates`) sits in `viewControls`, which is where a list's own scope switcher goes.

**Its draft still travels in one vocabulary.** With no saved views, documents' draft is two
fields, and both go through `useListAddress` — `search` under the same key every other list
writes, and the type filter under `type`. The page already read `?search=` and never wrote
it; it writes it now, so the address behaves the same way it does on a saved-view list.

**The one thing to watch at close-out.** `variant="list"` puts the three storage cards and
the storage-unavailable banner inside a full-height flex column above a `flex-1` table.
That is the archetype's intent and the same shape every other list uses, but documents is
the only list with fixed content above the toolbar, so the browser pass should confirm the
cards are not squeezed and the table still gets the remaining height.

**Next.** Batch 6 — `client-portal/page.tsx`, the last straggler: two inline `RecordTable`
calls and no module table component.

### Status: batch 6 — the last straggler, and a border nobody had noticed

**Read this first if you are picking the run up.** Batch 6 is done. Lint and build green.

**Two page-local tables, which §7.1 names as a review failure outright.** `client-portal/
page.tsx` held roughly two hundred lines of column definitions across two inline
`RecordTable` calls, and none of it was page state. They are
`components/client-portal/ClientPagesTable.tsx` and `ClientAccountsTable.tsx` now, and the
page went **456 → 330 lines**. The programme's own rule is the stricter one: a sub-phase
that ends with a shared shape still living in a page file has not ended.

**The extraction found a real defect.** Neither inline table passed `shellVariant="nested"`,
so both drew a second panel edge one pixel inside the `Card` they sit in. That is the exact
divergence `ModuleTableShell`'s `nested` variant exists to absorb, and it was invisible
because nobody had put the two borders side by side. Both pass it now.

**The two hand-written `<h2 className="text-base font-semibold">` are `SectionHeading`.**
They were the pre-R7 heading — one step *louder* than the values under them — and they also
carried title case, so `Shared Pages` and `Client Accounts` became `Shared pages` and
`Client accounts` (§3.5). The pages heading's description moved into `SectionHeading`'s own
`description` slot rather than staying a `FieldDescription` beside it.

**`statusTone` and `actionLabel` moved verbatim.** The first draft of the extraction quietly
rewrote both — a three-tone `statusTone` and a `formatSnakeCaseLabel` action label — which
would have changed what the page renders under cover of a refactor. They are the originals,
copied, with a comment saying so. Worth recording as the trap: an extraction that restates a
rule instead of moving it is a behaviour change wearing a refactor's clothes.

**Next.** Batch 7 — close-out: `check-design.sh`, both rendered guards, **the full suite —
the first of the programme's two**, the module specs for everything 5.5 touched, the browser
pass in both themes at 1280 and 768, and every 5.5 census row marked.

### Status: batch 7 — close-out, and a suite run that proved a negative

**Read this first if you are picking the run up.** The verification pass is done and 5.5's
correction commits have landed. **The browser pass is the one item still outstanding** — see
the end of this block.

**What ran.**

| Check | Result |
|---|---|
| `check-design.sh` | **2 of 14**, the known baseline — `LynkSplash` (5.9) and `ClientPageCreateForm` (5.8). No 5.5 file adds a source-rule failure |
| `design-rules.spec.ts` | Green. **`Audited 94 routes. Unreachable: none`** |
| `scroll-containers.spec.ts` | Green — including the tables that gained variants and the shell that gained a sticky state sibling |
| **The full suite** — first of the programme's two | **236 passed / 64 failed** in 47.4 minutes, `--workers=1`, routes warmed |
| Documents module tests | 46 passed, one new (`test_list_documents_offset_pages_through_the_sorted_result`) |
| `compileall`, `verify_openapi`, contract drift | Green — 357 paths, 469 schemas; no drift |

**The full-suite number needs its denominator.** `docs/e2e-suite-status.md` snapshots
**201 passed / 43 failed** on 2026-08-11 — but that was 244 tests and the suite is 300 now.
64 failures against a 43-failure snapshot from nine days and three sub-phases ago is not a
comparison anyone should make, so it was not made.

**What was done instead: a targeted pre-5.5 baseline.** Every spec covering a surface 5.5
touched — payments, invoices, documents, catalog, leads, contacts, accounts, client portal,
insertion orders, tasks, quick create — was run against a **stashed pre-5.5 frontend**
(`git checkout ac5b16c -- frontend/`), warm, serial, same box.

**The two failure sets are identical. Not similar — identical.**

```
in POST but not PRE (would be 5.5 regressions):  (none)
in PRE but not POST (fixed by 5.5):              (none)
```

Sixteen failures on those surfaces before, the same sixteen after. **5.5 is behaviour-neutral
against the existing suite on every surface it touched**, which is the claim the sub-phase
needed to make and the only way to make it honestly. It cost ~9 minutes, not the 28 a full
HEAD baseline would have — because the probe was scoped to the surfaces in question rather
than to the whole suite.

**Two failures were cleared, and neither was 5.5's.** Both are specs asserting a contract an
*earlier* sub-phase moved, which the testing policy says to update rather than leave red.
Written up in `docs/e2e-suite-status.md`.

- **`foundation-revamp.spec.ts:26` — table density.** It was in **no group** in that document,
  and it wore the Group 5 signature (a click timing out with the locator matching nothing) —
  which is exactly the shape of a false attribution, since density is what batch 1 threaded a
  `variant` through. It reproduced on the pre-5.5 tree, and the real cause is neither: it asks
  for `role="button"`, and `TableDensityToggle` is a `SegmentedControl` — a Radix ToggleGroup
  with `type="single"` — so its segments are **radios**. The spec has matched nothing since
  the primitive landed. Asserting `role="radio"` passes, and it is the better assertion: the
  ARIA role is the contract a screen-reader user actually gets. **Generalise it** — any spec
  reaching for `role="button"` on a segmented control is in the same position.
- **`catalog-revamp.spec.ts:397` — the record Files tab.** It asserted `"No documents are
  linked to this record yet."`, which **5.3 batch 7 renamed** and did not update here.

**That second one paid for itself.** The Files tab on a record is the exact surface where the
empty-state defect was measured (`clientWidth 580 / scrollWidth 920`), and the repaired spec
now renders that tab and finds the empty state — which is the first independent evidence that
batch 1's relocation works where it was supposed to.

**One real bug found by reading my own diff, not by any check.** The address codec's write
guard asked *is this non-empty* when it should have asked *does this differ from the view*. A
saved view may carry its own `search` or `sort`; clearing one **deleted** the param instead of
writing it, so the view's value came back on the next load and the operator could not clear it
at all. An empty `?search=` is how the address says *cleared*, and the reader already handled
it through `params.has`. Fixed in `61e539f`. Columns keep the truthiness guard deliberately —
`ColumnPicker` refuses to hide the last column, so there is no empty state to represent.

**A process note worth keeping.** The first full-suite run was **discarded**: it was started
before the codec fix, and editing `savedViewQuery.ts` mid-run made the dev server recompile
every list route underneath the tests. Nineteen tests in, failures had already started arriving
as 30s timeouts. A suite run is only evidence about the tree it ran against — finish the edits,
then start the clock.

### The browser pass — and the defect only it could find

**Run 2026-08-20, both themes, 1280–1400 and 768.** The `/auth` honeycomb renders as a
honeycomb (§9). Four things were on the list; three passed and **the third was broken**.

**1. The empty-state fix, measured on the surface it was measured on.** The contact record's
Files tab reproduces the defect condition exactly — `clientWidth 701 / scrollWidth 920`. The
state box is now `left 646, right 1346, width 701` against a shell of `left 645, right 1347`:
it *is* the visible region. Scrolled fully right (`scrollLeft 219`) it does not move —
`left 646, right 1346`, still wholly inside, page still not scrolling sideways. The
screenshot shows the empty state centred while the header row has scrolled its first column
out of view. That is the batch 1 claim, verified.

**2. `documents` at `variant="list"` is right.** The three storage cards keep their height,
the toolbar sits under them, the table takes what is left, and **pagination is pinned at the
bottom where there was none at all**.

**3. The `lineItems` grid was painting under the record rail. This is the one.** On the quote
form the grid's derived 1032px min-width had stretched the *form column* to 1082px inside a
692px track, so the line-item table — and the Customer name field above it — ran underneath
the Totals rail.

**The cause is a rule worth knowing:** a grid item's automatic minimum size is its content's
min-content, so a card containing one wide child grows the whole column rather than letting
the child scroll. `FormSection`'s `Card` had no `min-w-0`. The old code did not hit it because
it wrapped the table in a plain `overflow-x-auto` block that took its parent's width;
`ModuleTableShell` sizes to the derived min-width instead. Fixed with `min-w-0` on
`FormSection` and on `TransactionLineItemsTable`'s card — after which the shell reports
`clientWidth 430 / scrollWidth 1032`, scrolling inside its column, and the rail is clear.

**Every check had passed on the broken layout** — lint, build, `check-design.sh`, both
rendered guards, 17 of 20 line-item document specs. `scroll-containers.spec.ts` was *right*
every time: the region is a legitimate scroller and the page never scrolled sideways. The
table stretched its parent, which no assertion in the repo looks for. This is the §5
"sticky column that passed everything" lesson repeating, and it is why the browser is on the
exit criteria rather than in the nice-to-have column.

**4. The two client-portal tables** report `shellVariant="nested"` and `border-top-width: 0px`
— one panel edge, not two — with `Shared pages` and `Client accounts` in sentence case.

**Also confirmed in passing:** `Columns` is in the toolbar on every list, in the position
archetype 1 draws it; POS and payments report **zero header checkboxes**; payments draws
`Open invoices` and `Record payment` as two outline controls with **no primary action**; the
`readOnly` variant on the invoice record reports `sortButtons: 0, checkboxes: 0`, so the
variant contract is enforced in the DOM and not merely in the types.

**A1, end to end, in the browser.** `/dashboard/sales/contacts` at rest has a clean URL;
typing gives `?search=acme`; sorting gives `?sort=first_name`; page 2 gives `?page=2`. Opening
a record from page 2 and pressing **back lands on page 2, `Showing 11 – 19 of 19 entries`** —
the appendix's highest cost × frequency item, fixed and seen.

**After the fix:** build clean, `check-design.sh` still 2 of 14, both rendered guards green at
94/94 routes, and the line-item document specs at 17 passed / 3 failed — all three
(`insertion-orders:226`, `invoices:143`, `invoices:178`) in the pre-5.5 baseline captured
above.

### What 5.5 leaves open, deliberately

| Item | Owner |
|---|---|
| The twelve settings / automation / integration / reports / dashboard raw-`Table` files | 5.6 and 5.7, with their pages. R10's importer rule is true at the end of **5.7**, and 5.6 batch 4b amended it to **four** primitives — `MatrixTable` joined them |
| `settings/automation`'s `?view=runs\|rules` — the word means "saved view id" on every other list | 5.6 |
| `settings/users` keeps its own filter-value shape in `userFilters.tsx`, so no column picker | 5.6 |
| **B.2** — custom modules collect conditions the request layer discards; the filter group stays undrawn (§7.9) | Filed, after 5.9 |
| ~~The narrow-list overlay defect~~ | **Closed.** Diagnosed in this close-out and it was not a defect — a clipped cell centre at 768, no overlay, nothing intercepted at the guard's own 1440. Written up at the end of 5.4 |
| 62 suite failures, all pre-existing, grouped in `docs/e2e-suite-status.md` | Not this programme's |

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

### Decided before the first line — the measurement, the batch order, and five rulings

**Measured at the start of the sub-phase, 2026-08-21.** `check-design.sh` is at the known
**2 of 14** (`LynkSplash` → 5.9, `ClientPageCreateForm` → 5.8). The settings tree is
**7,136 lines across 23 pages** plus 21 component files; the four largest pages —
`backups` 905, `module-builder` 869, `fields` 771, `calendar-booking` 601 — are 3,146 of
them, 44% of the surface in four files.

**Three claims in the plan above were re-measured and two of them moved.**

- **The sticky footers are seven, not six.** Six are in settings pages (`authentication`,
  `general`, `permissions`, `provisioning`, `module-builder`, `modules/[moduleId]`) and the
  seventh is `AutomationRuleEditor.tsx:126`, a component. R3 counts ten `sticky bottom-0`
  across the app; 5.4 took three, and these seven are the rest of them.
- **`PermissionDeniedState` reaching 1 of 23 pages is true of the page files and false of
  the rendered app.** `app/dashboard/layout.tsx` gates the whole `/dashboard/settings`
  prefix on `isAdmin` and renders `PermissionDeniedState` in place of `children`, so a
  non-admin already hits a wall on all 23. What is genuinely missing is the *finer* check:
  an admin who lacks `configure` on a module, and a 403 arriving from the page's own fetch,
  which today surfaces as a generic error state. `record-layouts` is the only page that
  does this properly, which is why it was the only match. **The work is to make a 403 read
  as denied rather than broken, not to bolt a redundant `isAdmin` check onto 22 pages.**
- **`recycle-bin` is already on `RecordTable`.** The census note is stale. The raw-`Table`
  set for 5.6 is **ten** files, listed in batch 4.

#### Ruling 1 — the rail is pinned, and it is not sticky

The settings layout becomes a full-height two-column grid: a `16rem` rail and a content
column that owns the scroll. This is archetype 2's spine mechanism, already proven inside
the same `overflow-y-auto` wrapper by every list page, and it means **no new
`position: sticky` enters the app** — R3 stands.

**Rejected: the rail scrolls with the document.** Simpler, and one fewer thing to get
wrong, but on `backups` (905 lines) the rail is gone by the second panel, which puts the
operator back through the hub — A8 with extra steps. The whole point of the rail is
lateral movement.

**Rejected: `lg:sticky top-0` on the rail column.** It reads as the cheap version of the
same thing and it would be the eleventh sticky in a programme that just deleted ten.

#### Ruling 2 — the hub survives, rebuilt from the one source

With a rail, `settings/page.tsx` is no longer the only way in, so it could be a
`redirect()` to `general`. It is kept: it is where the sidebar's single `Settings` entry
lands, it is where every state's `Back to Settings` goes, and it carries the one-line
descriptions a 16rem rail has no room for. What changes is that **it no longer holds an
IA.** `SETTINGS_NAV_GROUPS` in `lib/module-registry.ts` becomes the single definition —
grouped, with label, description and icon — and `SETTINGS_NAV_ITEMS` is derived flat from
it. The hub renders it, the rail renders it, ⌘K and recent-pages read the derived flat
list, and `record-layouts` stops leaking because there is nowhere left for it to leak
*from*.

#### Ruling 3 — the commit model splits by control, not by page

Written into `design.md` archetype 4 before any code. R1's table already answers both
halves and a settings page can hold both: an independent reversible control autosaves with
a `SaveStateIndicator`, and a **configuration record** — SSO credentials, the company
profile, a booking link — keeps a manual save because its fields validate together and
carry a side effect (a connection test, a re-verification). What R3 removes from all seven
is the *stickiness*; the button survives only where the model is genuinely manual.

Autosaving SSO would fire `testSsoSettings` against a half-typed issuer URL. That is the
same defect R1 refuses on a line-item document, and "it is a settings page" is not a
reason to accept it here.

#### Ruling 4 — `SegmentedBoolean` is the boolean, and `SettingsSwitch` is deleted

The question 5.4 transferred here (census 2.3, `CatalogRecordFormPage`). Four idioms exist:
`SegmentedBoolean` (7 files, 5 of them settings pages), the Radix `switch.tsx` (3 files,
none in settings), `SettingsSwitch` (2 files) and a bare `Checkbox` standing in for a
boolean (6 settings pages).

`SegmentedBoolean` wins on evidence — §7.1 already names it and it already has the most
call sites. **`SettingsSwitchRow` is deleted**: its `SettingsSwitch` is 112 lines
reimplementing `SegmentedBoolean` with a different focus ring. `Checkbox` keeps *many from
a set*, which is exactly what the permissions matrix and the module-access grid are.

The three `switch.tsx` call sites are **not 5.6's rows** — `CatalogRecordsTable` and
`LeadConversionForm` are 5.3's, `CalendarEventDialog` is 5.7's. The ruling is written now
and filed to them, per the census rule that the owner is whoever rebuilds the file.

#### Ruling 5 — `?view=` on automation becomes `?tab=`

5.5 made `?view=` mean *saved view id* on every list in the app. `settings/automation`
uses it for `runs|rules`, which is a tab strip. It moves to `?tab=`, which is what the
record archetype already calls the same thing. A10's deep links land in the same batch and
use the same vocabulary: `?module=` on `fields` and `module-builder`.

#### The batch order

| | Batch | Why here |
|---|---|---|
| 1 | The archetype — one IA source, the rail, the hub, `SettingsRow` | The mitigation rule: the shared shape is hoisted before page two |
| 2 | The seven sticky footers, R1/R3 applied | The commit model has to be settled before the pages that use it are rebuilt |
| 3 | Permission walls that read as denied, and A9's three admin-only links | Cheap, and it is what a non-admin actually experiences |
| 4 | The ten raw `Table` files → `RecordTable` (R10) | Mechanical, and it unblocks R10's importer count at the end of 5.7. Split 4a / 4b; **closed** |
| 5 | A10 deep links + `?tab=` on automation | Address vocabulary, one commit; **closed** |
| 6 | The four large pages rebuilt — `calendar-booking`, `fields`, `module-builder`, `backups` | 44% of the surface; they need batches 1–5 in place first. Split 6a–6d, smallest first, so `EditorPanel` is proved before the 900-line pages consume it |
| 7 | The stragglers — `profile`, `teams`, record layouts, activity log, templates, integrations, domains, automation components | |
| 8 | Close-out — the end-of-sub-phase pass and one correction commit | |

### Status: batch 1 — the archetype, and one list where there had been two

**Landed.** `lint` and `build` green; nothing else run, per the revised cadence.

**One IA, and `record-layouts` stops leaking.** `SETTINGS_NAV_GROUPS` in
`lib/module-registry.ts` is now the only settings information architecture — grouped, with
the label, the one-line description and the icon on each row. `SETTINGS_NAV_ITEMS` is
**derived** from it (flat, sorted by `sortOrder`) rather than authored, so the hub, the
rail, ⌘K, `lib/recent-pages.ts` and the dashboard layout's admin-only prefix list all read
the same nineteen rows. `record-layouts` was in the hub's copy and not the flat one, which
is why it was invisible to the palette and why `settingsPageTitle` fell through to the
Title Case route-label fallback; both fix themselves the moment the second list stops
existing. The palette's settings rows also stop using the raw href as their subtitle —
the description is now on the row, so it says what the page does.

**The rail (A8).** `settings/layout.tsx` went from a 5-line passthrough to a full-height
two-column grid: `SettingsNavRail` at `w-64`, and a content column that owns the scroll.
**No `position: sticky`** — this is archetype 2's mechanism, and the two-scroller shape is
the one `RecordSpine` already ships and `scroll-containers.spec.ts` already passes, because
the rule forbids a page scroll *plus* a nested one, not two siblings inside a full-height
page. The rail carries `-mx-2 px-2` for the same reason the spine does: the active item's
left bar and focus ring bleed outside the link's box, and inside a scroll container that
bleed is horizontal overflow.

The active treatment is copied from `SidebarMenuItemLink` on purpose — left bar, primary
tint, `aria-current="page"`. Two navigations in one viewport marking their position
differently would read as two different kinds of thing.

**The hub survives, emptied.** `settings/page.tsx` keeps its shape and loses its IA: 180
lines to 58, rendering `SETTINGS_NAV_GROUPS`. It is still where the sidebar's one
`Settings` entry lands, still where `Back to Settings` goes, and below `lg` — where the
rail is not drawn — it is the only index.

**`SettingsRow`, and `SettingsSwitchRow` deleted.** The new primitive is label /
description / control / save-state, and the save-state slot is the point: it is what makes
autosave legible, and its absence is why settings had eight editing patterns. The control
is a **slot**, because a setting is as often a `Select` or an input as a toggle — which is
the flaw in the thing it replaces. `SettingsSwitchRow`'s `SettingsSwitch` was 112 lines of
hand-rolled Off/On segmented pair, in 2 files, while `SegmentedBoolean` — the primitive
§7.1 already named for the job — was in 7. Both call sites (`module-builder`'s field
inspector, `AutomationInspector`) moved to `SettingsRow` + `SegmentedBoolean`, with **no**
`saveState`, because both edit a draft that commits with its parent and a `Saved` there
would claim a write that has not happened.

**`useAutosave`.** The `idle → saving → saved → idle` machine `InlineFieldEdit` grew inline
for the record spine, extracted so nineteen pages share one rather than re-deriving it. It
does not debounce: R1 asks for debouncing on *typed* fields, and an autosaving settings
control is a toggle or a select — one deliberate change, one write. A page autosaving text
debounces the value before calling `save`, where the field's shape is known.

Two lint/type facts worth keeping, both cheap to hit again: the `react-hooks/refs` rule
rejects reading `ref.current` in a hook's return value, so `retry` is gated on `state`
alone; and `flatMap` over a `readonly` tuple of heterogeneous groups infers `unknown[]`,
so the flat projection needs its type argument (`.flatMap<SettingsNavItem>`).

**Not yet done, and batch 2 starts here.** No settings page has been converted to the new
commit model. `authentication` still autosaves its MFA select and shows a sticky footer
forty lines below it — that page is batch 2's first, because it is the defect the archetype
was written against.

### Status: batch 2 — the commit model, and the eleventh save bar

**Landed.** `lint` and `build` green.

**All seven sticky save bars are gone, and an eighth turned up.** `grep -rn "sticky
bottom-0" app components` now returns **zero** live matches across the frontend — the
remaining hits are the comments explaining where the bars used to be. R3's census counted
ten; 5.4 took three, this batch took seven, and the arithmetic only works because
**`app/dashboard/views/[moduleKey]/page.tsx:190` was an eleventh**. The census marks that
file done at 5.3 — which rebuilt its hand-rolled tab strip and left the footer alone — so
R3's original count was one short. It was un-stickied here rather than filed to a
sub-phase that has already closed.

**Which ones kept their button, and why.** Ruling 3 splits by control, and every one of
the seven turned out to be a **configuration record**: the SSO credentials, the company
profile, the provisioning claim map, the permission matrix, the module-access grid, the
module definition, the automation rule. Each commits as a whole in one write with fields
that validate together, so the button stays and only the stickiness goes. **Exactly one
control in the seven was genuinely autosave-shaped** — `authentication`'s MFA policy — and
it is the one the archetype was written against.

That is worth stating plainly, because the plan implied the opposite: *"settings controls
autosave, so all six sticky Save/Discard footers in settings go"* reads as though the
button disappears seven times. It disappears once. What the archetype actually buys is
that **each control now says which model it is on**, which was the real defect — the same
page autosaving a select and demanding a Save forty lines below, with nothing marking the
boundary.

**`authentication` rebuilt onto the archetype.** Three `Card`s → three `FormSection`s. The
MFA select is a `SettingsRow` driven by `useAutosave`, so it carries `Saving… / Saved /
Couldn't save — Retry` in the row itself. The SSO card keeps a manual save behind a
non-sticky `FormFooter`; autosaving it would fire `testSsoSettings` against a half-typed
issuer URL, which is R1's line-item-document argument wearing different clothes. Its
`Enabled` checkbox became a `SegmentedBoolean` (ruling 4), as did `provisioning`'s
auto-provision checkbox — a lone `Checkbox` for one boolean is the drift.

**A rule added to `design.md` archetype 4: an autosaving control reports through its
`SaveStateIndicator`, not through a toast.** `updateMfaPolicy` lost both its success and
its error toast and moved from `mutate` to `mutateAsync` so the row can await it. The
indicator is attached to the thing that changed and clears itself; a toast for the same
write is a second notice of one event, in a corner nobody is looking at, and it would be
constant once settings autosaves broadly. Toasts stay for what has no control to sit
beside — a background job, an import, a manual save.

**R5 applied to seven dirty-state lines.** Every one of them painted `text-state-warning`
when dirty and `text-state-success` when clean. A form with unsaved edits is not an
exception, it is the ordinary middle of editing, so the line is `text-copy-muted` and says
the same thing in words. The save *errors* keep `text-state-danger`; those are exceptions.

**A run-shape trap, new and cheap to fall into.** Two concurrent `next build` runs in the
same container: the second prints `⨯ Another next build process is already running` and
**exits 0**. It reads as a green build in a task summary. Check the output, not the exit
code.

**Batch 3 starts here.** The permission walls and A9's three admin-only links, none of
which is touched yet.

### Status: batch 3 — a 403 is not a broken page, and four links into a wall

**Landed.** `lint` and `build` green.

**`PermissionDeniedState` reaches all 21 settings page files, up from 1.** `grep -L
isPermissionDenied app/dashboard/settings/**/page.tsx` returns nothing.

**But the interesting half is that the original measurement was measuring the wrong
thing**, and the fix is not the one the plan implied. `app/dashboard/layout.tsx` already
gates the entire `/dashboard/settings` prefix on `isAdmin` and renders
`PermissionDeniedState` in place of `children`, so a non-admin has always hit a wall on all
23 pages. Adding an `isAdmin` check to 22 page files would have been 22 redundant checks
behind a working one.

**What was actually missing is the finer case**: an admin who lacks `configure` on the
module they opened, or a role edited in another tab. Those arrive as a **403 on the page's
own fetch**, and every read path in the app threw a bare `new Error("… could not be
loaded")` — so the status, the one fact that decides wall-or-fault, was discarded at the
throw site. The operator was told the page was broken and sent to look for a fault that
does not exist.

**`ApiError` and `isForbiddenError`, in `lib/api.ts`.** The failing response keeps its
status; `isForbiddenError` answers 401/403; `readJson` is the shared GET-and-parse the
admin hooks were each re-declaring. Converted: every **read** path in `hooks/admin/*`,
`useAutomationRules`, `useClientPortal`'s `crmJson`, and the six settings pages that fetch
inline. Write paths are untouched and keep reporting through their toasts — a failed save
is a fault the operator can retry, not a wall.

**Three hooks now expose the read error** (`useAuthenticationSettings`,
`useProvisioningSettings`, `useDomainSettings`, `useUserManagement`), which they did not,
so their pages had no way to distinguish anything at all.

**`settings/fields` lost its hand-rolled error card**, one of settings' three competing
error idioms — a `Card` with `role="alert"` inside the content, where `PageShell` has
supplied the §7.4 states since 5.1. It is now `hasError` + `errorDescription` + `onRetry`
on the shell, like everything else.

**A9 is four sites, not three.**

| Site | Was | Now |
|---|---|---|
| `routes.ts` — `resolveNotificationHref` fallback | `SETTINGS_ROUTES.activityLog`, admin-only | `DASHBOARD_ROUTES.home` |
| `NotificationCenter.tsx` — "View all activity" | Shown to everyone | `isAdmin` only |
| `app/dashboard/page.tsx` — the "Activity log" header button | Shown to everyone | `isAdmin` only |
| **`DashboardOperationalWidgets.tsx:172`** — **not on the list** | Passed the activity log as an explicit fallback, on a widget every role sees | Uses the new default |

The fourth is the one worth noting: it was *explicitly* passing the admin-only route as its
fallback, so changing the default alone would not have fixed it. A9 was found by grepping
for the route, and the grep that found three found four when it was run again over
`resolveNotificationHref`'s call sites rather than over the literal.

**One spec updated, and no new one written.** `settings-landing-revamp.spec.ts` asserted
`getByRole("link", { name: /^General/ })` against the whole page. With batch 1's rail in the
layout that matches twice on any viewport wide enough to draw it — a strict-mode failure,
caused by this sub-phase and therefore ours to fix. Both tests are now scoped to
`[data-slot="settings-hub"]`. **A test of the rail itself was written and then deleted**:
the testing policy says new coverage lands in 5.10, and the rail's assertions are filed
there rather than smuggled in as an "update".

**Batch 4 starts here** — the ten raw-`Table` files, 3,885 lines, none touched yet.

### Status: batch 4a — five of the ten tables, and a duplicate primitive retired

**Landed.** `lint` and `build` green. **Batch 4 is split**: 3,885 lines across ten files is
too much for one commit to be a useful handover unit, and the five here are the ones whose
shape is a list. The five in 4b are matrices and workspaces and need their own decisions.

| File | Was | Now |
|---|---|---|
| `automation/AutomationRunsTable.tsx` | Raw `Table`, 3 columns dropped below `lg` | `RecordTable` |
| `automation/AutomationRulesTable.tsx` | Raw `Table`, 2 columns dropped below `lg` | `RecordTable` |
| `integrations/IntegrationEventHistory.tsx` | Raw `Table`, `min-w-[980px]` hardcoded | `RecordTable` |
| `settings/customer-groups/page.tsx` | Raw `Table` + `SortableHead` | `RecordTable` with `sortable` columns |
| `settings/modules/page.tsx` | Raw `Table`, `min-w-[880px]` hardcoded | `RecordTable` |

**`hidden md:table-cell` is the pre-R10 answer and it is a data loss, not a layout.** Four
of the five dropped columns entirely below a breakpoint — the automation run's success
count and start time, the rule's condition and action counts. `RecordTable` derives its
min-width from the visible columns and scrolls inside its own region, so the operator keeps
the data and loses only the width. That is the trade R10 already made everywhere else.

**Two hardcoded min-widths deleted.** `min-w-[980px]` and `min-w-[880px]` are wrong the
moment a column is not rendered — the same defect §4.4 records for the nine module lists
before `RecordTable` existed.

**`settings/modules` had hand-rolled the row gesture**, including its own `tabIndex`,
`onKeyDown` for Enter and Space, and a module-local `stopRowNavigation` helper on the
action cell so a click on *Access* would not also open the row. All three are the
primitive's, and the action column is `interactive`. 12 lines deleted, and the row now has
a focus ring it did not have.

**`IntegrationSectionError` is deleted — a 5.1 row left open.** The census marked it
`delete` as one of the three competing settings error idioms, and it survived because
nothing rehomed its four call sites. It was a **verbatim duplicate of `PanelError`**, which
already takes `message` and `onRetry`. All four moved.

**`IntegrationEventHistory` was drawing three states in prose.** A loading row that said
`Loading event history...`, an empty row that said `No CRM events found.`, and an error
banner *above* the table that left an empty table body rendering underneath it. All three
are `RecordTable`'s §7.4 states now, and the panel keeps only its two filters.

**Three page-local state blocks went with them** — `customer-groups` had a loading row, an
error block inside a `colSpan={6}` cell, and an `EmptyState` that had to be told the column
count. A state that knows the column count is a state in the wrong place.

**One source-rule failure of ours, found and fixed.** `check-design.sh` went to **3 of 14**
after batch 1 and nobody noticed until it was re-run here: `SettingsNavRail`'s group marker
took `uppercase tracking-wide`, which §3.5 forbids. The size and ink step already mark a
group label, and shouting one is the one thing a quiet rail must not do. Back to the known
2 of 14. **The lesson is the cadence's own**: lint and build per batch cannot see a design
rule, so a source-rule failure survives every batch until the sub-phase pass runs it. Worth
running `check-design.sh` after any batch that adds a new *visual* file, which is cheap —
it is a grep, not a browser.

**Batch 4b starts here.** Five files, 2,676 lines, none touched:
`settings/permissions` (594) and `settings/modules/[moduleId]` (339) are **matrices**, not
lists — rows × action checkboxes — and the open question is whether `RecordTable` with
`interactive` columns is the honest fit or whether R10 needs a `matrix` variant.
`users/userManagementTable` (792) is the largest raw-`Table` consumer in the app and has
its own selection, sort and filter state. `IntegrationWebhookWorkspace` (304) and
`IntegrationWebsiteWorkspace` (647) carry several small tables each.

### Status: batch 4b — the matrix is a primitive, and four files that were never matrices

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back
at the known 2 of 14 and no new rule failed. **Batch 4 is closed** — all ten raw-`Table`
files are converted.

**The batch's own framing was wrong, and re-measuring it is what made it tractable.** 4b
was written as "five matrices and workspaces". Measured, it is **eight tables across five
files**, and exactly **one** of them is a matrix:

| File | Tables | What it actually is |
|---|---|---|
| `settings/permissions` | 1 | **The only matrix** — modules × 7 actions |
| `settings/modules/[moduleId]` | 2 | Lists. Name, description, status, one trailing checkbox |
| `IntegrationWebsiteWorkspace` | 3 | Lists |
| `IntegrationWebhookWorkspace` | 1 | List |
| `users/userManagementTable` | 1 | List, with selection and sort — the canonical `default` |

The open question 4b was left holding — "`RecordTable` with `interactive` columns, or does
R10 need a `matrix` variant?" — was therefore a question about one file, not five.

#### The ruling: `MatrixTable`, a sibling primitive, not a fourth variant

Taken to the owner per R10's escalation clause, which is explicit that a shape
`RecordTable` cannot carry is written down and decided rather than quietly exempted.
Written into `design.md` §7.10 **before** the primitive existed, per §12.

**The distinction is not size or density — it is whether a cell can be read on its own.**
In a list every cell describes itself, so losing the identity column to a sideways scroll
costs context but not meaning. In a matrix every cell is an anonymous checkbox: scroll the
module name away and thirty rows say nothing at all. So the identity column *must* pin —
and pinning is precisely the mechanism `RecordTable` **removed** after two measured
defects (the body checkbox painting over the sticky header through `thead`'s stacking
context; the `pr-0` column collapsing at narrow widths).

**Rejected: a `matrix` variant on `RecordTable`.** It puts a conditional sticky column
back inside the primitive that paid to delete it, for one call site whose shape shares
nothing with the other three — ~150 lines of conditionals in a 529-line primitive.

**Rejected: leaving it a raw `Table` with an exemption.** 5.10's source check would need a
path allowlist for a *page*, and the 920px pinned-column geometry would stay hand-rolled
in it. That is the quiet exemption R10 refuses.

**R10 is amended, and the variant set does not change.** It is still three variants on
`RecordTable`. What changed is the importer rule: **four primitives may import `Table` —
`RecordTable`, `MatrixTable`, `ModuleTableLoading`, `ModuleListToolbar` — and zero pages.**
5.10's check counts four, not three.

#### Two defects the page had, which the primitive does not

- **The pinned cell drew the wrong stripe.** It hardcoded `bg-surface`, which is the *odd*
  row's ground. Every even row's pinned cell painted the odd stripe, and the hover tint
  stopped dead at the pinned column's edge. `MatrixTable` uses `bg-inherit`, so the cell
  takes the row's own computed ground — stripe and hover both, live.
- **The group band's sticky offset was hand-tuned to `top-[58px]`** to dodge a z-index
  collision with the header (`TableGroupRow` defaults to `top-8 z-20`, and `thead` is also
  `z-20` — equal z-index resolves by DOM order, which the body wins). The primitive fixes
  the cause: a strict ladder, every rung below the header's 20 —
  **thead (20) > group band (10) > pinned cell (0) > ordinary cells (auto)** — and the
  column header puts its checkbox *beside* its label rather than above it, so the header
  is one line tall and the default offset is simply correct.

#### `RecordTable` gained two additive props, for the user list

`userManagementTable` is a list, but it needed two things the primitive did not have.
Both are additive — no existing call site changes, and neither touches the default path:

- **`groupBy`** — bands the rows, opening a band where the label changes. It does not
  reorder; the caller supplies rows in band order, so grouping stays a presentation of the
  sort rather than a second one. (`MatrixTable` has the same feature for product areas.)
- **`selection.isRowSelectable`** — the signed-in user cannot be bulk-edited. The checkbox
  is drawn *disabled* rather than omitted, so the column keeps its rhythm, and "select all"
  skips it instead of selecting a row the caller has to filter back out.

#### What else went

Ten prose states across the four list files — `Loading website API keys...`,
`No notification channels configured.`, and eight more — are `RecordTable`'s §7.4 states
now. Five hardcoded min-widths (`900`, `940`, `940`, `980`, `760`) are derived. Four
`colSpan` empty states, which are the boxes that mis-lay-out on any table wide enough to
scroll, are gone. `userManagementTable` lost its hand-rolled `stopPropagation` on the
selection cell, its own `columnCount`, and `allPageSelected`.

#### The browser pass — done here, not deferred, because pinning is unassertable by grep

The pinned column is the same defect class as consistency-pass Phase 3's sticky column
that failed to occlude: it passed lint, typecheck, build, both rendered guards and 99
specs, and needed a sideways scroll and someone looking. So it was measured rather than
eyeballed — a throwaway spec drove the real page, scrolled the region hard right, and
used `elementFromPoint` at the pinned cell's centre. Both themes, switched by the class
`next-themes` actually stamps (`emulateMedia` alone does **not** switch this app, and a
first run "verified light" against numbers identical to dark — worth knowing):

| Measured, at `scrollLeft: 332` | dark | light |
|---|---|---|
| Pin holds the region's left edge | 1px (the region border) | 1px |
| `elementFromPoint` returns the pin, not a cell scrolled under it | ✅ all rows | ✅ all rows |
| Pinned ground opaque, and equal to **its own row's** stripe | ✅, alternating `0.2065` / `0.1988` | ✅, alternating `0.9890` / `1.0000` |
| Sticky header still paints over the pin | ✅ | ✅ |

The alternating pair is the point: it is the same defect the old page had — one hardcoded
ground for every row — proven fixed by measurement rather than assertion.

`design-rules.spec.ts` and `scroll-containers.spec.ts` pass across 82 routes.

#### One defect the browser pass found: the loading state had no accessible name

`permissions-revamp.spec.ts` asserted `getByLabel("Loading role permissions")`, which was
`RouteLoadingState`'s. Moving the loading state into the primitive removed it — and the
honest finding is that **no list in the app ever had one**: `ModuleTableShell` tied
`aria-busy` to `isRefreshing` only, so a table reported `aria-busy="false"` for the whole
of its first load, the one moment it is unambiguously busy.

Weakening the spec was the wrong fix. `ModuleTableShell` takes `isLoading` — `aria-busy`,
no badge, since the badge is for a refresh happening over content that is still readable —
and both table primitives pass it. The spec now asserts the region reports itself busy,
which is a better contract than a bespoke label string, and it is fixed for all 24+ lists
at once.

**Two `permissions-revamp` failures are pre-existing and not this batch's.**
`filters grouped modules` fails on `getByText("Sales", { exact: true })`, which
`e2e-suite-status.md` already lists by line with the cause (two matches — the sidebar nav
group and the table's own group band); a probe confirmed the band renders visible at the
right geometry with the right text. `shows distinct real-empty…` passes standalone and
fails in sequence, which is the order-dependence that document also records.

---

### Status: batch 5 — the address vocabulary, and a hook whose name had gone stale

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back
at the known 2 of 14. Rendered guards and specs stay for the sub-phase close-out, per the
cadence.

**`useListAddress` is `usePageAddress`.** 5.5 built the one router-writer for lists, and
nothing inside it is about a list — it reads `window.location.search` at call time, mutates,
and `replace`s. Three settings pages needed exactly that, and importing `useListAddress`
into `settings/module-builder` is the misnomer that makes the fourth page hand-roll its own
`router.replace` instead. It is the `RecordTabs` → `SectionTabs` lesson, applied before it
costs anything: four call sites renamed, no behaviour changed.

**The trap the rename surfaced, now written on the hook.** `router.replace` is async, so
`window.location.search` has *not* moved when a second synchronous `updateAddress` reads it
— two calls in one handler and the second silently drops the first's param. The list hooks
never hit this because they write from separate renders. `viewRuns(rule)` changes two params
in one gesture, so the rule is **one `updateAddress` per gesture**, one mutation inside it.

**Ruling 5, applied.** `settings/automation`'s `?view=rules|runs` is `?tab=`, because 5.5
made `?view=` mean *saved view id* on all sixteen lists and two meanings for one word is the
drift this sub-phase exists to delete. The module scope is `?module=` — `?module_key=` is
gone rather than aliased, for the same reason; the two internal links that wrote it
(`settings/modules`, `settings/modules/[moduleId]`) and the one e2e spec that navigated with
it were updated in the same commit, and they were the only writers.

**The automation page had three params and seeded all of them into state.** `tab`, `module`
and `rule_id` are read on every render now, so the tab strip, the module filter and the runs
filter are all links. Two things went with it:

- **`changeModule` was `window.location.href = …`** — a full document reload to change a
  select. It is an `updateAddress` call, and the page no longer throws away its React tree
  to filter itself.
- **`rule_id` was read and never written.** `View runs` on a rule set local state, so the
  filtered run list an operator was looking at could not be sent to anyone. Changing the
  module drops it, since it names a rule in the module being left.

**A10 is closed on both pages, and the two answers differ in one way worth recording.**
`fields` addresses `?module=<key>` directly. `module-builder` selected by **id** and now
addresses by **key** — the key is what the runtime route, the field config and the saved-view
editor already use, and an id in a URL is not something a human recognises as the module they
meant. The `Select` moved to keys with it, so nothing converts between the two.

**An unknown key falls back; the stale param stays.** Both pages fall through to their
default rather than rendering an empty catalogue for a typo — `fields` only *after* the
custom modules resolve, since a deep link to a custom module is unrecognisable while the list
is still loading. Neither page rewrites the address to match: a write on mount is precisely
what replaces a shared link's state with the defaults, which is the mount problem 5.5 solved
by adopting rather than writing.

**What is deliberately not addressed.** The automation rule editor and the new-module panel
both hold an unsaved draft, so a link to either promises a state the URL cannot carry. They
became local modes over an addressed page — `isEditing`, `creating` — rather than a third
value of the workspace enum. `AutomationSettingsPage`'s `Workspace = "rules" | "editor" |
"runs"` is `Tab = "rules" | "runs"`, and the editor is a branch above the shell.

**Written into `design.md` first** (§12): archetype 4 gained *The address is the page's state,
and it speaks one vocabulary* — the three-param table, and the rule that a draft is never
addressed.

**Next.** Batch 6 — the four large pages rebuilt (`backups`, `module-builder`, `fields`,
`calendar-booking`), 44% of the surface. Two of them are the pages this batch just deep-linked;
the address work survives the rebuild, and `module-builder`'s two `window.confirm` calls
(`:410`, `:873`) are batch 6's to remove, not this one's.

### Status: batch 6a — the twelfth hand-rolled drawer, and the first of the four large pages

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14. Rendered guards and specs stay for the sub-phase close-out, per the cadence.

**Batch 6 is split four ways, and the order is by size rather than by the plan's listing.**
`calendar-booking` (602) is first because it is the smallest of the four and it carries the
shape all four share, so the primitive is proved on the simplest case before `fields` (796),
`module-builder` (892) and `backups` (906) consume it. The plan's order — backups first — was
a line in a table, not a dependency.

**`sheet.tsx` was the component 5.1 forgot.** Batch D gave `dialog.tsx` a styled
`DialogPanel` with a closed size set and left the sheet as a bare Radix wrapper, so all
**twelve** right-side drawers re-typed thirty lines of portal, overlay, header, scroll body
and footer by hand. It had drifted on every axis a call site was left to decide:

- **Three widths** — `32rem` ×3, `34rem` ×4, `38rem` ×2 — and no file says why any of them.
- **Two inks for the description**, `text-copy-muted` and `text-copy-secondary`.
- **The dirty line painted `text-state-warning` / `text-state-success`**, which is colour
  carrying *unsaved* — §1.2 reserves it for status and destructive intent. "All changes
  saved" was rendering green on a panel that had saved nothing.
- **The close X wired straight to a local `close()`**, beside an Escape and an overlay click
  that went through `onOpenChange`. Identical today at every call site, and one refactor away
  from a drawer whose Escape guards an unsaved draft and whose X does not.

**The two drawers that *were* primitives had already found the better answer.** `RecordSpine`
and `QuickCreateSurface` independently agreed on `h-dvh`, `max-w-none` with the width and the
border arriving only at `sm` — full-bleed on a narrow viewport instead of a 320px-wide panel
with a left border on it. The ten pages had none of that. `EditorPanel` takes the primitives'
shape, not the pages'.

**Rejected: style `SheetContent` / `SheetHeader` / `SheetFooter` in `sheet.tsx`.** The
shadcn-shaped answer, and it kills the class strings — but it leaves the *structure* at every
call site, which is the half that actually drifts: the portal, the overlay, the close button,
and `min-h-0` on the flex child, whose omission silently stops the body scrolling. It also
needs side-aware defaults so the mobile nav drawer does not inherit `border-l`. §4.4's lesson
is that a rule with no default behind it does not survive page two, and a composition is not a
default. `EditorPanel` draws the whole thing and takes one slot.

**Two sizes, picked by content shape.** `default` 36rem — the width the two primitives already
agreed on, and where 32 and 34 round to; `wide` 42rem for a body holding a grid or a repeating
multi-column row. A third is §12, like a fourth `RecordTable` variant. The footer is
`FormFooter`, so the panel's two rules are one ink and the actions inherit R4's height.

**Written into `design.md` first** (§7.11, plus the §7.1 registry row): the recipe that was
copied twelve times, the closed size set, one dismissal path with three triggers, and the
three files still allowed to touch `sheet.tsx` — `RecordSpine`, `QuickCreateSurface`, and the
mobile nav drawer, which is `side="left"` and is not an editor.

**What `calendar-booking` lost besides the chrome.**

- **A second answer to one failure.** A hand-rolled `role="alert"` banner sat above a
  `RecordTable` already wired to `hasError` + `onRetry` on the *same query*, so a failed load
  drew the error twice. The banner is gone and the page-level 403 wall moved onto `PageShell`
  — a denial on booking-types denies the handle too, because they are one feature.
- **A third New button.** Four entry points to one action under three labels: the page header
  (`New booking link`), the card (`New link`), the empty state (`Create booking link`), and a
  `New` *inside the editor* that discarded the draft you were standing in. The card's and the
  editor's are gone; the header's and the empty state's are the archetype's two.
- **A border it was drawing twice.** The `RecordTable` sat inside a `Card` without
  `shellVariant="nested"`, so the shell drew its own outline inside the card's.
- **`text-state-success` as a status column.** `<span className={item.enabled ? … }>` is
  `StatusValue`, which is what every other list in the app uses.
- **The Integrations button in the page header.** It was an A8 workaround — the rail lists
  Integrations now, so a lateral link competing with the page's primary action is a leftover.
- **Three `<h3 className="text-sm font-semibold text-copy-primary">`** → `SectionHeading` at
  `text-copy-label` (R7), and the two `Card` + hand-rolled-header pairs → `FormSection`.
- **A validity expression spelled inline on the submit button** — seven clauses, one of which
  (`duration_minutes`) also had a `FieldError` written separately. `isDraftValid` names the
  set once, so the field-level error and the disabled commit cannot disagree.

**The booking handle is a configuration record (R1), and it is one field.** Autosaving it
would move every canonical link the workspace has handed out on the keystroke that takes the
handle to three characters. It keeps a manual save, and it now says so through `FormFooter`
rather than a bare button floating at the end of a flex row.

**Next.** Batch 6b — `fields` (796) onto `EditorPanel`, which is the page whose panel has two
modes in one sheet.

### Status: batch 6b — the catalogue was a table, and the panel was written twice

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14.

**`fields` held two complete copies of the sheet recipe in one file** — one for create, one
for inspect, sixty lines of chrome between them — and the tell is that only one of them
commits on Enter. The create half was a `<form onSubmit>`; the inspect half was a `<div>` with
an `onClick` Save, so typing a new label and pressing Enter in the inspector did nothing at
all. One `EditorPanel` whose title, description, status, footer and `onSubmit` branch on
`panelMode` is the whole panel now, and both halves submit.

**The field catalogue was a hand-assembled list, and R10 says there is no third table.** It
was a `divide-y` of rows where the entire row was a `<button aria-pressed>` wrapping a
heading, two chips and a subtitle, with a `Popover` of two ghost `Button`s standing in for a
menu — a popover is not a menu: no `role="menu"`, no arrow-key traversal, no typeahead. Every
part of it is `RecordTable`'s:

- the row-open gesture and its accessible name;
- `isRowHighlighted` for the row the editor is open over, which the page was painting with
  `bg-action-primary-muted` — the *action* tint, used to mean "selected";
- the loading state, which was a page-local `RouteLoadingState` inside a `p-5` div;
- the filtered-empty state, which the page distinguished from the truly empty state by hand with a
  ternary on `catalog.length` in three separate props.

**The menu collapsed to a button once the table existed.** Its two items were *Inspect field*
— which is the row-open gesture, so it was a menu item duplicating the row you had to click to
reach it — and *Enable / Disable*, which is one action and belongs in `rowActions`. Protected
fields keep the disabled control and its `title`, because a control the backend will refuse is
drawn disabled rather than hidden (§7.9).

**Ruling 4 applied twice more.** `Field orientation="horizontal"` wrapping a lone `Checkbox` in
a bordered box — once in create (`Require a value when records are saved`), once in inspect
(`Required`) — is the exact drift the ruling names: `Checkbox` is *many from a set*, and a
single on/off setting is `SegmentedBoolean`. Both are now `Required` / `Optional`, and the two
halves finally use the same words for the same field.

**Two more colour misuses, both in the inspector.** `<Lock className="h-4 w-4 text-primary">`
beside the title set an icon's colour independently of its label (§5), and the protected
notice was `border-primary/30 bg-action-primary-muted` — the primary action's tint carrying an
*informational* message. The lock is a `Chip` in the table's Status column where it names a
state, and the notice is an ordinary muted panel.

**The dirty line is prose again.** `text-state-warning` / `text-state-success` for
*unsaved* / *saved* was §7.11's third drift and this was its second instance; the panel's
status slot carries it in `text-copy-muted`, and the two page-local error paragraphs
(`createError`, `inspectorError`) moved into the same slot rather than floating at the end of
the scroll body where a long form pushes them out of view.

**Next.** Batch 6c — `module-builder` (892), whose panel is a field inspector over a
drag-ordered list, and whose two `window.confirm` calls batch 5 filed here.

### Status: batch 6c — the two `window.confirm` calls, and a primitive that emitted its own chrome

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14.

**`FieldInspector` was a component that emitted `SheetHeader` and `SheetFooter`.** It is the
worst version of the §7.11 problem: the chrome was not merely copied into a page, it was
copied into a *component*, so the drawer's shape was decided in two files at once and the page
that mounted it could not see what it was mounting. The inspector now returns a `FieldGroup`
and nothing else; `EditorPanel` in `ModuleWorkspace` supplies the title, the description, the
close control and the footer.

**Batch 5 filed the two `window.confirm` calls here and both are gone.** `:410` removing a
field and `:873` deleting a module — the browser's own dialog, in a programme with one
confirmation primitive: unthemed, unpositioned, untestable without a Playwright dialog
handler, and impossible to word properly (`window.confirm` takes one string and no destructive
affordance). Both are `useConfirm` now, and both say what survives: a removed field's stored
values do not, a deleted module's records do.

**Two more of the colour misuses `fields` had.** The selected field row was `border-primary
bg-action-primary-muted` — the primary *action's* tint meaning "the inspector is open over
this" — and `LockKeyhole` was `text-primary` twice, an icon coloured independently of its
label (§5). The row is `border-line-strong bg-surface-raised`, which is separation rather
than a claim, and the lock is a `Chip` where it names a state and `text-copy-muted` where it
is a marker beside a name.

**The save row is an `ActionBar` inside the `CardFooter`, not a second `FormFooter`.**
`CardFooter` already draws the rule and the gutter, so nesting `FormFooter` in it would draw
two. What the row was missing is R4 — `flex flex-wrap gap-2` with the status pushed left by
`mr-auto` sets no size on its children, so Delete, Discard and Save were free to disagree.
Delete also moved to the far left of the action group, away from Save.

**Permissions and Automation left the page header.** Seven controls were competing there —
a search field, a module select, New module, and three ghost links. Two of the three were A8
workarounds and the rail carries both now. **Saved views stays**, because
`/dashboard/views/<key>` is not a settings route and nothing else on the page reaches it.

**Two specs updated, both broken by this batch and therefore ours.**
`module-builder-revamp.spec.ts` asserted the two removed links by role at page scope; the
assertion moved to `[data-slot="settings-nav-rail"]` rather than being deleted, because what
it was checking — that these are destinations and not faked tabs — is still true and still
worth checking. `fields-revamp.spec.ts` moved from `getByRole("button")` on a row to
`getByRole("row")`, and from the deleted `Checkbox` to the `SegmentedBoolean` that replaced it.

**A note on copy, so 5.9 is not pre-empted.** Four Title Case control labels were rewritten in
passing — `New Field`, `Create Field`, `Save Field`, `Field Key` — because §3.5 is a design
rule and those lines were being rewritten anyway. The **dirty-line wording was deliberately
left alone**: `Unsaved changes` / `All changes saved` is what 5.4 settled across the forms, and
an earlier pass of this batch had changed it to prose before the measurement showed the
majority went the other way. What §7.11 removes from that line is the colour, not the words.

**Deliberately not touched: the drag-and-drop field list.** 5.7 owns `DropZone` /
`SortableList` and the six raw HTML5 implementations, and this is one of them. Its colour and
its heading are fixed here; its reordering mechanism is filed where the primitive lands.

**Next.** Batch 6d — `backups` (906), the last of the four and the one that **deletes** its
drawer rather than adopting it.

### Status: batch 6d — the page that deletes its drawer, and the fourth `formatBytes`

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14. Batch 6 is complete: 3,196 lines across four files, 44% of the settings
surface.

**`backups` is the page that proves `EditorPanel` is not always the answer.** Its schedule —
frequency, retention, scope, destination, document inclusion — sat behind a `Configure`
button that opened a 38rem drawer with its own dirty banner, its own Cancel, and its own
discard confirmation. Archetype 4 says a settings page is a stack of `FormSection` panels
whose rows are `SettingsRow`; hiding half the page's subject behind a button is the opposite
of that, and it is why the page needed 200 lines of drawer machinery to say what two panels
say now.

**It stays a configuration record (R1), and that is the point.** The fields validate together
— a `selected_modules` scope with nothing selected is refused by the mutation, and a cloud
destination is only selectable with a connected account — so it keeps one manual save. What
R3 removes is not the button, it is the *drawer*: the commit is a `FormFooter` at the end of
the panel, and Discard is where 5.4 put it on every other form in the app.

**The module grid stopped being drawn disabled.** It rendered greyed out with
`cursor-not-allowed opacity-50` whenever the scope was Full tenant — a control the backend
ignores, which §7.9 says is not drawn at all. It appears with the scope that uses it.
Ruling 4 keeps the `Checkbox` here: this is *many from a set*, which is the job the ruling
explicitly leaves it.

**Three hand-rolled panel headers and three `dl` grids.** The headers were the icon-chip
recipe — a `h-9 w-9` bordered square holding a lucide glyph, then `text-lg font-semibold` —
three times, one step louder than the values beneath them (R7). They are `FormSection`. The
grids were label-over-value cells with the ink and the gutter written longhand at each of
eleven cells; they are a page-local `Fact`. **It is deliberately not hoisted yet**: the
authentication page has a local twin, and two is not a primitive — and the thing it looks
most like, a metric tile, is archetype 5's and belongs to 5.7 (§4.7).

**`formatBytes` had four implementations that disagreed about the answer.**

| Where | Absent or zero | Largest unit |
|---|---|---|
| `settings/backups` | `-` | MB |
| `dashboard/documents` | `0 B` | TB |
| `client/documents` | *unguarded* | MB |
| `client/pages/[token]` | `Unknown size` | MB |

A 3 GB backup read as `3072.0 MB` on this page and `3.0 GB` on the documents page — the
`lib/currency.ts` story from 5.1, one unit down. `lib/format.ts` owns it now, scaling through
TB, and it **returns `null` for an absent value** rather than choosing a placeholder: §3.6
makes that `EmptyValue`, and a formatter that picks for its caller is how four different
placeholders happened. The two client-portal call sites are 5.8's files and were pointed at
the helper rather than left as a fifth copy.

**Two specs rewritten, and neither behaviour dropped.** `backups-revamp.spec.ts` lost every
drawer scope — what it checks, that the record commits as a set through one footer, is
unchanged and now asserts the dirty line returns to saved. The drawer-dismissal guard became
a discard test: `Discard changes` starts disabled, restores the saved value, and **writes
nothing**, which the old test never checked at all.

**What batch 6 did not touch, deliberately.** `module-builder`'s drag-and-drop field list is
one of 5.7's six raw HTML5 implementations and waits for `SortableList`. The `Fact` pair waits
for a third call site. And the remaining eight `sheet.tsx` call sites — `teams` ×2,
`permissions`, `modules`, `customer-groups`, the two automation components and the two
integrations workspaces — are batch 7's stragglers, which is exactly the set §7.11 was written
for.

**Next.** Batch 7 — the stragglers, and the eight drawers that now have a primitive to adopt.

### Batch 6's verification — the failure sets were diffed, and one new failure was found and fixed

**The diff, not the count.** Four specs cover the surfaces batch 6 touched:
`backups-revamp`, `fields-revamp`, `module-builder-revamp`, `booking-links-revamp` — twelve
tests. The pre-slice tree (`ab6d546`) was served from a **git worktree on a second frontend at
`:3100`** rather than checked out over `frontend/`, so the working tree never moved and both
runs hit the same backend.

| Run | Result |
|---|---|
| Pre-slice (`ab6d546`) | **9 failed / 3 passed** |
| Post-slice, first attempt | 10 failed / 2 passed |
| Post-slice, after the fix | **9 failed / 3 passed — the same nine** |

**The one new failure was real, and it was in the page rather than the test.** `backups`
reported *Unsaved changes* after a successful save. `saveMutation.onSuccess` set the draft to
the saved record and then `invalidateQueries`d — so for the length of that refetch the draft
had moved and the query's copy had not, which the footer reads as dirty. `setQueryData` with
the response the mutation already has closes it; the invalidation stays for the activity log.
The old drawer never showed this because it closed itself on save and took the dirty line
off-screen with it. The spec's mock was stateless in the same shape — its GET kept returning
the original record after a PUT, so the page it was testing could never settle — and it
remembers the write now.

**Two environment traps, both new and both worth writing down.**

- **`FRONTEND_CORS_ORIGINS` is an allowlist, and a baseline frontend on a second port is not
  on it.** The first two baseline runs came back **12 failed / 0 passed**, every one of them
  `Expected login to reach the dashboard or MFA challenge` — which reads exactly like the
  documented cold-server and Postgres-drop failures and is neither. The login POST is
  cross-origin from `:3100`, so without the origin in the allowlist the browser discards the
  auth cookie and every test dies at the door. A second-port baseline needs the origin added.
- **Port 8000 belongs to another stack on this box**, and 8010 to a third. The backend was
  published on **8042** through a scratchpad compose override with `ports: !override` —
  without the tag Compose *merges* port lists and keeps trying to bind 8000.

**A pre-existing group was closed as a side effect, and deliberately not fixed.** Five of the
nine standing failures share the signature `getByLabel('Name'/'Label', { exact: true })`, which
`e2e-suite-status.md` Group 5 listed as an unverified hypothesis pointing at the command
palette's `aria-labelledby` defect. A probe disproved it: the input has neither `aria-label`
nor `aria-labelledby`, and the label's **text** is `"Label *"` because `RequiredMark` renders an
`aria-hidden` asterisk — hidden from the accessibility tree, which is correct, and *not* hidden
from Playwright's label matching, which is what `exact: true` reads. The accessible name is
fine; the assertion is unusable on every required field in the app. The finding and the three
shapes of fix are written into `e2e-suite-status.md`; **the seven tests were left red**,
because they were red before batch 6 and clearing them is that document's triage rather than a
design batch's.

### The browser pass — two defects nothing asserted, and both were carried in

**Fifteen screenshots**: four pages × both themes, three at 768px, and the `EditorPanel` open
in both themes plus at 390px. `design-rules.spec.ts` and `scroll-containers.spec.ts` came back
green over **94 routes, none unreachable** — the strong shape of that run, per
`e2e-suite-status.md`.

Everything the assertions cover was right, and two things they do not cover were not.

**A create panel cannot report *All changes saved*.** The booking-link editor opens empty and
its footer said the draft was saved, because `isDirty` compares the draft to itself and an
empty draft equals an empty baseline. It is the pre-rebuild line, carried across unchanged —
and the fix is the phrasing 5.4 already settled for exactly this case: an edit panel says *All
changes saved*, a create panel says what is still needed. Nothing asserts a footer's wording,
so nothing caught it.

**A whole column painted amber for a boolean.** `fields` rendered `Required` as
`StatusValue tone="attention"` in every required row. §7.1 draws the line by asking whether the
value has a *better or worse*: a status does, and required-ness does not — it is a property of
the field, like its source and its type. R5 deleted `Pill` for exactly this, colour repeating
hundreds of times per table where ink would do, and the column is ink now.

Both were pre-existing and neither was introduced by this batch; both were also in files being
rebuilt, which is when they are cheapest to fix. Neither is visible in a diff, in a lint run or
in a rendered guard — only in a screenshot.

**What the narrow viewport confirmed.** At 768px the rail is correctly not drawn (Ruling 1),
the `RecordTable` scrolls inside its own container rather than the page (§4.5), and the
segmented filter strip scrolls sideways in its own overflow. The `EditorPanel` at 390px is
full-bleed with no left border, which is the `RecordSpine` / `QuickCreateSurface` shape §7.11
adopted and the ten page-level drawers never had.

---

### Status: batch 7a — the last nine drawers, and three panels where Enter did nothing

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14.

**§7.11's importer rule is now true, and it is measurable.** `grep -rn "components/ui/sheet"
app components` returns exactly four files — `EditorPanel`, `RecordSpine`,
`QuickCreateSurface`, and `app/dashboard/layout.tsx`'s mobile nav drawer — which is the set
§7.11 named when the primitive was written and 6a could not yet enforce. **Zero pages and zero
non-primitive components import `sheet.tsx`.** The nine that moved here:

| File | Was | Now |
|---|---|---|
| `settings/teams` ×2 | 32rem, `text-copy-secondary` description | `EditorPanel` default |
| `settings/permissions` | 32rem | `EditorPanel` default |
| `settings/modules` | 34rem, **a `div` with an `onClick` Save** | `EditorPanel` + `onSubmit` |
| `settings/customer-groups` | 34rem | `EditorPanel` default |
| `IntegrationWebhookWorkspace` | 34rem, **a `div` with an `onClick` Save** | `EditorPanel` + `onSubmit` |
| `IntegrationWebsiteWorkspace` | 34rem, **a `div` with an `onClick` Save** | `EditorPanel` + `onSubmit` |
| `AutomationInspector` | 34rem | `EditorPanel` default |
| `AutomationRunDetails` | 38rem, read-only | `EditorPanel wide`, no footer |

**Three of the nine could not be committed from the keyboard**, which is batch 6b's `fields`
finding turning up three more times. A drawer whose body is a `<form>` submits on Enter; a
drawer whose body is a `<div>` with an `onClick` Save does not, and nothing distinguishes the
two on screen. `modules`, `IntegrationWebhookWorkspace` and `IntegrationWebsiteWorkspace` were
all the second kind. `EditorPanel`'s `onSubmit` makes the body a form, so the shape a call site
used to choose by accident is the primitive's now — and all nine submit.

**The create panels stopped claiming to be saved.** Five of the nine open empty, and four of
them rendered *All changes saved* on a draft that had never been written — the defect batch 6's
browser pass found on booking links, carried in the same copied recipe. The status slot follows
the phrasing 5.4 settled: an edit panel says *All changes saved*, a create panel says what is
still needed (*Name the group and give it a key to create it.*).

**Six page-local error blocks moved into the status slot.** Each was a `role="alert"` div at the
*top of the scroll body*, so on a long form the message scrolled out of view behind the footer
that caused it. They are `status` now, beside the commit — 6b's answer, applied to the rest.

**A status vocabulary defect the conversion surfaced.** `AutomationRunDetails` painted its step
column with a hand-rolled ternary while the same file used `statusToneFor` for the run's status
two elements above. The reason is in the backend: `automation_rules.py` writes `succeeded` for a
**run** and `success` for a **step** — two words for one outcome — and `statusToneFor` knew only
the first, so routing steps through it would have quietly repainted every successful step
neutral. The mapper knows both words now, with the why on the line, and the step column is
`StatusValue` like every other status in the app.

**Eleven Title Case control labels went**, because §3.5 is a design rule and these lines were
being rewritten anyway (6c's precedent): `Create Department`, `Save Team`, `Create Role`,
`Role Name`, `Save Group`, `Discount Type`, `Discount Value`, `Channel Name`, `Key Name`,
`Allowed Origins`, `Add Webhook`, `Create API Key`. Four `Saving...` became `Saving…`.

**Two stale names renamed.** `DepartmentEditorSheet` / `TeamEditorSheet` are `…EditorPanel` —
the `useListAddress` → `usePageAddress` lesson from batch 5, applied while it still costs
nothing.

**Next.** Batch 7b — `profile` (516) and `general` (363) onto archetype 4, plus the `teams` page
body, whose editors landed here and whose `Card` + hand-rolled headings did not.

---

### Status: batch 7b — the fourth label-over-value, and a header that repeated the page

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14.

**`Fact` is a primitive, and the third call site 6d was waiting for turned out to be the
fourth.** 6d wrote *"the authentication page has a local twin, and two is not a primitive"*
and left it page-local. `profile` is the third — and `RecordSpineField`, a primitive since
5.3, is the same ink pair again. They disagreed on exactly the two axes a call site was left
to decide:

| Where | Container | Value ink |
|---|---|---|
| `RecordSpineField` (5.3) | none | `text-sm text-copy-primary` |
| `profile`'s `SummaryTile` | none | `text-sm text-copy-primary` |
| `authentication`'s `Status` | none | `text-copy-secondary` |
| `backups`' `Fact` (6d) | **bordered box** | `text-copy-secondary` |

**The bordered one is the interesting row, because the argument against it was already
written — in the file that did not do it.** `SummaryTile` carried a comment reading *"An ink
group, not a box… it sits inside a Card already, so a border here is the third container
level §1.3 forbids."* 6d drew the box anyway, one sub-phase later, in a file whose author had
not read that comment. It is §4.4's lesson in miniature: **a comment in one page is not a
default.** Written into `design.md` §7.12 before the primitive, per §12.

**`Fact` emits `dt`/`dd` and `FactList` supplies the `<dl>`**, so the pairing cannot be got
wrong — all four originals were inside a `<dl>` and two of them rendered bare `div`s in it,
which is invalid. **`RecordSpineField` is deliberately not folded in**, and §7.12 says why:
its siblings are `InlineFieldEdit`s and `RecordSpineLink`s — controls and anchors, not
description-list terms — so sharing the component would buy one fewer file at the cost of
invalid markup on every record page. The shared thing is the ink pair, which is a token
decision rather than a component one.

**`general` and `profile` onto archetype 4.** Six `Card` + hand-rolled `<h2 class="text-lg
font-semibold text-copy-primary">` pairs became `FormSection` — `general` was one `Card`
holding three `CardHeader`/`CardBody` pairs with two of them wrapped in a hand-written
`<section className="border-t">`, which is a multi-section panel rebuilt by hand. Both pages'
commit rows became `FormFooter`; `profile`'s was a `mt-6 flex … border-t pt-5` written
longhand, so its Save set no size on itself and could disagree with any sibling (R4).

**Two colour misuses in `profile`, both the redundancy R5 names.** The authenticator-secret
label painted `text-state-warning` *inside a box already tinted `bg-state-warning-muted`*,
and the recovery-codes heading painted `text-state-success` inside `bg-state-success-muted`.
The box carries the tone once; the label repeating it is colour spent twice on one signal.
The authenticator link was `text-primary` — the primary *action's* ink on an anchor — and is
now §2.2's one link treatment.

**`FormSection` and `SectionHeading` each gained one passthrough, not a feature.**
`SectionHeading` has carried an `action` slot since 5.2 and `FormSection` did not forward it,
which is why `profile` drew its own header row beside the primitive's to place `MfaStatus`.
`SectionHeading` also takes an `id` now, for a region naming itself with `aria-labelledby`.

**`teams`' body, and R10's escalation clause answered in the negative.** The department list
is a two-level hierarchy, and `RecordTable`'s `groupBy` — added in 4b for exactly this shape
— takes a band **label**: it cannot carry a department's description, its team count, or its
three actions. So the hierarchy stays. What went is the drift around it: **two icon-chip
headers** (the `h-9 w-9` bordered square holding a glyph, then `text-lg font-semibold` — 6d
deleted three of the same recipe from `backups`), **a third container level** (§1.3: a tinted
`section` inside a tinted `div` inside the panel, now rules and ink), and a panel header
whose description was *the page description, verbatim*. The two create buttons moved to
`PageShell`'s `actions`, where archetype 4 puts them.

**Nine more Title Case labels and one prose placeholder.** `Create Department`, `Create
Team`, `Add Team` ×2; `"No description"` is `EmptyValue` (§3.6).

**Next.** Batch 7c — record layouts: the page (57), `RecordLayoutBuilder` (575),
`RecordLayoutPreview` and `RecordLayoutValidationPanel`.

---

### Status: batch 7c — record layouts, and a fifth idiom for one boolean

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14.

**Five `Card className="p-4"` + `<h2 className="text-sm font-semibold text-copy-primary">`
pairs → `FormSection`.** The heading ink is the R7 inversion these predate: `text-copy-primary`
is one step *louder* than the values beneath it, and a section heading is the one thing on a
panel that should be quieter. `RecordLayoutBuilder` had the pattern five times in one file.

**Ruling 4 has a fifth idiom, and it is the quietest of them.** The section's *Collapsed by
default* toggle was a `Button` whose `variant` flipped between `ghost` and `outline` with
`aria-pressed` carrying the state. Ghost-vs-outline is the weakest signal in the set for a
value the operator has to *read* — and the ruling has named one answer for one boolean since
batch 1. It is a `SegmentedBoolean` with `Collapsed` / `Expanded`, which also gives the field
a name it did not have.

**R4 on the page actions.** Discard, Reset and Publish sat in a bare `<>` fragment, so three
sibling controls in one action row set no shared height. `ActionBar` owns that (R4).

**R5 on the validation panel, and the reason is in the block's own copy.** Errors and
suggestions were drawn as the same treatment in two shades — a tinted box with a coloured
semibold heading, `state-danger` for one and `state-warning` for the other. But the suggestion
block says, in its own second line, *"These do not block publishing."* Advice is not an
exception, so it does not take the exception's tint; it is an ordinary muted panel now, and
the two blocks differ **by kind** rather than by two shades of one thing. The error keeps
`state-danger`, because a blocked publish genuinely is an exception.

The `CheckCircle2` beside *"This layout can be published"* lost its independent green (§5: an
icon does not take a colour its label does not have). It is the most frequent state of the
panel, so painting it was colour spent on the *absence* of an exception.

**`RecordLayoutPreview` needed nothing**, and it is worth saying why: it already carries the
§1.3 argument as a comment and follows it — no frame of its own, because the runtime renderer
already draws a card per section and a wrapper would be the third level. It uses
`SegmentedControl` and `EmptyState`. It is what a file looks like when the rules were
available while it was being written.

**Two Title Case page titles.** `Record Layouts` appears in both the page and the builder —
they have to agree, and §3.5 says which way.

**Next.** Batch 7d — the remaining small pages (`activity-log`, `message-templates`,
`domains`, `integrations`, `recycle-bin`, `users`, `automation`), the automation components,
`IntegrationProviderRegistry`, the two user dialogs and `userFilters`, and the three shared
`components/ui` stragglers.

---

### Status: batch 7d — `Pill` under another name, and a state standing beside its table

**Landed.** `lint`, `tsc --noEmit`, `build` and `check-design.sh` green; the guard is back at
the known 2 of 14. **Batch 7 is complete** — every file 5.6 owns is now marked in the census.

**`settings/domains` had re-created `Pill`.** R5 deleted the *identifier*; this page kept the
*shape* — a nested ternary producing `rounded bg-state-success-muted px-2 py-0.5 text-xs
text-state-success`, or the danger pair, or the warning pair, once per domain. That is a
coloured capsule carrying a status, which is the thing R5 removed, and the source guard cannot
see it because it greps for the component name. It is `StatusValue` now, `Primary` is a `Chip`,
and the `charAt(0).toUpperCase()` beside it — one of 5.9's seventeen — is
`formatSnakeCaseLabel`. **This is what 5.10's colour-budget check is for**: the guard has to
count *rendered* colour in a table body, because the identifier returning is only half of it.

**`settings/automation` drew two states beside a table that has owned them since 4a.** A
`RouteLoadingState` and a `Card` wrapping an `EmptyState` sat outside `AutomationRunsTable` —
the same page-local pair batch 4 deleted from ten other files, surviving here because 4a
converted the *table* and left the page's own branch alone. The error one is the worse half:
it rendered *above* the table, leaving an empty table body underneath it, which is the exact
defect 4a recorded for `IntegrationEventHistory`. Both moved onto the table's props.

**`AutomationStepList` had four visible container levels.** `Card` → a tinted `CardBody` →
`section rounded border bg-surface-raised` → `StepRow rounded border bg-surface`. §1.3 stops at
the third. The two group boxes are ink groups now — a heading and its rows — which is also R8's
row-over-card, and the canvas tint on `CardBody` does the separating it was already there to do.

**The `bg-action-primary-muted` selection tint, for the third and fourth time.** 6b found it on
`fields`' catalogue rows and 6c on `module-builder`'s field rows; it is on `AutomationStepList`'s
step rows and its validation row too. The primary *action's* tint meaning "the inspector is open
over this" is a claim the row is not making. `border-line-strong bg-surface-muted` is separation.
Its icon chip was `text-primary` — an icon coloured independently of its label (§5), the same fix
6c made twice.

**Nine more R7 headings** — `text-lg` / `text-base` / `text-sm font-semibold text-copy-primary`
where `SectionHeading` is the role: three in `userFilters`, two in `IntegrationProviderRegistry`,
one each in `recycle-bin` and `domains`, and the provider card's name stepped down from
`text-base`.

**Two more §7.4 prose states.** `Loading provider health...` was a `Card` with a sentence in it
and `No integration providers registered.` was another; they are `PanelLoading` and `EmptyState`.
`Loading custom domains…` was a bare `<p aria-live>`.

**Three more of the colour redundancy 7b named.** `createUserDialog`'s success banner painted
`text-state-success` inside `bg-state-success-muted`; `AutomationStepList`'s "Builder fields look
complete" tick was green for the ordinary case; `UserTeamPicker`'s selected-row `Check` was
`text-primary`, the action's ink marking membership.

**What was audited and deliberately left alone.** `settings/activity-log`, `settings/users`,
`settings/integrations`, `settings/message-templates` and `editUserDialog` measured clean — no
`Card`-plus-hand-rolled-heading, no page-local state, no colour misuse. They are marked
**audited** in the census rather than rebuilt, which is the honest verdict and the same one 7c
gave `RecordLayoutPreview`.

**Still open, and filed rather than taken:** `module-builder`'s and `views/[moduleKey]`'s raw
drag-and-drop are 5.7's (`SortableList`), and `settings/automation`'s `AutomationRuleEditor`
keeps its `Card` shell because it is a record editor, not a settings panel.

**Next.** Batch 8 — the sub-phase close-out: the rendered guards, the specs, the browser pass
over the batch 7 surface in both themes, and one correction commit.

### Status: batch 8 — close-out, and eight specs that had been measuring a moved contract

**5.6 is complete.** Every census row it owns is marked, both rendered guards are green, the
browser pass is done in both themes, and the two correction commits have landed.

**What ran.**

| Check | Result |
|---|---|
| `check-design.sh` | **2 of 14**, the known baseline — `LynkSplash` (5.9), `ClientPageCreateForm` (5.8). No 5.6 file adds a source-rule failure |
| `lint`, `tsc --noEmit` | Green |
| `design-rules.spec.ts` | Green. **`Audited 94 routes. Unreachable: none`** |
| `scroll-containers.spec.ts` | Green |
| **The scoped attribution probe** — 155 specs over every surface 5.6 touched | 106 passed / 49 failed at HEAD; the 49 re-run against pre-5.6 gave **41 pre-existing, 8 regressions** |
| The browser pass — 13 routes × 2 themes, plus 768 and a 120-stop tab-through | One finding, fixed |

#### The attribution, and why it was worth the second run

5.5's probe came back with two *identical* failure sets, which is the cheapest possible
result to write up. 5.6's did not, and the difference is the point: **eight specs passed
before this sub-phase and failed after it.** Every one was read against the diff before
being touched, and **none was an app defect** — each was a spec still measuring a contract
5.6 deliberately moved. They are listed in `docs/e2e-suite-status.md`; the shapes worth
carrying forward are these three.

- **A8's rail makes a whole class of assertion unsayable.** `users-revamp:170` asserted that
  the Users page has no link named `Authentication`. The rail now links every settings
  destination from every settings page, and it renders inside `main`, so the count is 1 by
  design. The repaired assertion says the thing that is still true — *the only such link is
  the rail's* — and any other spec of the form "this settings page does not link to X" is in
  the same position.
- **The segmented-control role, again.** `record-layouts-admin:112` reached for
  `role="button"` on what batch 7c had made a `SegmentedBoolean`. A Radix `ToggleGroup
  type="single"` renders **radios**. This is precisely the generalisation 5.5's close-out
  wrote down after `foundation-revamp:26` — arriving on schedule, in a file nobody connected
  to it. The rule holds: after a boolean moves onto the segmented primitive, grep the specs
  for `role="button"` on its label.
- **A fallback is a contract.** `notifications-revamp:39` is titled *rejects external
  destinations*, and it still does. What moved is where a rejected link lands: A9 took the
  default off the admin-only activity log and onto `/dashboard`, which every role can reach.
  The test was asserting the old destination, not the behaviour in its own name.

**The other five** were batch 7b's copy and structure landing without their specs: the
house `"… yet."` empty-state idiom, the deleted `Organization structure` wrapper heading,
two sentence-case panel titles (`Create Team` → `Create team`, and `Create Department`
again), `RecordTable`'s period-less `errorState` titles, and an `aria-label` that had sat on
a plain `Card` — never an exposed landmark, only a test hook — replaced by three real
`FormSection` headings.

#### The browser pass — and the one thing it found

**Run 2026-09-16, both themes, 1280–1400 and 768, 13 routes across the whole batch 7
surface.** Themes were proved distinct by measurement, not by assumption: body ground
`rgb(11, 13, 16)` dark against `rgb(247, 248, 250)` light. **`emulateMedia` is a no-op in
this app** — `:root` carries the dark set and `.light` overrides it, stamped by next-themes
from `localStorage` before paint — so a pass that asks for "both themes" the media-query way
measures dark twice and reports success.

**`settings/teams` was drawing twenty solid red buttons.** Every department row and every
team row carried its delete as `variant="destructive"` — a filled danger control — and on a
tenant with eight departments that is twenty red squares stacked down the page. It is the
**only** file in the app that draws a row action that way; every other settings list uses
`ghost` or `outline`. The destructive weight belongs in the confirmation, which already
names the record and the consequence (*"Users assigned to it will become unassigned"*,
§7.5), not on twenty idle rows. This is R5's argument — a coloured decoration repeated once
per row communicates nothing the ink does not — applied to buttons rather than capsules, and
the source guard cannot see it because `destructive` is a legal variant. Measured before:
20 non-neutral grounds in the content region, in both themes. After: **0**.

**It was not 5.6's regression** — the same two call sites are there at `c9dd8d3`. It is
5.6's to fix because 5.6 rebuilt the page, and because nothing else would have looked.

**What the pass cleared rather than found**, each checked instead of assumed:

- **No page scrolls sideways**, on any of the 13 routes, in either theme, or at 768.
- **`position: sticky` is `thead` and nothing else** — R3's allowlist — except
  `MatrixTable`'s pinned identity column on `permissions`, which is deliberate, reasoned in
  §7.10, and explicitly not the list-table pinning §4.4 took back out.
- **Focus is visible at every stop.** 120 stops across `teams`, `general`, `permissions` and
  `domains`, walked from inside the rail so the content is actually reached — the naive
  walk spends all 18 of its stops in the app sidebar and proves nothing about the rebuild.
  One stop had no ring: Next's own `nextjs-portal` dev element.
- **The type ramp is closed** — every rendered size in {11, 12, 14, 16, 18}.
- `Administratio` and `Finanace Department` are **seed-data typos, not clipping**, and the
  two "clipped" strings a naive probe reports are `PageHeader`'s `sr-only` h1 and
  description, which are supposed to be 1px boxes (§8).

#### Filed, not taken

- **The settings rail's labels are Title Case** — `Booking Links`, `Customer Groups`,
  `Module Settings`, `Module Builder`, `Field Config`, `Record Layouts`, `Activity Log`,
  `Recycle Bin` — against `All settings` beside them. §3.5's guard greps for `uppercase` and
  cannot see Title Case, which is why this has survived. **Owner: 5.9**, with the rest of the
  sweep, and batch 1 made that job cheaper than it looks: the labels are now authored once in
  `SETTINGS_NAV_GROUPS`, so it is a one-file change that moves the rail, the hub, ⌘K and the
  shell header's page name together. It will move spec expectations with it —
  `e2e-suite-status.md` Group 3 is already holding the `Booking Links` / `Booking links`
  disagreement open.
- **Specs are typechecked by nothing.** `frontend/tsconfig.json` excludes `tests/e2e/**/*`,
  and typescript-eslint disables `no-undef` because it assumes `tsc` covers the file. So a
  spec can reference an undefined variable and **neither `npm run lint` nor `tsc --noEmit`
  reports it** — one of this batch's own edits did exactly that and was caught only by
  re-running. **Owner: 5.10**, where the new coverage lands.

#### Two environment facts that cost time, for whoever runs this next

- **Do not run a second Next dev server to hold the baseline tree.** Turbopack takes ~7 GiB
  after a long session, and a second one on a 15 GiB box gets OOM-killed mid-run — silently,
  exit code 0, which then reads as 152 spec failures rather than as a dead server. The
  baseline belongs on the *same* server: `git checkout <sha> -- frontend/app frontend/components
  frontend/hooks frontend/lib`, keeping `frontend/tests` at HEAD so current specs run against
  the old app. Restore with `git reset --hard`.
- **`NAV-FAILED` from `scroll-containers` is a memory report, not a scroll defect.** The same
  spec ran 3.2m green early in this session and 18m red late, with every route
  `NAV-FAILED`, because the dev server had grown to 7.1 GiB. Restarting `frontend` took it
  to 1.86 GiB and the run came back green. Judge a suspicious guard failure against
  `docker stats` before believing it.

### What 5.6 leaves open, deliberately

| Item | Owner |
|---|---|
| `module-builder`'s and `views/[moduleKey]`'s raw drag-and-drop | 5.7 (`SortableList`) |
| `NotificationCenter`'s row — its unread `bg-action-primary-muted` is the action's tint carrying *unread*, the fourth instance of the pattern batch 7d retired three times. A9 is done; the row itself is one of 5.7's eleven | 5.7 (`ListRow`) |
| The settings rail's Title Case labels, now authored in one place | 5.9 |
| Specs excluded from `tsc` and from `no-undef` | 5.10 |
| The settings rail's own coverage — every destination reachable without a trip through the hub, `aria-current="page"` on the current one | 5.10 |
| 41 pre-existing suite failures on the settings surface, grouped in `docs/e2e-suite-status.md` | Not this programme's |

---

## 5.7 — Dashboard, reports, boards, calendars, mail

The surfaces no phase has touched.

- `StatTile` — 5 metric implementations plus 28 inline `text-xl`/`text-2xl font-semibold`
  big-number treatments. **Load the `dataviz` skill** before touching chart colour or
  stat-tile layout.
- `ListRow` / `TimelineItem` — **11 unshared** activity / comment / notification / event
  row implementations.
- `DropZone` + `SortableList` — **5 raw HTML5 drag-and-drop** implementations, not 6, and
  `RecordLayoutBuilder` is not one of them — corrected in 5.6 batch 7c, where the census note
  marking it was found to point at a file that reorders with arrow buttons. The set is
  `settings/module-builder`, `views/[moduleKey]`, `DashboardLayoutEditor`,
  `OpportunitiesPipelineBoard`, `TasksBoard`.
- A shared `Board` for the 2 kanbans, and one calendar grid for the 3 (tasks calendar,
  dashboard calendar with 5 raw `<button>`s, public booking).
- `mail/page.tsx` (760) and `calendar/page.tsx` (631) rebuilt onto the archetypes.
- **A11** — reports costs 2 clicks because a single-item module became a collapsible
  sidebar group, and opening it collapses the group you were in.
- ~~`finance/invoice-generator/page.tsx` is a 3-line `redirect()` still in the route list.~~ **Deleted in 5.3 close-out** — zero inbound links, and it was costing both rendered guards a route visit.

### Decided before the first line — the measurement, the batch order, and seven rulings

**Measured at the start of the sub-phase, 2026-09-16.** `check-design.sh` is at the known
**2 of 14** (`LynkSplash` → 5.9, `ClientPageCreateForm` → 5.8). The surface is **8,314
lines** across the five pages (`reports` 943, `mail` 752, `calendar` 631, `dashboard` 481,
`tasks` 281) and their components. `Table.tsx` has **seven** importers: the three primitives
that implement it, `reports`, `DashboardPersonalWidgets`, and two client-portal pages that
are 5.8's.

**Five claims in the plan above were re-measured, and four of them moved.**

- **The metric implementations are four, not five, and the 28 big numbers are six.** 5.3–5.6
  took most of them with their pages. What is left on this surface: `DashboardCrmWidgets`'
  `Metric` and `DashboardModuleSummary` (both `text-3xl font-semibold`), `reports`'
  `MetricCard` (`text-xl`) plus two inline `text-3xl` totals beside its chart, and the
  pipeline stage tiles on `sales/opportunities` (`text-xl`) — a 5.5 page, but a metric row,
  and it moves with the primitive that supplies it. Three sizes for one role, and none of
  them the §3.3 stat figure. `support/cases`' `SupportMetric` is out of scope (decision 8).
  `IntegrationProviderRegistry`'s `Metric` is a label over a value — a `Fact`, not a stat —
  and `ImportControls`' `SummaryCard` is a result count inside a dialog; neither is a
  dashboard metric, and neither is 5.7's.
- **There are two calendar grids, not three.** `BookingForm` draws no month grid — it lists
  slots. `TasksCalendar` and `calendar/page.tsx` are the whole set, and they are the same
  42-cell grid written twice, each with its own mobile day-picker written twice more.
- **`DropZone` has one consumer.** The only drag-to-upload target in the app is
  `DocumentUploadFormPage`; every other `type="file"` is a button. A primitive with one call
  site is a component moved into `ui/`, not a shared shape, so **`DropZone` is not built**.
  It is filed back to documents with the reason.
- **The five drag-and-drop implementations are two shapes, not one.** Three reorder a single
  list — `DashboardLayoutEditor`, `settings/module-builder`, `views/[moduleKey]` — and two
  move a card between columns — `TasksBoard`, `OpportunitiesPipelineBoard`. That is
  `SortableList` and `Board`, as planned, but it means `SortableList` has three consumers
  and `Board` two, and neither may be proven on one.
- **The "11 row implementations" count has no source.** Nothing in `docs/` lists the eleven.
  It is re-measured in the batch that builds `ListRow`, not trusted.

And one thing nobody had counted: **`DashboardLayoutEditor`'s edit bar is `sticky top-2`**, a
floating translucent `backdrop-blur` card. R3 counted ten `sticky bottom-0` and 5.4 and 5.6
took all ten; this one is `top`, which is why the count missed it.

#### Ruling 1 — `StatTile` is an ink group, and `StatGroup` is the box

A metric is a label, one figure at the §3.3 stat size, and at most one line of context. It
draws **no border of its own**. A row of metrics is one `StatGroup` — a grid whose cells are
separated by rules, which is exactly the archetype 5 wireframe — and the group is the only
container.

Every call site proves why: `DashboardCrmWidgets`' metrics already sit inside a widget
`Card`, and `reports`' `MetricCard` sits inside a `Card` inside the page. A bordered tile
there is the third container level §1.3 forbids, and it is what both do today.

**Rejected: a bordered tile, one box per metric.** It is what any CRM draws, and on a
dashboard it produces a lattice of equal boxes in which nothing leads. The figure is what the
eye lands on (§3.3); the box around it competes with it.

**Rejected: a `size` prop.** Three sizes for one role is the drift being removed. A figure
that needs to be smaller is not a stat, it is a `Fact`.

`DashboardModuleSummary` is the one tile that is also a link. It stays interactive —
`Card variant="interactive"` earns its box by being clickable (R8) — and holds a `StatTile`
inside rather than growing a `href` prop on the primitive.

#### Ruling 2 — a dashboard widget is a panel, and its states are `PanelStates`

`DashboardWidgetShell` becomes `Card` + `PanelHeader` (R7 — its `h2` is `text-copy-primary`
today, the same weight as the data under it). The widgets' own loading / error / empty — six
hand-written loading lines, four tinted error boxes, and `DashboardEmptyMessage`, a **dashed
box inside the widget card** — become `PanelLoading` / `PanelError` / `PanelEmpty`, and
`DashboardEmptyMessage` is deleted.

**Colour in the widgets (R5).** `BucketList`'s bars are `bg-state-success/70`, the funnel is
`bg-state-success-muted` with green figures, and the forecast and owner rows print their
amounts in `text-state-success`. None of it is an exception — a pipeline value is not *good
news*, it is a number — so it is ink. The bars are a single-series chart and take
`seriesColor(0)` from `lib/chartColors.ts`, the only legal source (`tokens.md` §3.4).

#### Ruling 3 — the dashboard header carries the page's own actions, and nothing else

The header draws up to **eight** controls: a period select, Refresh, Edit dashboard, Activity
log, New work, and three links — Calendar, Mail, Documents. The three links duplicate the
sidebar one inch to the left, and the `quick_actions` widget one inch below. R4 and §4.4 make
it a row of one height; this ruling makes it a row of **the page's actions** — period,
refresh, edit. The links go; `New work` (a link to the tasks *list*, named like a create
action) goes; Activity log, admin-only since A9, stays in the sidebar's Settings where the
other admin surfaces are.

**Rejected: an overflow menu for the five.** It keeps five ways to leave the page on the one
page that already has a sidebar and a launcher widget, and hides them one click deeper.

Edit mode's bar is not sticky (R3). It becomes an `ActionBar` above the grid, in flow, and
its two `window.confirm` calls become `useConfirm` — the same move 5.6 batch 6c made.

#### Ruling 4 — `SortableList` and `Board` take no dependency, and the keyboard path is the contract

No drag-and-drop library is in `package.json`, and §7.2 names shadcn and lucide as the only
sources. **Neither primitive adds one.** Every one of the five call sites *already* ships a
keyboard path beside the pointer one — move-up/move-down buttons on the three lists, a stage
or status `Select` on every board card — because HTML5 drag has none. The primitives make
that pairing the contract rather than a per-page courtesy: `SortableList` owns the drag
handle, the drop indicator, the move buttons and a polite live-region announcement
(`"Moved Pipeline funnel to position 3 of 11"`); `Board` owns the columns, the drop target
state, the card's move control and the four §7.4 states the two boards currently each
hand-write.

**Rejected: `@dnd-kit`.** It is the usual answer and its keyboard sensor is good, but it is a
new component source against §7.2 to solve a problem every call site has already solved
with a control the operator can see. A hidden keyboard sensor is less discoverable than a
visible move button, not more.

**The drop target stops borrowing the action tint.** Both boards paint the hovered column
`border-action-primary bg-action-primary-muted` — the fifth instance of the action tint
carrying a state that 5.6 batch 7d retired three times and batch 8 found a fourth of. A drop
target is `border-line-strong` on `bg-surface-raised`: elevation, not colour (§4.6).

**R5 on the cards.** An overdue card keeps its warning mark — overdue *is* the exception.
`OpportunitiesPipelineBoard`'s `border-state-info/50` "High-value deal" does not: a large
deal is not an exception, and a quartile computed over whatever page happens to be loaded
is not a fact about the deal.

#### Ruling 5 — one `MonthGrid`, and the day picker is part of it

`TasksCalendar` and `calendar/page.tsx` become one `MonthGrid`: the 42-cell grid, weekday
header, month navigation, today marker, a per-day entry list with `+N more`, and the narrow
day-picker both files write separately below `md`/`lg`. Entries are a render prop — a task
and an event are different rows, and the grid does not know either.

The today marker is `bg-action-primary` on one file and absent on the other; it becomes a
weight and ink change on the date numeral, not a filled circle. Event tone by invite response
(`pending` warning, `shared` info) stays — *pending your response* is an exception the
operator must act on — but `shared` loses its tint: it is a property, not a state.

**Rejected: a week or agenda view.** Neither page has one today, and adding a view is a
feature, not a rebuild.

#### Ruling 6 — A11: a group of one is a link

`SidebarMenuItemCollapsible` wraps a single child in a disclosure, so Reports is a button
that opens a list containing Reports. The fix is **generic, not reports-specific**: the
sidebar renders any group whose resolved item count is one as a `SidebarMenuItemLink`, with
the group's icon and the item's label. A tenant that disables all but one module in a group
gets the same treatment, which is the point — the defect was never about reports.

**Rejected: moving reports into the `workspace` group.** It fixes the one instance by
editing the registry and leaves the mechanism that produced it.

#### Ruling 7 — the tasks display is `?display=`, and so is the pipeline's

`tasks` holds `list | board | calendar` and `sales/opportunities` holds `table | pipeline` in
component state, so a reload or a shared link loses the view — A10's defect on the two pages
5.6 did not reach. §4.7's address vocabulary has `?view=` (saved view id, 5.5) and `?tab=` (a
workspace within one page). A display mode is neither: it re-renders the same data, which is
exactly the §7.7 row *a value one region re-renders from*. It gets its own word,
**`?display=`**, written into the vocabulary table before either page uses it.

`CalendarEventDialog`'s Radix `switch.tsx` becomes `SegmentedBoolean`, as 5.6 ruling 4 filed.

#### The batch order

| | Batch | Why here |
|---|---|---|
| 1 | `StatTile` + `StatGroup`, and the dashboard's widgets onto `PanelStates` (rulings 1, 2) | Archetype 5's own primitive, proved on its own page first. **Load `dataviz` before it** |
| 2 | The dashboard page — header (ruling 3), edit mode off sticky and off `window.confirm`, and the second and third `StatTile` consumers (`reports`' metrics, the pipeline stage tiles) | The second consumer is the API test (mitigation rule) |
| 3 | `SortableList` — `DashboardLayoutEditor`, `views/[moduleKey]`, `module-builder` | Three consumers, and batch 2 has just rebuilt the first |
| 4 | `Board` — both kanbans, with `?display=` on both pages (ruling 7) | |
| 5 | `MonthGrid` — `TasksCalendar`, then `calendar/page.tsx` rebuilt around it; `CalendarEventDialog` onto `SegmentedBoolean` | |
| 6 | `ListRow` — re-measure the set first, then the activity / notification / invite / message rows | Last of the primitives, because 1–5 each rebuild one of its consumers |
| 7 | `reports` rebuilt — raw `Table` → `RecordTable`, which takes `Table.tsx` to the R10 importer count outside 5.8 | |
| 8 | `mail` rebuilt, `RecordEmailComposer`, `TaskDialog`, and the shell `adopt` rows — sidebar with A11 (ruling 6), `ProfileMenu`, `GlobalCommandPalette`, `chart.tsx` | |
| 9 | Close-out — the end-of-sub-phase pass and one correction commit | **Closed** — see *Status: batch 9* |

### Status: batch 1 — `StatTile`, and a dashed box inside every widget

**Landed.** Rulings 1 and 2, rule first: `design.md` archetype 5 now carries the `StatTile` /
`StatGroup` contract, the `tabular-nums` decision, and *a widget is a panel*.

- **`components/ui/StatTile.tsx`** — `StatTile` (label, figure, one line of context; no border,
  no size prop) and `StatGroup` (the grid, and the rules). The rules are each cell's own
  `before:` / `after:` hairline one pixel outside its leading and top edge, clipped by the
  group's `overflow-hidden`, so a first-column cell loses its left rule wherever the grid
  wraps. **Rejected: `gap-px` over a `bg-line-subtle` ground** — it only works if the tiles
  paint the ground behind them, and a widget in edit mode was `bg-surface-raised` while the
  tiles would have been `bg-surface`. **Rejected: `divide-x`** — it cannot follow a wrap
  across a breakpoint.
- **`DashboardCrmWidgets`** — `Metric` deleted. The snapshot and the weighted forecast are
  `StatGroup`s, and both render **flush**: `isFlushCrmWidget` tells the shell not to pad them,
  and the widget pads its own four states instead so a loading line is not jammed against the
  card edge. The forecast's four tiles were two `sm:grid-cols-2` grids of boxed metrics; they
  are one group over a `divide-y` stage list. `Best Case` / `New Leads` / `Pipeline Value`
  went sentence case while their lines were being rewritten anyway.
- **Colour (R5).** `BucketList`'s bars were `bg-state-success/70` — green for a count of lost
  deals as much as won ones. They take `seriesColor(0)`. The funnel was
  `bg-state-success-muted` boxes with green amounts, **indented by list index** — a stage's
  left edge encoded its position and its width encoded its count, and the two read as one
  quantity. It is baseline-anchored bars now, which is the only honest length comparison.
  The forecast's and owner rows' amounts went from `text-state-success` to ink.
- **`DashboardReportChartWidget`** — the bar chart painted every bar a different series hue,
  `seriesColor(index)`. One measure is one series; colouring by position encodes rank as
  identity, and a filter that drops a row repaints every bar after it (dataviz: colour follows
  the entity, never its rank). One colour, 4px data-ends. The pie keeps its categorical hues
  — there, each slice *is* an entity.
- **States** — the six hand-written `Loading…` lines, four tinted error boxes (two labelled
  `Retry`, two `Try again`) and **`DashboardEmptyMessage` — a dashed box inside the widget
  card, the third container level** — are `PanelLoading` / `PanelError` / `PanelEmpty`.
  `DashboardEmptyMessage` is deleted.
- **`DashboardOperationalWidgets`** — the recent-activity row's action was a bordered
  `rounded-full` capsule, `Pill` under another name; it is a word in the row's metadata. The
  notifications widget's unread dot was `bg-state-success` — unread is not success — and it is
  `bg-copy-primary` with `aria-label="Unread"`. The rows themselves wait for `ListRow`
  (batch 6).
- **`DashboardPersonalWidgets`** — the summary table was raw `Table` and is `RecordTable
  variant="readOnly" shellVariant="nested"`, which takes `Table.tsx` from seven importers to
  **six**. Its `View →` column went: the module name is the link. The module tile is `Card
  variant="interactive"` around a `StatTile`, per ruling 1. The filter's icon was
  hand-positioned `absolute` over a plain `Input`; it is `InputGroup`.
- **The widget shell's header** is `PanelHeader` (R7): it was an `h2` in
  `text-copy-primary`, the same weight as the figures under it.

**Verification:** lint, `tsc --noEmit` and `npm run build` green, per the cadence. The build
caught what `tsc` did not: `.next/dev/types/validator.ts` was a half-written generated file
whose syntax error stopped `tsc` before it reached source, so a stale import of the deleted
`DashboardEmptyMessage` in `app/dashboard/page.tsx` passed the typecheck. **If `tsc` reports
only an error inside `.next/`, delete `.next/dev/types` and run it again** before believing it.

**Left for later batches, knowingly.** The widget titles are still Title Case (`CRM Snapshot`,
`Leads By Status`) in `widgetTitle` and the page's catalogue — copy, 5.9's, and
`dashboard-edit-mode-revamp` asserts them. The edit-mode `Card` still turns
`bg-surface-raised`, and the drag handle is still a bare icon in the header — batch 2 and
batch 3.

**Next: batch 2** — the dashboard page's header (ruling 3), edit mode off `sticky` and off
`window.confirm`, the page-level error banners onto `PanelError`, and `reports`' metrics and
the pipeline stage tiles onto `StatTile` as the API test.

### Status: batch 2 — the header, the fourteenth sticky, and the API test did its job

**Landed.** Ruling 3 on the dashboard page, and `StatTile`'s second and third consumers.

- **The second consumer changed the primitive, as the mitigation rule says it should.**
  `StatGroup` was `md:grid-cols-2 xl:grid-cols-4`, the archetype's number. `reports`' forecast
  has **five** figures and the pipeline has **seven** stages, so both would have wrapped
  four-and-one and four-and-three at exactly the width where they fit on one row. The columns
  now **derive from the tile count** (`ROW_COLUMNS`, static class names, capped at seven — past
  that a row of figures is a table). `reports`' side rail stacks two figures beside its chart,
  which is `layout="stack"`. Written into `design.md` archetype 5 before the call sites.
  **Rejected: a `columns` prop.** A count the caller passes can disagree with the children it
  passes; a count read from the children cannot.
- **`reports`** — `MetricCard` deleted (a bordered box at `text-xl` inside a `Card`), and the
  rail's two `text-3xl` totals. The forecast card lost its `p-4` so its `StatGroup` runs edge to
  edge between two rules, with its own header and stage lists padded instead. The loading state
  was five `Skeleton` boxes shaped like the deleted cards; it is `PanelLoading`. The bar chart
  took batch 1's fix — one series, one colour — and the forecast lists' amounts went to ink.
  **The rest of the page is batch 7's**; this batch touched only its metrics.
- **`sales/opportunities`** — seven bordered `text-xl` stage boxes, a metric row under another
  name, are one `Card` holding one `StatGroup`. The census row stays 5.5's; the change is noted
  there.
- **Ruling 3.** The header went from up to eight controls to three: period, Refresh, Edit
  dashboard. `HeaderLink`, `useSidebarUser` and the `SETTINGS_ROUTES` import went with them.
- **Edit mode (R3).** The bar was `sticky top-2 z-20` with `bg-surface-raised/95 backdrop-blur`
  — a translucent floating card, and a sticky R3's count never included because every one it
  counted was `bottom-0`. It is an `ActionBar` in flow, over a rule. Its dirty line was
  `text-state-warning`: colour carrying *unsaved*, which 5.6's `EditorPanel` already ruled out
  (§1.2), so it is ink. A widget in edit mode keeps `border-line-strong` and loses the raised
  ground. The buttons lost their `size="sm"` — `ActionBar` sets the row's height (R4).
- **Both `window.confirm` calls are `useConfirm`**, and each now says what happens: *reset*
  names the default set and that nothing saves until Save; *discard* names what goes back.
- **One message per failure.** A failed save produced a toast *and* a red banner under the
  header saying the same thing. The banner is gone; the toast says the draft is still open.
  The *layout could not be loaded* notice stays — it is the only place that says the default
  layout is standing in, and it carries its retry.

**Verification:** `tsc --noEmit`, lint, build green, each run on its own under the new CPU caps
(`fd1076d`). The `StatGroup` rule selectors were checked in the built CSS rather than assumed —
`[&>[data-slot=stat-tile]]:before:*` compiles with `content: var(--tw-content)`.

**Specs that will move at close-out**, recorded so the attribution is quick:
`dashboard-edit-mode-revamp` "cancel discards…" accepts a native `dialog` — it is a `useConfirm`
dialog now, so the Cancel flow needs a click on *Discard changes*. Any spec that looked for
`New work`, or the header's Calendar / Mail / Documents links, is asserting ruling 3's removals.

**Next: batch 3** — `SortableList`, proved on `DashboardLayoutEditor` (its drag handle is still
a bare icon in the header), then `views/[moduleKey]` and `module-builder`.

### Status: batch 3 — `SortableList`, and focus that follows the moved item

**Landed.** Ruling 4's first half: `components/ui/SortableList.tsx`, and all three
single-list drag-and-drop implementations on it.

**The API.** `items`, `getKey`, `getItemLabel`, `label`, `onMove(from, to)`, `disabled`, and a
`renderItem(item, { index, count, handle, moveButtons })`. The primitive owns the `<ol>`, each
`<li>`'s drag events, the grip, the two move buttons, and a polite live region; the call site
owns what an item *looks* like, because a widget card and a divided column row share nothing
visual. `className` is the list's layout and `itemClassName` an item's — the dashboard needs
`col-span` on the grid item itself, and that is the only reason the second prop exists.

**Rejected: a `SortableItem` compound component.** It would let a call site forget the move
buttons, which is the one thing the primitive exists to make impossible. A render prop that
*hands* the buttons over still lets a caller not render them, but it makes omitting them a
visible act at the call site rather than an absence.

**What the three originals disagreed on, and what won.**

| | Dashboard | View manager | Module builder |
|---|---|---|---|
| Drag state | `useState` index | `useState` key | `dataTransfer` string |
| Move buttons | `ArrowUp` / `ArrowDown` | `ArrowUp` / `ArrowDown` | `ChevronUp` / `ChevronDown` |
| Announcement | none | its own live region | none |
| Drop target marked | no | no | no |

Arrows, state, one announcement — *"Email moved to position 1 of 3."* — and a drop target
that is now visible: a 2px `outline-line-strong` on the item, whatever box the item draws. An
outline because the primitive cannot know which element is the item's edge, and elevation or
a tint would need it to. The item being dragged drops to 60% opacity.

**Focus after a keyboard move — guarded, not yet observed.** React reorders keyed children by
moving DOM nodes, and Chrome drops focus from a node that is removed and re-inserted. Which
node moves depends on the direction: moving an item *up* usually moves its neighbour past it
and leaves the focused node where it is, while moving it *down* moves the focused node itself.
So the likely defect was **half** of the move buttons dropping the keyboard user back to
`<body>` after one press — `view-manager-revamp:97` presses *Move up* once, which would pass
either way. **This is reasoned from React's reconciliation, not seen in a browser.** The
primitive restores focus after every move regardless — to the same control, or to its sibling
when the item has reached the end and that button has just disabled itself — so the fix holds
whichever half was broken. The browser pass confirms it; it is on the close-out's checklist
below.

- **`DashboardLayoutEditor`** — the shell lost its drag props, its `dragIndex` state and its own
  move buttons; the header now takes `handle` and `moveButtons` from the list. The widget grid
  is the `<ol>`, and the size class moved from the card to the `<li>` — the grid item.
- **`views/[moduleKey]`** — `moveColumn` and `dropColumn` were the same splice written twice,
  one per input method. They are one `moveColumnTo`, fed from the list, with indices mapped
  back through `visibleColumns` — `selectedOptions` drops any saved key the definition no
  longer has, so its indices are not `visibleColumns`' indices. Its own announcement stays for
  add and remove; moves are the primitive's.
- **`settings/module-builder`** — `moveField` swapped neighbours and `dropField` spliced; one
  `moveFieldTo`. The census row's *"the drag-and-drop field list is 5.7's"* is now done.

**Verification:** `tsc --noEmit`, lint, build green, one at a time. The first `tsc` caught a
stray `</div>` from the view-manager splice; nothing else did.

**For the close-out's browser pass** — this batch adds three checks no assertion covers:
drag a widget and a column in both themes and see the outline; press *Move up* twice from the
keyboard on each of the three pages and confirm the second press moves the item again; and
confirm `view-manager-revamp:227`'s `dragTo` still lands, now that the `data-testid` is on the
row inside the draggable `<li>` rather than on the draggable element itself.

**Next: batch 4** — `Board`, on `TasksBoard` and `OpportunitiesPipelineBoard`, with `?display=`
on both pages (ruling 7).

### Status: batch 4 — `Board`, and a dialog that wiped the address

**Landed.** Ruling 4's second half and ruling 7, rule first: `design.md` §7.13 (*a reordered
list is `SortableList`, a kanban is `Board`*) — which also gives batch 3's primitive the §7
entry it shipped without — two §7.1 rows, and `?display=` in the address vocabulary table.

- **`components/ui/Board.tsx`** — the columns, the card box, the move `Select`, the drag, and
  the four states. **It is the other half of a list, so it sits in `ModuleTableShell`**: one
  scroll region, the same *Refreshing* badge and `aria-busy`, and `RecordTable`'s states in
  its order and words — the call site passes the table's own `emptyState` /
  `filteredEmptyState`, so switching display does not change what an empty list says. The
  call site supplies `renderCardBody` and nothing else about the card.
  **Rejected: a `renderCard` that hands over `handle` and `moveControl`**, `SortableList`'s
  shape. That fits a list whose items share nothing visual; the two boards' cards were the
  same box written twice, and handing the box back to the call site is how they drifted.
- **Containers (§1.3).** Both boards were panel → tinted `bg-surface-muted` column box →
  bordered card: three levels. Columns are ink groups now, drawing an edge only as a drop
  target, and a card is a row — `border-line-subtle`, no ground.
- **The drop target** was `border-action-primary bg-action-primary-muted` on both — the action
  tint carrying a state, the fifth instance. It is `border-line-strong bg-surface-raised`.
- **R5.** The deal card's `border-state-info/50` "High-value deal" — a 75th percentile over
  whatever page was loaded — is gone. Overdue keeps its icon and word in `text-state-warning`;
  the warning-tinted *border* went with it, one signal per exception. The pipeline's own
  "Pipeline View" heading and description went too: the segmented control above it already
  says which display this is.
- **The card title is the open gesture**: a link to the deal page (it was a `button` calling
  `router.push`, so it could not be opened in a new tab), a button for a task, which opens a
  dialog. Both got a visible `focus-visible` outline.
- **Focus follows the card.** A keyboard move re-parents the card into another column, which
  is a new DOM node, so focus fell to `<body>` — reasoned, like batch 3's, not yet seen. The
  board focuses the move control where the card lands, and drops the request when the move
  settles without landing (a failed save leaves the card where it was).
- **No announcement of its own.** Both pages toast every move; a second live message for the
  same change is noise.
- **The unstaged column** is `acceptsCards: false`: its cards show, it is not a drop target, and
  it is not in the move menu. The old menu had no *Unstaged* option either, but showed a
  deal with no stage as *Lead*, which it was not; it shows *Choose stage* now.
- **`?display=`** — `hooks/useListDisplay.ts`, over `usePageAddress`, with `display` added to
  `LIST_ADDRESS_KEYS`. The first mode is the default and is never written; an unknown value
  reads as the default. `tasks` holds `board | calendar`, `sales/opportunities` holds
  `pipeline`. A reload onto `?display=board` starts `useTasks` at the board's 100-row page
  size (a new `initialPageSize` argument) instead of fetching ten and then a hundred.
- **Found on the way: the task dialog wiped the address.** Opening, closing and creating a task
  called `router.replace("/dashboard/tasks")` or `…?taskId=N` — the *whole* query string — so
  every card opened dropped `?display=` and every saved-view param `useSavedViews` had written.
  It predates this batch; `?display=` only made it visible, because the board flipped back to
  the list the moment a card opened. The three writes go through `updateAddress` now.
- **The deal value is not `<Money>`.** `total_cost_of_project` is a `Text` column, and
  `formatMoney("12,000")` is `NaN`, so the card prints the value as written with its currency
  code. The type is a backend question, not this batch's.

**Verification:** `tsc --noEmit`, lint, build green, one at a time; `check-design.sh` at the
known 2 of 14.

**Specs that will move at close-out.** `tasks-revamp:76` asserts `?taskId=N$` and `:81` asserts
`/dashboard/tasks$` after the Board radio is clicked — the address is `?display=board&taskId=N`
and `?display=board` now, which is ruling 7 working. Nothing else in the three specs that touch
the boards names a removed string: *Change status for …*, the column regions (*To do tasks*)
and the page hints are unchanged.

**For the close-out's browser pass:** drag a card in both themes and see the raised column; pick
a new stage from the keyboard and confirm focus lands on the card's move control in its new
column; reload on `?display=board` and `?display=pipeline`; and look at the board in
`ModuleTableShell` at 768px — its right-edge fade is an `after:` float written for a `<table>`
child, and a flex child has not been seen under it.

**Left knowingly.** `OpportunitiesTable`'s value cell is `text-state-success` — ruling 2's *a
pipeline value is not good news*, on a 5.5 page this batch did not otherwise touch. Filed for
the close-out's correction commit. `Add Task` on the tasks toolbar is 5.9's Title Case.

**Next: batch 5** — `MonthGrid`: `TasksCalendar`, then `calendar/page.tsx` rebuilt around it, and
`CalendarEventDialog` onto `SegmentedBoolean`.

### Status: batch 5 — `MonthGrid`, and a picker that got the weekdays wrong

**Landed.** Ruling 5, rule first: `design.md` §7.14 and its §7.1 row.

- **`components/ui/MonthGrid.tsx`** — header, the 42-day grid, the narrow day picker with the
  selected day's agenda, and the entry box. **It draws no container**: the task calendar sits in
  the list's `ModuleTableShell`, the calendar page's in a `Card`. One controlled value,
  `selectedDay`: the month shown is the selected day's, so *Previous month* selects a day in
  the previous month and a month cannot disagree with its selection. Entries are
  `renderEntry(entry, "cell" | "row")` inside a button the grid owns, which is `Board`'s split
  — the call site supplies the inside, the primitive the box, hover and focus.
- **A container query, not `md` or `lg`.** The two originals switched to the picker at `md` and
  at `lg`. Neither is right for a primitive: at 1280px the task list's shell is ~980px wide and
  the calendar page's panel, beside the §4.4 20rem rail, is ~630px. The grid shows when *its own*
  box is 42rem (`@2xl/month-grid`), which is 96px a day. Checked in the built CSS
  (`container:month-grid/inline-size`, `@container month-grid (min-width:42rem)`), as batch 2's
  selectors were. **Rejected: a `compact` prop** — the caller would be guessing a width the
  browser already knows.
- **What the two disagreed on, and what won.**

  | | `TasksCalendar` | `calendar/page.tsx` | `MonthGrid` |
  |---|---|---|---|
  | Today | `bg-action-primary` filled circle | not marked | `font-semibold text-copy-primary`, `aria-current="date"` |
  | Selected (picker) | `border-primary bg-action-primary-muted` | same | `border-line-strong bg-surface-raised` |
  | *Has entries* dot | `bg-state-info` | `bg-state-info` | `bg-copy-muted` |
  | `+N more` | static text | static text | opens the day in a popover |
  | Day keyed in | browser zone | browser zone | `getUserTimezone()` — the zone the time is printed in |
  | Tab stops per month | 42+ | 84+ (numeral and *+* per day) | 1 numeral, plus the selected day's action |

- **Found: the task picker's weekdays were wrong.** It filtered the 42 days to the month and laid
  them straight into seven columns with no weekday row, so every month started in the first
  column. September 2026 begins on a Tuesday; its 1st sat where a Sunday goes. The picker now has
  the weekday row and the leading blanks. The calendar page's picker had the same bug.
- **Found: `+N more` hid entries.** A fourth task due on a day was unreachable in the grid on both
  pages — the text was not a control. It opens a popover listing the whole day, which closes when
  an entry opens its dialog.
- **Keyboard.** The day numerals are one roving tab stop: arrows by day and week, `Home` / `End`
  to the week's edges, `PageUp` / `PageDown` by month, crossing month boundaries, with focus
  following the selection (re-queried after render, the batch 3 and 4 pattern). The calendar
  page's *Create event on…* is `renderDayAction`, handed a `tabIndex` that is 0 on the selected
  day only.
- **`components/ui/ListStates.tsx`** — `renderListState`, `Board`'s four states lifted out
  unchanged. The task calendar would have been their third copy. `RecordTable` keeps its own:
  it splits the alert wrapper from the content, and takes error and permission slots the other
  two do not.
- **`TasksCalendar`** (178 → 75) — now in `ModuleTableShell` like the board, with the *Refreshing*
  badge instead of `· Refreshing…` in its subtitle, and the filtered-empty state it did not have:
  a filter that matched nothing said *No tasks to schedule*. The priority went from a
  `StatusValue` line per cell to words in the agenda row; a cell holds the title.
- **`calendar/page.tsx`** (631 → 391) — `PageShell`, then the §4.4 page split: the grid's `Card`,
  and a rail of *Pending invites* and *Calendar sync*.
  - **The *Selected day* panel is gone.** At the grid's width the cells and `+N more` show the day,
    and narrower the grid's own agenda does, so a third list of the same events was redundant.
  - **R5.** Event tone by response was a tinted box per event: `pending` warning, `shared` info,
    `declined` a muted ground. `pending` keeps a warning mark (an icon in the cell, *Awaiting your
    response* in the row) and nothing else, `shared` is ink, and `declined` is disabled ink with
    the word. Invites were warning-tinted boxes in a panel whose title already says they are
    pending; they are rows. Provider health was a `rounded-full` tinted capsule — `Pill` under
    another name — and is `StatusValue` over a descriptor, so *Ready* is ink.
  - **The header lost a bordered text box**, *External sync active for this session*, hidden
    below `xl`. It is the sync panel's description. Each provider's own *Sync* button, a second
    copy of the header's *Sync now*, went too.
  - **States.** The context error was a page-wide red banner about provider status; it is
    `PanelError` in the panel it describes. The events error keeps the grid's header so the
    operator can still leave a month that failed.
  - **The events query is keyed on the month**, not the selected day, so picking a day does not
    refetch.
- **`CalendarEventDialog`** — the hand-styled Radix `Switch` is `SegmentedBoolean` (*All day* /
  *Timed*) in a `Field`, as the message-template and webhook forms write it. `switch.tsx` has two
  importers left, both 5.3's. The *owner only* notice was a bordered box and is a line of ink.

**Verification:** `tsc --noEmit`, lint, build green, one at a time; `check-design.sh` at the known
2 of 14.

**Specs that will move at close-out.** `calendar-revamp` "keeps core scheduling usable on mobile"
asserts `getByLabel("Calendar month agenda")` — the region is *Event calendar* now, at every
width — and clicks *All-day event* expecting `data-state="checked"`, which is a Radix switch
attribute; the control is a radio group whose *All day* item takes `aria-checked`. Its other
assertions — *Previous month*, *Next month*, the event title (today's agenda), *New event*,
*Create Event* — should hold. "Provider cards hide technical sync details" asserts *Reconnect
required*, the failure line and *Reconnect Google*, all kept. `tasks-revamp:84`'s region *Task
due date calendar* is kept.

**For the close-out's browser pass:** both pages in both themes at 1440 (grid) and 1024 (the
calendar page's panel narrower than 42rem beside the rail — picker); the today numeral against a
selected cell; a day with four entries and its popover, then opening an entry from it; the arrow
keys across a month edge on the grid and on the picker, focus visible at every stop; and the
picker's first row against the weekday header on a month that does not begin on a Sunday.

**Left knowingly.** An event spanning several days is placed on its start day only, as both
originals did. The dialog's `Create Event` / `Save Event` / `Move To Recycle Bin` are 5.9's Title
Case.

**Next: batch 6** — `ListRow`: re-measure the row set first, then the activity / notification /
invite / message rows.

### Status: batch 6 — `ListRow`, and the eleven were fourteen

**Landed.** Rule first: `design.md` §7.15 and its §7.1 row.

**The re-measure.** The plan's *11 unshared row implementations* had no source, as the head of
the sub-phase warned. Counted over every `divide-y` and every mapped list of lines outside
`components/ui/`, with contracts and support out (decision 8), there are **fourteen**:

| Row | File | Was |
|---|---|---|
| Timeline entry | `RecordTimeline` | `divide-y`, icon, title `text-sm` |
| Audit line | `RecordAuditHistory` | `divide-y`, time `text-xs` |
| Notification | `NotificationCenter` | **action tint** for unread, time `text-[11px]` |
| Notification | `DashboardOperationalWidgets` | `-mx-4` bleed, time on its own line |
| Activity line | `DashboardOperationalWidgets` | module name as title, description second |
| Amount line | `DashboardCrmWidgets`' `AmountRow` | `divide-y` |
| Forecast bucket | `reports`' `ForecastBucketList` | **boxed**, tinted — batch 7's |
| Pending invite | `calendar/page.tsx` | title button, `ActionBar` under it |
| Provider | `calendar/page.tsx` | status beside, actions under |
| Mail message | `mail/page.tsx` | a `Button variant="ghost"`, **action tint** for selected |
| Linked task | `RecordTasksPanel` | **boxed**, tinted, two `Chip`s |
| Score factor | `leads/[leadId]` | `divide-y` |
| Document share | `DocumentList` | **boxed** list inside a boxed section |
| Document version | `DocumentList` | **boxed** list inside a boxed section |

Four boxes inside a panel (§1.3), two action tints carrying a state, three title weights and three
time sizes for one role. Thirteen are on the primitive; the fourteenth moves with `reports` in
batch 7.

- **`components/ui/ListRow.tsx`** — `RowList` (the `<ol>`/`<ul>`, its name, the rules) and
  `ListRow` (leading mark, title, one trailing value, one metadata line, body, actions). The call
  site supplies content only; the ink is fixed (§7.15).
- **The open gesture is the title, stretched.** `href` makes it a `Link`, `onSelect` a button, and
  its `after:absolute inset-0` box covers the row, so the row is the target, a link still opens
  in a new tab, and the actions sit above it on `z-10`. The focus outline is drawn on the
  stretched box — the row's edge, not the title's words. Checked in the built CSS, as batches 2
  and 5 were: `focus-visible:after:-outline-offset-2` compiles to `outline-offset: calc(2px*-1)`.
  **Rejected: the whole row as a `Link`** (the two notification lists' shape). A row with actions
  cannot be one — a button inside a link is invalid — so the pattern would have split in two the
  first time a row had both, which two of the fourteen do — the invite and the linked task.
- **`inset` is the list's.** A list in a padded panel drops its first and last rows' outer padding
  and underlines a link title on hover; an inset list (the popover, the mail card) pads every row
  `px-4` and raises it on hover with `bg-surface-row-hover`, the table's own token. **Rejected:
  a `-mx-2` hover ground in padded panels** — it draws a ground wider than the rules above and
  below it.
- **Actions sit at the row's end and wrap under the content** below a 12rem content column, which
  is how the calendar rail's invites fit in 20rem without a breakpoint. They are an `ActionBar`
  at `sm` (R4), so the invite buttons, `Complete`, `Revoke` and `Download` lost their call-site
  sizes.
- **R5.** `NotificationCenter`'s unread row was `bg-action-primary-muted` with a `bg-primary`
  dot — the fourth instance of the action tint carrying a state, as 5.6 batch 8 measured it. The
  mail list's selected row was the sixth, after batch 4's drop targets. Unread is `font-semibold` and a `bg-copy-primary` dot named *Unread*; selected is
  `bg-surface-raised`, §7.14's selected day. The timeline's delete went from a hand-painted
  `hover:bg-state-danger-muted` ghost to `variant="destructiveGhost"` (§7.3).
- **The dashboard activity line's title is what happened** — the description — with the module,
  action and record in metadata. It was the module name in bold over the sentence.
- **`NotificationCenter`'s states** were three hand-written blocks; they are `PanelStates`. The
  *Refreshing…* line was `text-[11px]`, off the ramp, and is `text-xs`.
- **`RecordTasksPanel`** — status and priority were two `Chip`s. A status is not a tag (§7.1);
  they are words in the metadata. The `Link` and `Chip` imports went.
- **`DocumentList`** — the detail section's two inner boxes went; its own tinted section box and
  its Title Case *Version History* / *Client Portal Access* labels stay, filed below.

**Verification:** `tsc --noEmit`, lint, build green, one at a time; `check-design.sh` at the known
2 of 14.

**Specs that will move at close-out.** None found by name. `notifications-revamp:52` finds the
link by `/Renewal task assigned/`, which the title still carries — but the link's accessible name
is now the title alone, not title, time and message; a spec reading the whole row through the
link will see less. `documents-revamp:361`'s *Revoke* is kept.

**For the close-out's browser pass:** the notification popover in both themes — unread weight and
dot, hover ground to the edge, focus outline inside the popover's clip; Tab through a row with
actions (the timeline's delete, a pending invite) and confirm the actions are reachable and
clickable above the stretched target; the calendar rail at 1440 and 1024 with an invite whose
buttons wrap; the mail list's selected row against its hover.

**Left knowingly.** `ForecastBucketList` → batch 7. `DocumentList`'s detail panel — a
`bg-surface-muted` bordered section with Title Case labels and a local `formatBytes` that
`lib/format.ts` already exports — is a documents surface, not a row; filed for the close-out's
correction commit. `DashboardModuleEntryPoints`, `DashboardQuickActions` and `RecordRelatedLink`
are **not rows**: each is a box earned by being a link (R8, 5.3's ruling on `RecordRelatedLink`),
and they were not counted.

**Next: batch 7** — `reports` rebuilt: raw `Table` → `RecordTable`, and `ForecastBucketList` onto
`ListRow`.

### Status: batch 7 — `reports`, and one failure that said so twice

**Landed.** 943 → 918 lines. Batch 2 had taken the page's metrics; this is the rest of it.

- **R10.** The display's *Table* was a raw `Table` in a `ModuleTableShell`; it is `RecordTable
  variant="readOnly" shellVariant="nested"`, the dashboard summary's shape. **`Table.tsx`'s
  importers outside the primitives are now the two client-portal pages, both 5.8's** — R10's
  count is true for everything 5.7 owns. The saved-reports table went `nested` too, and lost its
  per-row *Open* button: the row already opens the report and is labelled *Open saved report …*.
- **`ForecastBucketList`** — the fourteenth row from batch 6's count, and a tinted, bordered box
  inside the forecast card. It is a `SectionHeading` over a `RowList`.
- **One message per failure.** The page had four tinted `role="alert"` boxes, and two of them
  doubled another message:
  - *The report could not be generated* was a banner between the filters and the report panel,
    and the panel under it still drew *No report data yet*. It is the panel's `PanelError`.
  - `actionError` was one string for seven failures, drawn as a banner on the page **and** inside
    the save dialog — so a failed *Save as* printed its message twice, once behind the backdrop.
    The name conflict is a `FieldError` under *Name* with `aria-invalid`, and says what to do
    (*Choose another name*). The other six — update, delete, both exports, a preset the role cannot
    reach — are toasts, as batch 2 made the dashboard's.
  - The invalid forecast range is a `FieldError` under *End*, where `aria-describedby` already
    pointed. The forecast's load failure is `PanelError`.
- **R7.** Three `h2`s — `text-sm` twice and `text-base` once, all `text-copy-primary` — are
  `PanelHeader`. The report panel's display switch is its header's action.
- **States.** The chart's `Skeleton` box and its `EmptyState` are `PanelLoading` / `PanelEmpty`, and
  the no-modules and forecast-unavailable cards use `PanelEmpty` too.
- **Presets** were `bg-surface-muted` boxes that took `hover:border-action-primary/60` — the action
  tint as hover. A preset is a control, so it keeps its box (R8), with `border-line-subtle` and no
  ground, strengthening on hover, and a `focus-visible` outline in place of the ring.
- **R4.** The header's four buttons passed `size="sm"` into a page header; they take the header's
  height. *Clear* / *Delete* sat beside a default-height `Select` at `sm`; they are an `ActionBar`.
- ***Top result*** was a hand-written label over a value, and is a `Fact` (§7.12).

**Not `?display=`.** Table / Bar / Pie looks like ruling 7's case — one region, the same data — but
here the display is one field of a report configuration (module, grouping, metric, filters) that
is saved as a whole and that the address does not carry. Addressing only the display would reopen
a link on the *default* report in the linked display. Written into the vocabulary row in
`design.md` so the next reader does not "fix" it.

**Verification:** `tsc --noEmit`, lint, build green, one at a time; `check-design.sh` at the known
2 of 14.

**Specs that will move at close-out.** `reports-revamp` keeps every string it asserts: *Forecast
unavailable*, the `Bar` radio, *Insertion Orders report* as a heading (now `PanelHeader`'s `h2`),
*The report could not be generated…*, *No records match these filters*, *Clear filters*, the
saved-report row name, *Save changes*, *Delete saved report?*, and the date error with
`aria-invalid`. None of its assertions name the removed *Retry* buttons, which `PanelError` replaces
with *Try again*. No spec covers the *Save as* failure, which moved into the dialog — so nothing
checks that move.

**For the close-out's browser pass:** the forecast card at 1440 with the date range reversed (the
error under *End*, and no empty band where the figures were); the report panel in Table display in
both themes; a preset's hover and focus.

**Next: batch 8** — `mail` rebuilt, `RecordEmailComposer`, `TaskDialog`, and the shell `adopt` rows:
the sidebar with A11 (ruling 6), `ProfileMenu`, `GlobalCommandPalette`, `chart.tsx`.

### Status: batch 8a — the shell, and a nav that marked its place with the action tint

**Landed.** Batch 8 is split: **8a** is the shell rows (sidebar with A11, `ProfileMenu`,
`GlobalCommandPalette`, `chart.tsx`), **8b** is `mail`, `RecordEmailComposer` and `TaskDialog`.
Rule first: `design.md` §7.16 and its §7.1 row.

- **§7.16 — the current page is ink and elevation.** The sidebar marked it with
  `bg-action-primary-muted text-primary` inside a `border-primary/20` box, and 5.6's
  `SettingsNavRail` copied that string by hand so the two navs would match. It is the seventh
  instance of the action tint carrying a state. **`navItemClassName(active)`** in `SidebarNav`
  is the one treatment, and the rail imports it, so the copy cannot drift again: current is
  `bg-surface-raised`, primary ink and a `bg-copy-primary` bar; hover is `bg-surface-muted` with
  no border (pointing at an item used to box it).
- **A group whose current item is showing does not mark itself.** The group button and the child
  under it were both tinted: one position drawn twice. The group takes primary ink, and ground
  plus bar only when the child is hidden — closed, or the sidebar collapsed to icons.
- **Found: closed groups were in the tab order.** `max-h-0 opacity-0` hid the links and left every
  one of them focusable, so a keyboard user tabbed through each module of each closed group
  invisibly. The list is `inert` while hidden, and the button carries `aria-controls`. Child links
  also lacked `aria-current`; they have it.
- **A11 (ruling 6)** — `Sidebar` renders a group of one as `SidebarMenuItemLink`, the group's
  icon and the item's label. Generic, as ruled.
- **The sidebar's other two controls** — *Collapse sidebar* hovered in the action tint, *Log out*
  in the danger pair. Logging out loses nothing, so it is not destructive (§7.3). Both hover
  `bg-surface-muted`. The wordmark link's `focus:ring` is `focus-visible`.
- **`ProfileMenu`** — a `Popover` holding three hand-styled rows is `DropdownMenu`: `role="menu"`,
  arrow keys, typeahead, focus returned to the avatar. Its *Log out* lost the red too.
- **`GlobalCommandPalette`** —
  - **Found: every record group printed its module name twice.** The groups passed cmdk's
    `heading` *and* drew their own label; cmdk renders `heading` visibly (and `aria-hidden`,
    naming the listbox group from it). The other three groups drew only their own label, so their
    groups had no name. All four use `heading` now, styled through `[&_[cmdk-group-heading]]` —
    checked in the built CSS, as batches 2, 5 and 6 were.
  - The item class was written four times and had drifted (the record results had lost the flex
    row); it is one constant, and the label/subtitle pair one component. The recent rows' *Recent*
    tag went — the group heading says it.
  - *Searching records…* is `PanelLoading`; the tinted error box is `PanelError`.
  - `DialogPanel` was handed back its own ground, edge, radius and a shadow the primitive already
    sets (§4.6). `text-[11px]` ×2 is `text-2xs`; the ⌘K hint is a `kbd`. *Recent Pages* /
    *Quick Links* went sentence case while the lines were rewritten.
  - **Not changed: the selected item's `bg-action-primary-muted`.** It is the listbox
    active-option token 5.10 measured and held for the owner, shared with `select.tsx` and
    `DropdownMenuItem`. §7.16 records why a nav's current page could be ruled on and this could
    not.
- **`chart.tsx`** — read against the `dataviz` rules and already met them (values and labels in
  ink, the swatch carrying identity). The swatch's fallback was a raw `var(--chart-1)`; it is
  `seriesColor(0)`, the one legal source.

**Verification:** lint, `tsc --noEmit`, build green, one at a time; `check-design.sh` at the known
2 of 14. The host had rebooted and the frontend container was down, so each ran in a
`docker compose run --rm --no-deps` container. That goes through `COMPOSE_FILE`, so it keeps the
CPU cap and does not start the backend on frappe's port.

**Specs that will move at close-out.** `command-palette-actions` "record-search failures…" asserts
*Search is temporarily unavailable. Check your connection and try again.* as one string. `PanelError`
prints the message and its *Check your connection…* line as two elements, so the text is the same
but it is split across them. Its *Try again* button is kept. `application-shell-refactor:43` counts
one *Log out* button, and that still holds: the profile menu's is a `menuitem` now, and closed. A
spec that clicked the *Reports* group button in the sidebar will find a link.

**For the close-out's browser pass:** the sidebar in both themes, expanded and collapsed: the
current item's ground against the hive backdrop, and a collapsed group icon carrying the mark. Tab
from the wordmark to *Log out* with one group open and confirm no focus stop disappears. Check the
settings rail beside it, and open the profile menu from the keyboard. In the palette, look at a
record search with two modules: one heading each.

**Left knowingly.** The sidebar's *Log out* and the profile menu's are the same action in two
places. `application-shell-refactor` asserts the sidebar's, so which one goes is the owner's call.

**Next: batch 8b** — `mail/page.tsx` rebuilt (its message rows are batch 6's), `RecordEmailComposer`,
`TaskDialog`.

### Status: batch 8b — `mail`, and a header that did the rows' work

**Landed.** The last rebuild rows 5.7 owns.

- **`mail/page.tsx` (739 → 727) is the §4.4 page split**, the calendar page's shape: a messages
  `Card` and a 20rem rail holding *Mail connections*.
  **Rejected: connections on top, as they were.** Three boxed provider cards pushed the inbox —
  what the operator opens the page for — below the fold. **Rejected: moving connections to
  settings/integrations.** Mailboxes are per user and the OAuth connect runs from here.
  - **The list and the message sit side by side once the card is 48rem** (`@3xl`), which beside
    the rail is a 1440 viewport. Narrower, the message follows the list as it did. A container
    query for the reason §7.14 gives; checked in the built CSS (`@container (min-width:48rem)`).
  - **Header (ruling 3's reasoning).** *Manage Integrations*, *Sync IMAP*, *Reconfigure IMAP*,
    *New Mail*. The middle two repeated the IMAP row's own actions; *Manage integrations* is the
    empty state's action now. The header is *New mail*.
  - **Connections are `ListRow`s**: status as `StatusValue`, mailbox and last sync as `Fact`s,
    *Manage* / *Sync* as row actions named for the provider (*Sync Gmail*). R5: the green *Inbox
    sync is available* box went, since *Ready* already says it. The warning box is a warning
    line. The scope chips (`gmail.send`) went too: technical detail, and the calendar rail never
    showed them. **§7.9**: *Sync* was drawn disabled on every send-only mailbox; it is drawn
    where it can run.
  - **The IMAP form was a card that opened between the connections and the inbox.** It is an
    `EditorPanel` (§7.11), opened from the IMAP row or from *Connect IMAP/SMTP* under the rail.
    Closing it clears the password, as a successful save already did.
  - **The reader.** Subject over `Fact`s (*From*, *To*, *Received* / *Sent*, *Linked record*).
    The green *Linked to …* box and the *Open Linked Record* button said one thing twice, and the
    fact's value is now the link. The body was a bordered, recessed box inside the card (§1.3); it
    is prose under a rule, and it comes **before** *Link to a record*, not after. Link targets were
    full-width outline buttons with *Link* printed inside. They are rows now, with a *Link* action.
  - **States.** Two tinted error boxes and two loading lines are `PanelStates`. A folder or
    search that matched nothing said *No mail messages yet — connect Gmail…*; it says *No messages
    match*.
- **`RecordEmailComposer`** was already close. Its local `formatBytes` is `lib/format`'s, which
  5.6 wrote to end four such copies. This was the fifth, and it rounded KB to integers. Each
  attachment was a bordered, recessed box in the dialog; they are a divided list. Cc and Bcc were
  **one `Field` with two labels**, so the error under them belonged to neither; they are two. The
  no-mailbox buttons are an `ActionBar` without call-site sizes.
- **`TaskDialog`** — the footer held up to **six** controls: *Move To Recycle Bin*, *Add To
  Calendar* (disabled as *Already On Calendar* once it was), *Open Calendar Event*, *Remove From
  Calendar*, *Cancel*, *Save Task*. The calendar three act on the task's calendar entry, not the
  form, so they are a *Calendar* section that says *On the calendar for …* or *Not on the
  calendar*. *Assignments* was `text-copy-primary` over a `FieldDescription`; it is a
  `SectionHeading`. The option loading line and tinted error are `PanelStates`. The top-of-dialog
  submit error keeps its tinted alert, the same as `CalendarEventDialog`.

**Verification:** lint, `tsc --noEmit`, build green, one at a time, in `run --no-deps` containers
as in 8a; `check-design.sh` at the known 2 of 14.

**Specs that will move at close-out.** `mail-revamp` "IMAP settings use labeled controls" clicks
*Reconfigure IMAP*. It finds the IMAP row's *Reconfigure* button, named *Reconfigure IMAP/SMTP*,
by substring, and the form is in a sheet now. *Mailbox email*, both security comboboxes, *Disconnect
IMAP* and the confirmation are kept. Its note that *"the page behind the dialog has its own
Cancel"* is still true: the sheet's. "Mail hides technical provider…" keeps *The provider needs
attention…* and *We could not load mail messages.* `tasks-revamp` keeps *Edit Task*, *Create Task*
and *Task title*. Nothing asserts the calendar buttons' old names.

**For the close-out's browser pass:** mail at 1440 (side by side) and 1280 (stacked) in both
themes. Open the IMAP sheet from the row, then run disconnect's confirm over the sheet. Tab through
the reader: facts, the linked-record link, the link search, then a result's *Link*. Check a task
dialog with a linked calendar event, and the composer's attachment list with more than five files.

**Left knowingly.** `mail/page.tsx` still hard-codes `linkedRecordHref` per module, a registry
question and not a visual one. *Create Task* / *Save Task* / *Move To Recycle Bin* are 5.9's Title
Case, asserted by `tasks-revamp`.

**Next: batch 9** — 5.7's close-out: `check-design.sh`, both rendered guards, the specs named in
batches 2–8b, the browser pass collected above, and one correction commit carrying the items filed
for it (`OpportunitiesTable`'s green value cell, `DocumentList`'s detail panel).

### Status: batch 9 — close-out, and six specs out of sixty-seven

**5.7 is complete.** Every census row it owns is marked, the attribution is done, the browser pass
found five things and all five are fixed.

**What ran.**

| Check | Result |
|---|---|
| `check-design.sh` | **2 of 14**, the known baseline — no 5.7 file adds a source-rule failure |
| `lint`, `tsc --noEmit`, `build` | Green, after the last correction |
| `design-rules.spec.ts` | Green, **`Audited 94 routes. Unreachable: none`** — twice, the second after the browser-pass fixes |
| `scroll-containers.spec.ts` | Green before the browser-pass fixes, and **green again after all of them** (2.5m), once the database was back |
| The in-scope suite — 285 tests in 54 files (all but the two guards, contracts and support) | **218 passed / 67 failed** at `b0d3ff5` |
| The attribution — the 67 re-run against pre-5.7 (`9923ceb`) on the same dev server | **61 fail there too. 6 passed before 5.7** |
| The browser pass — 11 routes × 2 themes at 1440, the same at 768, a 40-stop tab walk, the palette, the profile menu, a keyboard move, the month grid | Five findings, fixed |

#### The six, read against the diff

| Spec | What it was |
|---|---|
| `tasks-revamp:61` | **Ruling 7.** Opening a board card keeps `?display=board`; the spec asserted the address without it. Predicted in batch 4's status |
| `dashboard-edit-mode-revamp:126` | **Batch 2.** Discard is a `useConfirm` dialog; the spec accepted a native `dialog` event that no longer fires. Predicted in batch 2's status |
| `command-palette-actions:268` | **Batch 8a.** `PanelError` prints the failure and *Check your connection and try again.* as two elements. Predicted |
| `custom-modules-revamp:94` | **Batch 1.** The dashboard's module summary names each module as a link, so `link "Projects"` matched the summary as well as the sidebar. Scoped to *Primary navigation* — the guard under test is the sidebar's |
| `accounts-revamp:92` | **Load flake.** Passed alone at HEAD (14.5s); in the suite it ran into the 30s test timeout |
| `application-shell-refactor:19` | **Load flake.** Passed alone at HEAD (6.6s) — the centring poll's 5s window, under a loaded box |

**None was an app defect.** The four contract moves are fixed in the specs; the two flakes are listed
under *Known flaky* in `docs/e2e-suite-status.md`. A seventh, `command-palette-actions:287`, timed out
at exactly 30s in the targeted re-run after passing in the full suite, and passed alone in 27.8s: a slow
test under load, not a regression.

#### The browser pass — five findings

Themes proved distinct by measurement, as 5.6 prescribed: body ground `rgb(11, 13, 16)` dark,
`rgb(247, 248, 250)` light. Screenshots under `frontend/test-results/browser-pass-57/` (not committed).

- **`reports` ran off the page at 768.** Batch 7 took `size="sm"` off the header's four buttons, which
  made the row wider than 528px — and `PageHeader`'s action row was `sm:shrink-0`, so it could not wrap.
  *Save changes* sat past the right edge and the content scroller scrolled sideways (572 > 528). It is
  `sm:min-w-0` now, and the row wraps inside itself. The same change took `tasks` (552) and
  `settings/users` (659) back to 528 as well. **The fix is in a shared primitive** and was re-checked on
  all three routes, and `design-rules` was re-run over all 94 routes after it.
- **The command palette's search input was the one focus stop with no indicator.** `outline-none` with
  nothing in its place (§2.3); it has been that way since before 5.7, and 8a adopted the file without
  seeing it. It takes the focus ring now — measured, `rgb(143, 154, 168) 0 0 0 2px`.
- **Mail with no messages pinned its empty state to the left third of the card.** The list and reader
  split applied whether or not a message was open. The split is conditional on a message now.
- **The task board's *Items per page* was blank**, and older than 5.7: the board sets a page size of 100,
  which is not a configured option, and a Radix `Select` shows nothing for a value no item carries.
  `Pagination` appends the current size when it is missing. Its trigger was a fixed `w-[65px]`, which
  clipped `100` to `10(`; it is `w-20`.
- **`dashboard/layout.tsx`'s *Checking access...*** was a recessed, bordered box standing where the page
  would be. It is `RouteLoadingState`. Found while marking the last unmarked census rows, not in the pass.

**What the pass cleared rather than found:**

- **No page scrolls sideways at 1440** on any of the 11 routes, in either theme.
- **The tab walk has no invisible stop.** Forty stops from the top of `reports`: wordmark, collapse,
  the eight sidebar entries — *Sales → Finance* directly, so the closed groups' links really are
  `inert` — *Log out*, the palette, notifications, profile, then the page. Every stop draws an outline
  or a ring. (The first attempt at this walk opened the palette with its own starting click and walked
  the palette's input forty times; that is how the input's missing ring surfaced.)
- **A11** — *Reports*, *Services* and *Support Cases* render as links; the current one carries the
  §7.16 ground and bar in both themes, and a collapsed sidebar shows it on the icon.
- **Palette headings** — each record group's heading occurs once. *Modules:4* is the heading plus three
  items' *Modules* type tag, which is content, not a repeat.
- **Profile menu** — Enter opens a `role="menu"`, arrows move between `menuitem`s, Escape returns focus
  to *Open profile menu*.
- **`SortableList`** — *Move Notifications up* twice from the keyboard moved the widget from 10 to 8 with
  focus on the same control after both presses: batch 3's reasoned-not-observed focus restore, observed.
  Cancel and *Discard changes* wrote nothing.
- **`MonthGrid`** — ArrowDown six times from 16 September crosses into October a week at a time, a ring
  at every stop; at 1024 beside the rail the picker's first row starts on Tuesday under *Tue*, which is
  September 2026's.

#### Two environment facts that cost time, for whoever runs this next

- **A production build leaves a `.next/` that can hang the dev server.** The per-batch builds ran in
  `docker compose run --no-deps` containers, which write `frontend/.next` through the bind mount; the dev
  server started over it sat on `Compiling /dashboard/calendar` at 0% CPU until every warm-up curl timed
  out. `rm -rf frontend/.next` (from a container — the files are root-owned) and it compiled in 6s.
- **`docker compose run frontend-e2e` without the port override recreates the stack from the base file**,
  whose backend binds 8000 — frappe's. It took the running backend down. Every e2e command needs the same
  `-f docker-compose.yml -f docker-compose.limits.yml -f <override>` *and* `--no-deps`.
- And the known one, arriving on schedule: **the remote Postgres went away** at about 02:15 — first
  `server closed the connection`, then `Connection timed out` to `100.107.171.33:5432` on restart. Logins
  fail as *Expected login to reach the dashboard or MFA challenge*, which is how `scroll-containers`'
  post-fix re-run read. Check `docker compose logs backend | grep OperationalError` before believing a
  login failure. **When the host can reach the database again, the backend container may still time
  out** — restart it; its startup retry loop does not recover by itself.

### What 5.7 leaves open, deliberately

| Item | Owner |
|---|---|
| Widget titles in Title Case (`CRM Snapshot`, `Leads By Status`), *Create Task* / *Save Task* / *Move To Recycle Bin*, *User Invite* / *Team Share*, *Add Task* — each asserted by a spec or catalogued | 5.9 |
| The sidebar's *Log out* and the profile menu's are the same action twice; `application-shell-refactor` asserts the sidebar's | The owner |
| The listbox / menu active-option ground (`--color-primary-muted`) in `select.tsx`, `DropdownMenuItem` and the palette | 5.10, with the owner (§7.16) |
| `mail/page.tsx`'s per-module `linkedRecordHref` | A registry question, not a visual one |
| An event spanning several days is placed on its start day only | A feature, not a rebuild |
| 61 suite failures that also fail before 5.7 | Not this sub-phase's — `docs/e2e-suite-status.md` |

---

## 5.8 — Client portal, public, and auth

Was consistency-pass Phase 7. The portal is a second app, not a second theme: **no
`app/client/layout.tsx`**, 25 repeats of `min-h-screen bg-app`, 21 of the `font-lynk`
wordmark, container width drifting six ways, **not one layout or state primitive imported
anywhere under `app/client`**, and 35 hand-written loading / empty / error branches. Its 7
detail pages are archetype 2 from 5.3 and land on that archetype, with the rail collapsed
(ruling 2). Every count in this paragraph is the re-measured one — the four the plan
originally carried are recorded with their corrections below.

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

### Decided before the first line — the measurement, the batch order, and seven rulings

**Measured at the start of the sub-phase, 2026-09-23.** `check-design.sh` is at the known
**2 of 14** (`LynkSplash` → 5.9, `ClientPageCreateForm` → 5.8's own). The surface is **2,856
lines** across `app/client` (21 files), `app/public` (1) and `app/auth` (4), plus
`app/page.tsx`, `BookingForm` (502), `PublicBookingPage` (23) and `ClientPageCreateForm`
(371). 26 files in scope; `client/support` and `client/support/[caseId]` are out of the
programme (scoping decision 8) and are carried by the layout without being rebuilt.

**Four claims in the plan above were re-measured, and all four moved.**

- **`min-h-screen bg-app` is 25 repeats, not 20**, and `font-lynk` is 21 — that one held.
- **The container width drifts six ways, not four**: `max-w-6xl` (9), `5xl` (7), `md` (6),
  `sm` (1), `4xl` (1), `3xl` (1).
- **"Exactly one dashboard primitive imported (`Button`)" is wrong, and the true statement is
  worse.** `app/client/**` imports seven — `button` (17), `textarea` (7), `input` (6),
  `Table` (2), `RequiredMark` (2), `field` (2), `select` (1). Every one is a *form control or
  a table*. **Not one layout or state primitive is imported anywhere under `app/client`**: no
  `PageShell`, no `Card`, no `EmptyState`, no `RouteStates`, no `ListRow`, no `StatusValue`,
  no `Money`. The controls arrived because a form needs an input. The shell is hand-written
  in full, 16 times.
- **The hand-written state blocks are 35, not 18**: 15 `isLoading ?` chains, 13 error
  branches, 7 `length === 0` empties — and 18 distinct *"Loading …"* strings, which is where
  the original count came from. It counted the loading arm and missed the other two.

And two nobody had counted:

- **`money()` is written eight times** — `catalog`, `catalog/[kind]/[itemId]`, `orders`,
  `orders/[orderId]`, `quotes`, `quotes/[quoteId]`, `pages/[token]`, and
  `public/quotes/proposal/[token]`, the last with a widened null-tolerant signature. `Money`
  has existed since 5.4.
- **The type is entirely off the §3.3 ramp.** 22 `text-3xl`, 14 `text-2xl`, 8 `text-xl`,
  against **one** `text-lg` on the whole surface. §3.3 caps product UI at `text-lg`.

**`tokens.md` §3.5 names four ambient tokens and `globals.css` defines one.**
`--noise-texture` is there; `--ambient-grid`, `--ambient-vignette` and `--ambient-card-glow`
are specified and do not exist. The rule landed without the value behind it — §12's repeated
lesson, and the reason `auth/layout.tsx` is still raw `rgba()`.

**The plan above says the 7 detail pages are "archetype 7".** There is no archetype 7. There
are exactly seven detail pages and the census marks each one archetype 2; read as archetype 2
throughout. Corrected in the line above.

#### Ruling 1 — the portal gets a left rail, not a top nav

**The owner's call, 2026-09-23.** The portal's defect is A8's exactly: with no
`app/client/layout.tsx` the hub is the only index, so Orders → Quotes round-trips through
`/client`. Settings had the same defect and `SettingsNavRail` fixed it.

`ClientPortalRail` is **built from the sidebar's own parts** — `SidebarNav`, `SidebarMenu`,
`SidebarMenuItemLink` — not a copy of them, so the active treatment is `navItemClassName`
itself and the portal marks its place the way the rest of the app does (§7.16). It carries
the same `w-60` / `w-[4.5rem]` collapse on its own storage key, and, like the dashboard, it
has **no "Home" entry**: the wordmark is the way back. That is not a style choice —
`useIsActive` matches on `startsWith(href + "/")`, so a `/client` entry would light up on
every page in the portal.

**Rejected: a horizontal section nav under the identity bar.** Seven flat peers are what a
top nav is for, it leaves the full width to the line-item tables, and it reads as the
vendor's customer area rather than as a seat in the vendor's CRM. It was rejected because
one shell language across both apps is worth more than the width, and because ruling 2
removes the cost that argued for it.

#### Ruling 2 — archetype 2's rail collapses when nothing on the record is editable

Ruling 1 buys a 16rem rail. Archetype 2's signature is a 20rem spine (R9). Stacked, that is
**36rem of rail before any content** on all seven portal detail pages — the pages a customer
actually opens, and the ones carrying line-item tables.

The resolution is not a narrower rail. It is that **the spine has nothing to hold here.** R2
draws its boundary between *state that edits in place* and *content that is read-only*, and
R9 chose position to answer "what is clickable" where a convention could not. A portal
record is read-only in full (R10 gives it `RecordTable variant="readOnly"`). A 20rem rail
whose every field is read-only is the signature spent on nothing — it teaches the customer
that the left column is where you change things, on a surface where nothing changes.

So: **archetype 2 with no editable field collapses its spine.** The record's identity, status
and money go to `PageShell`'s `eyebrow` / `title` / `context`, its meta goes to a single
`RecordSpineMeta`-shaped line under the header, and the content region takes the full width.
This is written into `design.md` §4.7 before any page adopts it. The census already called
this "archetype 2, rail collapsed" on all seven rows; this ruling is what that phrase means.

#### Ruling 3 — `/client/login` takes `/auth/login`'s treatment, and §9 widens

**The owner's call, 2026-09-23**, on the question the plan left open. One front door for the
product: `/client/login` gets the hive, the grid shimmer, the vignette and the glass card.

§9 currently licenses the hive on "the auth background, the splash, and the dashboard's
ambient backdrop". It widens to name the client portal's login, and only its login — the
portal's *interior* is a surface a customer works inside, where §9's prohibition stands
unchanged.

**Rejected: keeping them different.** The portal is the tenant's customer area and Lynk's
atmosphere at full strength there advertises Lynk to someone who is not its user. Overruled:
a sign-in page is the product's door wherever it stands, and two doors that are recognisably
the same product is worth more than the distinction.

The mechanism is `app/auth/layout.tsx`'s, so it moves to a shared `AuthAtmosphere` rather
than being written twice — `/client/login` is not under `app/auth`, and a copy is how the two
would drift.

#### Ruling 4 — the layout owns the width, the page never sets one

Six container widths exist because every page set its own. `app/client/layout.tsx` sets one
and no page under it carries a `max-w-*` on its root. `max-w-6xl` is the value: it is already
the most common (9), and the order and quote detail pages are line-item tables that need it.

#### Ruling 5 — the portal's states come from `PageShell`, with `backHref="/client"`

All 35 hand-written branches go. `PageShell`'s `isLoading` / `hasError` already supply the
route-level cases and `EmptyState` supplies the fourth; the portal's only addition is that
its error and permission states must send the customer back to `/client`, not to
`/dashboard`, which is `PageShell`'s default. A portal page that renders a state pointing at
the dashboard is a customer looking at a login wall.

#### Ruling 6 — `Money` replaces the eight `money()`

Including `public/quotes/proposal/[token]`'s null-tolerant variant — `Money` already takes
`amount: number | string | null | undefined` and an `EmptyValueContext`.

#### Ruling 7 — the ambient tokens are defined before `/auth` is touched, and the hive is screenshotted

`--ambient-grid`, `--ambient-vignette` and `--ambient-card-glow` are added to `globals.css`
in both themes, per `tokens.md` §3.5's existing specification, and `auth/layout.tsx` then
consumes them. The light theme gets its own values — a vignette tuned for a dark ground
reads as dirt on a light one (§3.5).

**`/auth` is screenshotted in both themes before and after, and the honeycomb is confirmed to
still be a honeycomb.** This is on the exit criteria and cannot be delegated to an assertion:
§9 records a previous attempt that replaced the hive with a *triangular* lattice at invisible
contrast and passed every grep and every guard in this repo.

### The batch order

| Batch | What |
|---|---|
| 1 | The rules into `design.md` / `tokens.md`, the three ambient tokens, `ClientPortalRail`, `app/client/layout.tsx`, and `client/page.tsx` as the shell's first consumer |
| 2 | `AuthAtmosphere` + the tokenised `auth/layout.tsx`; `/client/login` onto it (ruling 3); `auth/setup-password`, `AuthCallbackClient`, `client/setup` |
| 3 | The seven list pages onto `PageShell` + `ListRow` / `RecordTable` + `EmptyState` + `Money` |
| 4 | The seven detail pages onto archetype 2, rail collapsed (ruling 2) |
| 5 | The public surfaces — `public/quotes/proposal/[token]`, `client/pages/[token]`, `BookingForm`, `PublicBookingPage`, `app/page.tsx` — and `ClientPageCreateForm`'s `size-6` |
| 6 | Close-out: the guards, the in-scope suite with its attribution baseline, and the browser pass including the hive |

### Status: batch 1 — the file that was missing, and seven links that were never navigation

**Landed.** The rules first (§12), then the values, then the shell, then its first consumer.

**`design.md` §9 widened and archetype 2 gained a variant, before any page moved.** §9 now
licenses the hive on `/client/login` and names the portal's *interior* as still out — the
prohibition it already carried for "anything an operator works inside" needed saying for a
surface a *customer* works inside. Archetype 2 gained **the read-only variant**: a record
with no in-place state field renders without the spine, its identity and status in
`PageShell`'s `eyebrow` / `title` / `context` and its content region at full width.

The variant's test was sharpened while batch 4's pages were being read, and it matters: it is
**"does this record have a state field that edits in place"**, not "does this page have any
control". The portal's quote page carries Approve, Reject and Download and still takes the
variant, because none of the three is a field — R1 already routes an approval through an
explicit confirm rather than a silent commit, and actions have never belonged in the rail.

**The three ambient tokens exist now.** `tokens.md` §3.5 has named `--ambient-grid`,
`--ambient-vignette` and `--ambient-card-glow` for a sub-phase, and `globals.css` defined
**one** of the four (`--noise-texture`). That is the §12 lesson in its purest form — the rule
landed, nothing supplied the value, and `auth/layout.tsx` went on carrying raw `rgba()`
because there was nothing else to write. Both themes get their own: light inverts the grid to
ink, drops the vignette to a quarter of its dark strength, and earns the card's depth from a
faint ink shade at the bottom right, because a white shimmer on a white ground is invisible
and a black vignette reads as dirt.

**`ClientPortalRail` is built from the sidebar's parts, not styled to match them.** It
renders `SidebarNav` / `SidebarMenu` / `SidebarMenuItemLink`, so the active treatment *is*
`navItemClassName` (§7.16) — the third consumer of the one class, after the sidebar and
`SettingsNavRail`. It carries the sidebar's `w-60` / `w-[4.5rem]` collapse on its own storage
key, because a customer's portal and an operator's dashboard are different sessions.

**`lib/client-portal-nav.ts` is the portal's `SETTINGS_NAV_GROUPS`.** The seven sections were
a private array inside `client/page.tsx`; the rail would have been a second copy of it. `key`
is the metric key the overview endpoint returns, so the hub pairs a count to a section
without a second mapping. Two section labels shortened to fit one value per role — *Support
tickets* → *Support*, *Catalog items* → *Catalog*.

**`app/client/layout.tsx`, 82 lines, and three routes deliberately excluded.**
`isPortalChromeRoute` keeps the chrome off `/client/login` and `/client/setup` — pre-auth
doors, where a rail of destinations you cannot reach yet is a wall with handles drawn on it —
and off `/client/pages/[token]`, which renders in the **tenant's** branding, with the
tenant's logo, accent and company name. Lynk's own rail across the top of that is the wrong
company's chrome.

**The hub, and what came off it.** `client/page.tsx` 145 → 120 lines, and every one of the
chrome lines went: `min-h-screen bg-app`, `mx-auto max-w-6xl`, the `font-lynk text-3xl`
header, the sign-out button (now the rail's), the loading line, the error card, the
hand-rolled metric tiles and the hand-rolled action rows. What replaced them: `PageShell`
with `isLoading` / `hasError` and `backHref="/client"` (ruling 5 — its default is
`/dashboard`, which for a customer is a login wall), seven `Card variant="interactive"` tiles
each holding a `StatTile` (R8, and 5.7 ruling 1's one exception for a tile that is also a
link), a `FactList` for the pricing group, and `RowList` / `ListRow` for next actions with an
`EmptyState` behind them.

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run lint` | Clean |

**Next.** Batch 2 — `AuthAtmosphere`, the tokenised door, and `/client/login` onto it.

### Status: batch 2 — one door, written once, and a raster that inverted the wrong way

**Landed.** Ruling 3 in code: `/client/login` and `/client/setup` now open on the same
surface as `/auth/login` — the hive, the grid shimmer, the vignette and the glass card.

**`AuthAtmosphere` is shared, not copied.** `/client/**` is not under `app/auth`, so a route
layout could not reach it and the only other option was writing the atmosphere a second time,
which is how the two doors would have drifted apart. `app/auth/layout.tsx` is 40 → **14
lines** and is now a one-line consumer.

**The raw `rgba()` is gone and the layers are not.** Three arbitrary values became
`--ambient-grid`, `--ambient-vignette` and `--ambient-card-glow`, which batch 1 defined. The
composition is unchanged — same z-order, same opacities, same `mix-blend-soft-light` on the
shimmer — because §9's instruction is to tokenise them, not to delete them, and the failure it
records is a "cleanup" that left a login form indistinguishable from a template. **The hive
is on the exit criteria and is confirmed in batch 6's browser pass, in both themes.** No
assertion in the suite can tell the two outcomes apart.

**Two defects found while adopting, neither of them in the plan.**

- **`auth/setup-password`'s h1 was `font-lynk text-5xl` reading "Set Password".** The brand
  face doing a page heading's job — §3.1 is explicit that `.font-lynk` is the wordmark and
  never product UI. It is the wordmark at the door's one size now, with the task named on the
  line beneath, which is where `/auth/login` has always put it.
- **`AuthCallbackClient` drew a 240px `/error.png` under a blanket `invert`.** `invert` is
  theme-blind: it is tuned for the dark ground and flips the wrong way in light, and nothing
  asserts on it. The raster carried no information the line beneath it did not, so it is an
  `AlertTriangle` at `text-state-danger` — which is themed, and a twentieth of the weight.
  The block also gained `role="alert"`, which it never had.

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run lint` | Clean |

**Deferred inside the sub-phase:** `auth/login/page.tsx` (426) is marked `rebuild` and keeps
its content for now — it is already on `Label` / `Input` / `Button`, its hand-authored
Google and Microsoft marks stay by §5, and what is actually wrong with it is copy
(*"Redirecting..."*, *"Authenticator Code"*), which is 5.9's. Batch 6 re-reads it before the
sub-phase closes rather than leaving the row unexamined.

**Next.** Batch 3 — the six in-scope list pages onto `PageShell` + `ListRow` + `EmptyState` +
`Money`.

### Status: batch 3 — six lists, and 462 lines became 425 with four more states in them

**Landed.** The six in-scope list pages — quotes, orders, documents, bookings, catalog,
messages — onto `PageShell` + `RowList` / `ListRow` + `EmptyState` + `Money` + `StatusValue`.
`client/support` is untouched (scoping decision 8) and renders inside the new chrome
unchanged.

**Every page lost the same seven lines** and gained the states it never had: the
`min-h-screen bg-app` root, the `mx-auto max-w-*` container (ruling 4 — the layout owns it),
the wordmark header, the ad-hoc "Overview"/"Catalog" button that was the page's only
navigation, the eyebrow that repeated what the rail now says, the loading line, the error
card. What replaced the last two is `PageShell`'s `isLoading` / `hasError` with
`backHref="/client"` and a working **Try again** — none of the six had a retry before, so a
failed load was a dead end with no way out but the browser's back button.

**`money()` is down from eight copies to two.** Six went here; `pages/[token]` and
`public/quotes/proposal/[token]` are batch 5's. `Money` was already taking
`string | number | null | undefined`, so no call site needed the null-tolerant variant that
had been written by hand.

**The catalog stopped being a card grid.** Three columns of bordered cards, one box per
product, each saying what a row says in a line — §1.5 is explicit that density is a feature
and a row beats a card. It is a `RowList` now, with the price and availability as trailing
ink and the description as the row's own line. Its search moved to `SearchBar` in
`PageShell`'s `actions`, which also removed a hand-positioned magnifier and its
`absolute left-3 top-1/2 -translate-y-1/2`.

**A service has no stock state, and now says so honestly.** The catalog's availability was
`item.kind === "service" ? "Available" : status.replaceAll("_", " ")` — a string either way.
It resolves through `getCatalogStockStatus` for products and `getGenericStatus` for services,
so a service carries no tone it has not earned rather than borrowing a product's.

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run lint` | Clean |

**Next.** Batch 4 — the five in-scope detail pages, on ruling 2.

### Status: batch 4 — five records with no rail, and the primitive that had to allow it

**Landed.** The five in-scope detail pages on ruling 2. `client/support/[caseId]` is
untouched (scoping decision 8); `client/pages/[token]` is batch 5's, being a public surface
rather than a portal record.

**The variant is a prop on the primitive, not a shape five pages draw.** `RecordWorkspace`
required a `spine`; it is optional now, and with it absent the row stays one column at every
width instead of splitting at `lg`. That is the whole implementation — ten lines. Five pages
each hand-rolling a spineless record page is the failure §0 names, and it is what would have
happened if the ruling had been written as guidance instead of as a default.

**Two corrections to the ruling, both found by reading the pages before writing them.**

- **The test is the field, not the control.** The quote page carries Approve, Reject and
  Download. An earlier wording — "does any control here write a column on this row" — would
  have sent it back to a spine, because Approve writes `status`. R2's boundary is about
  *dropdown-shaped fields that commit on change*, and R1 already routes an approval through
  an explicit confirm rather than a silent commit. `design.md` says so now, with the quote
  page named as the worked example.
- **It is `RecordWorkspace` without a `spine`, not `PageShell variant="document"`.** The
  first draft of the rule sent these pages to `PageShell` directly — which would have lost
  the back link, the record name, the status beside it and the tab strip, because
  **`PageHeader`'s h1 is deliberately `sr-only`** (§8) and `RecordWorkspaceHeader` is what
  actually draws a record's name. A rule written from the wireframe rather than from the
  primitive would have produced five pages with no visible heading.

**The order page stopped drawing its own table.** Its line items are
`TransactionLineItemsTable` — the component quote, order and POS invoice already share (R10)
— with `showAdjustments={false}`, because a portal order line carries no per-line discount or
tax. That removes the last raw `Table` importer in `app/client`.

**Every page gained a `Try again` and a real back link.** The five had `Loading order...` /
`Order not found.` and a header button; they have `PageShell`'s states through
`RecordWorkspace`, and `backHref` / `backLabel` pointing at the list they came from rather
than at `/client`.

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `npm run lint` | Clean |

**Next.** Batch 5 — the public surfaces, `app/page.tsx`, and the `size-6` guard failure,
which turns out to be three hand-written chips rather than one call site.

### Status: batch 5 — the public surfaces, a guard failure that was three files, and a second portal inside the first

**Landed.** The five public/entry surfaces, `ClientPageCreateForm`, and the sub-phase's own
standing guard failure.

**`check-design.sh` is 2 of 14 → 1 of 14.** The §4.2 failure had been listed for three
sub-phases as one line — `ClientPageCreateForm.tsx:335`'s `size-6`. It was **three files**:
the same removable chip written by hand in `ClientPageCreateForm`, `UserTeamPicker` and
`DocumentUploadFormPage`, no two agreeing on padding (`px-3 py-1` / `px-3 py-1.5` /
`px-2.5 py-1`), icon size (`h-3` / `h-3.5`), ink (`text-copy-secondary` /
`text-copy-primary`), and one of the three with **no hover state at all**. `RemovableChip`
takes all three, and the guard failure goes with them rather than being patched at one call
site. The remaining failure is `LynkSplash.tsx:58`'s `pl-[0.2em]`, which is 5.9's.

**It is not `Pill` returning.** R5 deleted `Pill` because a capsule carrying a *status* said
nothing ink could not, hundreds of times per table. This is §1.3's other case — a box earned
by interactivity: the capsule marks where one removable unit ends and the next begins, and
the `×` is a control. No tint, no blur, no noise overlay.

**A second portal was rendering inside the first.** `client/support` and
`client/support/[caseId]` are out of the programme (scoping decision 8) and batch 3's status
said they "render inside the new chrome unchanged" — which was wrong. Unchanged meant they
still drew their own `min-h-screen bg-app` root, their own centred container and their own
wordmark header, *inside* the layout that now supplies all three. They are still not on the
archetypes and still not rebuilt; the chrome is simply removed, which is a consequence of
batch 1's layout rather than a rebuild of a module that may be deleted.

**Three more found on the public surfaces, none of them in the plan.**

- **`app/page.tsx` returned `null`.** The entry route rendered a bare ground for as long as
  `/users/me` took — seconds on a cold backend, and the first thing a new session sees. It
  shows `LynkSplash`, which is what `app/loading.tsx` already shows for the same wait.
- **`client/pages/[token]` rendered the *tenant's* company name in `font-lynk`.** §3.1 is
  explicit that the face is Lynk's wordmark and never product UI; using it for another
  company's name made the tenant's brand read as Lynk's logo, on the one surface in the app
  that is deliberately not Lynk-branded. It is the product face at the header size now.
- **`LynkSplash` carried the same raw `rgba()` the auth door just lost.** `tokens.md` §3.5
  names three licensed surfaces for the ambient set and this is one of them, so tokenising
  the door and leaving the splash would have left the rule half-landed across its own set.

**The chrome count, re-measured.** `min-h-screen` 25 → **4**, and all four are genuinely
standalone roots: the two public document pages, the public booking page, and the splash
wrapper. `font-lynk` 21 → **6**: the two doors at `text-7xl`, the two Lynk-branded public
headers at `text-2xl`, and the rail's mark and wordmark. **No `text-3xl` or `text-2xl`
heading remains anywhere in scope** — the three that show in a grep are `client/support`'s,
which is out of scope, and the two wordmarks.

| Check | Result |
|---|---|
| `check-design.sh` | **1 of 14** — down from the 2 of 14 that has been the baseline since 5.1 |
| `tsc --noEmit` | Clean |
| `npm run lint` | Clean |

**`auth/login` is examined and left as it is.** Batch 2 deferred the row; read against the
diff it is already on `Label` / `Input` / `Button`, its hand-authored Google and Microsoft
marks stay by §5, and the wordmark is the door's. What is wrong with it is copy —
*"Redirecting..."*, *"Authenticator Code"*, *"Enabling..."* — which is 5.9's, and moving it
here would only mean touching the file twice.

**Next.** Batch 6 — close-out: the rendered guards, the in-scope suite against its
attribution baseline, and the browser pass, with the honeycomb on the exit criteria.






---

## 5.9 — Copy and voice

**Scope note.** Contracts and support cases are out of the whole programme (scoping
decision 8), so three items listed below are **not** done: the title-casers at
`SupportCaseCreateFormPage.tsx:260` and `support/cases/[caseId]:269`, and the raw foreign
keys at `contracts/[contractId]:244,264,265`. `"New Contract"` in the Title Case list is the
*button* on a surface that stays, so it is still in scope — check which side of the line a
string is on before sweeping it.

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

Filed here by later sub-phases:

- **The settings rail (A8)** — every `SETTINGS_NAV_GROUPS` destination reachable from the
  rail without a trip through the hub, and the current page marked `aria-current="page"`.
  Written in 5.6 batch 3 and deleted the same hour: it is new coverage, and the testing
  policy says new coverage lands here.

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
- **The active option in a listbox is visible too.** `aria-activedescendant` is not DOM focus,
  so the check above cannot see it: open a `SearchableSelect`, move the active row, and assert
  its ground differs from the popover's by a real margin. Measured in 5.4 batch 2 at **1.24:1
  dark / 1.08:1 light** — the token is `--color-primary-muted`, shared with `select.tsx`, so
  the fix is a vocabulary decision and it needs the owner.
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
- ~~**Appendix B.2 stays filed, not fixed here.**~~ **Half-retired in 5.3 close-out.** The
  *bug* is still out of scope — EAV filtering over `custom_module_record_values` is a
  backend query-param contract and it is scheduled after 5.9. What was in scope, and is
  done, is the interface's claim about it: the custom-module list no longer draws a filter
  control the request layer cannot carry (§7.9). A frontend programme cannot fix the query;
  it can stop the toolbar from saying the query happened.
