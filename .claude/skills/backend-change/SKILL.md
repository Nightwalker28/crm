---
name: backend-change
description: Use for meaningful backend work in Lynk, including routes, services, models, jobs, integrations, imports, exports, and shared platform behavior.
---

# Backend Change

## Inspect first

Before editing, inspect the nearby:
- route
- service
- model/schema
- tests
- shared helper or platform primitive already used by similar modules

## Required checks

For tenant-owned or tenant-configurable data:
- add or preserve explicit tenant ownership
- scope service queries by tenant
- validate linked records inside the same tenant

For routes:
- keep module availability and action permissions explicit
- do not rely on auth alone for access control
- keep CRM user, client account, public signed-link, and integration-key auth boundaries separate

For writes:
- preserve soft-delete/recovery behavior where expected
- add activity/audit history where the domain already uses it
- keep side effects intentional and idempotent where retries are possible

For shared behavior:
- reuse existing search, filters, pagination, imports, exports, uploads, downloads, notifications, comments, activity, and background-job helpers before adding new logic
- if multiple modules need the same behavior, consider the `platform-primitive` skill

For tenant-owned operational modules:
- keep DB/query-only behavior in repositories with explicit `tenant_id` or scoped current-user input
- keep business rules, linked-record validation, side effects, activity/audit logging, import/export orchestration, and serialization helpers in services
- keep routes focused on HTTP concerns, auth/module/action dependencies, request parsing, and response shape
- preserve existing offset list routes for compatibility
- add cursor/keyset list mode for high-volume lists; cursor queries must clear inherited ranking/timestamp ordering and use deterministic ordering matching the cursor, currently `order_by(None).order_by(<primary_id>.desc())`
- keep search Postgres-backed through shared search helpers or `backend/app/modules/platform/search`, not module-specific engines

## Background work and integrations

Prefer persisted jobs + Celery for long-running imports, exports, provider sync, or scheduled work.

For external systems:
- use least-privilege scopes
- keep opt-in flows explicit
- store and use trusted server-side state
- handle retry, failure, and duplicate delivery safely

## Verification

Use `release-verification` before finishing.

Typical backend checks:
- targeted backend tests through the backend container
- `docker compose exec -T backend python -m compileall app tests`
- migration checks when schema changes exist
- tenant, permission, linked-record, failure-path, and idempotency review
