# Lynk Codex Guide

Lynk is a modular CRM + ERP platform. Build it as a durable multi-tenant product, not as a collection of one-off screens.

## Product values

- Prefer reusable platform primitives over module-specific shortcuts.
- Preserve tenant isolation, least-privilege access, auditability, recoverability, and safe defaults.
- Keep the product modular: tenant module enablement, department/team availability, and role action permissions are separate concerns.
- Core operational deletes are soft-delete/recoverable by default.
- Public surfaces expose only intentionally public data; personalized pricing, private documents, and customer-specific terms require authenticated or scoped signed access.
- Do not reopen intentionally deferred slices by accident. Examples: automated WhatsApp sending, payment links, broad Gmail inbox access, user-created modules.

## Required working pattern

Before substantial work:
1. Inspect the relevant existing code and nearby tests first.
2. Load only the skills needed for the task.
3. State the minimal plan before editing.

While editing:
- Keep changes inside one coherent slice.
- Make the smallest safe change that completes the slice properly.
- Do not duplicate an existing shared helper, API pattern, or UI primitive.
- Do not leave shared capabilities half-landed across the current applicable module set.
- Do not add dependencies, broad refactors, or compatibility layers without a clear need.

Before calling work complete:
1. Load the `release-verification` skill.
2. Run the checks appropriate to the touched area.
3. Review the diff for tenant scoping, permissions, audit logging, recoverability, and accidental scope creep.
4. Update `roadmap` only when long-term direction materially changes.

## Repository map

- `backend/`: FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, Celery.
- `frontend/`: Next.js, React, TypeScript, shared dashboard primitives.
- `docker-compose.yml`: local stack with backend, frontend, PostgreSQL, Redis, Celery worker, and Celery beat.

## Default commands

- Default full close-out check from repo root: `./scripts/codex-check.sh`

From `backend/`:
- Targeted tests: `python -m unittest tests.<relevant_test_module>`
- Syntax check: `python -m compileall app tests`
- Migrations: `alembic upgrade head`
- Migration state: `alembic current`

From `frontend/`:
- Lint: `npm run lint`
- Build verification: `npm run build`
- Browser tests when relevant: `npm run test:e2e`

## Where to look next

- Backend-specific rules: `backend/AGENTS.md`
- Frontend-specific rules: `frontend/AGENTS.md`
- Reusable workflows: `.codex/skills/`
- Cross-checks: `.codex/agents/`
- Treat this guide, scoped `AGENTS.md` files, and `.codex/` skills as the current operational source of truth for agent work.
