---
name: release-verification
description: Use before calling meaningful work complete to choose and run the right validation for the touched area.
---

# Release Verification

Use this before marking meaningful work complete.

## Backend

When backend code changed:
- run targeted tests for the touched area through the backend container
- run `docker compose exec -T backend python -m compileall app tests`
- smoke-check the changed route/service path where practical

When schema changed:
- run `docker compose exec -T backend alembic upgrade head`
- confirm `docker compose exec -T backend alembic current`
- verify defaults/backfills for existing rows
- confirm cleanup paths are deterministic and avoid silent data loss

## Frontend

When frontend code changed:
- run `docker compose exec -T frontend npm run lint`
- run `docker compose exec -T frontend npm run build` for meaningful UI changes
- smoke-check affected pages, dialogs, tables, and detail pages
- check for console/runtime warnings
- confirm required markers and validation still match backend rules

## Security and product safety

Check:
- intended module and action permissions still apply
- tenant scoping is explicit where data is tenant-owned
- linked-record validation cannot cross tenants
- destructive behavior is still soft-delete/recoverable where expected
- public surfaces do not expose private or personalized data
- auth boundaries remain separate between CRM users, client accounts, and public integrations

## Performance and resilience

When relevant, check:
- obvious over-fetching on list pages
- cache hit and miss behavior
- Redis fallback behavior
- background-job status/failure handling
- pagination and duplicate/retry behavior

## Close-out

Before finishing:
- review the diff for unrelated changes
- summarize tests/checks actually run
- call out remaining risk honestly
- update `roadmap` only when long-term direction materially changed
