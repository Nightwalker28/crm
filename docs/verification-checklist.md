# Verification Checklist

Use this file as the standard close-out checklist for meaningful backend/frontend changes.

## Backend

- Run targeted Python compile checks for touched backend files.
- Run Alembic migration to head when schema changes exist.
- Confirm Alembic current revision after migration.
- Verify route/service behavior for the changed area with targeted smoke checks where practical.

## Frontend

- Verify affected pages compile/render in the dev server.
- Smoke test any changed dialogs, tables, and detail pages in-browser.
- Check for console/runtime warnings or React prop leakage on changed UI primitives.
- Confirm required field markers and validation behavior still match backend constraints.

## Permissions / Security

- Verify the changed route still enforces the intended module and action permissions.
- Confirm linked-record selectors cannot bypass backend validation.
- Confirm destructive operations remain soft-delete/recoverable where expected.

## Data / Migrations

- Confirm new schema defaults are sensible for existing rows.
- Confirm any backfill or cleanup migration behavior is deterministic.
- Avoid silent data-loss paths during schema cleanup.

## Performance / Caching

- Check that new list-page behavior does not accidentally over-fetch obvious unused data.
- If cache behavior changes, verify both cache-hit and cache-miss behavior.
- If Redis-backed caching is involved, verify fallback behavior when Redis is unavailable.

## Tracker / Docs

- Update `docs/platform-refactor-roadmap.md` when scope, status, or sequence changes.
- Update `docs/product-rules.md` if a business rule changes.
- Update `docs/architecture.md` if a technical pattern or constraint changes.
- Update `docs/current-task.md` when the active priority changes materially.
