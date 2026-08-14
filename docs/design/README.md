# Lynk Design

The design system's written source of truth. If you are about to write, review, or
restyle any UI in `frontend/`, start here.

| File | What it is | When to read it |
|---|---|---|
| [`design.md`](./design.md) | The design language — principles, colour policy, type, spacing, components, a11y floors, ship checklist | Before writing **any** UI |
| [`tokens.md`](./tokens.md) | The token vocabulary — every token, its value in both themes, and how light is derived from dark | Before touching colour, type, spacing, or radius |
| [`research-frappe-crm.md`](./research-frappe-crm.md) | Notes on Frappe CRM's design methodology, where several of our rules came from | Background. Not law. |
| [`rebuild.md`](./rebuild.md) | **The active work.** The rebuild programme — every surface rebuilt onto one archetype set, sub-phases 5.0–5.10 | Before starting or reviewing any frontend work right now |
| [`consistency-pass.md`](./consistency-pass.md) | The 2026-08 audit and Phases 0–4, which added `PageShell` and `RecordTable`. Phase 5 onward moved to `rebuild.md` | For the measurements, and for what has already landed |

Implementation lives in `frontend/app/globals.css` (tokens) and
`frontend/components/ui/` (primitives). Those files are authoritative over these
docs — but a disagreement between them is a bug in one of the two, and it should be
resolved, not left.

## The guards

The mechanical rules are enforced, not just written down:

| Guard | Covers | Run |
|---|---|---|
| `scripts/check-design.sh` | the source-level rules — colour, case, line height, spacing, control heights, radius, height caps, icon and component sources, motion | `./scripts/check-design.sh` (also inside `./scripts/codex-check.sh`) |
| `frontend/tests/e2e/design-rules.spec.ts` | the rendered truth across every route — Inter, monospace scope, case, control heights, radius | `docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts --workers=1` |
| `frontend/tests/e2e/scroll-containers.spec.ts` | one scroll region per screen | same, with `scroll-containers.spec.ts` |

A failing guard means the code is wrong. A legitimate case is marked — `design-exempt:
<reason>` on the line for the source guard, a named exemption in the spec for the
rendered ones — and a new *class* of exemption is written into `design.md` first.

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
