---
name: frontend-change
description: Use for meaningful frontend work in Lynk, including dashboard pages, detail pages, forms, tables, shared hooks, client pages, and public screens.
---

# Frontend Change

## Design system — read before writing UI

`docs/design/` is the source of truth for how Lynk looks and feels. Visual design here is
specified, not improvised, and every rule is written so it can be checked:

- `docs/design/design.md` — principles, colour policy, typography, spacing, component law,
  motion, accessibility floors, and the pre-ship checklist. Cite sections by number.
- `docs/design/tokens.md` — the token vocabulary, both themes, and how light is derived
  from dark in OKLCH. Read before touching colour, type, spacing, or radius.
- `docs/design/README.md` — orientation and the short version.

The rules that fail a review:

- Neutral gray instrument, **no brand accent**. Colour only where it carries meaning:
  status, destructive intent, chart series (§1.2, §2.2). One primary button per view.
- Hierarchy from ink weight and space, never from boxes, fills, or shadows. At most two
  levels of visible container on a screen (§1.3, §4.6).
- No raw hex, no Tailwind palette classes (`bg-slate-800`, `text-gray-400`), no arbitrary
  colour. Map to a token; if none fits, add it in `globals.css` and derive its light
  value properly (§2.5). Focus uses `ring-focus`, never the action colour (§2.3).
- Inter everywhere; `font-mono` only for secrets, raw payloads, and checksums. Aligned
  figures use `tabular-nums`, not a mono face (§3.1, §3.2).
- Sentence case. `uppercase` and faked small caps (`tracking-wider`) are out (§3.5).
- Two type families at the same sizes — tight for single-line, `text-p-*` for anything
  that wraps. Never hand-tune a `leading-*` (§3.3).
- Spacing on the 4px grid; control heights are the three tokens (32/38/44) and are never
  overridden at the call site; radius is `rounded-[var(--radius-*)]` named for what it
  wraps — the bare Tailwind aliases emit no CSS at all (§4.1–4.3).
- One scroll region per screen. Page content never carries a height cap; bounded overlays
  are the exception and must be marked (§4.5, §11.1).
- Build from `components/ui/` primitives, shadcn, and lucide only. A page-local table,
  dialog, or toolbar is a review failure. Variants live in the primitive's `cva` config,
  not in a call-site `className` (§7.1–7.3).
- Every interactive component ships hover/focus-visible/active/disabled; every data view
  ships loading/empty/error/permission-denied (§7.4).
- Accessibility floors are non-negotiable: 4.5:1 text, 3:1 controls and focus rings,
  meaning never carried by colour alone, icon-only controls named, one `h1` per page (§8).

Scope rule: restructuring screens the task did not name is a redesign, and it gets
proposed before it is built (§1.1). If the work genuinely contradicts a rule, change the
rule in `docs/design/design.md` in the same slice, with the reason written down (§12) —
do not let a screen silently disagree with the file.

## Inspect first

Before editing, inspect:
- the existing page or route pattern
- shared UI primitives
- related hooks and API clients
- similar already-landed module screens
- backend constraints the UI must reflect

## UI architecture rules

- Reuse shared primitives and hooks before creating page-local versions.
- Operational list pages should follow the shared table/list language where a table is appropriate.
- Module list pages should not use full sticky page/module headers unless a compact sticky toolbar is intentionally designed; default page headers scroll with the content.
- Saved views, inline filters, search, visible columns, column order, and pagination should reuse the shared module-view patterns.
- Existing records should prefer detail pages with summary/history/editing over modal-only flows.
- Row click/detail-page navigation is the preferred open path where a detail route exists. Action columns are for secondary quick actions, not primary record opening/editing.
- Custom modules should behave like first-class operational modules rather than builder/admin forms; quick create dialogs are fine, existing records should open detail/edit pages where practical.
- Do not add or relink module overview pages unless the owner explicitly asks.
- Shared record-page capabilities should land across the current applicable module set together when the feature is platform-wide.
- Use linked selectors where the relationship is canonical; do not regress to free text.
- Use shared timezone-aware datetime helpers for user-facing timestamps.
- Keep required markers, form validation, and error messaging aligned with backend rules.
- Route every request through `apiFetch`. Only GET/HEAD are retried automatically; never add a client that replays writes.
- Generated API contracts in `frontend/contracts/` are committed artifacts. Consume them through an adapter in `lib/contracts/`, and regenerate with `./scripts/generate-contracts.sh` instead of hand-editing.

## Product boundaries

- Keep CRM dashboard, client portal, public signed-link, and public integration experiences separate.
- Public screens must not expose personalized pricing, private documents, or internal-only fields.
- Do not invent local-only UI state for platform features that already have persisted backend support.
- Keep WhatsApp as contextual click-to-chat/contact workflow unless an explicit provider integration phase is opened; do not add standalone WhatsApp nav/page surfaces.
- Settings forms should track dirty state and show unsaved-change feedback where practical.

## Verification

Use `release-verification` before finishing.

Typical frontend checks:
- `docker compose exec -T frontend npm run lint`
- `docker compose exec -T frontend npm run build` for meaningful UI changes
- `./scripts/check-design.sh` — the source-level design gate (docs/design rules; also part
  of `./scripts/codex-check.sh`)
- `docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1`
  — the rendered design guards, for any restyle or new screen
- open the changed screen in **both themes** before calling it done
- smoke-check affected pages, dialogs, tables, and detail pages
- inspect browser console/runtime warnings
- run browser tests when the changed flow is covered or high-risk

If a design guard fails, fix the code. Only widen a guard when you can name why the case
is legitimate — and then mark the line (`design-exempt: <reason>`) or the spec exemption
with that reason.
