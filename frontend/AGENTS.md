# Frontend Rules

The frontend is Next.js + React + TypeScript and should stay aligned with the shared dashboard system rather than growing one-off UI patterns.

## Core frontend rules

- Prefer shared UI primitives, hooks, and route patterns over page-specific copies.
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
- affected page/dialog/table/detail-page smoke checks
- console/runtime warnings
- required-field and validation behavior
- browser tests through the Compose E2E service when the changed flow is already covered or high-risk
