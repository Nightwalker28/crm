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
- targeted `python -m unittest ...`
- `python -m compileall app tests`
- migration checks when schema changes exist
- tenant, permission, linked-record, failure-path, and idempotency review
