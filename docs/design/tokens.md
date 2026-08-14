# Lynk Design Tokens

The token vocabulary. [`design.md`](./design.md) says *what Lynk should look like*;
this file says *what to type*.

Source of truth is `frontend/app/globals.css`. Nothing in this document is
authoritative if it disagrees with that file — but if they disagree, one of the two is
a bug and it should be fixed in the same change.

---

## 1. The two layers

```
  raw token                semantic token / Tailwind class
  ─────────────────        ────────────────────────────────
  --color-bg-surface   →   --color-surface   →   bg-surface
  --color-text-muted   →   --color-copy-muted →  text-copy-muted
  (values live in           (mapped in @theme inline,
   :root and .light)         consumed in components)
```

**Raw tokens** carry values. They are declared twice — once in `:root` (dark, the
default) and once in `.light`. They are named for *what they are*
(`--color-text-muted`).

**Semantic tokens** are declared once, in `@theme inline`, and never redeclared per
theme. They point at raw tokens and Tailwind turns them into utility classes. They
are named for *what they are for* (`text-copy-muted`).

This works because CSS custom properties resolve lazily: `--color-copy-muted:
var(--color-text-muted)` resolves against whichever declaration of
`--color-text-muted` wins on that element. Override the raw token in `.light` and
every derived token follows automatically. **Never redeclare a `@theme inline` token
inside `.light`** — that breaks the mechanism and forces every future colour change to
be made in two places.

Components use **only** the third column. A component that reads
`var(--color-text-muted)` directly has skipped the semantic layer and will not be
caught by a rename.

---

## 2. Grounds and ink

### Grounds

| Class | Raw token | Dark | Light | Role |
|---|---|---|---|---|
| `bg-app` | `--color-bg-app` | `#0b0d10` | `#f7f8fa` | The page |
| — | `--color-bg-sidebar` | `#0e1116` | `#f1f3f6` | Sidebar only |
| `bg-surface` | `--color-bg-surface` | `#12161c` | `#ffffff` | Panels on the page |
| `bg-surface-muted` | `--color-bg-surface-muted` | `#171c23` | `#f1f3f6` | Recessed strips |
| `bg-surface-raised` | `--color-bg-surface-raised` | `#1d232c` | `#e7eaf0` | Floating layers |
| `bg-overlay` | `--color-bg-overlay` | `rgba(5,7,10,.72)` | `rgba(16,19,25,.42)` | Dialog scrim |
| `bg-surface-row-alt` | `--color-bg-surface-row-alt` | derived | derived | A table row's zebra ground |
| `bg-surface-row-hover` | `--color-bg-surface-row-hover` | derived | derived | A table row's hover ground |

Note the inversion: in dark, *raised* is lighter than *surface*; in light, *raised* is
darker than white. Elevation reads as "further from the ground colour", which is why
`bg-surface-raised` and not a shadow is the elevation device on dark.

The two row grounds are **derived, not authored** — each is a `color-mix` of the tokens
above, so neither theme carries a literal:

```css
--color-bg-surface-row-alt:   color-mix(in oklab, var(--color-bg-surface-muted)  30%, var(--color-bg-surface));
--color-bg-surface-row-hover: color-mix(in oklab, var(--color-bg-surface-raised) 60%, var(--color-bg-surface));
```

Those are the exact composites `bg-surface-muted/30` and `bg-surface-raised/60` used to
produce on a row, so the stripe and the hover look unchanged. They exist because the
result has to be **opaque**: a sticky column inherits its ground from the row it sits in
(`design.md` §4.4), and a translucent ground does not occlude — the columns scrolling
underneath show straight through the pinned cell. That was a real regression, visible
only on a table wide enough to scroll sideways, and only on alternate rows.

The rule generalises: **anything a sticky element inherits must be opaque.** Reach for a
tinted ground (`/30`, `/60`) only where nothing is ever pinned over it.

### Ink

| Class | Raw token | Dark | Light | Role |
|---|---|---|---|---|
| `text-copy-primary` | `--color-text-primary` | `#f4f7fb` | `#101319` | Record names, values, headings |
| `text-copy-secondary` | `--color-text-secondary` | `#b7c0cc` | `#4a515d` | Body, table cells, descriptions |
| `text-copy-label` | `--color-text-label` | `#99a4b4` | `#5d6574` | Field labels, form icons, section eyebrows |
| `text-copy-muted` | `--color-text-muted` | `#808b9a` | `#626a78` | Timestamps, counts, column headers, ids |
| `text-copy-disabled` | `--color-text-disabled` | `#59616d` | `#9aa1ad` | Non-interactive only |

Every step except `disabled` clears 4.5:1 on **all four grounds** in both themes —
including `bg-surface-raised`, which is the worst case and the one that is easy to
miss. `disabled` is exempt under WCAG 1.4.3 as incidental text.

Ids use `text-copy-muted` + `tabular-nums`. A sixth, fainter step was measured and
rejected: at any lightness that reads as distinct from `muted`, it lands at ~3.4:1 on
the raised ground in both themes.

### Borders — two tiers, do not mix them

| Class | Raw token | Dark | Light | Role | 3:1? |
|---|---|---|---|---|---|
| `border-line-subtle` | `--color-border-subtle` | `#20262f` | `#e6e9ef` | Row dividers, seams | no |
| `border-line-default` | `--color-border-default` | `#2a313c` | `#dde1e8` | Panel edges | no |
| `border-line-strong` | `--color-border-strong` | `#3a4350` | `#c4cad4` | Emphasised separation | no |
| `border-line-control` | `--color-border-control` | `#646d7c` | `#7f8693` | Input/select/checkbox edge | **yes** |
| `border-line-control-hover` | `--color-border-control-hover` | `#7a8492` | `#6a7280` | The same edge on hover | **yes** |

The first three are structural hairlines and are deliberately quiet. Only the two
control tokens clear WCAG 1.4.11, so they are the *only* ones allowed to bound a form
control. Using `border-line-default` on an input is an accessibility bug, not a style
preference.

`border-line-control` is measured against the *worst* ground it can land on, which is
`bg-surface-raised` — a checkbox inside a popover. Dark 3.03 / light 3.04 there, and
higher on every other ground.

**Hover moves away from the ground, never toward it.** `border-line-control-hover`
measures 4.17:1 dark / 4.02:1 light on that same worst ground. It exists because
`Input` hovered to `border-line-strong` — 2.0:1 on the raised ground — so pointing at
a text field quietly dropped it below the floor it had been holding at rest. A hover
that reduces contrast is the one direction a control edge must never move.

---

## 3. Action, focus, and status

### 3.1 Action (neutral)

| Class | Raw token | Dark | Light |
|---|---|---|---|
| `bg-primary`, `bg-action-primary` | `--color-primary` | `#f4f7fb` | `#101319` |
| `bg-action-primary-hover` | `--color-primary-hover` | `#e2e8f0` | `#262c36` |
| `bg-action-primary-active` | `--color-primary-active` | `#cdd5e0` | `#363d49` |
| `bg-action-primary-muted` | `--color-primary-muted` | `rgba(244,247,251,.08)` | `rgba(16,19,25,.06)` |
| `text-primary-foreground` | `--color-primary-contrast` | `#0b0d10` | `#ffffff` |

Measured: dark fill/label 18.1:1, light fill/label 18.6:1, and the light fill holds
17.5:1 against the app ground so the button's edge is unambiguous without a border.

`-muted` is the neutral hover/selection wash — `ghost` button hover, selected rows,
active nav. It is a tint of the action colour, not a surface, so it composites over
whatever ground it lands on.

The token is still called `primary`. That is deliberate — the name describes the
*role* (the primary action), not the hue, and keeping it means the neutral migration
does not touch 74 files.

### 3.2 Focus

| Class | Raw token | Dark | Light |
|---|---|---|---|
| `ring-focus`, `border-focus` | `--color-focus-ring` | `#8f9aa8` | `#5b6472` |

Chosen to hold ≥3:1 against all four grounds in both themes (dark: 6.82 / 6.36 /
6.00 / 5.53; light: 5.63 / 5.98 / 5.38 / 4.96), so a focused control is visible
wherever it sits. Never use the action token for focus.

The shadcn `--ring` and `--sidebar-ring` aliases both point here, so vendored
primitives pick it up without changes. The canonical pattern is
`focus-visible:ring-2 focus-visible:ring-focus`, plus
`focus-visible:ring-offset-2 focus-visible:ring-offset-app` where the control sits on
the page ground. Destructive buttons use the same focus token — the ring signals
*focus*, and the fill already signals danger.

### 3.3 Status

Each status is a **pair**: a solid, and a tint that is the same RGB at low alpha
(0.14 dark / 0.12 light). Use the tint as background, the solid as text or border.

| Class | Raw token | Dark | Light |
|---|---|---|---|
| `text-state-success` / `bg-state-success-muted` | `--color-success` | `#2fcf80` | `#00834c` |
| `text-state-warning` / `bg-state-warning-muted` | `--color-warning` | `#f4b740` | `#966a00` |
| `text-state-danger` / `bg-state-danger-muted` | `--color-danger` | `#ef6461` | `#ca4243` |
| `text-state-info` / `bg-state-info-muted` | `--color-info` | `#4ca7ff` | `#0373c7` |
| `text-state-danger-contrast` | `--color-danger-contrast` | `#0b0d10` | `#ffffff` |

Every light value is its dark counterpart with hue held — measured drift is ≤0.4°
across all four (success 155.8→155.9, warning 80.2→79.9, danger 24.1→24.0,
info 250.3→250.4). The light values look darker only because they must carry white
*and* clear 4.5:1 on a white ground; that is weight, not a different colour (§4).

Warning is the one people try to "fix": `#966a00` looks muddy in isolation. It is dark
because it must clear 4.5:1 as text on white. Frappe's answer is to shift amber toward
orange in dark mode, which we deliberately do not do — it reintroduces cross-theme hue
drift for a problem the tint/solid pairing already solves. Use warning as a tint
background with the solid as text; never as a large fill.

### 3.4 Charts

| Token | Dark | Light | Hue | Drift | Light on white |
|---|---|---|---|---|---|
| `--chart-1` | `#5fbace` | `#429fb3` | 214° | 0.37° | 3.07 |
| `--chart-2` | `#7b9be0` | `#7292d6` | 265° | 0.30° | 3.09 |
| `--chart-3` | `#e0a860` | `#bf8940` | 72° | 0.17° | 3.06 |
| `--chart-4` | `#d97c86` | `#d47782` | 13° | 0.55° | 3.11 |
| `--chart-5` | `#8fbf8a` | `#719f6c` | 142° | 0.17° | 3.05 |
| `--chart-6` | `#cd90c7` | `#bb7fb5` | 330° | 0.17° | 3.08 |
| `--chart-7` | `#4cbdb0` | `#2ba498` | 185° | 0.33° | 3.06 |
| `--chart-8` | `#df9176` | `#cc8065` | 40° | 0.43° | 3.07 |

Charts stay chromatic even though the UI is neutral — series identity *requires* hue
separation, and there is no gray-only way to distinguish eight lines. Slots 6–8 sit at
the mean lightness and chroma of the first five, so no series is optically louder than
another.

**Never write these into a component.** Import from `lib/chartColors.ts`:
`seriesColor(index)` for data, and `CHART_GRID_STROKE` / `CHART_AXIS_STROKE` /
`CHART_TICK_FILL` for chrome — axes and gridlines are structure, so they use the
neutral tokens and follow the theme. Assign series in order and do not reorder for
aesthetics; the same series should keep the same colour across screens. Series colour
is never the only cue: label directly or provide a legend with markers.

### 3.5 Ambient — auth and marketing only

Product UI is flat, neutral, and has no atmosphere. The auth screen, the splash and
the dashboard's ambient backdrop are the exception, licensed by `design.md` §9 (the
hive) and §6 (ambient motion). Those surfaces need atmospheric values that the ground
and ink ladders do not supply — a shimmer, a vignette, a raised glow on a floating
card — and before these tokens existed the only way to write one was a raw `rgba()`
in an arbitrary value, which §10 forbids.

| Token | Role |
|---|---|
| `--noise-texture` | the repeating grain behind `.noise-overlay` |
| `--ambient-grid` | the fine grid shimmer over the hive |
| `--ambient-vignette` | the edge falloff that seats the card on the page |
| `--ambient-card-glow` | the top-left / bottom-right radials on a floating auth card |

Rules:

- **These four are the entire vocabulary.** A new atmospheric value is a new token
  here (§9), never an arbitrary colour at the call site.
- They are legal on `app/auth/**`, `LynkSplash`, and the dashboard backdrop. Anywhere
  an operator works — tables, forms, dialogs, cards, empty states — they are out, on
  the same grounds §9 keeps the hive out of those places.
- They carry no contrast contract, because nothing readable sits on them alone. Text
  and controls still meet §8 against the ground *underneath* the atmosphere.
- Both themes get a value. The light theme needs different ones — a vignette tuned
  for a dark ground reads as dirt on a light one.

Tokenising these is not permission to add more of them, and removing them is not a
cleanup: `design.md` §9 records that the auth atmosphere is intent, and that a screen
made more correct and less itself has gone wrong.

---

## 4. How light is derived from dark

Light is not designed. It is computed. For every non-neutral token:

1. Convert the dark value to OKLCH: `(L, C, H)`.
2. **Hold `H` and `C`.** These carry identity.
3. Sweep `L` downward until both hold:
   - white on the resulting fill ≥ 4.5:1, and
   - the colour as text on `#f7f8fa` (light `bg-app`) ≥ 4.5:1.
4. If the result is out of sRGB gamut, walk `C` down in small steps until it clamps —
   never adjust `H`.
5. Verify hue drift is ≤ 0.5° from the dark value.

For chart colours the floor is 3:1 against `#ffffff` rather than 4.5:1, since they are
non-text fills.

The helper used to do this lives in the design scratchpad
(`derive.py` — sRGB↔OKLab/OKLCH plus WCAG contrast). Any new semantic colour goes
through this procedure and the measured numbers go in the PR description.

Hover and active states are the same operation at fixed lightness deltas
(−0.045 and −0.09 in dark; the inverse in light), so the ramp stays inside one hue.

---

## 5. Radius

| Token | Value | Wraps |
|---|---|---|
| `--radius-control-sm` | `0.375rem` (6px) | Small buttons, chips |
| `--radius-control` | `0.5rem` (8px) | Buttons, inputs, selects |
| `--radius-card` | `0.625rem` (10px) | Cards, table containers, callouts |
| `--radius-panel` | `0.75rem` (12px) | Panels, large sections |
| `--radius-dialog` | `0.875rem` (14px) | Dialogs, sheets, popovers |

Used as `rounded-[var(--radius-control)]`. `rounded-full` and `rounded-none` are the
only bare classes still allowed.

`--radius-sm` / `-md` / `-lg` / `-xl` are **deliberately not mapped** in
`@theme inline`, so `rounded-md` emits no CSS and fails loudly. Named aliases invite
eyeballing — the same button had ended up 6px in one place and 8px in another.

## 6. Control heights

| Token | Value | Use |
|---|---|---|
| `--size-control-sm` | `2rem` (32px) | Dense toolbars, row actions, inline filters |
| `--size-control` | `2.375rem` (38px) | Forms, dialogs, page-level actions |
| `--size-control-lg` | `2.75rem` (44px) | Auth screens, empty-state CTAs |

Used as `h-[var(--size-control)]` or `size-[var(--size-control)]` for square icon
buttons. `Button`, `Input`, `Select` and `InputGroup` all resolve to these, so a
control and the control beside it always match. Never override a height at the call
site.

---

## 7. Type

| Token | Value |
|---|---|
| `--font-app-sans` | `var(--font-inter)`, then `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--font-app-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

### Two size families

Same pixel sizes, two line heights, split on whether the text can wrap.

| Tight (single line) | Size | Prose (may wrap) | Size / line-height |
|---|---|---|---|
| `text-2xs` | 11px / 1.2 | — | — |
| `text-xs` | 12px | `text-p-xs` | 12px / 1.55 |
| `text-sm` | 14px | `text-p-sm` | 14px / 1.55 |
| `text-base` | 16px | `text-p-base` | 16px / 1.6 |

`text-2xs` replaced the 18 hand-written `text-[11px]` eyebrows. The prose family
replaced 61 hand-tuned `text-sm leading-6` / `text-xs leading-5` pairs — if you find
yourself writing a `leading-*` next to a `text-*`, you want a prose token.

Mapped to `--font-sans` / `--font-mono` in `@theme inline`, so `font-sans` and
`font-mono` are the classes. `--font-inter` is injected by `next/font/google` in
`app/layout.tsx`.

No webfont is loaded for mono. Machine strings are rare enough (§3.2 of `design.md`)
that a system stack is correct, and shipping a second webfont for record IDs was the
source of the "this feels like a terminal" problem.

---

## 8. The shadcn compatibility layer

`globals.css` also declares the shadcn names — `--background`, `--foreground`,
`--card`, `--popover`, `--primary`, `--muted`, `--accent`, `--destructive`,
`--border`, `--input`, `--ring`, `--sidebar-*`. These are **aliases** pointing at
Lynk tokens; they exist so vendored shadcn primitives work unmodified.

Rules:

- Do not change a shadcn alias's value. Change the Lynk token it points at.
- Do not use shadcn class names (`bg-card`, `text-muted-foreground`, `bg-accent`) in
  new application code. Use the Lynk semantic names, which say what they mean.
- Inside a vendored `components/ui/` primitive, the shadcn names are fine — that is
  what they are for.

---

## 9. Adding a token

Only when no existing token expresses the role. Then:

1. Add the raw token to `:root` with the dark value.
2. Derive the light value by §4 and add it to `.light`.
3. Map it in `@theme inline` with a role-based name.
4. Record it in the right table in this file.
5. Put the measured contrast numbers in the PR description.

Do not add a token for a one-off. One-offs are a sign the design is diverging, not
that the palette is short a colour.

---

## 10. Forbidden patterns

Run these over changed files before shipping:

```bash
cd frontend

# raw hex — only third-party brand marks (Google/Microsoft OAuth) are legitimate
grep -rnE "#[0-9a-fA-F]{3,8}\b" app components --include=*.tsx

# Tailwind's own palette — does not follow the theme
grep -rnE "\b(bg|text|border|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]" app components

# focus must use the focus token
grep -rn "ring-primary" app components

# mono is for secrets only
grep -rn "font-mono" app components

# structural borders must not bound controls
grep -rnE "<(input|select|textarea)[^>]*border-line-(subtle|default)" app components

# arbitrary colour values bypass the token layer
grep -rnE "(bg|text|border)-\[(#|rgb|hsl|oklch)" app components

# radius aliases emit no CSS - a hit is a silently square corner
grep -rnE "\brounded-(sm|md|lg|xl|2xl|3xl)\b" app components

# a hand-tuned line height means a missing prose token
grep -rnE "text-(xs|sm|base) [a-z0-9-]*leading-" app components

# call-site height overrides on a control (use a size variant instead)
grep -rnE "className=\"[^\"]*(^| )h-[0-9]+!? " app components | grep -E "Input|Button|Select"

# uppercase and faked small caps, inside class strings only
grep -rnE "className=[\"{\`][^\"\`]*(uppercase|tracking-(wide|wider|widest))" app components

# focus is never removed - outline-none is legal only with focus-visible: alongside it
grep -rn "outline-none" app components | grep -v "focus-visible"

# spacing steps that are not on the ladder (design.md 4.1)
grep -rnE "\b(gap|p)-5\b" app components --include=*.tsx

# a looping animation must carry its own reduced-motion guard
grep -rn "animate-\|animation:" app components app/globals.css | grep -v "motion-reduce\|motion-safe\|prefers-reduced-motion"
```

**The reduced-motion grep is now informational.** `globals.css` ends with a
`prefers-reduced-motion: reduce` block that collapses every animation and transition,
and `app/providers.tsx` wraps the tree in `MotionConfig reducedMotion="user"` for
`motion/react`, so the guard is a property of the platform rather than of the class
string. What the grep is still good for is spotting a *new* looping animation whose
intent you should think about — not for finding violations.

Two of these are deliberately loose and will surface a handful of legitimate hits:
the shadcn `label`/`field` primitives set `leading-none`/`leading-snug` on purpose for
single-line labels, and the invoice print document is exempt from the colour greps
(§2.5 of `design.md`). The arbitrary-colour grep is also expected to hit the ambient
layers on `app/auth/**` until those move onto the §3.5 tokens. Everything else should
come back empty.

The reduced-motion grep is a prompt, not a verdict — a one-shot transition does not
need a guard, a loop does. Anything `infinite` that comes back is a defect.

A hit is not automatically a defect, but it is automatically something to justify.
