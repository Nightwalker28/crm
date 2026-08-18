# Lynk Design Language

This is the operational design spec for Lynk's product surfaces. It exists so that a
person or an agent (Claude Code, Codex, anything else) can open one file, understand
what Lynk is supposed to look and feel like, and produce UI that lands inside the
system instead of beside it.

**Read this before writing any UI.** Read [`tokens.md`](./tokens.md) before touching
colour, type, spacing, or radius. [`research-frappe-crm.md`](./research-frappe-crm.md)
records where several of these rules came from and is background, not law.

Every rule here is stated so it can be checked. Where a rule has a mechanical test,
the grep is given. Where a rule is a judgement call, it says so.

---

## 0. The one-paragraph version

Lynk is a dense, multi-tenant CRM/ERP that operators keep open for eight hours a day.
The interface is a **neutral gray instrument with no decorative colour**. Hierarchy
comes from ink weight and spacing, not from boxes, fills, or brand accents. Colour
appears only when it carries meaning — status, data series, destructive intent.
Dark is the default and light is the same palette at a different weight, never a
second design. Everything is built from the 53 primitives in `components/ui/`;
a page that needs a new visual pattern is a signal to extend a primitive, not to
style a div.

---

## 1. Principles

These are ordered. When two conflict, the earlier one wins.

### 1.1 Improve the foundation, do not replace it

Lynk already has a coherent shell: sidebar, `PageHeader`, `ModuleTableShell`,
`ModuleListToolbar`, `RecordTabs`, `QuickCreateSurface`. Design work means making
these sharper — correcting a contrast failure, unifying a fragmented scale, removing
a decorative flourish that carries no information. It does not mean re-imagining the
shell.

A change that touches more than one screen's *structure* is not a design fix, it is a
redesign, and it needs to be proposed before it is built.

### 1.2 Gray first, colour last

The default for every surface, border, and piece of text is a neutral gray.
Colour is a **budget**, and the budget is nearly zero. Before adding a colour, answer:
*what fact does this colour communicate that a reader could not otherwise get?*
If there is no answer, use gray.

Lynk has **no brand accent in the UI**. Primary actions are neutral (see §2.2).
Colour survives in exactly four places:

| Allowed use | Token family | Why |
|---|---|---|
| Status and outcome | `--color-success/warning/danger/info` | The colour *is* the meaning |
| Destructive intent | `--color-danger` | Must be unmistakable before the click |
| Data series in charts | `--chart-1..8` | Series identity requires hue separation |
| Brand marks (logo, splash, auth art) | see §9 | Identity surfaces, not work surfaces |

Everything else — buttons, links, focus, selection, active nav, progress, avatars,
tags without semantics — is gray.

### 1.3 Hierarchy through ink, not boxes

To make something more important, make it darker/lighter in ink and give it more
space. Do not give it a border, a card, a tinted background, or a shadow.

```
Bad   <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted p-4">
        <span className="text-xs text-copy-muted">Owner</span>
        <p className="text-sm">Jane Doe</p>
      </div>

Good  <div>
        <span className="text-xs font-medium text-copy-label">Owner</span>
        <p className="text-sm text-copy-primary">Jane Doe</p>
      </div>
```

A border earns its place when it separates two things that would otherwise be
ambiguous — a table from its toolbar, a sticky footer from scrolling content, an
input from its background. Nesting a bordered box inside a bordered box is almost
always wrong.

Nesting depth budget: **at most two levels of visible container** on any screen.
Page → panel. Not page → panel → card → box.

**The panel taxonomy.** "Two levels of container" needs the two levels named, or every
group of fields becomes a box by default — which is how 206 hand-rolled card-shaped boxes
accumulated against 65 files using `<Card>`. There are exactly three ways to group
something, and only two of them draw:

| Role | Draws | Token set | For |
|---|---|---|---|
| **Panel** | border + ground + radius | `Card` — `border-line-default`, `bg-surface`, `--radius-card`, `p-6` (or `p-4` when dense) | A top-level region of a page. Level 1. **A panel may not contain a panel.** |
| **Ink group** | nothing | a section heading + a stack. No border, no ground, no radius | A named cluster of fields or rows *inside* a panel. This is where most of the 206 belong. |
| **Row** | border + radius, no ground | `border-line-subtle`, `--radius-control` — or a bare `divide-y` | A repeated item inside a panel: an activity entry, a comment, a task, a picker option. Level 2, and only when the item is individually interactive. |

The rule that decides between them:

> **A box is earned by interactivity or by separation. Never by grouping.**
> Grouping is a heading and some space.

Two consequences worth stating, because both were live drift:

- **Panels take `border-line-default`; rows take `border-line-subtle`.** That is what those
  two tiers already mean in `tokens.md` §2 — panel edges versus row dividers. The
  same-role boxes that split across `radius-card + line-subtle` and
  `radius-control + line-default` were reading one tier as the other.
- **A row that is not interactive is not a box at all.** If the operator cannot click it,
  hover it or focus it, it is a `divide-y` line in a stack. A border around static content
  inside a panel is the third level §1.3 forbids, wearing a smaller radius.

**Primitives that draw a surface as their own job are exempt.** `Card` itself, and the
handful of `components/ui/` files whose entire purpose *is* rendering a panel-or-raised-tier
surface rather than borrowing one at a call site — `ModuleTableShell`'s `standalone` variant,
`ModuleListToolbar`, `RouteStates`, `chart.tsx`'s tooltip, `dropdown-menu.tsx` — are not swept
by the panel taxonomy the way application code is. The test is the same one §11.1 applies to
`Table`'s own implementers: does this file's job start and end at drawing the surface, or is
it a page/component *consuming* one? A `components/ui/` file that renders inside someone
else's panel (an export dialog's radio option, a payment dialog's invoice picker) is a
call site like any other and follows the rows above, not this exemption.

### 1.4 One theme, two weights

Light is not a separate palette. Every non-neutral value in `.light` is derived from
its dark counterpart by holding OKLCH hue and chroma and moving only lightness.
Switching theme must change the *weight* of the interface, never its identity — the
same screen, lit differently.

This is enforced by derivation, not by taste. The procedure is in
[`tokens.md` §4](./tokens.md#4-how-light-is-derived-from-dark).

### 1.5 Density is a feature

Operators scan hundreds of rows. Whitespace that helps a marketing page hurts here.
Prefer the tighter option when both are legible: `text-sm` over `text-base`,
`gap-2` over `gap-4`, a row over a card. Reach for air only to separate *groups*,
never to decorate.

### 1.6 The same job looks the same everywhere

If two modules both list records, they use the same table shell, the same toolbar,
the same empty state, the same pagination. Divergence is a bug even when the
divergent version is prettier. When a module genuinely needs something new, the new
thing goes into `components/ui/` and every applicable module adopts it in the same
slice.

---

## 2. Colour

Full token tables live in [`tokens.md`](./tokens.md). This section is the policy.

### 2.1 The neutral ladder

Four ground levels and five ink levels, in both themes. Use them by **role**, not by
how they look:

| Ground | Role |
|---|---|
| `bg-app` | The page itself. Nothing else. |
| `bg-surface` | A panel that sits on the page — table body, form card, dialog body |
| `bg-surface-muted` | A recessed strip inside a surface — table header, toolbar, secondary button |
| `bg-surface-raised` | Something floating above — popover, dropdown, tooltip |

| Ink | Role |
|---|---|
| `text-copy-primary` | Record names, values, headings — the thing the operator came for |
| `text-copy-secondary` | Supporting text, secondary buttons, most body copy |
| `text-copy-label` | Field labels, form icons, section eyebrows |
| `text-copy-muted` | Timestamps, counts, column headers, placeholder, ids |
| `text-copy-disabled` | Non-interactive state only. Never for de-emphasis. |

`text-copy-disabled` is the single most misused token. If text is readable content,
it is `muted` at the quietest. `disabled` means *you cannot act on this*.

Ids and reference numbers use `text-copy-muted` with `tabular-nums` — not a lighter
step and not a mono face. A sixth, fainter step for ids was measured and rejected:
it cannot clear 4.5:1 on `bg-surface-raised` in either theme without collapsing into
`muted`.

### 2.2 Actions are neutral

The primary action on a screen is a **high-contrast neutral fill**: near-white with
near-black label in dark, near-black with white label in light. It reads as the
loudest thing on a gray page without introducing a hue.

| | Dark | Light |
|---|---|---|
| Primary fill | `#f4f7fb` | `#101319` |
| Primary label | `#0b0d10` | `#ffffff` |

Because the fill is maximally loud, **there is exactly one primary button per view.**
A screen with two filled buttons has no primary action.

**The variant set is closed at six.** `Button` shipped nine, three of which were aliases
of another and one of which had no call site at all. Measured across `app/` and
`components/`:

| Variant | Call sites | Ruling |
|---|---|---|
| `default` | 280 (implicit) | **Keep.** The one neutral fill. |
| `outline` | 296 | **Keep.** Every secondary action. |
| `ghost` | 126 | **Keep.** Tertiary and icon-only actions. |
| `destructive` | 10 | **Keep.** The confirm button of a destructive flow. |
| `destructiveOutline` | — | **Add.** Two dialogs hand-write this string today. |
| `destructiveGhost` | 17 | **Keep, renamed** from `dangerGhost`. |
| ~~`primary`~~ | 0 | **Delete** — a duplicate of `default`. |
| ~~`danger`~~ | 0 | **Delete** — a duplicate of `destructive`. |
| ~~`secondary`~~ | **47** | **Deleted — but it was not redundant.** See below. |
| ~~`link`~~ | 0 | **Delete.** A link in body copy is an `<a>` (§2.2 above), not a button. |

**Correction, made in rebuild 5.1.** The count of 8 above was measured on the literal
`variant="secondary"` form only. The real figure is **47 across 16 files**, and **38 of them
are the *selected* half of a two-state control** — `variant={isActive ? "secondary" :
"outline"}`, thirteen of them carrying `aria-pressed`. Deleting it as originally ruled would
have collapsed those pairs to `outline`/`outline`: visually identical, so the operator loses
which option is on.

So `secondary` was never "outline at a different ground". It was **a missing primitive wearing
a button's clothes** — which is §7.3 at scale: three call sites passing the same override are a
missing variant, and forty-seven are a missing component. The answer is `SegmentedControl`
(§7.1), and the variant set still closes at six.

The lesson is about the measurement, not the ruling: a grep for a literal prop value misses
every ternary, and a variant that looks unused in one form can be load-bearing in another.

The three destructive variants share one prefix on purpose: `destructive` /
`destructiveOutline` / `destructiveGhost` is a legible ladder, where
`destructive` / `danger` / `dangerGhost` was three names for two ideas.

**Height is owned by the action row, not by the call site.** An `ActionBar` sets the size
for its children — `sm` in a toolbar, `default` in a page header or a form — so a row
cannot mix a 38px button with a 32px one. `lg` stays restricted to auth and empty-state
CTAs (§4.2). Widths may still differ: an icon-only button beside a labelled one is the
same height and narrower, and that is not a mismatch.

Links inside body copy are `text-copy-primary` with an underline offset — not a
coloured link. A coloured link inside a gray page is the loudest pixel on screen for
the least important reason.

### 2.3 Focus is its own token

Focus rings use `--color-focus-ring`, never the action colour. A near-white focus
ring on a dark page is harsh and bleeds into surrounding content. The focus token is
a mid gray that holds ≥3:1 against all four grounds in both themes, so the ring is
always visible on whatever it lands on.

```
grep -rn "ring-primary" frontend/app frontend/components   # should return nothing
```

Focus is never removed. `outline-none` is only acceptable when immediately paired
with a `focus-visible:` ring on the same element.

### 2.4 Status colour is a pair, not a fill

Every status colour ships as a solid plus a low-alpha tint of the *same* RGB
(`--color-success` / `--color-success-muted`). A status pill is the tint as
background and the solid as text or border. Never invent a third value by hand,
never use the solid as a large background fill.

### 2.5 Never write a hex in a component

```
grep -rnE "#[0-9a-fA-F]{3,8}\b" frontend/app frontend/components --include=*.tsx
```

Everything else is drift — a raw hex cannot follow the theme, so it is a light-mode
bug waiting to be filed. Fix by mapping to a token; if no token fits, add one in
`globals.css` and derive its light value properly. The same applies to Tailwind's own
palette (`bg-slate-800`, `text-gray-400`) and to arbitrary values (`bg-[#1a1a1a]`).

Three exceptions, and only these:

1. **Third-party brand marks** — the Google and Microsoft OAuth logos are those
   companies' colours, not ours.
2. **The invoice print document** (`finance/pos/[invoiceId]/print`) — the invoice has
   its own document theme that the operator picks, and it must not follow the app
   theme. An operator working in dark mode still needs a light invoice on paper.
3. **Tenant-configured brand colour** — a tenant's accent for client-facing pages is
   *data*. The hardcoded hex is only the fallback for an unset value.

The first two are path exceptions in `scripts/check-design.sh`. The third is per-line:
mark it with a `design-exempt: <reason>` comment on the offending line (§10).

---

## 3. Typography

### 3.1 One face

**Inter**, loaded via `next/font/google` and exposed as `--font-app-sans`. It is
chosen on measurement, not taste: a 54.6% x-height (vs 51.0% for the runner-up)
keeps 12px labels legible, and 2871 glyphs cover the international customer,
currency, and address data a CRM carries.

There is no display face and no secondary sans. The `LynkTitle` face is for the
wordmark only (`.font-lynk`) and must not appear in product UI.

### 3.2 Monospace is for machine strings only

A monospaced face makes a CRM feel like a terminal. `font-mono` is permitted on
exactly three kinds of value:

- API keys, tokens, webhook secrets, signing secrets
- Raw payloads and code blocks (integration logs, JSON previews)
- Checksums and other opaque machine identifiers

It is **not** for record numbers, invoice numbers, emails, phone numbers, IDs, dates,
or amounts. Those are content, and they read better in Inter.

Numbers that need to line up in a column get `tabular-nums`, not a mono face:

```tsx
<td className="text-right tabular-nums">{formatCurrency(total)}</td>
```

That is what the feature is for — it gives you fixed-width digits inside the body
face, with none of the terminal texture.

### 3.3 The ladder

> **Only the surface's name is larger than the body. Everything else is ink.**

Under one face and no accent, hierarchy inside a page is the *only* place typographic
personality can live — so it is specified as a closed set of **roles**, not as a range of
sizes. A role fixes size, weight and ink together. Picking one is picking all three.

| Role | Size | Weight | Ink | Where |
|---|---|---|---|---|
| **Surface title** | `text-lg` 18px | `font-semibold` | `text-copy-primary` | The name of the thing you are looking at: page title, dialog title, sheet title, whole-route state title. **Exactly one per surface.** |
| **Section heading** | `text-sm` 14px | `font-semibold` | `text-copy-label` | A named group inside a surface. The 137 hand-written `<h2>`s land here. |
| **Eyebrow** | `text-2xs` 11px | `font-semibold` | `text-copy-label` | A group marker above a heading or a rail block. Replaced the swept `uppercase` labels. |
| **Field label** | `text-xs` 12px | `font-medium` | `text-copy-label` | The name of a value. |
| **Value** | `text-sm` 14px | `font-normal` | `text-copy-primary` | The thing the operator came for. The loudest ink in the body. |
| **Body / cell** | `text-sm` 14px | `font-normal` | `text-copy-secondary` | Table cells, descriptions in a row, supporting copy. |
| **Metadata** | `text-xs` 12px | `font-normal` | `text-copy-muted` + `tabular-nums` | Timestamps, counts, ids, record numbers. |
| **Stat figure** | `text-2xl` 24px | `font-bold` | `text-copy-primary` + `tabular-nums` | Dashboard metrics only. One size — see below. |

Four sizes in product UI: **11 / 12 / 14 / 18**. `text-2xl` is the dashboard exception and
`text-3xl`+ is auth and marketing only.

**16px is not in the product ramp.** It used to be the section-heading size, and that is
the rule this table changes. Two pixels above a 14px body is not a hierarchy, it is
"slightly bigger text" — the exact failure this section already warned against — and it is
why one heading role had drifted to four sizes at once (`text-lg` ×46, `text-base` ×43,
`text-sm` ×24, bare `font-semibold` ×23). A step that reads as almost-the-same gets picked
whenever neither neighbour feels right. `text-p-base` survives for prose that genuinely
wraps at reading length; the tight 16px does not.

**The heading steps down, not up.** A section heading is quieter than the values under it:
same size, heavier weight, one ink step back. That inversion is deliberate and it is the
§1.3 principle applied to type — on a record page the operator came for *Jane Doe*, not for
the words *Contact details*. The heading is navigational furniture and should not outrank
the data. Heading and value differ on two axes at once (weight and ink) and on none of the
third (size), which is a stronger signal than the 2px it replaces and costs no vertical
space.

The one place a heading takes `text-copy-primary` is where **no value competes with it**:
the title of a state rendered inside a container — an empty, error or permission-denied
state inside a table body. Those keep the section-heading size and take primary ink,
because at that moment they are the only content on the surface. A state that replaces the
*whole route* is a surface title instead (§4.4).

**Prose family** — anything that may wrap onto a second line: descriptions, helper text,
empty-state copy, error explanations.

| Class | Size / line-height |
|---|---|
| `text-p-xs` | 12px / 1.55 |
| `text-p-sm` | 14px / 1.55 |
| `text-p-base` | 16px / 1.6 |

Never hand-tune a line height (`text-sm leading-6`). If it wraps, it is prose; pick the
prose token. Do not introduce sizes between these — if something needs to be "slightly
bigger", it needs more weight or more space, not a new size. That rule now has teeth,
because there is no longer a step available between body and title to reach for.

**One stat figure size.** Dashboard metrics ran `text-3xl` ×27, `text-2xl` ×18 and
`text-xl` ×15 for one role. A metric is a number the eye lands on, not a competition
between panels, and three sizes on one dashboard reads as three levels of importance that
nothing supports. `text-2xl font-bold tabular-nums`, once.

### 3.4 Weight carries emphasis, not size

`font-medium` for anything the eye should land on first; `font-semibold` for buttons
and page titles; `font-normal` everywhere else. `font-bold` is reserved for stat
figures. Emphasis inside a paragraph is weight, never colour.

### 3.5 Sentence case, and stop shouting

Titles, buttons, labels, menu items, and column headers are **sentence case**.
Not Title Case, not ALL CAPS.

There is **no legitimate use of `uppercase` in product UI**, and none left in the
codebase. A quiet header is distinguished by size, weight, and ink step — a section
eyebrow is `text-2xs font-semibold text-copy-label`, not shouted small caps. Faking
small caps with `tracking-wider` is the same mistake and is equally out.

Uppercase cost legibility on exactly the text operators scan most, and the
wide-tracked variant was the single biggest reason the UI read as templated.

**Title Case is in scope, and nothing catches it.** The rule is sentence case, so
"Save Quote", "New Contract" and "Module Settings" break it exactly as `uppercase`
does. Both guards are blind here: the grep matches class strings, and the rendered
spec reads `text-transform`, which is `none` for text that was simply typed
capitalised. The same applies to the `capitalize` class and to runtime title-casers
that rebuild a label from a key. Until the Title Case check in
`design-rules.spec.ts` lands, this one is enforced by reading.

### 3.6 Values the operator did not supply

An absent value had **six spellings** — `"—"` ×32, `"Unassigned"` ×25, `"-"` ×25,
`"Not set"` ×21, `"Not recorded"` ×17, `"Not provided"` ×1 — and `ReadOnlyRecordLayout`,
the primitive three pages share, emitted the one nobody else used.

There is one answer per context, and **no call site chooses it**:

| Context | Renders | Why |
|---|---|---|
| A field on a record, form or detail surface | `Not set` | The operator is reading one value and needs to know it is genuinely empty, not that the page failed to load. |
| A cell in a table | `—` | A column of 25 rows each reading "Not set" is noise. Density is a feature (§1.5), and the column header already says what the field is. |

This is the same shape as the status ruling in `rebuild.md` R5 — the *renderer* decides the
treatment from context, and the call site supplies only the value. A hyphen-minus (`-`) is
never correct; the character is an em dash.

`"Unassigned"` survives in exactly one place: as the **label of a real filter bucket**
("Owner: Unassigned"), where it names a set of records rather than the absence of a value.

**Enum labels are sentence case, including the ones built at runtime.**
`lib/statusStyles.ts` title-cases every unmapped value and hard-codes "Closed Won",
"In Progress" and "To Do" — so §3.5 is broken on data that reaches every list page in the
app, by a helper rather than by a designer. The correct forms are "Closed won", "In
progress", "To do". `lib/module-display.ts#formatSnakeCaseLabel` is the one function
allowed to build a label from a key; the 17 open-coded `charAt(0).toUpperCase()` repeats
are drift.

---

## 4. Space and size

### 4.1 The 4px grid

All spacing is a Tailwind step (multiples of 4px). No arbitrary `p-[13px]`.

| Step | Use |
|---|---|
| `gap-1.5` / `gap-2` | Inside a control — icon to label, pill contents |
| `gap-3` | Between related controls in a toolbar row |
| `gap-4` | Between fields in a form |
| `gap-6` | Between sections of a page |
| `gap-8` | Between major regions. Rare. |

**There is no 5-step.** `gap-5` and `p-5` are not on the ladder and are being swept
out (112 uses at the time of the ruling). Being a multiple of 4px is necessary, not
sufficient — the ladder is a closed set, the same way control heights are (§4.2).

The 5-step is why card padding has three values at once (`p-4` ×77, `p-5` ×81,
`p-6` ×25) for one role. A step that sits between the two legitimate answers gets
picked whenever neither feels right, which is how a padding decision stops being a
decision. Choose `p-4` for dense containers and `p-6` for a card that holds sections;
if a screen genuinely needs the value in between, that is a case for changing this
table under §12, not for reaching past it at the call site.

### 4.2 Control heights are a closed set

Three heights, as tokens, matched across every control type (button, input, select,
search):

| Token | Height | Use |
|---|---|---|
| `--size-control-sm` | 32px | Dense toolbars, table row actions, inline filters |
| `--size-control` | 38px | Forms, dialogs, page-level actions |
| `--size-control-lg` | 44px | Auth screens and empty-state calls to action only |

Used as `h-[var(--size-control)]` / `size-[var(--size-control)]`. An input and the
button beside it must always resolve to the same token.

Never override a control's height at the call site (`<Input className="h-9" />`).
That was the source of the drift: a select trigger at 36px beside a 38px input reads
as broken to someone who cannot name why. If a control needs a different height, it
needs a size variant, not a className.

### 4.3 Radius is named by what it wraps

Never guess a radius. The token says what the shape is:

| Token | Value | Wraps |
|---|---|---|
| `--radius-control-sm` | 6px | Small buttons, pills-with-corners, chips |
| `--radius-control` | 8px | Buttons, inputs, selects |
| `--radius-card` | 10px | Cards, table containers, panels |
| `--radius-panel` | 12px | Sidebar panels, large sections |
| `--radius-dialog` | 14px | Dialogs, sheets, popovers |

`rounded-full` is for avatars and status pills only; `rounded-none` where a corner
must be square.

**The named Tailwind aliases are not mapped.** `rounded-sm` / `-md` / `-lg` / `-xl`
emit no CSS at all — a leftover alias fails loudly instead of silently rendering a
different corner. This is deliberate: 129 bare `rounded-md` (6px) had accumulated
alongside 202 `rounded-[var(--radius-control)]` (8px) for the same class of element,
so the same button was 6px in one place and 8px in another. Named aliases invite
eyeballing; a token named for what it wraps forces a deliberate pick.

### 4.4 Written geometry

Numbers, not instincts. When a screen needs a value that is not here, take it from the
nearest shipping screen rather than inventing one.

| Thing | Value |
|---|---|
| Page gutters | `px-4 sm:px-6` — the same pair on header, body, and full-bleed rows |
| Section stack | `space-y-6` |
| Form field stack | `space-y-4` |
| Settings section stack | `space-y-8` |
| Sidebar nav stack | `space-y-0.5` |
| Inline actions | `gap-2` |
| Card content padding | `px-6 py-6` — `CardHeader` and `CardBody` |
| Card action bar | `px-6 py-4` — `CardFooter`, the same row height as a toolbar |
| Dense table row | 40px |
| Comfortable table row | 52px |
| Toolbar row | `min-h-9` |
| Context rail | `20rem` — the record spine and the form aside are the same width (§4.7) |
| Nav rail | `16rem` — settings lateral navigation (§4.7) |
| Page split | `lg:grid-cols-[minmax(0,1fr)_20rem]` — **one** ratio, **one** breakpoint |
| Field grid inside a section | `md:grid-cols-2` |

The last two replace measured drift, not a gap: the two-column split had **10 different
ratios** with the breakpoint flipping between `lg` and `xl`, and the responsive field grid
`grid gap-* sm|md:grid-cols-2` was hand-written **78 times**. A page split is `lg` because
it reorders major regions; a field grid is `md` because it only reflows label/value pairs.

`Card` carries **two** vertical values, not three. It ran `pt-6` / `py-5` / `py-4` —
one step per slot, one of them the 5-step §4.1 rules off the ladder. 24px is the
card's content padding; 16px is the action-bar padding, and a footer gets it because
five of the six in the app are sticky save bars, where the extra 16px is height taken
from the thing being saved. A card used as a dense container still takes `p-4` at the
call site; `p-6` and `p-4` are the two legal answers, picked by role.

**One row mechanism per list.** A list picks dense or comfortable and every row in it
matches; do not mix heights inside a single table.

**These numbers are supplied by a primitive, not retyped per page.** Every value above
that a page could get wrong now has a component that owns it. Reaching past them to
hand-assemble a page root or a table is the drift this section exists to prevent.

`PageShell` — owns the page root, and is the only thing that writes it:

| Variant | Root | For |
|---|---|---|
| `list` | `flex h-full min-h-0 flex-col gap-4` | the §11.1 full-height column: pinned toolbar, one scrolling table, pinned pagination |
| `document` | the documented section stack (`gap-6`) | scrolling form and detail pages |
| `settings` | the settings section stack (`gap-8`) | settings pages |

It emits `data-slot="page-shell"` so the rendered guard can assert that the first
element inside the content scroller is one. `PageHeader` is its heading row — see below.

**It also supplies the four §7.4 whole-route states** — `isPermissionDenied`,
`isLoading`, `hasError`, each with a slot to override — resolved in that order, because
that is the order the operator can act on them. Two rules follow from having them here:

- A page whose permission check is still in flight must not pass `isPermissionDenied`
  yet, or it flashes a wall before the answer arrives.
- When a state is showing, the shell drops `actions` and `context`. An action row over a
  permission wall or a failed load offers work the operator cannot do.

`PermissionDeniedState`, `RouteErrorState` and `RouteNotFoundState` each take
`titleAs="p"`. Standing alone they replace the page and own its `h1`; inside a shell the
shell has already emitted one, and §8 allows exactly one.

`RecordTable` — owns everything above the cell, which `Table` (a cell primitive) does
not and should not:

- min-width **derived from the visible column count**, never a hardcoded
  `min-w-[Npx]`. A view trimmed to three columns must not still force a horizontal
  scrollbar sized for twelve.
- the selection column: one width, one padding, one indicator size, tri-state
  `indeterminate` on every list that has it.
- **no horizontally-sticky columns.** The header row pins; nothing pins sideways.
- **one row-open gesture**, bound to click, Enter and Space, with a visible
  `focus-visible` ring on the row. Keyboard-reachable is a §8 floor; a row that takes
  focus invisibly is worse than one that cannot take it at all.
- all four §7.4 data-view states as slots — loading, empty, error, permission-denied —
  with the empty state's create action wired by default.

Legitimate differences between lists are `cva` variants on the primitive (§7.3), not
`className` at the call site.

**Pinned columns were tried and taken back out.** The selection and identity columns
pinned for one phase. The owner's call, and the two defects behind it:

- The row's checkbox painted *over* the header's. `thead` is `sticky top-0 z-20`, and a
  positioned element with a z-index opens a stacking context — so the header cell's own
  z-index was scoped inside `thead` and never compared against the body at all. `tbody`
  opens no such context, so the body cell's `z-20` met the header's `z-20` as equals, and
  equal z-index is resolved by DOM order, which the body wins.
- The selection cell carried `pr-0` to stay narrow. `table-auto` collapses a column to its
  content when the table is short of width, so at a narrow viewport the right-hand border
  closed onto the checkbox with no gap — and a wide viewport had slack, so it looked
  correct on the machine it was built on.

Both are properties of pinning inside a table, not bugs in the pinning code, and neither
was worth the horizontal scroll it saved. An unpositioned cell always paints under the
sticky header, and the selection column takes the table's own `px-4` on both sides — 16 +
16 + 16 = the 48px the primitive budgets for it. A row ground therefore no longer needs to
be opaque for occlusion; `--color-bg-surface-row-alt` and `-row-hover` stay because a
translucent stripe over a striped ancestor is its own inconsistency.

One detail of the contract is still easy to get wrong and expensive to notice:

- **The table's states are the `EmptyState` family, not the route states.**
  `PermissionDeniedState` and `RouteErrorState` each emit the page's `h1`; they are
  correct as a whole route and wrong inside a `td`, where they would give the page a
  second heading (§8). Inside the table the same four states render as icon + title +
  description + action.

**`PageHeader` absorbed `PageToolbar`.** They were the same thing — a right-aligned
action row — differing only in `min-h-9` and which one emitted the heading. Because
only `PageHeader` rendered the `sr-only` `h1`, every page built on `PageToolbar`
shipped no `h1` at all, breaking §8; the merged component always emits it, which fixes
that class of bug rather than each instance of it. The deprecated alias existed for one
phase and is now deleted: every page is a `PageShell`, which renders the header for it.

`PageHeader` also has a second, narrower use: a record detail page renders one with no
`title`, carrying only the back link and the record's actions, under a shell that has
already named the page. `RecordPageHeader` is that call.

### 4.5 One scroll region per screen

A screen must never have both a page scroll and a nested content scroll. Two
scrollbars, and the inner region steals the wheel whenever the pointer is over it.

Decide which kind of thing you are looking at:

**Page content** — the table, list, or body the operator came to read. It must **never**
carry a height cap. Either make the page a full-height column so one region scrolls, or
leave the content uncapped so the page scrolls as one document. Both give one scrollbar;
pick full-height when a pinned toolbar and pagination are worth it (§11.1).

**A bounded control** — an overlay or an option list. It *should* be capped, because an
uncapped one would push the rest of the screen away. These are exempt:

- dialog and sheet bodies (`role="dialog"`, `[data-slot="sheet-content"]`)
- popovers and listboxes
- code, payload, and long-legal-text blocks
- inline pickers, marked `data-bounded-list` with a comment saying why

The rule is enforced by `frontend/tests/e2e/scroll-containers.spec.ts`, which walks every
static route and fails on any page that scrolls while also containing a nested scroller.
If you add a legitimately bounded region, mark it — do not widen the test.

**Watch for `overflow-x-hidden` on a vertical stack.** CSS computes the other axis to
`auto`, so the element silently becomes a scroll container. Use `overflow-x-clip`.

### 4.6 Shadows are for elevation, not decoration

`--shadow-panel` exists for things that genuinely float — dialogs, popovers,
dropdowns. Nothing anchored to the page gets a shadow. On dark grounds a shadow is
nearly invisible anyway; elevation on dark is communicated by the *lighter ground*
(`bg-surface-raised`), which is why that token exists.

**One token, one spelling.** There were five vocabularies for the same job —
`shadow-2xl` on twelve sheet call sites, `shadow-xl` on five overlay lists,
`shadow-md` inside the vendored popover and select, a hand-written
`shadow-[0_32px_100px_rgba(...)]` on the command palette, and `shadow-[var(--shadow-panel)]`
on the three places that were right. They now all read the token, and it is set in the
primitive — `sheet`, `dialog`, `popover`, `select` — so a call site never types an
elevation at all.

The anchored half went the other way. A switch thumb, a kanban card, a filter chip, a
selected settings row and a sticky editor bar had picked up `shadow-sm`/`shadow-lg`;
those are gone. What floats: dialogs, sheets, popovers, dropdowns, listboxes, toasts.
Everything else is on the page.

### 4.7 The five page archetypes

Every screen in Lynk is one of five shapes. This is the level §1.1 calls a redesign and
§12 requires to be written down first, so it is written here before it is built.

A screen that is none of these is not a sixth archetype — it is a screen that has not
decided which of the five it is. The rulings behind them (`R1`–`R6`) are in
[`rebuild.md`](./rebuild.md).

---

#### Archetype 1 — List

Shipped. `PageShell variant="list"` + `ModuleListToolbar` + `RecordTable` + `Pagination`.

```
┌──────────────────────────────────────────────────────────────────┐
│ Leads                                          [Import] [New]    │  PageHeader
├──────────────────────────────────────────────────────────────────┤
│ [search]  [view ▾] [filters ②] [columns]              [density]  │  ModuleListToolbar  pinned
├──────────────────────────────────────────────────────────────────┤
│ ☐ │ Name        │ Status   │ Owner      │ Value    │ Updated     │  header  sticky top-0
│ ☐ │ Acme Corp   │ Contacted│ P. Raman   │ $42,000  │ 2h ago      │
│ ☐ │ Northwind   │ New      │ J. Silva   │ $18,400  │ 5h ago      │  ← the only scroller
│   │ …                                                            │
├──────────────────────────────────────────────────────────────────┤
│ 1–25 of 412                                        ‹ 1 2 3 … ›   │  Pagination  pinned
└──────────────────────────────────────────────────────────────────┘
```

Contract: full-height column, rows are the only scroller (§11.1), min-width derived from
the visible column count, one row-open gesture bound to click/Enter/Space with a visible
focus ring, all four §7.4 states supplied by the primitive. **Status renders as plain text**
(`rebuild.md` R5) and **is not editable in a cell** (R6) — changing it means opening the
record.

---

#### Archetype 2 — Record: the spine

**The signature.** A fixed `20rem` rail carries the record's identity, state and
relationships; the content region is the only scroller and carries one tab strip.

```
┌─ header ─────────────────────────────────────────────────────────────────┐
│ ‹ Deals    Acme Corp — Q3 renewal                     [Edit]  [⋯]        │
├──────────────────────┬───────────────────────────────────────────────────┤
│ SPINE   20rem, fixed │ CONTENT — the only scroller                       │
│                      │                                                   │
│ State                │  Details │ Timeline │ Tasks │ Files               │
│   Stage      ⌄       │  ────────                                         │
│   Owner      ⌄       │                                                   │
│   Priority   ⌄       │  Commercial                    ← section heading   │
│                      │    Amount           $42,000.00                    │
│ Connected            │    Expected close   12 Sep 2026                   │
│   Account       ›    │    Probability      60%                           │
│   Contact       ›    │                                                   │
│   Quotes        ›    │  Contact details                                  │
│                      │    Email            jane.doe@acme.com             │
│ Created 2 Aug        │    Phone            +1 555 0100                   │
│ Updated 2h ago · ⏱   │                                                   │
└──────────────────────┴───────────────────────────────────────────────────┘
```

…and the Timeline tab, where the composer sits above the feed:

```
├──────────────────────┬───────────────────────────────────────────────────┤
│ State                │  Details │ Timeline │ Tasks │ Files               │
│   Status  Contacted ⌄│            ────────                               │
│   Owner   P. Raman  ⌄│  ┌─────────────────────────────────────────────┐  │
│                      │  │ Note   Call   Email   WhatsApp              │  │
│ Connected            │  │ [ Capture the outcome and next action…    ] │  │
│   Company  Acme    › │  │ ☐ Create reminder task            [ Log ]   │  │
│   Contact  —         │  └─────────────────────────────────────────────┘  │
│                      │                                                   │
│ Created 2 Aug        │   Note      P. Raman                     2h ago   │
│ Updated 2h ago · ⏱   │     Left voicemail, retry Thursday                │
│                      │   Call      P. Raman                     2h ago   │
│           ⏱ = History│   Email ↗   Quote follow-up               1d ago  │
│           opens the  │   Task      Send pricing deck             2d ago  │
│           audit sheet│                                                   │
└──────────────────────┴───────────────────────────────────────────────────┘
```

**The rule that makes it a signature rather than a layout:**

> **The spine is the only editable region on the page.**
> Every control that writes to the record is in it. Nothing in the content region edits.

R2 draws a categorical boundary — dropdown-shaped fields hold *state* and edit in place,
everything else holds *content* and is read-only until `/[id]/edit` — and then names its own
risk: a half-editable page where nothing signals what is clickable is worse than either pure
model. The spine answers that with **position** instead of with a convention. A boundary
carried by a region is learnable in one glance, and it cannot drift, because a control that
moves out of the rail is visibly in the wrong place.

**What "editable" means here**, because the Tasks tab creates tasks and the Files tab
uploads files, and neither is a violation: the spine owns **the record's own fields**; the
content region hosts **related objects** — tasks, files, notes, logged interactions — which
are records in their own right and keep their own create affordances.

> Does the control write a column on *this* row? It belongs in the spine.
> Does it create or edit a row that points at this one? It belongs in the content region.

Denormalised stamps follow the event that produced them, not the rail. Logging a follow-up
writes `last_contacted_at`, but the operator is recording that something happened rather
than changing what the record is, so the composer stays in `Timeline` — and a field derived
from an event is read-only everywhere in any case.

Contract:

- **Blocks, in this order:** an optional lifecycle track (only where the record has a real
  pipeline — lead, deal, quote, order), **State**, **Connected**, then created/updated
  metadata carrying the `History` disclosure. State fields are `InlineFieldEdit` and
  autosave (R1). Connected entries are links, never free text.
- **Connected carries two kinds of entry: a record, and a collection.** A record is
  `RecordSpineLink` — a name and the way to it. A collection is `RecordSpineCollection` —
  a label, how many, and a link into the module tab that lists them (`Deals 3 ›`). Both
  are links for the same reason: a count with no way through is a number the operator
  cannot act on, and that is what the pre-5.3 relationship rail's tile grid was. The count
  answers "how big is this account" at a glance; the tab answers "which ones". Rejected:
  keeping the tiles (decoration, and it left the rail's densest region inert), and moving
  the counts into `Details` (they are derived volume, not fields, and R2's read-only
  content region is not where navigation belongs).
- **Every record type carries the spine.** Where a record has no state fields the State
  block is omitted; the Connected block is not optional. A rail that ends up carrying only
  "Created / Updated" is a signal that the record type is under-modelled — raise it, do not
  answer it with a second archetype.
- **The tab set is fixed and owned by the archetype:** `Details · Timeline · Tasks · Files`,
  in that order, on every record. Module-specific tabs append after `Files`. Because the
  archetype owns the only strip, tabs cannot nest — the defect at
  `opportunities/[opportunityId]` and `finance/pos/[invoiceId]` has nowhere to recur, and
  contracts, contacts and accounts inherit the four panels instead of each page remembering
  them.
- **The composer is the first thing in `Timeline`**, above the feed, and it is the only
  place a record's history is written from. Its modes are the interaction kinds the record
  supports — note, call, email, WhatsApp — so "log what happened" and "read what happened"
  are one surface rather than a panel and a tab that never see each other. A separate
  `Notes` tab is not an option: `record_activity.py` already emits notes into the feed as
  `type="note"`, so a Notes tab renders the same rows twice and asks the operator which
  copy is authoritative.
- **Where a channel has a tracked endpoint, that endpoint *is* the composer's mode for it,
  and the page offers no second untracked path to the same channel.** Contacts are the
  case: click-to-chat posts to `/whatsapp/contacts/{id}/click`, which picks a template,
  records a `WhatsAppInteraction` and optionally creates the reminder — and that
  interaction is exactly what the feed renders as `type="whatsapp"` underneath. So the
  pre-5.3 `WhatsApp` panel becomes the composer's WhatsApp mode rather than a spine block:
  by the test above it creates a row pointing at the record, not a column on it.
  `CommunicationActions` keeps its raw `wa.me` button only on records with no tracked
  endpoint — offering both on one page means the same action logs itself half the time,
  and the operator cannot tell which button did which.
- **Audit history is not a tab.** It hangs off the spine's `Updated` line and opens in a
  sheet. Two reasons, and the second is the load-bearing one. First, it is a reference
  surface consulted occasionally, and a tab that is always present but rarely opened is
  furniture competing with three tabs that are opened constantly. Second, `activity_logs`
  and the `record_activity` projection are **deliberately separate stores** — that
  module's docstring says so — with different permission surfaces, so a merged feed means
  either overturning that decision or interleaving two cursors client-side, which breaks
  "load more". Hanging it off `Updated 2h ago` puts the answer where the question is
  asked.
- **A field the spine owns does not appear in `Details`.** Record layouts are configured
  server-side and predate the spine, so they still list status, owner and the rest; drawing
  them in both places puts an editable status in the rail and a read-only copy of the same
  value beside it, which is precisely the "nothing says what is clickable" failure R2 set
  out to avoid. `ReadOnlyRecordLayout` takes `omitFieldKeys` and a section left with
  nothing renders nothing. Found by looking at the first rebuilt page, not by an assertion.
- **One filled button in the header** (§2.2), and it belongs to the record's primary
  workflow action — Convert, Send, Issue. Destructive and rarely-used actions go in the
  `[⋯]` menu the wireframe shows, which is what keeps Delete from setting a second fill
  beside Convert.
- **Scroll:** the content region. The rail is a flex sibling of it, not `position: sticky`,
  so this adds no exception to R3. Same mechanism as archetype 1.
- **The `Edit` affordance is in the header row**, reachable from every tab, and
  `/[id]/edit` preserves `?tab=` in both directions. Editing from Files returns to Files.
- **Below `lg` the rail stacks above the content and the page reverts to a document
  scroll.** That is the deliberate fallback, not a responsive feature: §4.4's gutters stand
  and Lynk is a desktop product, so the narrow case only has to stay usable.

**`InlineFieldEdit`'s own contract**, built in rebuild 5.1 batch E ahead of the spine
(5.3) landing:

- The trigger is `Select` (radix, already vendored) with `SelectTrigger variant="ghost"`
  — R6's affordance in one variant rather than a second component: no border at rest, the
  ground only appears on `hover:bg-surface-muted`, the chevron is `text-copy-muted` and
  always visible, and `focus-visible` takes the §2.3 ring. `size="sm"` — a state field is
  a quiet affordance, not an input.
- The closed value renders through `StatusValue status={…} context="record"` — the same
  component a read-only status uses, so a field looks identical whether it turns out to be
  editable or not until the operator notices the chevron. No call site invents its own ink.
- Each field owns one `SaveStateIndicator`, inline beside the control (the archetype 4
  wireframe's "`Provider [ Microsoft Entra ▾ ] Saving…`" row is the pattern — InlineFieldEdit
  is that row's control-plus-feedback pair, generalised). `idle → saving → saved → idle`
  auto-reverts 2s after a successful commit; `error` stays until retried, per
  `SaveStateIndicator`'s own contract that an unretryable error is a dead end.
- **A side-effecting change confirms first.** R1's "explicit confirm, never a silent
  commit" row is a `confirm` prop the call site supplies when the value can fire an
  automation or an email (the contract status change is the current example) — resolving
  `false` cancels before `onCommit` runs, so nothing autosaves speculatively.
- **Interim placement.** R9 makes the spine the record's only editable region once 5.3
  lands it. Until then, batch E adopts `InlineFieldEdit` at its *current* location on the
  five pages that already hand-roll this control — the control's own contract does not
  change when 5.3 moves it into the State block, only its position on the page does.

The cost, recorded rather than discovered later: the rail spends ~320px on every record, so
the content region is about 700px at a 1280px viewport. A two-column field grid fits; a
three-column one does not. The three line-item documents (quote, order, invoice) are where
this bites, and the answer is that `RecordTable variant="lineItems"` scrolls sideways inside
the content region — the archetype does not bend for them.

---

#### Archetype 3 — Form

`PageShell variant="document"` + `RecordFormLayout`. Applies to `/new` and `/[id]/edit`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ New deal                                                                 │
├────────────────────────────────────────────┬─────────────────────────────┤
│ ┌ Commercial ──────────────────────────┐   │ ┌ Ownership ──────────────┐ │
│ │  Name *          [                ]  │   │ │  Owner    [          ]  │ │
│ │  Amount          [                ]  │   │ │  Team     [          ]  │ │
│ │  Close date      [                ]  │   │ └─────────────────────────┘ │
│ └──────────────────────────────────────┘   │        aside  20rem         │
│ ┌ Contact ─────────────────────────────┐   │                             │
│ │  Email           [                ]  │   │                             │
│ └──────────────────────────────────────┘   │                             │
├──────────────────────────────────────────────────────────────────────────┤
│ Unsaved changes                            [Cancel]  [Create deal]       │  ActionBar — not sticky
└──────────────────────────────────────────────────────────────────────────┘
```

Contract: sections are panels (`FormSection` → `Card`), the section title is the
section-heading role, fields sit on `md:grid-cols-2`, every input has a visible label
(§7.5), required sets match the backend exactly. **Manual save** (R1) — a create form and a
line-item document both keep an explicit commit, because a half-formed autosaved record
lands in lists, counts and reports.

The action bar is **at the end of the document, not stuck to the viewport** (R3). It carries
the dirty-state string and both actions, once — `insertion-orders` currently renders two
Cancel buttons because the page header and the footer each supplied one.

---

#### Archetype 4 — Settings

`app/dashboard/settings/layout.tsx` supplies a `16rem` nav rail; each page is a
`PageShell variant="settings"` inside it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Settings                                                                 │
├────────────────┬─────────────────────────────────────────────────────────┤
│ NAV   16rem    │ Authentication                                          │
│                │ Sign-in methods and session policy for this workspace.  │
│ Workspace      │                                                         │
│  General       │ ┌ Multi-factor ──────────────────────────────────────┐  │
│  Branding      │ │  Require MFA for all users        [ on  ]  Saved   │  │
│ People         │ └───────────────────────────────────────────────────┘   │
│  Users         │ ┌ Single sign-on ────────────────────────────────────┐  │
│  Roles         │ │  Provider          [ Microsoft Entra ▾ ]  Saving…  │  │
│ ▸Authentication│ └───────────────────────────────────────────────────┘   │
│  …             │                                                         │
└────────────────┴─────────────────────────────────────────────────────────┘
```

Contract: **every settings page has a visible title and a description** — none of the 19
does today. **Autosave** (R1), because a settings control is one independent reversible
field and a switch with a Save button is a UX smell; `SaveStateIndicator` replaces the
removed footer, so the operator still gets feedback. All six sticky Save/Discard bars go
(R3). `PermissionDeniedState` on **all 23** pages, not 1 — settings is entirely admin-gated,
so a missing permission wall is exactly what a non-admin hits.

The nav rail closes A8 and settles the IA: `SETTINGS_NAV_ITEMS` (flat, 18) and the hub's
`SETTINGS_SECTIONS` (6 groups, 19) become **one** source, which is what currently leaks
`record-layouts` — invisible to ⌘K and rendering Title Case from a label fallback.

---

#### Archetype 5 — Dashboard

`PageShell variant="document"` — a metric row, then panels.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Dashboard                                                    [This week ▾]│
├──────────────┬──────────────┬──────────────┬─────────────────────────────┤
│ Open deals   │ Pipeline     │ Won this mo. │ Overdue invoices            │
│ 38           │ $412,900     │ $86,400      │ 4                           │  StatTile
├──────────────┴──────────────┴──────────────┴─────────────────────────────┤
│ ┌ Pipeline by stage ───────────────┐ ┌ Tasks due today ────────────────┐ │
│ │                                  │ │  Call Northwind      14:00      │ │
│ │        (chart)                   │ │  Send Q3 quote       16:30      │ │  rows, divide-y
│ └──────────────────────────────────┘ └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Contract: one `StatTile`, one stat-figure size (§3.3), metrics on
`md:grid-cols-2 xl:grid-cols-4`, panels on `xl:grid-cols-2`. Chart colour comes from
`lib/chartColors.ts` and nowhere else (`tokens.md` §3.4). A metric is a **number plus its
label** — a sparkline or a delta is allowed, a decorative gradient is not (§1.2).

Load the `dataviz` skill before touching chart layout or stat-tile composition.

---

## 5. Icons

**lucide-react only.** It is already the single icon dependency (165 imports).
Do not add another icon package, and do not hand-author SVG paths in a component
when a lucide glyph exists.

- Default size is `size-4` (16px), matching `text-sm` cap height.
- `size-3.5` inside `sm` controls and pills; `size-5` for empty-state and page-header
  glyphs; `size-8`+ for illustration only.
- Icons inherit `currentColor`. Never set an icon's colour independently of its label.
- `strokeWidth` stays at the lucide default. A heavier stroke on one icon breaks the
  optical weight of a whole toolbar.
- An icon-only button **must** carry `aria-label` or an `sr-only` label. An icon
  alone is never an accessible name.
- Icons are supporting, not decorative. If removing the icon loses no information and
  the label is already clear, remove it.

**Audited August 2026: clean.** 165 icon imports, all lucide, no second package.
Exactly two files hand-author SVG, and both are **third-party brand marks**, which
lucide excludes by policy:

| File | Mark |
|---|---|
| `app/auth/login/page.tsx` | Google and Microsoft OAuth logos |
| `components/contacts/contactList.tsx` | LinkedIn |

Those are the only permitted hand-authored icons. Anything else is a lucide glyph.

---

## 6. Motion

Motion confirms a change; it does not perform. Anything an operator sees a hundred
times a day must be effectively invisible.

- **150ms** for hover, focus, and colour transitions. Transition specific properties
  (`transition-[background-color,border-color,color,box-shadow]`), never `transition-all`.
- **200ms** for enter/exit of popovers, dialogs, sheets.
- No entrance animation on page or list content. A table that fades in on every
  navigation makes the app feel slower than it is.
- No unconditional splash or full-screen loader on route change. Route transitions use
  `RouteLoadingState` / skeletons that preserve the shell, so navigation never blanks
  the page.
- Ambient motion (`float-slow`, shimmer) belongs on auth and marketing surfaces only.
- Respect `prefers-reduced-motion` for anything that loops.

**Reduced motion is a property of the platform, not of the call site.** The 13
hand-placed `motion-reduce:` uses found in the frontend audit were the symptom of the
opposite approach: `Skeleton` and `Pagination` remembered, 20 of 21 spinners did not,
and `.float-slow` ran `infinite` with no guard on the first screen every operator sees.

It is now enforced in two places, because the frontend animates in two languages:

- `app/globals.css` ends with a `prefers-reduced-motion: reduce` block that collapses
  every animation and transition — loops stop, one-shot transitions become instant.
- `MotionConfig reducedMotion="user"` in `app/providers.tsx` covers `motion/react`,
  which animates in JS and cannot see a CSS media query. `Checkbox` and `Switch`
  animate scale there.

A component that also wants the intent legible in its own file may still carry
`motion-reduce:` — `Skeleton` and `Spinner` do. What it must not do is *rely* on the
call site to remember. One consequence worth knowing: a hover state expressed only as
a `whileHover` scale disappears under reduced motion, so an interactive primitive owes
§7.4 a CSS hover as well.

This is the one rule here that a media query can switch off, so no amount of static
computed style will catch a violation. `design-rules.spec.ts` checks it by re-running a
route under `emulateMedia({ reducedMotion: "reduce" })`.

---

## 7. Components

### 7.1 Use the primitive

`components/ui/` holds 53 primitives. Before writing UI, check whether the pattern
exists. The list-and-record language in particular is not optional:

| Need | Use |
|---|---|
| A module list | `ModuleTableShell` + `Table` |
| Toolbar above a list | `ModuleListToolbar` |
| Search | `SearchBar` |
| Saved views / filters | `SavedViewSelector`, `InlineSavedViewFilters` |
| Column visibility | `ColumnPicker` |
| Paging | `Pagination` |
| Page root, title, actions and route states | `PageShell` (which renders `PageHeader`) |
| Fast create | `QuickCreateSurface` |
| A record detail page | The §4.7 archetype — spine + `RecordTabs`. Not a hand-rolled root |
| A record's state field | `InlineFieldEdit`, in the spine only (R6) |
| An action row | `ActionBar` — it owns its children's control height (R4) |
| A section heading | `SectionHeading` — 137 hand-written `<h2>`s |
| Money | `<Money>` over `lib/currency.ts`. Never a local `Intl.NumberFormat` |
| Nothing to show | `EmptyState` |
| No permission | `PermissionDeniedState` |
| Loading | `skeleton`, `ModuleTableLoading`, `RouteStates` |
| A panel's four states | `PanelStates` — `PanelHeader` / `PanelLoading` / `PanelEmpty` / `PanelError` |
| Status label | `StatusValue`. **`Pill` is deleted** — see `rebuild.md` R5: colour marks exception, not state |
| A tag, a count, a "System" marker | `Chip`. **Not** `StatusValue` — see below |
| Pick one of a small set | `SegmentedControl` / `SegmentedBoolean` — a view switcher, an Active/Inactive toggle |
| A person | `Avatar` |
| An absent value | `EmptyValue` — `Not set` in a field, `—` in a cell (§3.6) |
| Autosave feedback | `SaveStateIndicator` (R1) |
| Linked record | `LinkedRecordPicker` |
| Import / export | `ImportControls`, `ExportControls`, `ModuleImportExportControls` |

**`StatusValue` or `Chip`?** A **status** is one value from a closed set saying how a record is
doing, so it renders as ink and only deviation is painted. A **tag** names what something *is* —
a scope, a field type, a category — so it has no better or worse and never carries tone, but it
does take a quiet edge because tags usually sit several in a row. If a tag seems to need
colour, it is a status, and its classification belongs in `lib/statusStyles.ts`.

A page-local table, dialog, or toolbar is a review failure unless the diff also
explains why the primitive could not be extended.

### 7.2 shadcn and lucide are the only sources

New UI is assembled from **shadcn primitives** and **lucide icons**. Nothing else.

- Need a component that does not exist yet? Take the shadcn version, vendor it into
  `components/ui/`, and re-skin it with Lynk tokens. Do not hand-roll it, and do not add
  a different component library alongside it.
- Need an icon? It is in lucide. Do not add a second icon package, and do not hand-author
  an SVG path when a lucide glyph exists.
- A shadcn component that has been vendored is ours to re-skin, not to fork twice. If you
  need a variant, add it to the `cva` config (§7.2), do not copy the file.

This is a hard constraint, not a preference. It is what keeps 53 primitives looking like
one system, and it is why the token layer works at all — every primitive reads the same
variables.

### 7.3 Variants live in the primitive

Styling belongs in the component's `cva` config, not in the `className` at the call
site. If three call sites pass the same `className` override, that override is a
missing variant. Call-site `className` is for layout (`w-full`, `mt-2`), not skin.

### 7.4 States are mandatory

Every interactive component ships **hover, focus-visible, active, disabled**, and
every data view ships **loading, empty, error, permission-denied**. A view with only
a success state is unfinished. Empty states say what the thing is and offer the
create action; they do not just say "No data".

**The states come from the composition.** `PageShell` and `RecordTable` (§4.4) supply
all four, drawn from `RouteStates`, `EmptyState` and `PermissionDeniedState`. This is
deliberate: when each page had to remember, most did not — the four states were the
least consistent thing in the app, with `PermissionDeniedState` reaching 1 of 23
settings pages and 7 settings pages carrying no error state at all. A page opts out of
a state by passing its own slot, never by omitting it.

Copy carries the same contract as the container. An error names the fix, not the
failure (§7.5). An empty state is an invitation to act. An action keeps its name for
the whole flow — a button reading "Create invoice" produces "Invoice created", not
"Saved successfully" — because the interface's vocabulary is how an operator learns
their way around it.

### 7.5 Forms

- Every input has a visible `label`. Placeholder is never a label.
- Required fields use `RequiredMark`, and the client's required set matches the
  backend's constraints exactly.
- Errors sit under the field, in `text-state-danger`, and name the fix
  ("Enter a valid email"), not the failure ("Invalid").
- Error colour is always paired with text. Colour alone never carries state —
  a red border with no message is invisible to a colourblind operator.
- Destructive confirmations name the record and the consequence, and the confirm
  button uses the `danger` variant.

### 7.6 A primitive that draws a container names itself with `data-slot`

Every `components/ui/` file that renders a **container** — a panel, a shell, a state, an
action row, a value wrapper — emits `data-slot="<kebab-case name>"` on its outermost
element. `PageShell` already did this so the rendered guard could assert page rhythm
(§4.4); the convention is now the rule rather than one component's habit.

The reason is that the rendered guards check *composition*, and composition is invisible to
a class selector. `.rounded-\[var\(--radius-card\)\].border` matches a real `<Card>` and a
hand-rolled div identically — which is exactly the distinction §1.3 exists to draw, so a
guard built on classes cannot tell a compliant page from a regressed one. `data-slot` is
the only signal in the DOM that says *this container came from the primitive*.

Three checks depend on it and cannot be written without it: nesting depth (§1.3's two-level
budget), the panel border tier, and one-archetype-per-surface. All three are owned by
`rebuild.md` 5.10; the attribute has to be in the primitives before that sub-phase can
write them.

The name is the component's own, in kebab-case — `card`, `card-header`, `empty-state`,
`module-table-shell`. Sub-parts get their own slot rather than sharing the parent's. A
call site never writes `data-slot`; if a page needs one, the page needed a primitive.

---

## 8. Accessibility floors

Non-negotiable, and checkable:

| Rule | Floor | WCAG |
|---|---|---|
| Text on its ground | 4.5:1 | 1.4.3 |
| Large text (18px+ bold / 24px+) | 3:1 | 1.4.3 |
| Control boundaries, focus rings, icon-only affordances | 3:1 | 1.4.11 |
| Chart series against ground | 3:1 | 1.4.11 |

Plus:

- Meaning is never colour alone — pair with text, icon, or shape.
- Everything reachable by mouse is reachable by keyboard, in visible order.
- Dialogs trap focus and return it to the trigger on close.
- Icon-only controls have accessible names.
- Every page has exactly one `h1`. `PageHeader` renders its title as an `sr-only`
  `h1` — that is intentional and correct: the heading is in the accessibility tree
  and announced, while the visible header row carries only actions. Do not "fix" it
  by adding a second visible `h1`.

  **`PageHeader` owns the page's `h1`, and nothing else may emit one.** This was
  measured in a browser and had drifted three ways at once: the sidebar wordmark was
  an `h1` on every page, `app/dashboard/layout.tsx` renders the module name as a
  second, and `PageHeader` adds a third — so `/dashboard/profile` announced "Profile"
  twice. The wordmark is a brand mark inside a nav link and is now a `span`; the
  layout's module title becomes a plain element once every page carries a `PageShell`
  (tracked in `docs/design/consistency-pass.md` Phase 4).

  Neither guard counts headings, so nothing caught this. If you add an `h1` outside
  `PageHeader`, you are adding the second one.

`--color-border-control` exists *because* of 1.4.11. Structural hairlines
(`--color-border-subtle` / `-default`) are deliberately below 3:1 and must never be
used to bound an input, checkbox, or select.

---

## 9. The hive

Lynk's identity is a hexagonal lattice — a hive, everything connected. It is a
**brand** device, not a UI texture.

It belongs on: the auth background, the splash, and the dashboard's ambient
backdrop, at the opacities already set in `HexagonBackground`.

It does not belong on: tables, forms, dialogs, cards, empty states, or anything an
operator works inside.

If you touch the hive, verify it actually renders. A previous attempt replaced it
with three linear-gradients at 150°/30°/90° — which draws a *triangular* lattice, not
a honeycomb — at a contrast so low it was invisible. Take a screenshot in both themes
before claiming the motif is intact.

**The auth surface's atmosphere is intent, not drift.** `app/auth/layout.tsx` layers a
grid shimmer, a vignette and two inner-card radials over `HexagonBackground`. Those
are the reason `/auth` is the least generic screen Lynk has, and they are licensed
here and by §6's allowance for ambient motion on auth and marketing.

They are also, as written, raw `rgba()` in arbitrary values — a `tokens.md` §10
forbidden pattern. **The fix is to tokenise them, not to delete them.** `tokens.md`
§3.5 now names the ambient set. Deleting the layers would satisfy every grep and every
rendered guard in this repo and leave a login form indistinguishable from a template,
which is the failure this document exists to prevent. A cleanup that makes a screen
more correct and less itself has gone wrong.

No assertion in the suite can tell the two outcomes apart. Screenshot `/auth` in both
themes before and after, and confirm the honeycomb is still a honeycomb.

---

## 10. Before you ship

```
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build

# the source guard - greps the rules that are mechanical (also inside codex-check.sh)
./scripts/check-design.sh

# the rendered guards - they walk every route in a browser
docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1
```

The guard has two halves, and they are complementary.

`scripts/check-design.sh` reads the source and enforces what is visible there: raw hex
and Tailwind palette classes (§2.5), `ring-primary` (§2.3), `uppercase` and faked small
caps (§3.5), hand-tuned line heights (§3.3), off-grid spacing (§4.1), call-site control
heights (§4.2), bare radius aliases (§4.3), a height cap on `ModuleTableShell` (§4.5,
§11.1), `overflow-x-hidden` on a stack with no explicit other axis (§4.5), non-lucide
icon packages and hand-authored SVG (§5), a second component library (§7.2), and
`transition-all` (§6). Every failure names its section.

`design-rules.spec.ts` reads computed styles from all 94 routes and enforces §3.1, §3.2,
§3.5, §4.2 and §4.3. `scroll-containers.spec.ts` enforces §4.5. Between them they catch
what grepping the source cannot — a `<code>` element inheriting a monospace UA default,
an id column that turns out to hold plain integers, a height cap passed in through a
call-site `className`. If a guard fails, fix the code; only widen a guard when you can
name why the case is legitimate, and say so in the exemption comment.

**Exempting a line.** A genuinely legitimate case carries a `design-exempt: <reason>`
comment on the offending line, and the source guard skips it:

```tsx
accent_color: "#14b8a6", // design-exempt: tenant brand colour is data, this is the unset fallback (§2.5)
```

Mark the line; do not widen the check. If the exemption is a new *class* of case rather
than a one-off, it goes into this document first (§12), and the check learns about it
after the rule does.

Detail routes need records to be reachable. Seed a tenant with:

```
docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default
docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
```

Then walk this list:

1. **Both themes.** Open the screen in dark and light. Nothing may be invisible,
   and nothing may change identity between them.
2. **No raw hex, no raw colour.** `grep -rnE "#[0-9a-fA-F]{3,8}\b" <changed files>`
3. **Tokens, not Tailwind palette.** No `bg-slate-800`, `text-gray-400`,
   `border-zinc-700`. Those do not follow the theme.
4. **Primitives.** Did you rebuild something `components/ui/` already has?
5. **All four states** on interactive elements, **all four views** on data.
6. **Keyboard.** Tab through it. The focus ring must be visible at every stop.
7. **Contrast.** Any new colour pair measured against §8.
8. **Density.** Does it match the screens beside it, or is it airier?
9. **Scope.** Did the diff change structure on screens the task did not name?

---

## 11. Known drift

Recorded so it is not mistaken for intent. Do not fix these opportunistically inside
an unrelated change, and do not copy them.

| Open | Scale | Note |
|---|---|---|
| Body copy is still one size in practice | 872 `text-sm` | The tight/prose split (§3.3) and `text-2xs` exist, but the finer 13/15px steps have not been introduced. Add them only if a real hierarchy needs them. |
| `text-copy-label` applied to swept labels only | — | The token exists and the 118 ex-`uppercase` labels use it. Other hand-written labels still sit on `text-copy-muted`. Move them as you touch them. |

### 11.0 Components that predate the shadcn rule

§7.2 makes shadcn primitives the only source. Four places were built before that rule
and hand-roll something shadcn already provides. Two have user-facing consequences, so
they are ordered by that rather than by size.

| Component | Built as | Consequence |
|---|---|---|
| ~~`RecordTabs`~~ | radix `Tabs` | **Resolved** in `e6a53f8`. Keyboard navigation, roving `tabIndex` and the ARIA wiring come from radix. Do not re-fix this. |
| ~~`ColumnPicker`~~ | shadcn `Popover` | **Resolved** in `e6a53f8`. Escape and outside-click are handled by the primitive. Do not re-fix this. |
| Hand-rolled tablists | raw `<button role="tab">` + `useState` | **The defect `RecordTabs` had, reappearing at two new call sites**: `app/dashboard/views/[moduleKey]/page.tsx:141` and `app/dashboard/settings/module-builder/page.tsx:480`. Both announce `role="tablist"` with no `onKeyDown`, no roving `tabIndex` and no `aria-controls`. `SavedViewSelector.tsx:26` is the correct hand-rolled reference if a radix `Tabs` genuinely does not fit — it implements arrow/Home/End, roving `tabIndex` and a focus ring. |
| `Table` | raw `<table>` | Consistency only; it works. shadcn has a Table to build on. It is a **cell** primitive — everything above the cell belongs to `RecordTable` (§4.4). |
| Card-shaped boxes | hand-rolled `rounded-card + border + bg` | **206** such boxes against **65** files using `<Card>`, up from 93/63 when this was first recorded. The drift is accelerating: a change to `Card` now reaches well under half of the things that look like one. Phase 2 moved `Card` onto `border-line-default`; the hand-rolled boxes did not follow, so the tier split is now *between* `Card` and its imitators rather than inside `Card`. |

`Pagination`, `SearchBar`, `spinner` and `sonner` are thin compositions over existing
primitives and are fine as they are. The remaining `components/ui/` files are
Lynk-specific compositions (`ModuleTableShell`, `SavedViewSelector`, `PageHeader` and
so on) that shadcn has no equivalent for — those are correct, not drift.

The two hand-rolled tablists are accessibility defects rather than style, and come
first. That they reappeared *after* `RecordTabs` was fixed is the lesson in this
table: fixing an instance does not fix the pattern, which is why the rule now lives in
§4.4 and the check lives in the rendered guard.

### 11.1 List pages are full-height — do not put a max-height back

**Resolved.** Module list pages are a full-height column, and the rows are the only
thing that scrolls.

```
<div className="flex h-full min-h-0 flex-col gap-4">   ← page root
  <ModuleListToolbar />                                  pinned
  <SomeTable />        → ModuleTableShell: flex-1        the only scroller
  <Pagination />                                         pinned
</div>
```

`ModuleTableShell` is `min-h-56 flex-1 overflow-auto`. It used to be
`max-h-[70vh] overflow-auto`, which put a second scroll container inside the
already-scrolling page: two scrollbars, and the table stole the wheel whenever the
pointer was over it.

The dashboard shell was already built for this — `h-screen overflow-hidden` with a
single `overflow-y-auto` page scroller — so the fix was to stop fighting it.

Rules that follow:

- **Never give `ModuleTableShell` a max-height.** Constrain the page layout instead.
  A height cap here re-creates the nested scroll on every list page at once.
- A list page root must be `flex h-full min-h-0 flex-col`. Without `min-h-0` the flex
  child refuses to shrink and the page scrolls again.
- Outside a flex column `flex-1` is inert and the shell grows to its content. That is
  the intended fallback, not a bug.
- The sticky column header depends on the shell still being a scrolling ancestor.
  Verified: scrolling the shell 200px leaves the header at the same viewport offset.

**Beware `overflow-x-hidden` on a vertical stack.** CSS computes the other axis to
`auto`, so the element silently becomes a scroll container. Three sidebar nav groups
were doing this and each had its own 8px scrollbar. Use `overflow-x-clip`, which
leaves the block axis `visible`.

**Call-site height overrides are the trap.** Fixing `ModuleTableShell` did not fix
every page, because six call sites passed a cap back in through `className`
(`max-h-[62vh]` on settings > permissions, `max-h-[58vh]` on module access,
`max-h-[44rem]` on documents, and so on). The component-level fix cannot see those.
Both the general rule (§4.5) and the audit spec exist because of this.

**Retired.**

- `font-mono` on record numbers, emails and ids — 21 files → 8, secrets only.
- `ring-primary` as the focus ring — 37 files → `ring-focus`.
- The aqua accent — `--color-primary` is neutral, so the ~74 decorative consumers
  resolve to gray without a per-file change.
- Dead colour classes that emitted no CSS at all — `bg-state-*-subtle`,
  `bg-surface-hover`, `bg-surface-subtle`, `rounded-control`, `bg-action-primary`.
- `uppercase` — 118 sites → 0. Section eyebrows are now `text-2xs font-semibold
  text-copy-label`; the wide `tracking-*` that faked small caps went with them.
- Two radius vocabularies — 129 bare aliases swept; `rounded-sm/md/lg/xl` now emit
  no CSS so a leftover fails loudly.
- Hand-tuned prose line-heights — 61 `text-sm leading-6` / `text-xs leading-5` →
  `text-p-sm` / `text-p-xs`.
- Control-height drift — heights are tokens, and the call-site `className="h-9"`
  overrides on `Input` are gone.
- Hardcoded chart palettes — two duplicated 8-colour arrays and non-theme-aware axis
  and grid strokes → `lib/chartColors.ts` over `--chart-1..8`.
- Raw Tailwind palette classes in product UI — `emerald-*` callouts → status tokens.

**Rejected after measurement.** Recorded so they are not re-proposed:

- *A reference/indirection layer so `.light` maps into one raw palette*
  ([research §4](./research-frappe-crm.md)). The premise was that our two themes
  carry different grey casts. Measured: dark neutrals sit at hue ≈258, light at
  ≈262.5, both at chroma ≤0.026. Snapping every neutral to a single hue changes no
  value by more than one 8-bit step — the ramps are already the same grey. The
  restructure would be a large diff for a guaranteed-invisible result.
- *A sixth, fainter ink step for ids* (research §2). Cannot clear 4.5:1 on
  `bg-surface-raised` in either theme without collapsing into `text-copy-muted`.
  Taken instead: the `tabular-nums` half of the idea.
- *Frappe's amber exception — shifting warning toward orange in dark* (research §5).
  It reintroduces exactly the cross-theme hue drift this system exists to prevent,
  and it does not fix the muddy light-mode value that motivated it. That value is
  dark because it must clear 4.5:1 on white; the fix is to use warning as a tint
  background with the solid as text (§2.4), which is already the rule.
- *A bespoke domain icon tier* (research §8). **Closed, not deferred.** The owner set
  shadcn primitives and lucide icons as a hard rule (§7.2), which rules this out by
  design. Lynk buys consistency over icon-layer identity, deliberately. Do not
  re-propose hand-drawn glyphs.
### 11.2 The mandatory floors are drifting

Measured during the 2026-08 frontend consistency audit. These are §7.4, §2.3 and §6
rules — not preferences — and none of them is currently guarded, because
`design-rules.spec.ts` reads one static snapshot of one state and so never focuses an
element or queries a media feature.

| Floor | Rule | Measured | Status |
|---|---|---|---|
| Permission-denied state | §7.4 | `PermissionDeniedState` in 15 files repo-wide; **still 1 of 23** settings pages after Phase 4 | open — rebuild 5.6 |
| Error state | §7.4 | 3 competing idioms in settings; **7 pages have none** | open — rebuild 5.6 |
| Loading state | §7.4 | 4 expressions — `RouteLoadingState`, `Skeleton`, inline `<TableRow>`, plain `<p>` | **closed** for routes — `PageShell` supplies it |
| Empty state | §7.4 | 3 module tables shipped no create action | **closed** — `RecordTable` wires it by default |
| `focus-visible` | §2.3 | 68 uses, never audited or guarded | partly closed — the shared controls were audited in Phase 2; the rendered check lands in rebuild 5.10 |
| `prefers-reduced-motion` | §6 | 13 hand-placed uses; `.float-slow` looped `infinite` unguarded | **closed** — enforced in `globals.css` and `MotionConfig`, see §6 |

The fix is structural and is described in §4.4: the states are supplied by
`PageShell` / `RecordTable` rather than remembered per page. Phases 0–4 of that sweep
are in `docs/design/consistency-pass.md`; **the remaining work is
`docs/design/rebuild.md`**, which absorbed Phases 5–8 and is the active plan.

**Also closed by the Phase 2 primitive pass**, recorded here because the audit
measured them and they will otherwise read as still-open:

- `Input` was bounded by `border-line-default` and *hovered* to `border-line-strong` —
  a control below the 1.4.11 floor at rest and further below it on hover. It now reads
  the control tier, and the hover token in `tokens.md` §2 exists so hover can only
  raise contrast.
- 20 checkbox call sites re-typed the primitive's own skin with `border-line-strong`
  in place of `border-line-control`. The overrides are deleted, not corrected — the
  primitive was already right.
- `Card` sat on `border-line-subtle`, the row-divider tier, so every card beside a
  table had a visibly lighter edge than the table. It is a panel, and takes the panel
  tier.
- `Card` was `overflow-hidden`, clipping `LinkedRecordPicker`'s suggestion list in the
  last row of any form section (Appendix B.1 of the consistency pass). Six settings
  pages had worked around it per-call-site; no record form had.
- `custom-scrollbar` was used on three bounded pickers and defined nowhere. It is now
  a real utility — bounded overlay lists keep a quiet scrollbar, because it is the
  only cue that there is more below.
### 11.3 `dialog` was built on Headless UI, not shadcn — closed

§7.2 makes shadcn the only component library. `@headlessui/react` was a live dependency
behind four shared primitives — `components/ui/dialog.tsx`, `ExportControls`,
`ImportControls`, and `ModuleImportExportControls` — recorded here as a named exception
while it stood, so the failing source guard was understood rather than re-diagnosed.

Closed in rebuild 5.1 batch D: `dialog.tsx` now vendors the Radix `Dialog` primitive
(the same family `sheet.tsx` was already on), and the two `Menu` call sites
(`ExportControls` / `ImportControls`, mounted by `ModuleImportExportControls`) moved to a
new vendored `components/ui/dropdown-menu.tsx`. `@headlessui/react` is no longer a
dependency. This was the behaviour-changing swap the note below described — focus-trap
and close semantics moved at all nine dialog call sites in one slice, per the testing
policy in `rebuild.md` 5.1.



---

## 12. Changing this document

The design language is versioned with the code. If a change contradicts a rule here,
the rule changes first, in the same PR, with the reason written down. A screen that
silently disagrees with this file is a bug in one of the two.

For anything structural — a new page archetype, a change to the shell, a new colour
role — write the reasoning into this file under the relevant section before building.
Future agents read this file, not the PR description.
