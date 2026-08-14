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
A screen with two filled buttons has no primary action. Secondary actions use the
`secondary` or `outline` button variants; tertiary actions use `ghost`.

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

### 3.3 The size ramp

There are **two parallel families at the same pixel sizes**, split by whether the text
can wrap. Getting this wrong is what makes copy look cramped or labels look floppy.

**Tight family** — single-line text that will not wrap:

| Class | Use |
|---|---|
| `text-2xs` (11px) | Section eyebrows, dense chips |
| `text-xs` (12px) | Labels, table column headers, pills, metadata |
| `text-sm` (14px) | **Default for everything.** Body, table cells, inputs, buttons, nav |
| `text-base` (16px) | Section headings inside a page |
| `text-lg` (18px) | Page titles |
| `text-2xl`+ | Dashboard stat figures and marketing/auth surfaces only |

**Prose family** — anything that may wrap onto a second line: descriptions, helper
text, empty-state copy, error explanations.

| Class | Size / line-height |
|---|---|
| `text-p-xs` | 12px / 1.55 |
| `text-p-sm` | 14px / 1.55 |
| `text-p-base` | 16px / 1.6 |

Never hand-tune a line height (`text-sm leading-6`). If it wraps, it is prose; pick
the prose token. Do not introduce sizes between these — if something needs to be
"slightly bigger", it needs more weight or more space, not a new size.

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
| Record detail sections | `RecordTabs` |
| Nothing to show | `EmptyState` |
| No permission | `PermissionDeniedState` |
| Loading | `skeleton`, `ModuleTableLoading`, `RouteStates` |
| Status label | `Pill` — **being retired.** See `rebuild.md` R5: colour marks exception, not state, and `StatusValue` replaces it. Do not add a new `Pill` call site |
| Linked record | `LinkedRecordPicker` |
| Import / export | `ImportControls`, `ExportControls`, `ModuleImportExportControls` |

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
### 11.3 `dialog` is built on Headless UI, not shadcn

§7.2 makes shadcn the only component library, and `@headlessui/react` is still a live
dependency behind four shared primitives: `components/ui/dialog.tsx`, `ExportControls`,
`ImportControls`, and `ModuleImportExportControls`. The source guard fails on it.

This is **consistency debt, not a defect**. Headless UI's dialog is a correct,
accessible implementation — it traps focus and restores it, which is what §8 asks for.
Nothing user-facing is wrong.

It is also not a dependency to delete opportunistically: `dialog.tsx` backs every modal
and sheet in the product, so swapping it changes focus-trap and close behaviour
everywhere at once. That needs its own slice and its own e2e pass, not a line in an
unrelated PR. Until then this is a **named exception to §7.2**, recorded here so the
failing guard rule is understood rather than re-diagnosed.



---

## 12. Changing this document

The design language is versioned with the code. If a change contradicts a rule here,
the rule changes first, in the same PR, with the reason written down. A screen that
silently disagrees with this file is a bug in one of the two.

For anything structural — a new page archetype, a change to the shell, a new colour
role — write the reasoning into this file under the relevant section before building.
Future agents read this file, not the PR description.
