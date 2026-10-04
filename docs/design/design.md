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
`ModuleListToolbar`, `SectionTabs`, `QuickCreateSurface`. Design work means making
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

**A link in text is `TextLink`** (rebuild 5.9): `text-copy-primary`, underlined at rest with
`underline-offset-4`, the underline in `line-strong` until hover. Five recipes were in use and
none matched. Four were `text-action-primary hover:underline` — the same ink as the text around
them, so the link was invisible until a pointer crossed it. The underline is drawn at rest
because ink cannot mark a link without colour, and colour is ruled out above. There is one
other link treatment and it is not this one: **a record's name that opens it** from a row or a
card is the row's open gesture (§7.15) and takes `hover:underline` from `ListRow` / `Board`.

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

**The active option in a list is focus too.** A `SearchableSelect` row, a `Select` item, a
`DropdownMenuItem` and the command palette's selected row are where the keyboard is, whether
the list moves real DOM focus (Radix) or `aria-activedescendant` (the combobox and the
palette). All four draw the same inset ring, `ring-2 ring-inset ring-focus`, over the faint
`--color-primary-muted` fill. The fill alone measured **1.24:1 dark / 1.08:1 light** against
the popover (rebuild 5.4 batch 2), under the 3:1 the ring itself is held to. The ring shows
on pointer hover as well, because a list has one active row and the pointer moves it.
Rejected: a heavier fill token (still under 3:1 unless it is loud, and it adds vocabulary),
and the nav's left bar (it means *current page*, and sharing it would say that here too).
`design-rules.spec.ts` opens a `SearchableSelect` and a `Select` and measures the active row
in both themes.

### 2.4 Status colour is a pair, not a fill

Every status colour ships as a solid plus a low-alpha tint of the *same* RGB
(`--color-success` / `--color-success-muted`). A status pill is the tint as
background and the solid as text or border. Never invent a third value by hand,
never use the solid as a large background fill.

**In a list, colour marks the exception and nothing else** (`rebuild.md` R5). `StatusValue`
paints only warning and danger in a table. So a green balance, a red *Delete* on every row,
or the same action painted on every row is state wearing colour. A paid invoice's zero balance is
muted ink, and an outstanding one is primary ink, because the status column already says
*Overdue* when it is. A row's destructive action is a neutral ghost button; the confirmation
it opens carries the destructive colour. `design-rules.spec.ts` fails a table body with any
success or info ink, or with a coloured action on every row. It does not count a majority of
rows: most demo insertion orders really are overdue, and that is data, not decoration.

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

**What keeps its capitals, decided in rebuild 5.9.** Sentence case applies to every string
Lynk authors, and Lynk's own nouns are not proper names:

| Keeps its capitals | Sentence case |
|---|---|
| Other people's names — Google Drive, Microsoft, WhatsApp, LinkedIn, Lynk | Module names — *Insertion orders*, *Client portal* |
| Acronyms — MFA, SSO, CSV, API, IMAP | Feature names — *Recycle bin*, *Module builder*, *Record layouts* |
| Places, time zones, currencies | Widget and report titles — *Leads by status* |
| **What the operator typed** — a team, a custom module, a saved view | Column headers, enum labels, dialog titles |

A module name read as a proper name is what produced *Module Settings* beside *All settings*
on the same rail. The last row is the one exception to "Lynk authors it": a tenant's
*Platform Admins* team is rendered exactly as it was named.

**Guarded rendered, since rebuild 5.10.** `design-rules.spec.ts` reads every visible heading,
button, tab, table header and label, and fails on a capital mid-label that is not in its
proper-noun list. That list is Lynk's vocabulary of other people's names, never the tenant's
data. Operator text is told apart by where it sits instead: a table body, a record's name,
a select's value. When it sits in a heading the check would otherwise read, wrap it in
`<span data-user-content>`, as the teams page does with a department name. The platform's own
labels are not operator text even when the backend supplies them. The integrations registry
and the system saved view's name (*Default view*) were moved to sentence case in 5.10.

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
allowed to build a label from a key, and it produces sentence case — `lead.created` is
*Lead created*. The open-coded `charAt(0).toUpperCase()` repeats are gone; `labelize` in
`statusStyles.ts` calls it rather than repeating it (rebuild 5.9).

### 3.7 An action keeps its name

The interface's verbs are how an operator learns their way around it, so each action has one
name and keeps it from the button to the toast (§7.4).

- **Making a record is *Create X*.** Not *New X*, not *Add X* — *Create lead*, *Create
  invoice*, *Create field*. *Add* is for putting an existing thing into a container: *Add
  widget* to a dashboard, *Add to calendar*, a line item added to a quote. *Upload* is for
  a file, *Record* for a payment, *Compose* for mail — each names what actually happens.
- **The pending label is that verb plus `…`** — §7.5.
- **The toast is the noun and the past tense** — *Create invoice* → *Invoice created.*, not
  *Saved successfully* and not a bare *Record created.* when the page knows what it made.
  A toast is a sentence, so it ends with a period.
- **An error names the fix** (§7.5), including on a route boundary: *Check your connection
  and try again* over *Something went wrong*.
- **A destructive confirmation names the record and the consequence** — the title asks the
  question about *this* thing (*Delete "Q-1042"?*), the description says what happens next,
  and the button repeats the verb (*Delete quote*), never *OK* or *Confirm*.
- **An empty state says what the thing is, then offers to create one** (§7.4).

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

**There is no 5-step.** `gap-5` and `p-5` are not on the ladder. They were swept out in
rebuild 5.9 — 112 uses at the time of the ruling, ~190 by the sweep once `px-`, `py-`, `mt-`
and the rest of the family were counted — and none remain outside contracts and support. Being a multiple of 4px is necessary, not
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
| Nav rail | None in settings (§4.7, 2026-10-01). The client portal's rail takes the sidebar's own widths |
| Page split | `lg:grid-cols-[minmax(0,1fr)_20rem]` — **one** ratio, **one** breakpoint |
| Field grid inside a section | `md:grid-cols-2` |

The last two replace measured drift, not a gap: the two-column split had **10 different
ratios** with the breakpoint flipping between `lg` and `xl`, and the responsive field grid
`grid gap-* sm|md:grid-cols-2` was hand-written **78 times**. A page split is `lg` because
it reorders major regions; a field grid is `md` because it only reflows label/value pairs.

**What is not a page split** (rebuild 5.9, which moved the six that were): a **master-detail**
list on the left (the portal's message threads), a **public booking page** whose left column is
the meeting's summary, a **builder beside a live preview** (record layouts — the preview has to
render near the width it previews), and a **row's own columns**. Those carry their own ratio
because they are not main-plus-aside. A new main-plus-aside page takes the one above.

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

**Sticky pins the table header and nothing else** (`rebuild.md` R3). A save bar or toolbar
is a flex sibling of the scroll region, never `position: sticky`. Five files hold `sticky`
legitimately: `Table` (the header and the group row), `MatrixTable` (its pinned identity
column, §7.10), `RecordTable` (the state row, kept in view while a wide table scrolls),
`ModuleTableShell` (the scroll fade, a pseudo-element) and `RecordFormLayout` (the form
aside, which is top-anchored; R3 is about the bottom-anchored save bar). `check-design.sh`
fails a sticky in any other file. A sixth is a design change and takes §12.

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
- **A field that points at a *user* is state, not a relationship.** Owner / `assigned_to` /
  `owner_id` / `user_id` / `assigned_to_id` is a column on **this** row, so the spine's own
  test puts it in **State**, as an `InlineFieldEdit` that autosaves — not in `Connected` as a
  read-only name. It shipped as a
  `RecordSpineLink` on all eight record types, which made reassignment a page trip for the
  second-most-common edit an operator makes after status. The confusion is understandable and
  worth naming: Connected is for links to *other records*, and a user is a record — but the
  question the block answers is "what does this row point at", and `assigned_to` is a value
  *on* the row, chosen from a closed set. This is also the answer to the thin rails on
  contacts and accounts: they have two state fields, and one of them was being drawn in the
  wrong block.

  Three consequences, because "a user field" is a wider set than "Owner" and the difference
  decides what is editable:

  - **The record's own owner is one control everywhere**, drawn by `RecordOwnerField` — the
    same options, the same unassigned value, the same commit shape on all nine record types
    that carry one. The label follows the module's own word (`Assignee` on a support case),
    the behaviour does not. **Position in the block: directly under the record's status
    field, or first where the record has none** — it is the second-most-common edit after
    status and it reads in the same glance.
  - **`Unassigned` is a value, not an empty.** An owner-less record can be given an owner and
    an owned one can be handed back to the pool, so the option set carries the empty value
    and the field renders that value's name — not `EmptyValue`'s `Not set`, which is the
    spelling for a field that has nothing to say. Same reasoning as `No group` on the
    customer-group field beside it.
  - **A user *stamp* is not an owner and stays read-only** — the POS invoice's `Raised by`,
    `created_by_id`. It records who did something, and the denormalised-stamp rule above
    already covers it: nobody reassigns a past event.
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
  block is omitted, and where the record type has **no relationship columns at all** the
  Connected block is omitted too. That second half is narrow and deliberate: a relationship
  that exists and is unset still draws — `EmptyValue` tells the operator what this record
  *can* link to, which is why hiding a contract's six unset foreign keys was rejected. A
  catalog product and a custom-module record are the other case: neither schema has a
  relationship to draw, so a `Connected` heading over nothing would be a promise the data
  model does not make. Rejected: inventing the relationship to fill the block — a
  `POS invoices 3` collection on a product, which only `finance_pos_items` carries a foreign
  key for, so quote and order lines would silently not count and the number would be wrong.
  A rail that ends up carrying only "Created / Updated" is a signal that the record type is
  under-modelled — raise it, do not answer it with a second archetype.
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
- **The tab is the panel's name, so the panel does not draw it again.** A tab panel holds
  one panel, the strip above it already says `Timeline` / `Tasks` / `Files`, and a heading
  repeating that word 40px lower is the same furniture a `Notes` tab would be. `RecordTimeline`
  was built this way and the two panels the archetype inherited were not: the Files tab opened
  on a card headed `Documents` — the tab's label *and a different word for it*, which §1.6 is
  about. So a panel that is a tab's whole content carries **no `PanelHeader`**; its first row
  is its composer or its action, exactly as `Timeline`'s is. A `PanelHeader` is still correct
  for a panel that sits beside others on one surface, which is what it was built for.
  What the heading's description said moves to the empty state, where §7.4 already puts
  *what this thing is*.
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
- **External WhatsApp says what Lynk knows: that a chat was opened.** Every WhatsApp surface
  today is `external_link` mode (click-to-chat): the operator presses send inside WhatsApp and
  Lynk learns nothing after that. So its copy says *prepared* or *opened*, never *sent*,
  *delivered* or *read*, and the feed entry says delivery is not tracked. Sent/delivered/read
  belong to a provider-backed mode that reports them (06-whatsapp-business.md). The action is
  offered only while the workspace allows external mode (`GET /whatsapp/capabilities`), and a
  number WhatsApp cannot dial — no country code — gets a sentence saying so rather than a chat
  opened onto WhatsApp's "invalid number" screen (`lib/whatsapp.ts`).
- **A logged call says what the operator reported.** No phone system is connected, so the
  header's Call is a `tel:` link and the call happens on the operator's own phone. The
  composer's Call mode records it afterwards — direction, outcome, when, duration, note — and
  never dials on submit. The Call follow-up it replaced logged the call *before* opening
  `tel:`, so every attempt read as a call made, with no outcome. The feed entry says the call
  was logged by hand and that Lynk did not place or track it (`lib/calls.ts`,
  07-telephony.md Phase 1). On a deal the call names the participant on the line, preselected
  when there is one and the operator's choice when there are several, and it lands on that
  person's Timeline too, like the deal's Email. A quote's call names the quote's contact. Calls
  logged earlier as Call follow-ups stay follow-ups.
- **A message is filed against every CRM record whose address it uses.** Lead, contact and
  account carry `primary_email` / `phone` columns, so their headers offer Email, WhatsApp and
  Call on their own address. The failure this rule exists to prevent is one conversation split
  across two records: a deal once passed the linked contact's address into its own header and
  filed the result against the deal only, so the contact's Timeline had a hole in it.

  A deal has no address of its own, but it does have people. Following Salesforce (email with
  *Who* = contact and *What* = opportunity), Dynamics (email *Regarding* the opportunity, with
  recipients as activity parties) and HubSpot (email associated with the deal, contact and
  company), a deal's Email is addressed to its **participants**, and the send files the deal as
  `primary` and each participant it is sent to as `related`. The conversation is then on the
  deal *and* on each person's Timeline. Changed for Wave 3A's Opportunity run (owner decision,
  2026-09-29); before that, a deal offered no channel at all. The deal's Email:

  - appears only when at least one participant has an address and has not opted out;
  - prefills the one such participant, and leaves To empty when there are several, so the
    choice is the user's (the primary contact is never picked silently);
  - lists opted-out participants with the reason and does not let them be chosen;
  - files a typed address that belongs to no chosen participant against the deal alone.
    Nothing is linked because an address happened to match a contact.

  An account's Email still uses the account's own address only; offering its contacts from
  there is a separate decision. A quote offers no channel. The test is **"is the message filed
  against every record whose address it uses?"**, not "would this be convenient".
- **Audit history is not a tab.** It hangs off the spine's `Updated` line and opens in a
  sheet. Two reasons, and the second is the load-bearing one. First, it is a reference
  surface consulted occasionally, and a tab that is always present but rarely opened is
  furniture competing with three tabs that are opened constantly. Second, `activity_logs`
  and the `record_activity` projection are **deliberately separate stores** — that
  module's docstring says so — with different permission surfaces, so a merged feed means
  either overturning that decision or interleaving two cursors client-side, which breaks
  "load more". Hanging it off `Updated 2h ago` puts the answer where the question is
  asked.
- **A module that keeps its own event log renders it *inside* the History sheet, merged
  into the audit list — never as a panel on the page.** Contracts and support cases both
  write a domain event table (`contract_events`: created, status changed, party added,
  signer signed) alongside `activity_logs`, and the pre-5.3 contract page drew it as a
  full-width `Events` card at the bottom. Two immutable lists answering *what happened to
  this record*, in two places, is the duplication the archetype exists to remove — and the
  domain list is the one an operator actually needs, because it records the party and
  signer changes `activity_logs` never sees. `RecordAuditHistory` takes `moduleEvents` and
  interleaves them by timestamp. This is **not** the merge rejected above: those events
  arrive whole with the record, so there is no second cursor and "load more" still belongs
  to one store.
- **A field the spine or the header already draws does not appear in `Details`.** That
  covers the record's own name — the header's `h2` is the operator's answer to "which
  record is this", and repeating it as a labelled field says nothing further. Record
  layouts are configured
  server-side and predate the spine, so they still list status, owner and the rest; drawing
  them in both places puts an editable status in the rail and a read-only copy of the same
  value beside it, which is precisely the "nothing says what is clickable" failure R2 set
  out to avoid. `ReadOnlyRecordLayout` takes `omitFieldKeys` and a section left with
  nothing renders nothing. Found by looking at the first rebuilt page, not by an assertion.
- **One filled button in the header** (§2.2), and it belongs to the record's primary
  workflow action — Convert, Send, Issue. Destructive and rarely-used actions go in the
  `[⋯]` menu the wireframe shows, which is what keeps Delete from setting a second fill
  beside Convert. **A record whose forward motion *is* its state field carries no filled
  button at all**, and that is correct rather than a gap: a deal advances by changing its
  stage, the rail owns that field, and a `Won` / `Lost` pair in the header would be a
  second, louder control for a value the spine already edits — the defect the pre-5.3 deal
  page shipped as a six-button stage grid *and* a header pair *and* an `InlineFieldEdit`,
  three controls for one column.
- **A workflow action that only exists in one state is rendered only in that state — not
  drawn permanently and disabled.** `Convert to order` requires an accepted quote, and the
  pre-5.3 page shipped it as a button that was disabled most of the time with its reason
  written into a summary tile several inches away. That is **A12**: the operator sees a
  control, cannot use it, and has to hunt for why. The header shows it when the quote is
  accepted and unconverted, and shows nothing otherwise — the quote's route forward in
  every other state is the status field the rail owns, which is visible in the same glance.
  Rejected: keeping the disabled button and moving its explanation next to it (a control
  that is inert nine visits out of ten is furniture, and the explanation is only ever read
  once); and letting the button accept the quote *and* convert it in one click (cheaper
  still, but it makes an irreversible two-record change out of one press, which is R1's
  side-effect row).
- **The same rule reaches the channel buttons, and that is what closed the header.** A
  channel with no address is not a workflow action, but it fails A12's test identically:
  `CommunicationActions` drew `Email` and `Call` permanently, disabled whenever the column
  was empty, and `Email Opt Out` as a third disabled shape. A contact with no phone is the
  common case rather than the exception, so the header's most frequent state was two inert
  buttons and one live one. Each channel now renders only when it can be used. The opt-out
  case was the one worth arguing and it still loses: `email_opt_out` is a field, it is drawn
  in `Details` as `Opted out`, and a disabled button is a worse place to learn a compliance
  fact than the field that states it. **Rejected:** keeping the opt-out button alone as a
  warning (it makes one channel behave unlike the other two, and the operator has to know
  that a *missing* Email button and a *disabled* one mean different things).
- **A field the record's own write path maintains is read-only in the rail, dropdown shape
  notwithstanding.** R2 draws its boundary by shape because shape is learnable, and this is
  the one exception the shape rule cannot see: a POS invoice's `payment_status` is an enum,
  but it is written by recording a payment, from `amount_paid`. An `InlineFieldEdit` on it
  would let the rail say `Paid` over a balance of $400. It renders as a plain
  `StatusValue` beside the status it qualifies, and the catalog marks it `readonly` so a
  tenant adding it to `Details` does not get an editable copy either. The test is not "is
  it a dropdown" but **"is this column written by an operator, or derived by a service?"**
- **A boolean whose two values are named states is a state field, and it edits in the
  rail.** R2's shape test reads "dropdown-shaped", and taken literally that sends a catalog
  product's `is_active` to `/[id]/edit` — a page trip to flip one switch, on a column that
  is state by any reading. What the shape test is really about is a *closed set the
  operator picks from*, and two is a closed set. So `Active` / `Inactive` and `Public` /
  `Private` are `InlineFieldEdit` option pairs, and they render through the same
  `StatusValue` a read-only status uses, so nothing about them looks like a new control.
  **Rejected: a `Switch` in the rail.** It is a second control shape for the job
  `InlineFieldEdit` already does, its `SaveStateIndicator` pairing would have to be
  re-solved, and a toggle commits on a click where a select commits on a choice — which is
  a different feel for the same autosave. The naming is what qualifies a boolean: a field
  whose honest labels are "Yes" and "No" is answering a question about the record rather
  than naming a state it is in, and it stays content.
- **A line-item document's items are the document body, and they render in `Details` under
  the layout — read-only.** Quote, order and invoice all keep their editor on `/[id]/edit`
  behind a manual save, because R1 will not autosave totals derived from lines, discount
  and tax. Items are rows pointing at the document, so §4.7's own test would allow an
  editor in the content region; what forbids it here is that the write is a whole-document
  `PUT`, so an in-place editor is `/[id]/edit` rebuilt inside the record page — which is
  the "the detail page is secretly a form" defect this archetype exists to remove.
- **Scroll:** the content region. The rail is a flex sibling of it, not `position: sticky`,
  so this adds no exception to R3. Same mechanism as archetype 1.
- **The `Edit` affordance is in the header row**, reachable from every tab, and the tab
  travels with the operator on any trip off the record and back. Editing from Files returns
  to Files. The rule is not about `/[id]/edit` specifically — `/[id]/convert` is the same
  kind of trip and carries the tab the same way — and it matters here more than it would in
  another CRM because R2 makes the trip *routine*: the spine autosaves a record's state, so
  a page trip is now how an operator fixes a typo rather than a rare full-record edit.
  **One hook supplies both directions**, `useRecordTabHref`, because they are one job: the
  detail page carries the tab out, the form carries it back, and a page that has to remember
  either half will eventually remember only one. Naming the two directions as two helpers is
  exactly what let the return half go unbuilt on eleven pages while the outbound half
  shipped. A record type whose strip has only one tab carries no `?tab=` at all — the hook
  must not invent one. **Rejected: `?from=<encoded href>`**, which would return the operator
  to whatever page sent them: it nests a URL inside a URL, it is a rewritable redirect
  target, and the only thing that ever varies is which tab was open. **Rejected:
  `router.back()` on Cancel** — not an anchor, so nothing to middle-click and nothing to
  focus, and it goes somewhere else entirely when the operator arrived at `/[id]/edit` by URL.
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

**The read-only variant: a record with no editable field collapses its spine.**

The rail exists to answer R2's question. R2 draws a categorical boundary — dropdown-shaped
fields hold *state* and edit in place, everything else is *content* and is read-only until
`/[id]/edit` — and then names its own risk: a half-editable page where nothing signals what
is clickable is worse than either pure model. R9 answers that with **position**, because a
control that drifts out of the rail is visibly in the wrong place.

Where nothing on the record is editable, that question has no content, and a 20rem rail of
read-only fields spends the signature on nothing. Worse, it teaches the wrong lesson: the
left column is where you change things, on a surface where nothing changes.

So a record page with no editable field renders **without the spine**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ Orders    ORD-1042                                                     │  eyebrow
│             Acme retainer                             Paid  $4,200.00    │  title + context
│ Created 2 Sep 2026 · Updated 2h ago                                      │  meta line
├──────────────────────────────────────────────────────────────────────────┤
│ CONTENT — full width, the only scroller                                  │
│                                                                          │
│  Item                              Qty       Unit          Total         │
│  Retainer — September                1   4,200.00      4,200.00          │
│  …                                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Contract: **it is `RecordWorkspace` with no `spine`, and nothing else changes.** The record's
name stays in the header where `RecordWorkspaceHeader` draws it, the status stays beside it,
the identifying line and the created/updated stamps go to `subtitle`, and the content region
keeps the tab strip and stays the page's only scroller. `PageShell variant="record"` still
applies: the two-column row simply becomes one column, so the geometry the primitive already
owns needs no second implementation.

`spine` is optional on the primitive for exactly this reason. Five portal pages hand-rolling
a spineless record page is the failure §0 names — a new visual pattern is a signal to extend
a primitive, not to style a div.

**The test is "does this record have a state field that edits in place", not "is this page
small" and not "does this page have any control at all".** R2's boundary is about
*dropdown-shaped fields that commit on change*; an action is a different thing and has never
belonged in the rail. The portal's quote page is the worked example: it carries Approve,
Reject and Download, and it still takes this variant, because none of the three is a field —
Approve is a decision with a comment, which R1 already routes through an explicit confirm,
not a silent commit.

A record whose state happens to be *short* still gets the rail: the spine's blocks collapse
to what exists, and that is normal. This variant is for a surface where the answer is
categorically none — today the client portal's seven detail pages, which R10 already gives
`RecordTable variant="readOnly"`. A page that reaches for this because its rail looked empty
has misread it, and the fix there is that the record's state fields were never wired.

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
(§7.5), required sets match the backend exactly.

**`RecordFormLayout` draws the title and the action bar; a call site cannot supply its own.**
Both were slots before, and both were then written by hand seventeen times — which is the
§4.4 failure repeated: the rule existed, nothing supplied it. `title` is a required prop and
becomes the visible `h2`; `status` and `actions` are rendered through `FormFooter`, which
carries `ActionBar` and therefore R4's one control height. There is no `footer` slot to put a
second recipe in.

**The four form primitives, and what each replaces:**

| Primitive | Draws | Replaces |
|---|---|---|
| `RecordFormLayout` | title, content column, aside, `FormFooter` | 17 hand-written footers on one recipe, and the `sticky bottom-0` bar behind all of them |
| `FormSection` | the panel + `SectionHeading` | the pre-R7 `<h2 class="text-base font-semibold text-copy-primary">`, at 66 call sites |
| `FieldGroup columns={2}` | `grid gap-4 md:grid-cols-2` | the hand-written responsive field grid |
| `TextField` | `Field` + `FieldLabel` + `Input`, wired by `id` | five private copies, one of which wired no `id` at all |
| `TransactionTotals` | the document's money ledger in the aside | three private `SummaryRow`s, one of which withheld a figure it had already computed |

A field spanning both columns writes `md:col-span-2` on the `Field`, matching the grid's own
breakpoint. That stays at the call site because it is a property of the field, not of the
group.

`columns={3}` exists and is **not** a general option: a row of short values of the *same
kind* — three dates, three amounts — and nothing else. Two form sections qualify (a
contract's effective/expiration/renewal dates, an insertion order's subtotal/tax/total). At
the ~700px content column a third column is ~215px, which any prose-length label wraps at, so
a section that wants three columns for ordinary fields wants two.

**The form draws a visible heading, and on an edit it is the record's name.** `PageHeader`'s
h1 is `sr-only` by §8, and archetype 2 supplies its own visible `h2` — archetype 3 supplied
nothing, so an operator editing a contact saw a form with the record's name nowhere on
screen, and two edit tabs side by side were indistinguishable. It is the record's name on
`/[id]/edit` and the noun on `/new` (`Pavithra Nanayakkara` / `New contact`) for the same
reason the record header carries one: the operator came for a specific record and needs to
know this is the right one. Rejected: making the generic label visible (`Edit contact`
restates what clicking Edit already said), and reusing archetype 2's whole header row (it
needs the record's status and subtitle, and it blurs two archetypes that are deliberately
distinct). **Manual save** (R1) — a create form and a
line-item document both keep an explicit commit, because a half-formed autosaved record
lands in lists, counts and reports.

The action bar is **at the end of the document, not stuck to the viewport** (R3). It carries
the dirty-state string and both actions, once — `insertion-orders` currently renders two
Cancel buttons because the page header and the footer each supplied one.

**A line-item document's totals are a ledger, and the primitive owns the arithmetic's
appearance.** Quote, order and POS invoice each drew the same block — subtotal, the
adjustments, the resolved figure — from a private `SummaryRow` copied three times.
`TransactionTotals` draws it once, and three things it owns were wrong in at least one copy:

- **The resolved figure is separated by weight, not size.** All three grand-total rows were
  `text-base font-semibold`, which is the 16px step §3.3 removed from the ramp — the same
  pre-R7 string `FormSection`'s heading carried, arriving here as a *value* instead of a
  heading. A total is the value role at `font-semibold` (§3.4): same size as the rows above
  it, heavier, and `tabular-nums` so the column of figures aligns.
- **A subtraction carries its sign from the ledger.** Discount and Paid had a minus prepended
  to a formatted currency string at the call site, in three places, so the sign was a
  property of the sentence rather than of the row.
- **Every figure the form computes is drawn.** The invoice ledger read
  Subtotal - Discount - Tax - Paid - Balance and never showed **Total**, though it had
  computed it and validated `amount_paid` against it — so the operator typed a payment
  against a number the form knew and would not display. That is §7.9 pointed the other way:
  not a control the backend cannot honour, but an answer the form has and withholds. A row
  the ledger can compute is a row the ledger renders.

**A form section that draws the same field group as the record layout carries the record's
name for it.** §1.6, at the scale it costs most — an operator moves between a record and its
edit page constantly. All three documents titled their totals block *Review summary* while
the record page has called that exact field set `Totals` since the layouts were seeded, and
the order form called its delivery-date / payment-terms / delivery-address section *Delivery
and payment details* against the record's `Fulfillment`. Where the form draws a group the
record has no name for — the document's number, currency, dates and status, which a record
splits between its header, its rail and its sections — the section is named after the
document (`Quote details`, `Order details`, `Invoice details`), so the three share a shape
and each says which one it is.

**A requirement that spans two fields is not two `RequiredMark`s.** The order form marked
*Account* and *Contact* required and validated `account || contact`, against a backend that
requires neither — so the mark made a claim that was wrong twice over, and `RequiredMark` is
`aria-hidden` (§8), so the real rule reached nobody. An either-or requirement is stated once,
in the section's own description, and enforced by the section-level `role="alert"` the
validation already renders. `RequiredMark` stays what §7.5 says it is: this **field** must
have a value, and the backend agrees.

---

#### Archetype 4 — Settings

Each settings page is a `PageShell variant="settings"` in the dashboard's own document
scroll. There is **no second nav rail**: the sidebar's single *Settings* entry opens the hub
(`/dashboard/settings`), the hub is the one index, and every page below it shows a back
arrow before its title in the dashboard header that returns to the hub.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ←  Authentication                                    ⌘K     🔔  (AB)     │
├──────────────────────────────────────────────────────────────────────────┤
│ Authentication                                                           │
│ Sign-in methods and session policy for this workspace.                   │
│                                                                          │
│ ┌ Multi-factor ─────────────────────────────────────────────────────────┐│
│ │  Require MFA for all users                         [ on  ]  Saved      ││
│ └───────────────────────────────────────────────────────────────────────┘│
│ ┌ Single sign-on ───────────────────────────────────────────────────────┐│
│ │  Provider          [ Microsoft Entra ▾ ]  Saving…                     ││
│ └───────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

Contract: **every settings page has a visible title and a description**, and
`PermissionDeniedState` on every page, since settings is entirely admin-gated and a
missing permission wall is exactly what a non-admin hits.

`SETTINGS_NAV_GROUPS` is the one source for the hub, the header title and ⌘K.

**Why no rail (owner ruling, 2026-10-01).** 5.6 added a `16rem` rail (A8) so a two-page
settings task did not round-trip through the hub. It put two navs on screen for one
destination, beside a sidebar that already has a Settings entry. The owner chose the hub
plus the header back arrow: settings is visited occasionally, one page at a time, and the
workspace keeps its full width. The rendered guard (`design-rules.spec.ts`, `settingsNav`)
fails if a rail is drawn, if a settings page lacks the back arrow, or if the hub misses a page.

##### The commit model, per control (R1 applied)

R1's table already contains both answers, and a settings page can hold both kinds. The
test is **what the operator is committing**, not what page they are on:

| The control | Model | Feedback |
|---|---|---|
| One independent reversible field — a `SegmentedBoolean`, a `Select`, a switch row | **Autosave on change** | `SaveStateIndicator` beside the control, in its `SettingsRow` |
| A **configuration record** — SSO credentials, the company profile, a booking link | **Manual save** | A `FormFooter` at the end of the document |

A configuration record is a set of fields validated *together*, usually with a side effect
attached — a connection test, a re-issued token, a domain re-verification. Field-by-field
commit on those saves states the backend rejects, and it fires the side effect on a
half-typed issuer URL. Autosaving one is the same defect R1 refuses on a line-item document.

**An autosaving control reports through its `SaveStateIndicator`, not through a toast.**
The indicator is attached to the thing that changed and disappears on its own; a toast for
the same write is a second notice of one event, in a corner the operator was not looking
at. Toasts stay for what has no control to sit beside — a background job finishing, an
import completing, a manual save on a configuration record.

**What R3 removes is the stickiness, not always the button.** All six sticky Save/Discard
bars go; where the model is autosave the button goes with them, and where the model is a
configuration record the action becomes an ordinary flex sibling at the end of the page.
The failure this closes is `settings/authentication`, which autosaved a select at `:45` and
demanded an explicit footer forty lines below with **nothing visually separating the two**.
Now the select carries `Saved` and the SSO card carries a footer, and each one says which
it is from its own control.

##### `SettingsRow` is the unit, and `SegmentedBoolean` is the boolean

A settings page is a stack of `FormSection` panels whose rows are `SettingsRow` — label,
optional description, the control, and the save-state slot. It is the archetype's only new
primitive, and it exists because the save-state slot is what makes autosave legible: eight
editing patterns across 19 pages collapse to one because the row, not the page, owns the
pairing of a control with its confirmation.

**The boolean is `SegmentedBoolean`** and there is only one. `SettingsSwitchRow`'s
`SettingsSwitch` was a hand-rolled Off/On segmented pair — 112 lines reimplementing the
primitive §7.1 already names, in 2 files, while the real one was in 7. It is deleted.
`Checkbox` keeps its own job: **many from a set**, which is what the permissions matrix and
the module-access grid are. A lone `Checkbox` standing in for a single on/off setting is
the drift, not a third option.

##### The address is the page's state, and it speaks one vocabulary

A settings page that holds a selection or a workspace puts it in the query string, written
through the app's single address writer — `usePageAddress`, which was `useListAddress` until
settings needed it and it turned out nothing in it was about a list.

| What it names | Param | Where |
|---|---|---|
| The module the page is configuring | `?module=<key>` | `fields`, `module-builder`, `automation` |
| A workspace within one page | `?tab=` | the word the record archetype's strip already uses |
| A saved view's id | `?view=` | lists, and nowhere else |
| How one region renders the same data | `?display=` | `tasks` (`board`, `calendar`), `sales/opportunities` (`pipeline`) — §7.13. The default display is never written. **Not** `reports`' Table / Bar / Pie: there the display is one field of a report configuration the address does not carry, and is saved with it (rebuild 5.7 batch 7) |

One word, one meaning, app-wide: `?view=` became *saved view id* on all sixteen lists in
rebuild 5.5, so `settings/automation`'s `rules|runs` switch is `?tab=`, and the module scope
is `?module=` rather than a second spelling of the same idea.

**A draft is never addressed.** The automation rule editor and the new-module panel hold
unsaved work, so a link to either would promise a state the URL cannot carry — they stay
local modes over an addressed page. What the address holds is what a colleague could open.

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
`md:grid-cols-2 xl:grid-cols-4` for the usual four — `StatGroup` derives the columns from its
tile count, up to seven, so a row of five does not wrap four-and-one — panels on
`xl:grid-cols-2`. Chart colour comes from
`lib/chartColors.ts` and nowhere else (`tokens.md` §3.4). A metric is a **number plus its
label** — a sparkline or a delta is allowed, a decorative gradient is not (§1.2).

**`StatTile` is an ink group; `StatGroup` draws the rules** (rebuild 5.7 ruling 1). A tile
is a field label, one figure at the stat size, and at most one line of metadata context. It
has no border and no ground of its own, because every metric row sits inside a panel already
and a bordered tile there is the third container level §1.3 forbids. A row of metrics is one
`StatGroup`: a grid whose cells are separated by hairline rules drawn on the cells' own
edges and clipped at the group's, so the rules survive any wrap and any ground. The group
fills its container edge to edge — a panel that holds one draws no body padding around it.
There is **no size prop**: a figure that needs to be smaller is a `Fact` (§7.12), not a
stat. A tile that is also a link is `Card variant="interactive"` holding a `StatTile`;
the primitive does not grow an `href`.

The figure keeps `tabular-nums`, against the usual advice for a large standalone number: on
a dashboard the figures re-render in place when the period changes, and proportional digits
make the tile's width jitter under the operator's eye.

**A widget is a panel.** `Card` + `PanelHeader`, and its four states are `PanelLoading` /
`PanelError` / `PanelEmpty` (§7.4) — never a dashed box inside the card. A bucket bar or a
funnel is a single-series chart: the bar takes `seriesColor(0)`, and its label and figure
stay in ink. A pipeline value is not good news, so it is never `text-state-success` (R5).

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
| A table of records | `RecordTable` — see §7.10. `Table` is a cell primitive and is not importable outside it |
| A grid of controls: records down, actions across | `MatrixTable` — see §7.10. Not a `RecordTable` variant |
| Toolbar above a list | `ModuleListToolbar` |
| Search | `SearchBar` |
| Saved views / filters | `SavedViewSelector`, `InlineSavedViewFilters` |
| Column visibility | `ColumnPicker` |
| Paging | `Pagination` |
| Page root, title, actions and route states | `PageShell` (which renders `PageHeader`) |
| Fast create | `QuickCreateSurface` |
| An editing drawer over a page | `EditorPanel` — see §7.11. `sheet.tsx` is the Radix wrapper and is never composed at a call site |
| A record detail page | The §4.7 archetype — spine + its own tab strip. Not a hand-rolled root |
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
| Panels inside a card | `SectionTabs`. Never a hand-written `role="tablist"` — see §7.7 |
| Pick one of a small set | `SegmentedControl` / `SegmentedBoolean` — a view switcher, an Active/Inactive toggle. **Not** a tab strip (§7.7) |
| A list the operator reorders | `SortableList` — see §7.13 |
| A kanban | `Board` — see §7.13. The same rows as the list, in `ModuleTableShell` |
| A month calendar | `MonthGrid` — see §7.14. The grid and the narrow day picker are one component |
| A feed, inbox or history line — activity, a notification, an invite, a message, a linked task | `ListRow` inside `RowList` — see §7.15. Not a table and not a card |
| A navigation entry — the sidebar, the client portal rail | `navItemClassName` from `SidebarNav` — see §7.16. The current page is elevation and a bar in ink |
| A person | `Avatar` |
| An absent value | `EmptyValue` — `Not set` in a field, `—` in a cell (§3.6) |
| A read-only label over its value | `Fact` — see §7.12. An ink group, never a bordered cell |
| Autosave feedback | `SaveStateIndicator` (R1) |
| A settings control and its save state | `SettingsRow` inside a `FormSection` — archetype 4. **`SettingsSwitchRow` is deleted** |
| An on/off setting | `SegmentedBoolean`. `Checkbox` is for *many from a set*, never for one boolean |
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
- **A label is associated, not merely adjacent.** The input carries an `id` and the label
  its `htmlFor`. A `FieldLabel` sitting beside an `Input` with no `id` looks correct on
  screen and leaves the input with no accessible name and a label that does nothing when
  clicked — which is what one of the five private `TextField`s did on the lead form, unseen
  by every guard. `TextField` takes `id` as a required prop for this reason.
- Required fields use `RequiredMark`, and the client's required set matches the
  backend's constraints exactly.
- Errors sit under the field, in `text-state-danger`, and name the fix
  ("Enter a valid email"), not the failure ("Invalid").
- Error colour is always paired with text. Colour alone never carries state —
  a red border with no message is invisible to a colourblind operator.
- Destructive confirmations name the record and the consequence, and the confirm
  button uses the `danger` variant.
- **A form that fails to save says so on the form, through `FormErrorBanner`.** A toast is
  not enough on its own: it is transient, it is not in the tab order, and it is gone by the
  time the operator finishes reading the field it is about. Twelve forms had already
  hand-written the identical `role="alert"` banner and two showed only a toast — the banner
  is the primitive now, and both idioms are it.
- **The server's field errors go on the fields they name** (13 §7 Step 3, H2). A 422's
  validation list is read by `lib/apiErrors.ts` (`loc` → field path, `type` → a sentence that
  names the fix), and `ServerFieldErrorsProvider` hands each message to its input by id;
  `TextField` and `CustomFieldInput` show theirs without a prop. The banner then says
  `Check the highlighted field.`, and names any field the form has no input for. A 4xx
  sentence the domain wrote is shown as written; a 5xx detail never is. Before this, the
  deal form replaced every failure with one generic line and the bill put a field's error
  in its footer.
- **A request that gets no answer fails** (H23). `apiFetch` gives a read 20 s, a write 60 s
  and an upload 5 min to answer, then throws `RequestTimeoutError`; the page's own error
  state takes over. A timed-out write says to check whether it was saved, since it may have
  been.
- **One pending label and one dirty string.**
  - The pending label is the action's own verb plus a **`…` character**, never three
    periods: `Saving…`, `Creating…`, `Sending…`, `Recording…`, `Uploading…`.
  - The dirty line is exactly `Unsaved changes` — a status label, so no closing period — and
    **a clean form shows nothing.** That is the explicit-save convention of the CRMs and ERPs
    Lynk sits beside (Dynamics 365, Salesforce, HubSpot, Odoo): the line appears when there is
    something to lose. `All changes saved` is autosave language and claims a save the operator
    did not make; `No unsaved changes` announces an absence. `You have unsaved changes.`,
    `Unsaved message` and `No changes to save.` are the same fact in other voices. Settled
    2026-09-24, replacing the `Unsaved changes` / `No unsaved changes` pair.
  - **The dirty line is never coloured.** `text-state-warning` for unsaved and
    `text-state-success` for saved is colour carrying state, which R5 retires; unsaved work
    is the normal condition of an open form, not an exception.
  - A create form has no dirty state worth naming, so its status line is guidance instead
    (`Complete the required fields to create this lead.`). That is a different sentence
    doing a different job, and it stays.

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

### 7.7 A tab strip is never hand-rolled, and "tabs" is not a look

Two controls in this app change what the operator is looking at, and they are not
interchangeable:

| The strip changes | Pattern | Primitive |
|---|---|---|
| Which **panel of content** is on screen | ARIA tabs — `tablist` / `tab` / `tabpanel`, `aria-controls`, a roving tabindex, ←/→/Home/End | `SectionTabs` inside a card; the §4.7 archetype's own strip on a record page |
| A **value** one region re-renders from — a density, a display mode, Active/Inactive | Toggle group, no panel relationship | `SegmentedControl` / `SegmentedBoolean` |

Pick by what the strip *does*, not by how much room it needs. If choosing an option
replaces the region below it, it is tabs; if it re-renders the same region with
different data, it is a segmented control.

**`role="tablist"` is never written at a call site.** It is not a styling hook — it is a
promise of a keyboard contract, and three of the four strips in this app announced the
role while supplying none of it. A `tablist` whose arrow keys do nothing, whose segments
are each their own tab stop, and whose `tab` points at no `tabpanel` reads *worse* to a
screen reader than the plain buttons it is made of, because the operator is told to expect
arrow keys that are not there. Radix supplies the whole contract; the primitives above are
the only two places it is configured.

**Tabs are underlined. The pill shape belongs to the segmented control.** The two
hand-rolled strips picked different skins for the same job — one underline, one filled
pill — and the pill is the shape §7.1 already gave to `SegmentedControl` (in its own
`bg-surface-raised` tint, not the `bg-action-primary-muted` one the builder invented).
One dialect per pattern is what makes the pattern legible: an operator who learns that a
pill means "this value is selected" should not meet the same pill one screen later
meaning "there is other content behind this" (§1.6).

**The strip's divider tier follows what it divides.** A band inside a panel takes
`border-line-subtle`, the row-divider tier, because that is what it is — a divider between
a card's header and its body. A strip that bounds a *page* region, like the record
archetype's, takes `border-line-default`, the panel-edge tier. The active trigger's 2px
underline sits directly above that hairline, and it stays there: lifting it onto the rule
with `-mb-px` looks tidier and silently makes the band a vertical scroller, because
`overflow-x-auto` computes `overflow-y` to `auto` as well (the trap `check-design.sh`
names, which `RecordSpine` paid for once in rebuild 5.3).

**A panel takes the card's content padding unless it holds a full-bleed table.**
`SectionTabs` defaults its panel to the `CardBody` inset so a tabbed card and an untabbed
one line up; `panelPadding="none"` is for the case where the panel *is* a
`ModuleTableShell`, which owns its own edges.

---

### 7.8 A select becomes searchable by counting, not by a prop

> **A select whose option count is fixed by the product is never searchable. A select whose
> option count grows with the tenant's data gets a search input — and the primitive decides
> by counting its own options.**

Lead status, contract status, stock status, `Active`/`Inactive`: the product fixes these at
two to eight, and seeing all of them at once *is* the affordance. A search box over five
options is furniture. Owner, customer group and a custom module's `single_select` are the
other kind — their length is the tenant's data, and they are unbounded.

**No call site passes `searchable`.** That is the load-bearing half. A boolean at 17
`InlineFieldEdit` call sites is the prop that drifts, and §4.7's own lesson is that a rule
with no default behind it does not survive the next page — `space-y-6` was specified for a
year and one of 27 page roots used it. `SearchableSelect` counts what it was given and
crosses one exported threshold (`SEARCHABLE_SELECT_MIN_OPTIONS`, currently 10), so the
answer is the same everywhere and changing it is one edit.

**One DOM shape, always.** The search input is rendered or not; the component is not.
Radix `Select` cannot host a search field, so the searchable form is the `Popover` + `Input`
+ filtered list combobox — and swapping component *type* at N options would make an
element's ARIA contract depend on how much data a tenant happens to have, which is
untestable and would break the strip guards.

**This primitive exists because the pattern was already here four times.** `TimezonePicker`,
`UserTeamPicker` and `LinkedRecordPicker` each hand-rolled `Popover` + a `Search` input + a
filtered list + a `Check` on the selection, independently. `TimezonePicker` collapses into
`SearchableSelect` as a call site. **`LinkedRecordPicker` and `UserTeamPicker` stay**, and
the boundary is worth writing down: `SearchableSelect` picks a *field value* from options
held in memory; `LinkedRecordPicker` resolves a *record reference* over a server-side search
(§4.7's Connected concern); `UserTeamPicker` is grouped multi-select across two entity
types. Folding those in would give one primitive four modes, which is where the next author
gets lost.

**The same field behaves the same in both places it appears.** A select reached through the
rail and the identical select on `/[id]/edit` are one control, so forms render through this
primitive too — otherwise Owner is searchable in the spine and a 200-row native list on the
edit page.

**A truncated option set says it is truncated.** Options held in memory come from somewhere,
and every source has a ceiling: `/linked-record-options/users` returns at most 500 active
users. A list that quietly stops is §7.9 in miniature — the operator reads the absence of a
name as *that person does not exist*, which is a stronger and more wrong claim than *this
list is capped*. So the endpoint reports `has_more` and the call site renders the last row as
a disabled note saying what is missing and where to find it. `TimezonePicker` shipped the
other version of this for a year (`slice(0, 100)` over ~400 zones, including the unfiltered
list) and no assertion could see it, because a short list looks exactly like a complete one.

---

### 7.9 A control the backend cannot honour is not drawn

§4.7 rules that a workflow action absent in this state is *not rendered* rather than
rendered disabled. This is the same rule one level up: a control the request layer cannot
carry at all is not rendered *anywhere*, and it is worse than a disabled button because it
does not look inert — it looks like it worked.

**Appendix B.2 is the case.** `custom/[moduleKey]` rendered `InlineSavedViewFilters` and
counted the conditions into the toolbar badge, while `useCustomModuleRecords` serialised
only `page`, `page_size`, `search`, `sort_by`, `sort_direction`. The operator built two
conditions, the badge read `Filters ②`, and the table returned every row. A disabled
control teaches the operator *not yet*; this one taught them the wrong number of records.
It is the only failure mode in this document where the interface lies rather than nags.

So `ModuleListToolbar`'s filter group is **optional**, and a module that cannot filter
passes nothing: no `Filters` button, no badge, no `Clear filters`, no condition editor. Not
a disabled button, and not a tooltip.

**Rejected:** leaving the badge and adding a note that filters are coming (a promise in an
empty toolbar is still a toolbar that lies about a result set); and disabling the button
(the operator cannot tell a control that is off from a control that is broken, and here the
distinction is a data-correctness one). The real fix — EAV filtering over
`custom_module_record_values` — is a backend query-param contract and it is scheduled
(`rebuild.md`, after 5.9). Until it lands, the toolbar says what the product can do.

The general form, because this will recur wherever the frontend is ahead of an endpoint:
**a control's presence is a claim about the response.** If the claim is false, delete the
control, not the honesty.

---

### 7.10 A list is `RecordTable`, a matrix is `MatrixTable`, and there is no third

There is one table in Lynk. `Table` is the **cell** primitive — padding, stripes, the
sticky header, the sort affordance, the density context — and everything above the cell
is `RecordTable`: the derived min-width, the selection column, the one row-open gesture,
and all four §7.4 states. Thirteen modules hand-assembled that upper layer once and
drifted nine ways; that is the drift this rule closes.

**Only four files may import `components/ui/Table`:** `RecordTable`, `MatrixTable`,
`ModuleTableLoading` and `ModuleListToolbar` — the primitives that implement it. Every
other table, in `app/**` or `components/**`, goes through one of the two above the cell.
No page assembles a table. This is checked at source level.

A table that is genuinely a different *shape* is a variant, never a second table (§7.3).
There are three, and the set is closed:

| Variant | What it is | Drops |
|---|---|---|
| `default` | A module list | — |
| `lineItems` | The editable grid inside a line-item document: an input per cell, add and remove row, Enter walks down a column | selection, sort, row-open, pagination |
| `readOnly` | The same document's items once saved, and the client portal's tables | selection, sort, row-open |

`selectable` and `rowActions` are independent props, because they combine freely with
all three: a settings list is `default` with no selection, not a fourth variant.
**Density is not a prop here.** It is an app-wide operator preference — `useTableDensity`
feeds a context that `Table` reads to pick the cell padding — so it is already answered
one level below and must not be lifted.

A fourth variant is a design change and takes §12: the rule first, with the reason, and
a second *list* table stays forbidden either way.

#### The matrix is not a list, and that is why it is not a variant

`MatrixTable` is the sibling primitive for the one shape `RecordTable` cannot carry
without contorting: **records down, actions across, a control in every cell.** Its only
consumer today is the role permission grid — 30-odd modules × 7 actions — and one
consumer is enough, because the alternative is not "no primitive", it is the same
behaviour hand-rolled in a page.

The distinction is not size or density. It is **whether a cell can be read on its own**:

- In a list, every cell describes itself. A name, a date, an amount still mean something
  when the identity column has scrolled off to the left.
- In a matrix, every cell is an anonymous checkbox. Scroll the module name away and the
  grid says nothing at all.

That single difference is what forces the three things `RecordTable` does not have, and
deliberately does not want:

| `MatrixTable` owns | Why `RecordTable` refuses it |
|---|---|
| A **horizontally sticky identity column** | `RecordTable` removed sticky columns after two measured defects — a body checkbox painting *over* the sticky header because `thead`'s z-index was scoped inside its own stacking context, and a `pr-0` column collapsing onto the checkbox at narrow widths. A list survives losing them; a matrix does not. They are solved once, here. |
| A **header cell that carries a control** | A `RecordTable` head is a label and optionally a sort button. A matrix header sets an entire column, so it holds a tri-state checkbox over its label. |
| **Group rows** spanning the full width | A list groups by sorting. A matrix groups by product area, and the group row is structure, not a record. |

And the three it drops: no row-open gesture (there is nothing behind a row), no selection
column (the row's checkbox sets *the row's actions*, which is not selection), and no
sort (the row order is the grouping).

**A matrix commits manually.** Every cell is a control, so the page is a form in a
table's clothing — archetype 4's configuration-record half (R1), with one Save for the
whole grid. It is the one table in the app that is allowed a footer button.

Anything that is neither a list nor a matrix is neither primitive's, and takes §12 before
a line of it is written.

#### A report's table is a list, including a pivot (Reports rebuild, 2026-10-01)

A report result is read like a list, not like the permission grid: every cell is a figure
under a named column, and every row is a group someone can open. So all three report
formats are `RecordTable` `default`, never `MatrixTable` and never a new table.

- **Summary:** one row per group, with a *Records* column and one column per measure. A
  second grouping uses `groupBy` bands, and the band label carries the group's subtotal.
- **Matrix (pivot):** one row per row group, one column per column group (the first 12),
  and a *Total* column. A cell is a button that opens that cell's records, marked
  `interactive` so it never also opens the row.
- **Tabular:** the records, with `rowHref` to each record's page.
- The last row is **Total**, and it opens every record in the report. A total row is a row
  of the list, not a footer, because it opens records like the rows above it.

This follows Odoo's pivot and Dynamics' chart drill-down: a figure is always one click from
the records behind it (`docs/crm-evolution/11-reports.md` §3).

### 7.11 An editing drawer is `EditorPanel`, and `sheet.tsx` is never composed at a call site

`dialog.tsx` got a styled panel with a closed size set in rebuild 5.1; `sheet.tsx` did
not, and it is the same component one axis over. So every one of the **twelve** right-side
drawers in the app re-typed the whole recipe by hand:

```
<SheetPortal>
  <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
  <SheetContent side="right" className="z-50 flex h-full w-full max-w-[34rem] flex-col
                                        border-l border-line-default bg-surface-raised outline-none">
    <form className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
      …a title, a description, and a hand-wired ghost X…
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 …">
```

Thirty lines of chrome, twelve times, and it had already drifted on every axis that was
left to a call site: **three widths** (32 / 34 / 38rem) chosen by nobody for no stated
reason, the description at `text-copy-muted` on some and `text-copy-secondary` on others,
and the footer's dirty line painted `text-state-warning` / `text-state-success` — colour
carrying *unsaved*, which §1.2 reserves for status and destructive intent. Meanwhile the
two drawers that *are* primitives — `RecordSpine` and `QuickCreateSurface` — had
independently converged on a better shape than any of the ten pages: `h-dvh`, full-bleed
below `sm`, and the border only once there is room for it.

`EditorPanel` is that shape, drawn once. A call site passes the title, the description, the
body, the footer actions and the status line; it does not see a portal, an overlay, a
class string or a close button.

**The size set is closed, and it is picked by content shape rather than by taste:**

| Size | Width | For |
|---|---|---|
| `default` | 36rem | A single-column form — the common case, and the width `RecordSpine` and `QuickCreateSurface` already agreed on |
| `wide` | 42rem | A panel whose body holds a grid or a repeating multi-column row |

A third width is §12, like a fourth `RecordTable` variant.

**One dismissal path, three triggers.** Escape, the overlay, and the X all go through
`onOpenChange(false)`, so a panel holding a draft gets its discard confirmation from one
place. The pages that wired the X straight to a local `close()` were one refactor away
from a drawer whose Escape guarded an unsaved draft and whose X did not.

**The footer is `FormFooter`.** It is the same row at the end of the same kind of document,
so it takes the same primitive and inherits R4's control height — and its status slot is
prose in `text-copy-muted`, because "Unsaved changes" is a fact about a form, not a status
on a record.

`sheet.tsx` keeps exactly two other consumers: `RecordSpine` and `QuickCreateSurface`,
which are primitives themselves, and the mobile navigation drawer in
`app/dashboard/layout.tsx`, which is `side="left"` and is not an editor. Nothing in
`app/**` composes a sheet.

### 7.12 A read-only label over its value is `Fact`, and it is an ink group

The most-repeated shape in the app after the table: a field name, and the value under it,
read-only. It existed three times outside the record spine, and the three disagreed on the
two things a call site was left to decide.

| Where | Container | Value ink |
|---|---|---|
| `profile`'s `SummaryTile` | none | `text-sm text-copy-primary` |
| `settings/authentication`'s `Status` | none | `text-copy-secondary` |
| `settings/backups`' `Fact` (5.6 batch 6d) | **bordered box** | `text-copy-secondary` |

**It is an ink group, never a box (§1.3).** A read-only value is static, so a container is
not earned by interactivity, and label-above-value already groups — a border there is
separation that nothing asked for. All three sit inside a `Card` or a `FormSection`, so a
box around each cell is the third container level §1.3 forbids. The argument was already
written as a comment above `SummaryTile`; the bordered version landed anyway, one sub-phase
later, because **a comment in one page is not a default** — §4.4's lesson, again.

**The ink pair is `text-xs font-medium text-copy-label` over `text-sm text-copy-primary`.**
It is R7's inversion: the label steps *down* so the value is what the eye lands on, because
the operator came for the value.

**`Fact` emits `dt`/`dd` and `FactList` supplies the `<dl>`**, so the pairing cannot be got
wrong at a call site. All three call sites were already inside a `<dl>`; two of them said so
in markup and rendered `div`s inside it, which is invalid.

**`RecordSpineField` is deliberately not folded in.** It reads the same two token classes,
but it is a *slot in the record archetype* whose siblings are `InlineFieldEdit`s and
`RecordSpineLink`s — editable controls and anchors, not description-list terms. Wrapping
those in a `<dl>` to share a primitive would buy one fewer file at the cost of invalid
markup on every record page. The shared thing here is the ink pair, and that is a token
decision, not a component one.

A page-local `SummaryTile` / `DetailField` / `Fact` is a review failure — it is the renderer
`rebuild.md` 5.10 checks for.

### 7.13 A reordered list is `SortableList`, a kanban is `Board`, and the keyboard path is visible

Drag-and-drop came in two shapes, written by hand five times (`rebuild.md` 5.7 ruling 4):
**reorder one list** — the dashboard's widgets, the view manager's columns, the module
builder's fields — and **move a card between columns** — the task board and the deal
pipeline. One primitive each. **No drag library is added** (§7.2): every call site already
paired the pointer drag with a control the operator can see, and a visible button or select
is more discoverable than a hidden keyboard sensor. The primitives make that pairing the
contract.

**`SortableList`** owns the `<ol>`, the grip, *Move up* / *Move down* named for the item, a
polite announcement of the new position, and focus — which stays on the moved item's control
after a keyboard move, because React moves the focused DOM node and a moved node loses focus.
The call site renders what an item looks like, and places the handle and buttons it is given.

**`Board`** is **the other half of a list, not a second page.** It renders the same loaded
rows the table does, so it sits in the same `ModuleTableShell` (one scroll region, the same
*Refreshing* badge) and draws the same four §7.4 states in the same order and words as
`RecordTable`. It owns:

- **The columns**, as ink groups side by side with space between them: a `StatusValue` and a
  count over a stack. Never a tinted box — a column inside the shell was the third container
  level §1.3 forbids. A column draws an edge only while it is the drop target.
- **The card box.** A card is a row (§1.3): `border-line-subtle`, `--radius-control`, no ground
  of its own, `border-line-strong` on hover. Grip, then the title — the card's one open
  gesture, a link when the record has a page and a button when it opens a dialog — then the
  call site's body, then the move control. The call site supplies only the body.
- **The move control**: a `Select` of the columns that accept a card, named for the field
  and the card — *Change stage for Northwind renewal*. A column that only collects what fits nowhere else
  (*Unstaged*) shows its cards but is neither a drop target nor an option.
- **Focus follows the card.** A card that changes column is a different DOM node, so after a
  keyboard move focus goes to the move control on the card's new position, not to `<body>`.
- **The drop target is elevation, not colour** (§4.6): `border-line-strong` on
  `bg-surface-raised`. Both originals painted it with the primary action's tint.

**No announcement of its own.** Both pages already confirm a move with a toast, which is a
live region; a second message for the same change is noise (one message per change).

**Colour on a card is exception only (R5).** An overdue card carries the warning mark — icon
and the word, in `text-state-warning` — and nothing else about the card changes. A value
quartile computed over the loaded page is not a fact about the deal, and is not drawn.

**The display is addressed.** A list that can render as a table, a board or a calendar holds
the choice in `?display=` (§4.7 archetype 4's vocabulary table), so a reload or a shared link
opens the same view. The default display is never written.

### 7.14 A month calendar is `MonthGrid`, and the day picker is part of it

The task calendar and the calendar page were the same 42-cell grid written twice, each with
its own narrow-viewport day picker written twice more (`rebuild.md` 5.7 ruling 5). One
primitive; **entries are a render prop**, because a task and an event are different rows and
the grid knows neither. It draws **no container of its own** — the task calendar sits in the
list's `ModuleTableShell` beside the table and the board, the calendar page's in a `Card`.

It owns:

- **The header**: the month as a `SectionHeading`, an optional description, and *Previous
  month* / *Today* / *Next month* in an `ActionBar`. The header stays while the days load or
  fail, so the operator can always leave a month.
- **Days are keyed in the operator's timezone** (`getUserTimezone`), the same zone every time
  on the entry is printed in. The grid and the text beside it cannot disagree about which day
  a 23:30 meeting is on.
- **The grid, when the grid's own box is at least 42rem** (`@2xl/month-grid`). A container
  query, not a viewport breakpoint: at one viewport the task list's shell is a page wide and
  the calendar page's panel shares its row with the §4.4 20rem rail. Cells are separated by hairline rules and carry no ground; a
  day outside the month keeps its rules and dims its numeral. At most three entries show,
  then **`+N more`, which opens the day** in a popover — it was static text on both
  originals, so the fourth entry of a busy day was unreachable.
- **Narrower than that, the day picker and the selected day's agenda**, aligned under a weekday row.
  The task calendar's picker started every month on the first column, so a month that began
  on a Wednesday labelled every date with the wrong weekday.
- **Today is weight and ink** on the numeral — `font-semibold text-copy-primary` and
  `aria-current="date"` — never a filled circle. **The selected day is elevation**,
  `bg-surface-raised`, never the action tint. A day with entries is marked in the picker by a
  dot in `bg-copy-muted`: *has entries* is a property, not a state.
- **The day numerals are one tab stop**, with arrow keys moving by day and week, `Home` / `End`
  to the week's edges and `PageUp` / `PageDown` by month, crossing month edges as they go. A
  per-day action (`renderDayAction`, the calendar page's *Create event on…*) is tabbable only on
  the selected day, so a month is not 84 tab stops.
- **The entry box and its open gesture.** An entry is a button with no border and no ground —
  the cell is its container — that raises on hover. The call site supplies what is inside it.

**Colour on an entry is exception only (R5).** An invite awaiting the operator's response
carries the warning mark in words; *shared with me* is a property and is ink.

**Rejected: a week or agenda view.** Neither page had one, and a view is a feature, not a
rebuild.

### 7.15 A line in a feed is `ListRow`, and a row is never a box

After the table, the most-repeated list in the app is the one with no columns: a timeline
entry, an audit line, a notification, a dashboard activity line, a pending invite, a mail
message, a linked task, a document version. Rebuild 5.7 batch 6 measured **fourteen**
hand-written implementations. Every one was the same shape — an optional leading mark, a
title with one trailing value on its line, a quieter metadata line, an optional body, optional
actions — and they disagreed on everything a call site was left to decide: the title at
`text-sm`, `font-medium` or `font-semibold`; the time at `text-xs`, `text-p-xs` or `text-[11px]`,
beside the title or on its own line; four rows drew a bordered box inside a panel that was
already a box (§1.3); and two marked *unread* or *selected* with the primary action's tint.

**`RowList` is the `<ol>` / `<ul>` and the rules between rows. `ListRow` is one line.** It owns:

- **The ink.** The title is `text-sm font-medium text-copy-primary`; the trailing value and the
  metadata line are `text-xs text-copy-muted`; the body is `text-p-sm text-copy-secondary`. A
  trailing value that is the row's figure — an amount — is the call site's to set in ink.
- **The open gesture is the title**, a link (`href`) or a button (`onSelect`), stretched over the
  whole row so the row is the target and the actions stay reachable above it. A row that is a
  link is still not a box: it takes the row-hover ground in an inset list and an underlined
  title in a padded one. The focus outline is drawn on the row's edge, not the title's.
- **Actions sit at the row's end** and wrap under the content when the row is too narrow for
  both. They are an `ActionBar` at `sm` (R4), never inside the target.
- **Unread is weight and a dot in ink** — `font-semibold` on the title and a `bg-copy-primary`
  dot with `aria-label="Unread"`. **Selected is elevation**, `bg-surface-raised`, as §7.14's
  selected day is. Neither is the action tint.

**Inset is the list's, not the row's.** A list inside a padded panel sits in the panel's
content box and its first and last rows lose their outer padding. A list that runs to its
container's edge — a popover body, a flush section of a card — is `inset`, and every row pads
itself by `px-4` so the hover and selected grounds reach the edge. The two cannot be mixed in
one list.

**Rejected: a card per row.** It is what four of the fourteen did, and it is §1.3's third
container level wherever the list sits in a panel, which is everywhere. **Rejected: folding
it into `RecordTable`.** A feed has no columns to sort, select or hide, and one line's body
can be three lines of an email; a table row of variable height with one cell is not a table.
**Rejected: `SettingsRow` as the base.** Its control is the point of the row and is always
visible; a feed row's actions are secondary to what it says.

### 7.16 Navigation marks where you are in ink, and a group of one is a link

Two navs shared the viewport on every settings page — the sidebar and the settings rail, since
removed (§4.7) — and 5.6 made the rail copy the sidebar's current-page mark by hand so the two would read as one
kind of thing. The copy was the mark: `bg-action-primary-muted text-primary` behind a
`border-primary/20` box and a `bg-primary` bar. That is the primary action's tint carrying
*you are here*, the state §7.13, §7.14 and §7.15 each took it off.

**One class, `navItemClassName(active)`, exported from `SidebarNav`**, and both navs read it:

- **Current** is `bg-surface-raised`, `text-copy-primary`, and a 2px `bg-copy-primary` bar on
  the leading edge, with `aria-current="page"`. No border: the ground and the bar are two
  signals already, and a box around one line of a nav is the lattice §1.3 removes.
- **Hover** is `bg-surface-muted` and primary ink. No border either — the old hover drew
  `border-line-subtle`, so pointing at an item boxed it.
- **A group whose current item is showing does not mark itself.** It takes primary ink so the
  eye can find the branch, and the ground and bar only when the item is hidden — the group is
  closed, or the sidebar is collapsed to icons. Marking both was one position drawn twice.
- **A closed group's links are `inert`.** They were `max-h-0 opacity-0` and still in the tab
  order, so a keyboard user tabbed through every module in every closed group.

**A group of one is a link** (A11). The sidebar renders any group whose resolved items number
one as a single entry with the group's icon and the item's label. It is generic on purpose:
Reports was a button that opened a list containing Reports, and a tenant that disables all
but one module in a group met the same defect. **Rejected: moving reports into `workspace`** —
it edits the registry for one instance and leaves the mechanism.

**The active option in a menu or listbox is focus, and it is drawn as focus** (§2.3). Settled
by the owner in rebuild 5.10. An active option is the keyboard's cursor, not a position, so it
does not take the nav's bar.

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

It belongs on: the auth background, the splash, the dashboard's ambient backdrop,
and **the client portal's sign-in page**, at the opacities already set in
`HexagonBackground`.

It does not belong on: tables, forms, dialogs, cards, empty states, or anything an
operator works inside — **including the portal's interior.** Only `/client/login`
carries it; `/client/**` past the door is a surface a customer works inside and the
prohibition stands there unchanged.

**A sign-in page is the product's door wherever it stands** (rebuild 5.8, ruling 3).
`/client/login` and `/auth/login` were two different products — one a glass card on a
hive, the other a form on a flat ground — and the portal's door now reads as the same
product as the operator's. The mechanism is shared (`AuthAtmosphere`), not copied: the
two doors drift the moment the atmosphere is written twice.

The argument that lost is worth keeping, because it is the one to revisit if Lynk ever
white-labels the portal: the portal is the *tenant's* customer area, and Lynk's
atmosphere at full strength there is Lynk advertising itself to someone who is not its
user. That is a branding decision, not a design-language one, and it would be answered
by making the whole portal's identity configurable — not by making its door plain.

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
| ~~`RecordTabs`~~ | radix `Tabs` | **Resolved** in `e6a53f8`. Keyboard navigation, roving `tabIndex` and the ARIA wiring come from radix. Renamed `SectionTabs` in rebuild 5.3 batch 5, when the record archetype stopped using it. |
| ~~`ColumnPicker`~~ | shadcn `Popover` | **Resolved** in `e6a53f8`. Escape and outside-click are handled by the primitive. Do not re-fix this. |
| ~~Hand-rolled tablists~~ | raw `<button role="tab">` + `useState` | **Resolved** in rebuild 5.3 batch 5. Both sites — `views/[moduleKey]` and `settings/module-builder` — are on `SectionTabs`, and so is the third strip the row did not know about (`settings/modules/[moduleId]`, which was already on the primitive but drew a different tab). §7.7 is the rule that replaces this row, and `primitive-behaviour.spec.ts` now asserts the ARIA contract on *every* strip rather than one route. |
| `Table` | raw `<table>` | Consistency only; it works. shadcn has a Table to build on. It is a **cell** primitive — everything above the cell belongs to `RecordTable` (§4.4). |
| Card-shaped boxes | hand-rolled `rounded-card + border + bg` | **206** such boxes against **65** files using `<Card>`, up from 93/63 when this was first recorded. The drift is accelerating: a change to `Card` now reaches well under half of the things that look like one. Phase 2 moved `Card` onto `border-line-default`; the hand-rolled boxes did not follow, so the tier split is now *between* `Card` and its imitators rather than inside `Card`. |

`Pagination`, `SearchBar`, `spinner` and `sonner` are thin compositions over existing
primitives and are fine as they are. The remaining `components/ui/` files are
Lynk-specific compositions (`ModuleTableShell`, `SavedViewSelector`, `PageHeader` and
so on) that shadcn has no equivalent for — those are correct, not drift.

The two hand-rolled tablists were accessibility defects rather than style, and came
first. That they reappeared *after* `RecordTabs` was fixed is the lesson in this
table: fixing an instance does not fix the pattern. Closing them in rebuild 5.3 batch 5
took all three parts — the rule (§7.7), one primitive behind it, and a guard that visits
every strip instead of the one route somebody remembered.

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
