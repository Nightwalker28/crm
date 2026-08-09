# 04 — Configurable Pipelines and Kanban

## 1. Objective

Replace hardcoded opportunity-stage semantics with tenant-configurable pipelines/stages and make List/Kanban alternate presentations of the same saved-view/filter/query system.

## 2. Why this exists

Sales teams use different stage names and probabilities. Business logic should not depend on labels administrators need to customize. Kanban should not become a second filtering system disconnected from list views.

## 3. Current behavior

Inspect:

- Opportunity model/schema/service/routes;
- stage constants/enums/check constraints;
- `frontend/app/dashboard/sales/opportunities/*`;
- saved-view definitions/query helpers;
- reports/forecasting;
- automations/event conditions using stages;
- import/export;
- lead conversion/default opportunity creation.

Create an inventory of every comparison to current stage values before migrating.

## 4. Desired behavior

```text
Pipeline
- id
- tenant_id
- module_key
- name
- is_default
- is_active

PipelineStage
- id
- pipeline_id
- key              stable machine identity
- label            editable display label
- position
- semantic_type    open | ongoing | won | lost
- probability
- is_active
```

Business logic uses semantic type or stable key, never editable labels.

## 5. Existing code to inspect

Search current Opportunities, reports, dashboards, automations, imports, filters, scoring/forecasting, quotes/orders conversion, API docs, and frontend status styling. Identify hidden assumptions such as `closed_won`/`closed_lost` comparisons.

## 6. Architecture

Pipeline configuration is a sales-domain capability, not generic metadata. Keep explicit sales models/services and expose a resolved pipeline contract to list/forms/workspaces.

Saved view definition gains presentation mode, e.g.:

```text
presentation: list | kanban
kanban_group_by: pipeline_stage
```

Use the same resolved filters/search/sort permissions for both presentations.

## 7. Backend changes — phased

### Phase 1 — pipeline models and compatibility resolver

- add pipeline/stage models;
- seed current Opportunity stages into a default pipeline per tenant;
- add service resolving legacy stage value → stage record during compatibility period;
- enforce one active default pipeline per relevant tenant/module as product policy requires.

### Phase 2 — Opportunity references

- introduce pipeline/stage references on Opportunity;
- backfill all existing records;
- keep legacy API field compatibility if needed while clients migrate;
- update create/edit/convert behavior.

### Phase 3 — dependent business logic

Migrate:

- reports/forecasting;
- automations/events;
- filtering/search/export/import;
- validation;
- stage-change business actions;
- dashboard summaries.

### Phase 4 — remove obsolete legacy constraints

Only after all readers/writers are migrated and tests cover compatibility.

## 8. Database changes

Migration must:

1. create new tables/indexes/constraints;
2. seed per-tenant default pipeline/stages from existing semantics;
3. add nullable references;
4. backfill deterministically;
5. validate no orphan stage values;
6. make references required where domain requires;
7. defer dropping legacy columns/constraints until later migration.

Use stable keys unique within pipeline. Preserve historical inactive stages so old deals remain understandable.

## 9. API contracts

Expose:

- list/manage pipelines (configuration permission);
- ordered stages;
- resolved default pipeline;
- Opportunity pipeline/stage identity plus display metadata;
- stage transition/update endpoint or normal Opportunity update with explicit validation.

Do not require clients to infer semantic type from label.

## 10. Frontend changes — phased

### Phase 1 — configurable selectors

Forms/workspace use pipeline/stage APIs. Quick Create layout can include pipeline/stage fields.

### Phase 2 — pipeline settings UI

Admin can:

- rename/reorder stages;
- set semantic type/probability;
- add/deactivate stages;
- choose default pipeline;
- see impact warnings before deactivating a stage in use.

### Phase 3 — Kanban

- same saved view filters as List;
- columns from active pipeline stages;
- cards show configured key fields;
- drag/drop uses optimistic UI;
- backend validates move;
- rejected move rolls back with clear message;
- keyboard-accessible stage change alternative.

### Phase 4 — view persistence

Saved view can remember List/Kanban and allowed Kanban display preferences without duplicating filter definitions.

## 11. Permission model

Viewing a pipeline is part of viewing relevant sales records. Configuring pipelines requires configure/admin capability. Moving a card requires edit/stage-change permission and domain transition validation.

## 12. Tenant-isolation requirements

Pipeline/stage IDs must belong to same tenant as Opportunity. Reject cross-tenant pipeline/stage references and never expose another tenant’s configuration.

## 13. Background jobs/events

Stage changes should emit the existing CRM event pattern with stable identifiers and semantic type, e.g. opportunity stage changed from X to Y. Automations should be migrated to stable keys/IDs rather than labels.

## 14. Error/loading/empty states

- no pipeline config → seeded/default fallback;
- inactive stage on historical record → display but prevent invalid new assignment;
- Kanban column load failure;
- drag rejected/permission revoked;
- filtered view has no cards;
- stage deactivation blocked because records require reassignment.

## 15. Migration/backward compatibility

Do not perform a flag-day stage rename. Maintain compatibility until API/frontend/reports/automation/import/export are migrated. Document legacy field removal criteria.

## 16. Tests

- migration/backfill with every legacy stage;
- tenant isolation;
- default pipeline uniqueness;
- semantic business behavior won/lost;
- inactive stage behavior;
- reports/forecasting parity;
- automation stage conditions;
- saved-view List/Kanban parity;
- drag success/rollback;
- Playwright stage move.

## 17. Acceptance criteria

Tenant admins can configure stage labels/order/probabilities without breaking business semantics. Opportunity records reference stable stages. List and Kanban show the same filtered population. Drag/drop is permission-safe and rollback-capable.

## 18. Out of scope

- generic pipelines for every module in the first phase;
- arbitrary executable transition scripts;
- removing historical stage information;
- rewriting saved views from scratch.

## 19. Risks

- hidden hardcoded stage comparisons;
- report/automation regressions;
- bad backfills;
- treating labels as keys again;
- Kanban query divergence from List.

## 20. Codex implementation instructions

Begin by producing the full inventory of current stage dependencies. Land models/backfill/compatibility before UI management. Migrate one dependency family at a time and do not drop legacy constraints until repository-wide search and tests show they are unused.
