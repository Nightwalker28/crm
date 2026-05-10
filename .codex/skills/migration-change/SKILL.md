---
name: migration-change
description: Use whenever a change touches Alembic, models, constraints, indexes, backfills, cleanup, or schema-sensitive persistence behavior.
---

# Migration Change

## Design rules

- Use Alembic for schema changes.
- Make migrations deterministic for existing rows.
- Prefer additive safe transitions before destructive cleanup.
- Keep tenant ownership, uniqueness, and linked-record integrity explicit.
- Do not reintroduce removed legacy contracts or compatibility paths unless intentionally approved.
- Add indexes when justified by real list, join, restore, or search access patterns.

## Before editing

Inspect:
- related models
- recent migrations in the same area
- service/query behavior that depends on the schema
- whether existing rows need backfill or default handling
- whether current tests or seed/bootstrap flows assume the old shape

## Safety checks

For each migration, ask:
- What happens to existing rows?
- Can this lose data silently?
- Is the backfill deterministic?
- Does rollback/cleanup behavior need special care?
- Does the new constraint match current real data?
- Does tenant scoping remain valid after the change?

## Verification

For schema work:
- run `docker compose exec -T backend alembic upgrade head`
- run `docker compose exec -T backend alembic current`
- run Alembic chain/model checks where available
- test the affected route/service behavior after migration
- verify new defaults, backfills, uniqueness, and cleanup behavior
