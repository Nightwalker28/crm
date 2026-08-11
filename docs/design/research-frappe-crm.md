# Research: how Frappe CRM builds its look

Notes taken from reading [frappe/crm](https://github.com/frappe/crm) and the design
system it sits on, [frappe/frappe-ui](https://github.com/frappe/frappe-ui). This is a
study of their *method*, not a plan to copy their output. Where a finding applies to
Lynk it is called out under **For Lynk**.

Sources read (August 2026, `main` / `develop`):

- `frappe-ui/skills/frappe-ui/DESIGN.md` — the written design language
- `frappe-ui/skills/frappe-ui/TOKENS.md` — the token vocabulary
- `frappe-ui/spec/foundations.md` + `spec/adr/0005..0007` — the foundation spec and its ADRs
- `frappe-ui/tailwind/generated/colors.json` — 1081 resolved colour tokens
- `frappe-ui/src/charts/tokens.ts` — chart ramps
- `crm/frontend/src/components/Icons/*.vue` — ~140 bespoke icons

---

## 1. The headline finding: it is a gray product with colour used as data

Their first stated principle is **"Gray first."** Ink-gray on surface-base; colour only
where it *encodes information*. The primary button is `solid` + **gray**, not a brand
colour. Their rule for when something may be coloured is a closed list:

- status / priority / unread dots
- financial sign (red negative, green positive)
- SLA / severity
- status badges

> "Not encoding state, sign, severity, or unread? Then it's gray."

And: **"At most one accent per screen"** — a single unread dot in a gray list, not a
palette.

This is why it reads as calm and expensive rather than "designed." There is no brand
colour competing with the data. The thing you notice on a Frappe CRM list screen is the
*data*, because nothing else is asking for attention.

**For Lynk:** 58 component files currently reach for `text-primary` / `bg-primary` for
decoration — icons, section accents, hover tints — not for state. That is the single
biggest reason our screens read busier than theirs. The aqua accent we just landed is
fine; the fix is using it in ten places instead of a hundred. This costs nothing in
tokens and is the highest-leverage change available.

## 2. Hierarchy comes from ink weight, not from boxes

Second principle: **"Hierarchy through ink, not boxes."** They build structure with an
ink ladder plus a type scale plus `divide-y divide-outline-gray-1` — explicitly *not*
boxed cards. Their rule: "Borders must earn their place (interactive affordance,
overlay, distinct surface)."

The ink ladder is assigned **by role, not by eye**:

| Token | Role |
|---|---|
| `ink-gray-9` | page default, strongest values (unread titles, KPI figures) |
| `ink-gray-8` | titles, headings, primary content |
| `ink-gray-7` | secondary values, table cells, descriptions |
| `ink-gray-6` | field labels, form icons |
| `ink-gray-5` | timestamps, counts, captions, meta |
| `ink-gray-4` | ids (`tabular-nums`), decorative glyphs |

Six steps of gray doing the work that most apps do with borders and background fills.

**For Lynk:** we have four text steps (`primary` / `secondary` / `muted` / `disabled`)
against their six, and no written rule for which is used where — so the choice is made
per-component by eye. Worth adding two steps and a role table. Note they reserve a
dedicated step for ids and pair it with `tabular-nums`, which we do not do at all.

## 3. Two parallel type scales, split by whether text wraps

The most interesting typography idea. Same pixel sizes, two line-heights:

- `text-*` — line-height 1.15 — **single-line labels**: headings, button text, badges,
  table cells, stat values, "2h ago" timestamps
- `text-p-*` — line-height 1.5–1.6 — **multi-line text**: paragraphs, descriptions,
  helper text, anything that may wrap

Their note on getting it wrong is exact: "copy looks cramped (multi-line text in
`text-*`) or floppy (one-line labels in `text-p-*`)."

The scale itself is unusually fine-grained and small: 11 / 12 / 13 / 14 / 15 / 16 / 17 /
18 / 20px. Body default is **14px**; there are three distinct steps between 13 and 15px.
A data product needs resolution in the small sizes, not in the display sizes.

They also ship *composite* utilities — `text-base-medium` is size + weight + a tighter
letter-spacing than `text-base`, because medium-weight text at the same size wants
tighter tracking (0.015em vs 0.02em). ADR-0007 exists solely to justify this.

**Never uppercase.** Explicitly: no `uppercase`, no faked small-caps via
`tracking-wider`, on headings, section titles, table column headers, or labels. Sentence
case throughout — "Recent activity", not "RECENT ACTIVITY". A quiet header is
distinguished by *size, weight and ink step*, not by capitalisation.

**For Lynk:** 118 places currently use `uppercase`, most of them section labels and
column headers with wide tracking. That single pattern is a large part of what makes our
UI read as templated. We also have effectively two sizes in use (`text-sm`, `text-xs`),
so everything is either "normal" or "small" and there is no room to express three levels
of a hierarchy.

## 4. Colour architecture: neutral grays, three semantic categories, an indirection layer

Structure is three layers, same shape as ours but with two differences worth stealing.

**Layer 1 — raw palette.** Twelve hues × eleven steps, in OKLCH. Separate `lightMode`
and `darkMode` ramps.

The gray ramp is **`oklch(L 0 0)` — chroma exactly zero** at every step, in both modes.
Pure achromatic gray. No blue cast, no warm cast.

```
lightMode.gray:  0.979  0.964  0.946  0.913  0.830  0.683  0.586  0.439  0.341  0.205  0.168
darkMode.gray:   0.979  0.885  0.754  0.683  0.580  0.457  0.379  0.341  0.281  0.260  0.239  0.205
```

Note the dark ramp is **not** the light ramp reversed. It has an extra step (`450`) and
its steps bunch at the dark end — 0.205 / 0.239 / 0.260 / 0.281 are four distinguishable
surfaces within 0.08 of lightness, because on a dark ground you need fine resolution near
black to separate app / card / dialog / selected-row.

**Layer 2 — semantic tokens in three categories,** each taking a colour + numeric step
where higher = stronger contrast:

- `text-ink-*` — foreground, text and icons
- `bg-surface-*` — backgrounds
- `border-outline-*` — borders and rings

Category is the *role*, so a component author picks `ink` vs `surface` vs `outline`
first and a strength second. There is no way to accidentally use a text colour as a
border.

**Layer 3 — the indirection.** Semantic tokens do not hold values, they hold *references*
into the raw palette, and light and dark point at different steps:

```
surface.gray-1   light → gray/50  (0.979)     dark → gray/900 (0.239)
surface.gray-5   light → gray/400 (0.830)     dark → gray/450 (0.457)
ink.gray-9       light → gray/950 (0.168)     dark → gray/50  (0.979)
```

The mapping is *deliberately not symmetric*. `ink.gray-4` and `ink.gray-5` both resolve
to `darkMode/gray/400` — two light-mode steps collapse into one dark step, because that
distinction is not perceivable on a dark ground. They spent a token to say "these are the
same in dark mode" rather than force a difference that would not be visible.

They also warn that the numeric steps are **not interchangeable across categories**: in
light mode `ink-red-5` is red/500 while `surface-red-5` is red/400.

**Surfaces are named by elevation, not by guesswork:** `surface-base` (page),
`elevation-1` (card), `elevation-2` (dialog body), `elevation-3` (selected row), plus
`surface-sidebar`. In light mode `base` and all three elevations are **the same white** —
elevation is carried entirely by shadow. In dark mode they separate (0.205 / 0.239 /
0.260 / 0.341) because shadow does not read on a dark ground. Same semantic name,
different mechanism per theme.

**For Lynk:** our grounds are `#0b0d10 → #1d232c`, which carry a slight blue cast, and
our light grounds carry a slightly different one — that is part of why the theme flip
feels like two products. Going achromatic, or committing to one consistent cast in both,
would settle it. Our `--color-bg-*` names (`app` / `sidebar` / `surface` / `surface-muted`
/ `surface-raised`) are close to their elevation naming already; what we lack is the
indirection layer, so light and dark are two hand-maintained value sets rather than two
mappings over one palette.

## 5. Chromatic ramps hold hue across the theme flip

Measured hue drift between the light and dark ramps at the same step:

| hue | drift at 500 |
|---|---|
| teal | 0.4° |
| violet | 0.6° |
| blue | 2.3° |
| red | 1.0° |
| green | 3.7° |
| amber | **15.1°** |

Everything is within a few degrees except amber, which they pull from 71.8° to 56.7° in
dark mode — a deliberate shift toward orange, because a yellow that reads correctly on
white looks acidic and washed out on near-black.

The chart ramp carries the same rule, stated in a source comment:

> "The dark categorical ramp is derived from the light one slot for slot, so a series
> keeps its hue across a theme flip."

Their categorical palette is called **"Jewel"** — five hue families, each contributing a
dark member and its light partner, so adjacent series in a legend differ in *lightness*
as well as hue and stay distinguishable in greyscale:

```
#2283c3  #84c5f9   blue
#289e60  #84d4a1   green
#753cbb  #bb9df1   violet
#c98c28  #f5ca8e   amber
#ba205a  #f98da7   crimson
```

**For Lynk:** this is the principle we just applied by hand — hue and chroma held, only
lightness moved. Worth adopting their amber exception: our warning hue is held at 80°
across both themes, and the light-mode value (`#966a00`) does read muddy. Their approach
would push it toward orange in dark and keep it yellower in light.

## 6. Icons: two tiers, and the domain tier is bespoke

Frappe CRM ships ~140 hand-drawn icons in `frontend/src/components/Icons/`. Reading the
SVGs, the house style is consistent and unusual:

- **16×16 viewBox** — not 24 scaled down. Drawn at the size they are used.
- **Filled paths with `fill-rule="evenodd"`**, not strokes. What looks like a 1px outline
  is actually a filled shape with an evenodd hole punched in it, so the weight is
  optically tuned rather than uniform.
- **`fill="currentColor"`** — colour comes entirely from the ink token on the parent.
- Sub-pixel coordinates throughout (`11.9011`, `3.88117`) — drawn in Figma against the
  16px grid and exported, not snapped by hand.

The two tiers, from DESIGN.md:

- **Bespoke filled icons** for domain nouns — Leads, Deals, Contacts, Kanban, Convert,
  Dialpad, ERPNext. These carry the product's identity.
- **Lucide** (`lucide-plus`, `lucide-inbox`, …) for generic UI verbs. No reason to
  redraw a plus sign.

Sizes are specified by role: `size-4` default, `size-3.5` inline meta, `size-5` mobile
row leading, `size-2` / `size-1.5` status dots.

And the constraint that matters most: **"Icons support labels, never replace them"** —
icon-only buttons only for universal actions (×, …). **"Decorative icons are noise."**

**For Lynk:** we use Lucide for everything — 165 imports, one tier. That is *fine* and I
would not redraw 140 icons. But it does mean nothing in our icon set is ours. If we ever
want identity in the icon layer, the cheap version is a handful of bespoke 16px filled
icons for our module nouns only — Leads, Deals, Invoices, Contracts, the hive/module
concept — and Lucide everywhere else. That is maybe 12 icons, not 140.

Note also the stylistic mismatch: Lucide is a 24px, 2px-stroke, round-cap outline system.
Frappe's are 16px filled. Mixing the two tiers works for them because the bespoke set
*matches Lucide's optical weight at 16px* — a bespoke icon drawn heavier than Lucide
would look wrong beside it.

## 7. Geometry is written down as numbers

Not "generous spacing" — actual values, in the doc:

- Sidebar `14rem`; page header `min-h-12` (48px)
- Gutters `px-3 sm:px-5`, **the same pair** on header, body and full-bleed rows
- Content widths: reading pages `max-w-[940px]`, prose/editor `max-w-[770px]`,
  dashboards `max-w-4xl`, dense tables full-width
- Row heights: 40px dense table → 44–60 medium → 60px desktop feed → 68px mobile feed,
  and **"one mechanism per list"**
- Stacks: sections `space-y-6`, settings sections `space-y-11`, form fields `space-y-4`,
  sidebar nav `space-y-0.5`, inline actions `gap-2`
- Bottom of every scroll area: `pb-10` … `pb-40`

Radius is a numbered scale, `rounded-0`…`rounded-9` (0/4/5/6/8/10/12/16/20/100px), and
they **deleted the named aliases** (`rounded-md`, `rounded-lg`) in 1.0.0 so a leftover
alias emits no CSS and fails loudly. ADR-0006 records why: named aliases invite eyeballing;
numbers force a deliberate pick. Their canonical greps are in the spec so drift is findable.

**For Lynk:** we have exactly the drift ADR-0006 was written to prevent — 129 uses of
`rounded-md` (6px) sitting alongside 202 uses of `rounded-[var(--radius-control)]` (8px),
for the same class of element. Two vocabularies, so the same button is 6px in one place
and 8px in another. Their fix (one scale, aliases removed, documented grep) is directly
applicable.

## 8. Process notes

Things about how they run it, separate from what it looks like:

- **Figma is the declared source of truth**, one named file. Tokens are *exported* from
  it (`espresso-v2-design-tokens/*.json`) and compiled into the Tailwind theme
  (`tailwind/figma-tokens-to-theme.js` → `tailwind/generated/`). Nobody hand-edits the
  generated theme.
- **Drift has exactly three buckets**, and the spec says so: token drift, component
  drift, or an intentional code-only extension *that must be listed in the spec*. "There
  is no third category."
- There is a `scripts/audit-token-drift.cjs` and a codemod (`migrate-tokens-v2.js`) —
  token migrations ship as automated renames, not as a request to be careful.
- Architectural decisions get **ADRs**: why focus rings are 2px, why radius tokens are
  numbered, why composite typography utilities exist. Each is a page, and each closes an
  argument permanently.
- Verification is `getComputedStyle()` against Figma Dev Mode, with dates recorded per
  component — "pixel comparison beats screenshot comparison for spacing/typography."
- The design doc's own instruction to contributors: **"When unsure how something should
  look, copy from a recipe or a shipping app — don't invent."**

---

## What is worth taking, ranked

Ordered by effect per unit of work, for Lynk specifically. **Status added August 2026
after implementation** — see [`design.md`](./design.md) for the rules that resulted.

1. **Gray-first discipline.** Colour only for state, sign, severity, unread.
   → **Taken, and further than proposed.** `--color-primary` is now a neutral; there
   is no brand accent at all. The ~74 decorative consumers resolve to gray with no
   per-file change, because only the token's *value* moved.
2. **Drop `uppercase` on labels and headers.**
   → **Taken. 118 → 0.** Section eyebrows are `text-2xs font-semibold text-copy-label`;
   the wide `tracking-*` that faked small caps went with them.
3. **One radius vocabulary.**
   → **Taken.** 129 bare aliases swept onto the named-var scale, and `rounded-sm/md/lg/xl`
   are no longer mapped, so a leftover emits no CSS and fails loudly — their ADR-0006
   fix, applied literally.
4. **An ink-role table**, six steps, with a dedicated step for ids.
   → **Partly taken.** Added one step (`text-copy-label`) and the role table, so the
   ladder is five. The *sixth* step for ids was measured and rejected: it cannot clear
   4.5:1 on `bg-surface-raised` in either theme without collapsing into `muted`. Took
   the `tabular-nums` half of the idea instead, which is what actually makes ids align.
   Also fixed a pre-existing failure this surfaced — light `copy-muted` was at 4.08:1
   on the raised ground.
5. **Two line-height scales**, split on "does this text wrap", and a finer ramp.
   → **Taken for the split**, which was the valuable half: `text-p-xs/sm/base` at
   reading line-heights, replacing 61 hand-tuned `text-sm leading-6` pairs, plus
   `text-2xs` for the 18 hand-written 11px eyebrows. The finer 13/15px steps are *not*
   added — nothing in the product currently needs a level between 12 and 14.
6. **Semantic tokens as references, not values.**
   → **Rejected after measurement.** The premise was that our two themes carry
   different grey casts. They do — dark neutrals sit at hue ≈258, light at ≈262.5 —
   but at chroma ≤0.026 that difference does not survive 8-bit quantisation: snapping
   every neutral to a single hue changes no value by more than one step. The two ramps
   are already the same grey. The restructure would be a large diff for a
   guaranteed-invisible result, which is the exact trade this document warns against
   two paragraphs below. The real cause of "light and dark feel like different
   products" was the accent and status colours, and that was fixed by deriving light
   from dark in OKLCH.
7. **Written geometry.**
   → **Taken.** `design.md` §4.4, plus control heights as tokens (§4.2). The
   fragmentation was smaller than it first looked — most `h-9`/`h-10` hits were square
   icon medallions, not controls. The genuine defect was call-site `className="h-9"`
   overrides on `Input` and a select trigger 2px shorter than the input beside it.
8. **A small bespoke icon tier.**
   → **Not taken, and now ruled out.** The owner subsequently made shadcn primitives
   and lucide icons a hard rule ([`design.md` §7.2](./design.md)), which closes this
   item rather than deferring it: Lynk takes consistency over identity in the icon
   layer. The observation in §6 stands as research, but it is not a plan.

Also taken, not in the original list: the chart palette was extended to eight slots
(§5's "a series keeps its hue across a theme flip") and moved behind
`lib/chartColors.ts`, which replaced two duplicated hardcoded 8-colour arrays and
axis/grid strokes that did not follow the theme at all.

Not taken from §5: the **amber exception**. Frappe shifts amber 15° toward orange in
dark mode. It reintroduces exactly the cross-theme hue drift this system exists to
prevent, and it does not fix the muddy light-mode value that motivated it — that value
is dark because it must clear 4.5:1 on white. The tint/solid pairing already solves it.

What **not** to take: their palette, and their `ink`/`surface`/`outline` naming (ours
is already coherent and renaming costs a repo-wide diff for no user-visible gain).

> **Superseded, August 2026.** This section originally also argued against taking their
> gray primary button, on the grounds that Lynk having one accent colour was a
> deliberate choice. The owner subsequently chose zero accent, and item 1 was taken
> further than proposed: `--color-primary` is now a neutral and the aqua is gone
> entirely. Colour survives only for status, destructive intent, and chart series.
> [`design.md`](./design.md) is authoritative; this document is a snapshot of the
> research, kept as written except for this note and the status markers above.
