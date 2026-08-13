# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lynk — a modular, multi-tenant CRM + ERP platform. FastAPI + SQLAlchemy + Alembic on PostgreSQL with Redis/Celery (`backend/`), and Next.js App Router + React 19 + TypeScript + Tailwind v4 + shadcn primitives (`frontend/`).

`AGENTS.md` (root), `backend/AGENTS.md`, and `frontend/AGENTS.md` are the operational source of truth for working in this repo — read the scoped ones for any area you touch. This file summarizes the parts you need up front.

This repo is also used with OpenAI Codex, so the same operational rules exist twice: `.codex/skills/` + `.codex/agents/` (Codex format) and `.claude/skills/` + `.claude/agents/` (Claude Code format, invoked via the `Skill` and `Agent` tools). They're kept in sync by hand — if you change one set of rules, mirror the change in the other. Claude Code skills: `backend-change`, `frontend-change`, `migration-change`, `docs-change`, `feature-slice`, `platform-primitive`, `release-verification`, `roadmap`, `security-review`. Claude Code subagents (read-only reviewers, invoke via `Agent` with the matching `subagent_type`): `architect`, `backend-reviewer`, `frontend-reviewer`, `product-guardian`, `qa-reviewer`, `security-reviewer`.

## Commands

Everything runs in containers; Python/Node dependencies are not expected on the host.

```bash
docker compose up --build            # full stack: backend :8000, frontend :3000, redis, celery worker + beat
./scripts/codex-check.sh             # default close-out check (compileall, migration verify, OpenAPI gen, contract drift, unit tests, design rules, lint, build)
./scripts/generate-contracts.sh      # regenerate the committed generated API contracts (repair command)
./scripts/check-design.sh            # source-level design rules from docs/design/design.md (runs on the host; also inside codex-check.sh)
```

Backend (from repo root):

```bash
docker compose exec -T backend python -m unittest discover -s tests -p 'test_*.py'
docker compose exec -T backend python -m unittest tests.test_leads_conversion          # single module
docker compose exec -T backend python -m unittest tests.test_leads_conversion.LeadConversionTests.test_x  # single test
docker compose exec -T backend python -m compileall app tests
docker compose exec -T backend alembic upgrade head
docker compose exec -T backend alembic current
docker compose exec -T backend python -m scripts.verify_migrations   # replays the chain on a throwaway PG database
docker compose exec -T backend python -m scripts.verify_openapi      # fails on a broken/unserializable OpenAPI schema
```

Frontend:

```bash
docker compose exec -T frontend npm run lint
docker compose exec -T frontend npm run build
docker compose run --rm frontend-e2e npm run test:e2e
docker compose run --rm frontend-e2e npm run test:e2e -- leads-revamp.spec.ts --grep "Lead journey behavior baseline"
docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1   # rendered design guards
```

Tests are stdlib `unittest` (no pytest installed) and mostly build a SQLite in-memory session against `Base.metadata`. Playwright specs live in `frontend/tests/e2e/`.

CI (`.github/workflows/ci.yml`) layers `docker-compose.ci.yml` over the base compose file to add a Postgres service and CI secrets, then runs `./scripts/codex-check.sh` plus the Lead journey e2e baseline.

## Architecture

### Backend layering

`backend/app/`:
- `core/` — cross-module platform primitives. Reuse these before writing anything module-specific: `tenancy`, `access_control`, `permissions`, `security`, `pagination` / `cursor_pagination`, `module_search` / `postgres_search`, `module_csv` / `module_export` / `module_filters` / `list_fields`, `uploads`, `cache`, `celery_app`, `realtime`, `encrypted_fields` / `secrets`.
- `modules/<area>/` — `models.py` and `schema.py` are shared per area; behind them sit `repositories/` (query construction), `services/` (business rules, side effects), `routes/` (HTTP, auth, serialization only). Areas: `sales`, `finance`, `catalog`, `support`, `tasks`, `calendar`, `mail`, `documents`, `contracts`, `client_portal`, `whatsapp`, `website_integrations`, `user_management`, `platform`.
- `modules/platform/` — the configurability layer other modules consume: custom fields, custom modules (builder + runtime), module field configs, record layouts, saved views, global search, activity logs, record comments, notifications, automation rules, data-transfer jobs, recycle bin, tenant backup/restore.
- `api/v1/router.py` — the single place every router is mounted; area routers get prefixes here (e.g. sales under `/sales`).
- `bootstrap/seed.py` — seeds modules/roles/permissions for tenants; new modules need a seed entry to appear.

`main.py` resolves tenant context in HTTP middleware (`resolve_request_tenant_context_cached`) for every path except `/health`, `/media/*`, and `/api/v1/integrations/public*`. `start.sh` waits for Postgres, runs `alembic upgrade head`, runs the bootstrap seed, then starts uvicorn — so containers self-migrate on boot.

### Access control is three independent layers

Every protected route must clear all three, in order:

1. tenant module enablement (`is_module_enabled_for_tenant`)
2. department/team module availability (`require_department_module_access`)
3. role action permission — `view` / `create` / `edit` / `delete` / `restore` / `export` / `configure` (`require_role_module_action_access`)

Auth alone is never sufficient: service-layer queries must scope by `tenant_id` explicitly, and linked-record validation must stay inside the same tenant. There are three separate auth boundaries — CRM user auth, client portal auth, and public integration-key auth — and they must not be blended.

### Data rules worth knowing before you write a migration

- Alembic revision IDs must be **≤ 32 characters** (`alembic_version.version_num` is `VARCHAR(32)`).
- Migrations live in `backend/alembic/versions/`; `alembic/env.py` imports every area's models for autogenerate, so a new area's models must be imported there.
- Core operational deletes are soft-delete/recoverable by default (recycle bin).
- Cursor/keyset endpoints use strict descending PK order after `order_by(None)`; existing offset-paginated list routes stay as they are.
- Long-running import/export and provider syncs go through persisted jobs + Celery, never inline in a request.

### Frontend

`frontend/`:
- `app/dashboard/<area>/<module>/` — App Router pages (list, `new/`, `[id]/`, `[id]/edit/`). `app/client/`, `app/book/`, `app/public/` are the separate portal/public surfaces. `app/e2e/` holds test-only harness routes, blocked in production by `proxy.ts`.
- `lib/api.ts` — `apiFetch` is the only HTTP entry point: cookie auth, single-flight refresh on 401, GET deduplication, transient 5xx retry. Only GET/HEAD are retried; write operations are never replayed automatically.
- `contracts/` — generated OpenAPI artifacts for the record-layout API family, committed and drift-checked (`./scripts/generate-contracts.sh --check`). They are types, not a client: `lib/contracts/recordLayouts.ts` is the only importer and still calls `apiFetch`. See `frontend/contracts/README.md`.
- `lib/module-registry.ts` — the client-side registry of module key → route, group, tier, and quick action. `lib/routes.ts`, `lib/moduleViewConfigs.ts`, `lib/module-display.ts` are the sibling registries a new module must be added to.
- `components/ui/` — shared list/record language: `ModuleTableShell`, `ModuleListToolbar`, `Table`, `Pagination`, `SearchBar`, `SavedViewSelector`, `InlineSavedViewFilters`, `ColumnPicker`, `QuickCreateSurface`, `RecordTabs`, `ImportControls`/`ExportControls`. Use these instead of per-module tables or dialogs.
- `hooks/` — shared data hooks (`usePagedList`, `useSavedViews`, `useModuleFieldConfigs`, `useModuleCustomFields`, `useResolvedRecordLayout`, `useJobPoller`, `useRealtime*`).
- `proxy.ts` — Next middleware guarding `/dashboard` on the `lynk_access_token` / `lynk_refresh_token` cookies.

Render user-facing time through the shared timezone helpers (`lib/datetime.ts`), use `LinkedRecordPicker` for canonical relationships rather than free text, and keep required-field/validation copy aligned with backend constraints.

**Visual design is specified, not improvised.** `docs/design/design.md` (design language) and `docs/design/tokens.md` (token vocabulary) are the source of truth for colour, typography, spacing, radius, icons, motion, and accessibility floors. Read them before writing or restyling UI, and use semantic tokens — never raw hex or Tailwind's own colour palette.

The rules are enforced in two halves: `./scripts/check-design.sh` (source-level greps, inside `codex-check.sh`) and the `design-rules.spec.ts` / `scroll-containers.spec.ts` Playwright guards (rendered truth across every route). A failing guard means the code is wrong — fix the code, and only mark an exemption (`design-exempt: <reason>` on the line) when the case is genuinely legitimate.

## Adding a module

`python3 scripts/create-module.py <area> <modules>` scaffolds backend repository/service/route files, a migration template, and frontend hook/type/page/component files. It never overwrites, and it does **not** patch shared registries — it prints the snippets you must paste into `models.py`, `schema.py`, `api/v1/router.py`, `bootstrap/seed.py`, `lib/routes.ts`, `Sidebar.tsx`, `lib/moduleViewConfigs.ts`, and `lib/module-display.ts`. See `docs/module-template/README.md` and `checklist.md`.

## Working expectations

- Inspect existing code and nearby tests before substantial work; state a minimal plan before editing.
- Keep changes to one coherent slice. Don't duplicate an existing shared helper, API pattern, or UI primitive, and don't leave a shared capability half-landed across the applicable module set.
- Before calling work complete, load the `release-verification` skill and run the checks for the touched area, then review the diff for tenant scoping, permissions, audit logging, recoverability, and scope creep.
- Deliberately deferred slices — automated WhatsApp sending, payment links, broad Gmail inbox access, user-created modules — should not be reopened incidentally.
- `docs/crm-evolution/` is the current roadmap package; `CODEX-RUNBOOK.md` defines how a phase is executed and reported. Implement only the requested phase — a phase label is not evidence the work is missing. Update the roadmap only when long-term direction materially changes.
