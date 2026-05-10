---
name: frontend-change
description: Use for meaningful frontend work in Lynk, including dashboard pages, detail pages, forms, tables, shared hooks, client pages, and public screens.
---

# Frontend Change

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
- Saved views, inline filters, search, visible columns, column order, and pagination should reuse the shared module-view patterns.
- Existing records should prefer detail pages with summary/history/editing over modal-only flows.
- Shared record-page capabilities should land across the current applicable module set together when the feature is platform-wide.
- Use linked selectors where the relationship is canonical; do not regress to free text.
- Use shared timezone-aware datetime helpers for user-facing timestamps.
- Keep required markers, form validation, and error messaging aligned with backend rules.

## Product boundaries

- Keep CRM dashboard, client portal, public signed-link, and public integration experiences separate.
- Public screens must not expose personalized pricing, private documents, or internal-only fields.
- Do not invent local-only UI state for platform features that already have persisted backend support.

## Verification

Use `release-verification` before finishing.

Typical frontend checks:
- `npm run lint`
- `npm run build` for meaningful UI changes
- smoke-check affected pages, dialogs, tables, and detail pages
- inspect browser console/runtime warnings
- run browser tests when the changed flow is covered or high-risk
