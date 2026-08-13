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
- run `./scripts/generate-contracts.sh --check` when a touched API family has generated contracts in `frontend/contracts/`
- smoke-check affected pages, dialogs, tables, and detail pages
- check for console/runtime warnings
- confirm required markers and validation still match backend rules

## Design

When UI changed — new screens, restyles, or anything touching colour, type, spacing, radius, or a shared primitive:

- run `./scripts/check-design.sh` (source-level rules from `docs/design/design.md`; also runs inside `./scripts/codex-check.sh`)
- run the rendered guards, which walk every route in a browser:
  `docker compose run --rm frontend-e2e npm run test:e2e -- design-rules.spec.ts scroll-containers.spec.ts --workers=1`
- seed first so detail routes are reachable:
  `docker compose exec -T backend python -m scripts.seed_demo_crm --tenant-slug default` and
  `docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default`
- open the screen in **dark and light**; nothing may be invisible or change identity between them
- walk the ship checklist in `docs/design/design.md` §10: tokens not raw colour, primitives not page-local copies, all four interactive states and all four data views, keyboard focus visible at every stop, contrast measured against §8, density matching neighbouring screens, and no structural change to screens the task did not name

A failing guard means the code is wrong, not the guard. Widen a guard only with a named reason recorded in the exemption.

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
