# 10 — Developer Experience, CI, API Contracts, and Module Metadata

## 1. Objective

Strengthen engineering guardrails so the CRM evolution can proceed incrementally without increasing frontend/backend contract drift, migration risk, registry duplication, or permission/tenant regressions.

## 2. Why this exists

The roadmap touches shared UI primitives, record layouts, communication providers, events, pipelines, and relationship models. The safest improvements are not a framework rewrite; they are reliable checks, explicit contracts, and less duplicated module metadata.

## 3. Current behavior

Inspect:

- root/backend/frontend `AGENTS.md`;
- `scripts/codex-check.sh`;
- current GitHub Actions workflows;
- frontend API helpers/hooks;
- FastAPI OpenAPI generation;
- current TypeScript domain types;
- module registries/navigation/permissions/capabilities;
- `.codex/agents/` and `.codex/skills/`;
- migration tests/fixtures;
- Playwright configuration.

Do not add a new tool because it is fashionable if current tooling already solves the problem.

## 4. Desired behavior

```text
FastAPI domain endpoints
      ↓ OpenAPI
validated/generated TS contract layer
      ↓
frontend hooks/domain adapters
```

And:

```text
Module declaration
  ├─ key/label/route
  ├─ permissions/capabilities
  ├─ field/layout support
  ├─ saved-view support
  ├─ activity/workspace support
  └─ navigation metadata
        ↓
derived registries where practical
```

The module declaration does not replace backend domain models/APIs.

## 5. Existing code to inspect

Inventory every place a module must currently be manually registered. Identify duplicates before proposing consolidation. Inventory handwritten frontend response/request types that can drift from OpenAPI, especially in roadmap-critical APIs.

## 6. Architecture

Use explicit domain contracts plus generated schema types where useful. Keep business-friendly frontend adapters/hooks rather than scattering raw generated client calls across UI components.

Generated code should be reproducible and either committed according to repository policy or generated in CI/build with clear versioning. Choose one approach and document it.

## 7. Backend changes — phased

### Phase 1 — immediate safety guardrails (Wave 0)

Without broad refactoring:

- verify clean migration to head in CI/check script;
- verify upgrade from a representative prior supported schema if infrastructure exists/can be added safely;
- ensure backend compile/lint/tests required by `AGENTS.md` are consistently run;
- add focused tenant-isolation/permission regression suites for shared platform APIs touched by the roadmap;
- ensure OpenAPI generation fails on invalid schema/contracts.

### Phase 2 — OpenAPI contract generation pilot

Evaluate current frontend patterns and select a minimal tool such as `openapi-typescript` or Orval only after confirming compatibility.

Pilot on a bounded API family (for example layout runtime/admin APIs) and define:

- generation command;
- deterministic output;
- CI drift check;
- adapter/hook convention;
- error typing boundary.

Do not migrate the entire frontend in the pilot.

### Phase 3 — roadmap API adoption

Use generated types/contracts for new Activity, pipeline, WhatsApp capability, webhook, and layout APIs where it reduces duplication. Keep domain-friendly wrapper hooks.

### Phase 4 — module metadata inventory/consolidation

After the UX/workspace foundations stabilize:

- map current registries;
- define one canonical module metadata contract for stable cross-cutting properties;
- derive navigation/capability/view/workspace registrations where safe;
- leave domain-specific behavior in its module.

Do not create a “god registry” containing every business rule.

## 8. Database changes

No schema change is required for CI/API generation itself. Module metadata schema changes, if any, require an explicit migration and should reuse current Module/TenantModuleConfig/platform concepts rather than duplicating them.

## 9. API contracts

Rules for roadmap APIs:

- explicit request/response Pydantic models;
- no accidental ORM serialization;
- documented pagination/cursors;
- stable identifiers separate from display labels;
- structured errors where frontend needs field/provider resolution;
- provider secrets never in client contracts;
- OpenAPI reflects actual permission-neutral schema, while runtime authorization remains server-side.

## 10. Frontend changes — phased

### Phase 1 — CI/check parity

Ensure local documented checks and CI agree enough that Codex can reproduce failures.

### Phase 2 — generated contract boundary

Place generated code in a clearly named directory and wrap it with existing `apiFetch`/auth-refresh behavior unless the selected generator can integrate without regressing retries/auth/idempotency fixes.

Do not let codegen silently reintroduce unsafe automatic retries for write operations.

### Phase 3 — module metadata consumers

Refactor one consumer family at a time (for example navigation, then saved-view definitions) to derive from canonical metadata, with tests proving existing enabled/permission behavior.

## 11. Permission model

Contract generation never replaces authorization tests. Module metadata may describe required actions/capabilities, but backend permission helpers remain authoritative.

CI should include targeted tests that call APIs directly without relying on UI hiding.

## 12. Tenant-isolation requirements

Shared infrastructure changes require regression tests across at least two tenants for new layout/activity/pipeline/integration APIs. Test helpers should make multi-tenant fixture creation easy rather than repeating setup ad hoc.

## 13. Background jobs/events

CI should cover importability/configuration of Celery tasks touched by provider/event work. Provider job unit tests should not require live external services; use adapters/fakes at the domain boundary.

## 14. Error/loading/empty states

For generated contracts/build tooling:

- generator failure is a build/CI failure with actionable output;
- API spec drift fails deterministically;
- missing generated artifacts have documented repair command;
- module metadata validation fails startup/build/tests rather than producing broken navigation at runtime when feasible.

## 15. Migration/backward compatibility

Introduce codegen as an additive contract layer. Do not replace all handwritten types in one PR. Keep existing hooks while adopting generated primitives underneath them.

Module metadata consolidation is similarly incremental: derive one registry at a time and delete old duplication only when all consumers have migrated.

## 16. Tests / CI gates

### Backend baseline

- syntax/compile;
- unit/service/API tests;
- clean Alembic upgrade;
- migration state check;
- focused tenant-isolation tests;
- focused permission tests;
- OpenAPI generation.

### Frontend baseline

- lint;
- TypeScript/build;
- component/domain tests where present;
- generated-contract drift check;
- Playwright smoke suite for critical roadmap workflows.

Full browser suite can remain separate from fastest PR gates if runtime/flakiness requires, but critical smoke paths should remain gating.

## 17. Acceptance criteria

- Codex can reproduce documented checks locally through repository-supported commands.
- New roadmap APIs have low contract drift between Pydantic/OpenAPI and TypeScript.
- Generated contracts do not bypass current auth/API helper behavior.
- Migration, tenant, and permission regressions are caught earlier.
- Module metadata duplication is reduced incrementally without turning the system into generic CRUD.

## 18. Out of scope

- replacing FastAPI with another framework;
- generic CRUD generation for all modules;
- replacing SQLAlchemy models with metadata;
- one-shot frontend API rewrite;
- module metadata that stores arbitrary executable business logic;
- adding many dependencies without measured benefit.

## 19. Risks

- codegen fighting existing `apiFetch` auth/retry behavior;
- noisy generated diffs;
- CI becoming too slow to use;
- over-centralized module registry;
- false confidence that types equal authorization;
- migration checks depending on fragile external state.

## 20. Codex implementation instructions

Implement Phase 1 first and keep it small. Inspect current scripts/workflows before changing them. For codegen, run a bounded pilot and document the generated-code lifecycle before broader adoption. For module metadata, inventory duplication first and migrate consumer families sequentially. Never combine a CI overhaul, API client rewrite, and module registry rewrite in one phase/PR.
