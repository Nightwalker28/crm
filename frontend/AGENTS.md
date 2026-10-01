# Frontend Rules

The frontend is Next.js + React + TypeScript and should stay aligned with the shared dashboard system rather than growing one-off UI patterns.

## Design system

`docs/design/` is the written source of truth for how Lynk looks and feels. Read it before writing or restyling UI:

- `docs/design/design.md` — design principles, colour policy, typography, spacing, component law, the five page archetypes (§4.7), accessibility floors, and the pre-ship checklist.
- `docs/design/tokens.md` — the token vocabulary, both themes, and how light values are derived from dark.
- `docs/design/rebuild.md` — **the active programme.** Rulings R1–R10 constrain new work; sub-phases 5.1–5.10 are rewriting every surface onto the archetypes.
- `docs/design/rebuild-census.md` — which sub-phase owns which of the 327 frontend files. A new file added during feature work needs a row.

Short form: neutral gray instrument with no brand accent, hierarchy from ink and space rather than boxes, dark as default with light derived from it in OKLCH, Inter everywhere with monospace reserved for secrets, and shared primitives instead of page-local UI. Every screen is one of five archetypes; only the surface's name is larger than the body; a box is earned by interactivity or separation, never by grouping.

Use the `frontend-change` skill to build UI inside this system, and `frontend-design` when the work changes it.

The rules are guarded, not just written down:

- `./scripts/check-design.sh` checks the source-level rules (raw hex, Tailwind palette classes, `ring-primary`, uppercase and faked small caps, hand-tuned line heights, off-grid spacing, call-site control heights, bare radius aliases, a height cap on `ModuleTableShell`, implicit scroll containers, non-lucide icons, a second component library, `transition-all`). It runs on the host and is part of `./scripts/codex-check.sh`.
- `tests/e2e/design-rules.spec.ts` and `tests/e2e/scroll-containers.spec.ts` check the rendered truth across every route — what grep cannot see.

A failing guard means the code is wrong. If a case is genuinely legitimate, mark it (`design-exempt: <reason>` on the line, or a named exemption in the spec) and, when it is a new class of case, write it into `docs/design/design.md` first.

## Core frontend rules

- Prefer shared UI primitives, hooks, and route patterns over page-specific copies.
- Keep every request on `apiFetch`. Only GET/HEAD may be retried automatically; write operations must not be replayed.
- Generated API contracts live in `contracts/` and are committed. Import them only through an adapter in `lib/contracts/`, never directly from UI code, and regenerate with `./scripts/generate-contracts.sh` rather than editing them.
- Main operational lists should use the shared table/list language where a table is the right default.
- Saved views, inline quick filters, visible columns, column order, pagination, and search should reuse the shared module-view patterns.
- Existing records should prefer detail pages with summary/history/editing over modal-only workflows.
- Shared record-page capabilities should land across the current applicable module set together, not one module at a time.
- Use linked selectors for canonical relationships instead of free text.
- Render user-facing time through shared timezone-aware helpers.
- Required fields and validation copy should stay aligned with backend constraints.

## Product and safety boundaries

- Do not expose private pricing, private documents, or client-specific terms through public screens.
- Keep CRM dashboard auth, client portal auth, and public signed-link flows visually and logically separate.
- Do not invent local-only state for platform features that already have persisted shared backend support.
- Preserve the product's restrained shared visual language rather than introducing isolated styles.

## Verification expectations

For frontend changes, consider:
- `docker compose exec -T frontend npm run lint`
- `docker compose exec -T frontend npm run build`
- `./scripts/check-design.sh` for any UI change
- `docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1` for restyles and new screens, plus a both-themes pass
- `./scripts/generate-contracts.sh --check` when a touched API family has generated contracts
- affected page/dialog/table/detail-page smoke checks
- console/runtime warnings
- required-field and validation behavior
- browser tests through the Compose E2E service when the changed flow is already covered or high-risk

Authenticated browser tests sign in as `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env`. If that
account has MFA enabled, add `E2E_ADMIN_TOTP_SECRET=<authenticator setup key>` to `.env`; the suite derives
live codes from it. `.env` is gitignored — never commit the secret.
