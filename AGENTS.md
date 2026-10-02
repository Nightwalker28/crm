# Lynk Codex Guide

## ⚠ CPU ceiling — read first, applies to every task

**Never use more than 65% of the host's CPU, at any stage.** The owner runs other live projects
on this machine. This outranks speed: a slower check is acceptable, a saturated machine is not.

- **Every Lynk container is hard-capped** by `docker-compose.limits.yml` (caps sum to 5.0 of 8
  cores = 62.5%). The local `.env` sets `COMPOSE_FILE=docker-compose.yml:docker-compose.limits.yml`,
  so plain `docker compose …` applies it. **Any command that passes `-f` must also pass
  `-f docker-compose.limits.yml`**, or the caps silently disappear. Verify with
  `docker inspect <container> --format '{{.HostConfig.NanoCpus}}'` (non-zero = capped).
- **One heavy job at a time.** Never run `npm run build`, `tsc`, `lint`, a Playwright run, the
  backend test suite, or `verify_migrations` concurrently with each other, and never start
  parallel subagents that each run them.
- **Playwright always `--workers=1`.**
- **Host-side work runs under `nice -n 19`** (scripts, greps over the tree, Python helpers).
- **Check before starting something heavy:** `docker stats --no-stream` and `uptime`. If the host
  is already above ~65% from the owner's other work, wait or say so — do not add load.
- A cap is not raised, and the limits file is not bypassed, without the owner's say-so.

Lynk is a modular CRM + ERP platform. Build it as a durable multi-tenant product, not as a collection of one-off screens.

## Product values

- Prefer reusable platform primitives over module-specific shortcuts.
- Preserve tenant isolation, least-privilege access, auditability, recoverability, and safe defaults.
- Keep the product modular: tenant module enablement, department/team availability, and role action permissions are separate concerns.
- Core operational deletes are soft-delete/recoverable by default.
- Public surfaces expose only intentionally public data; personalized pricing, private documents, and customer-specific terms require authenticated or scoped signed access.
- Visual design is specified, not improvised. `docs/design/` is the source of truth for anything the user sees; read it before writing or restyling UI.
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
- `docs/design/`: the design language (`design.md`) and token vocabulary (`tokens.md`) that all UI must follow.
- `docker-compose.yml`: default app stack with backend, frontend, Redis, Celery worker, and Celery beat; PostgreSQL comes from `DATABASE_URL`.
- `docker-compose.local-db.yml`: optional override for a fully local PostgreSQL container when an isolated DB is needed.

## Default commands

- Default full close-out check from repo root: `./scripts/codex-check.sh`

Use Docker Compose for app checks; application dependencies are expected inside containers, not on the host.

From repo root:
- Targeted backend tests: `docker compose exec -T backend python -m unittest tests.<relevant_test_module>`
- Backend syntax check: `docker compose exec -T backend python -m compileall app tests`
- Migrations: `docker compose exec -T backend alembic upgrade head`
- Migration state: `docker compose exec -T backend alembic current`
- Frontend lint: `docker compose exec -T frontend npm run lint`
- Frontend build verification: `docker compose exec -T frontend npm run build`
- Design rules (source-level, runs on the host, included in `codex-check.sh`): `./scripts/check-design.sh`
- Design rules (rendered, walks every route): `./scripts/e2e.sh design-rules.spec.ts scroll-containers.spec.ts`
- Browser tests when relevant: `./scripts/e2e.sh <spec>…` (see below)

### Browser tests

- Browser tests (Playwright) run through `./scripts/e2e.sh`, **not** `docker compose run … frontend-e2e` against the dev server. It serves the production build (`next start` on :3000, the origin the backend trusts, reusing the build `codex-check.sh` leaves unless source is newer), stops the dev server for the run and restarts it after, enforces one worker, and refuses to start above 65% host load. Several times faster than the dev server, and the full design walk no longer OOMs.
  - While fixing a slice, scope the route guards to the touched routes: `./scripts/e2e.sh --routes /dashboard/inventory,/dashboard/settings/recycle-bin design-rules.spec.ts scroll-containers.spec.ts` (sets `E2E_ROUTES`; route prefixes, comma-separated; the canary and global checks still run).
  - Once per module, at its close: the unscoped walk, `./scripts/e2e.sh design-rules.spec.ts scroll-containers.spec.ts`, plus the module's specs.
  - Exception: `contract-transport`, `record-layout-runtime` and `quick-create-surface` drive the `/e2e/*` harness routes, which `proxy.ts` blocks in production; run those on the dev server: `docker compose run --rm frontend-e2e npm run test:e2e -- <spec> --workers=1`.

## Where to look next

- Backend-specific rules: `backend/AGENTS.md`
- Frontend-specific rules: `frontend/AGENTS.md`
- Design rules for anything user-facing: `docs/design/README.md`, then `docs/design/design.md` and `docs/design/tokens.md`
- Reusable workflows: `.codex/skills/`
- Cross-checks: `.codex/agents/`
- Treat this guide, scoped `AGENTS.md` files, and `.codex/` skills as the current operational source of truth for agent work.
