# Lynk Design

The design system's written source of truth. If you are about to write, review, or
restyle any UI in `frontend/`, start here.

| File | What it is | When to read it |
|---|---|---|
| [`design.md`](./design.md) | The design language — principles, colour policy, type, spacing, components, a11y floors, ship checklist | Before writing **any** UI |
| [`tokens.md`](./tokens.md) | The token vocabulary — every token, its value in both themes, and how light is derived from dark | Before touching colour, type, spacing, or radius |
| [`research-frappe-crm.md`](./research-frappe-crm.md) | Notes on Frappe CRM's design methodology, where several of our rules came from | Background. Not law. |

Implementation lives in `frontend/app/globals.css` (tokens) and
`frontend/components/ui/` (primitives). Those files are authoritative over these
docs — but a disagreement between them is a bug in one of the two, and it should be
resolved, not left.

## The short version

- Neutral gray instrument. **No brand accent in the UI.** Colour only where it carries
  meaning: status, destructive intent, chart series.
- Hierarchy from ink weight and space, not from boxes, borders, or fills.
- Dark is the default. Light is the same palette at a different weight, derived in
  OKLCH by holding hue and chroma.
- Inter everywhere. Monospace only for secrets and raw payloads; `tabular-nums` for
  aligned figures.
- Two type families at the same sizes: tight for single-line labels, `text-p-*` for
  anything that wraps. Never hand-tune a `leading-*`.
- Sentence case. No `uppercase`, no faked small caps.
- One radius vocabulary — `rounded-[var(--radius-*)]`, named for what it wraps. The
  Tailwind aliases emit no CSS on purpose.
- Use the primitives in `components/ui/`. A page-local table, dialog, or toolbar is a
  review failure. Build from shadcn primitives and lucide icons only.
- Improve the foundation. A change that restructures screens the task did not name is
  a redesign, and needs to be proposed first.
