# CRM evolution — where the waves stand

The handover for `CODEX-RUNBOOK.md`: a new session reads this instead of reconstructing
progress from the code. Update it at the end of every wave run, including partial ones.

Last updated 2026-09-29.

| Wave | State | Evidence |
|---|---|---|
| 0A–0D | Done | Lead journey baseline, `QuickCreateSurface`, `record_layouts.py` resolver, generated contracts in `frontend/contracts/` |
| 1A–1B | Done | `LeadQuickCreate`, `RecordLayoutPreview` |
| 1C–1F | Done | `RecordWorkspace`, `record_activity.py`, `mail_associations.py`, `RecordEmailComposer` |
| 2A | Done | Contact and Organization Quick Create, contextual Account → Contact / Deal |
| 2B–2C | Done | `sales_opportunity_contacts`, `opportunity_participants_routes.py` |
| 2D | Done | Opportunity Quick Create (rebuild 5.4 A3); participant display and management |
| **2E** | **Backend Phases 1–4 and frontend Phases 1–3 done; view persistence and the guard walk left — see below** | `sales_pipelines`, `pipelines_services.py`, `GET /sales/opportunities/pipeline`, `sales_opportunities.pipeline_stage_id`, `useOpportunityPipeline`, `OpportunityStageSelect`; inventory in `04a-stage-inventory.md` |
| 3A onward | Not started | |

## Wave 2E — frontend Phase 3: the Kanban, audited (2026-09-29)

The board predates this wave (rebuild 5.7: `OpportunitiesPipelineBoard` on the shared
`Board`). Checked against 04 §10 Phase 3:

| Requirement | State |
|---|---|
| Same saved-view filters as List | ✔ by construction: one `useOpportunities` query and one filter set; the board is a `?display=` of the same list |
| Columns from active pipeline stages | ✔ since frontend Phase 1. An inactive stage is a column only while occupied, and never a move target |
| Cards show key fields | Partly: name, account/client, owner, close date, value, overdue. Fixed, not configurable. Left as is |
| Drag/drop, optimistic | ✔ `stageMutation.onMutate` moves the card and its `pipeline_stage` |
| Backend validates, rejected move rolls back with a clear message | Rollback ✔. **Fixed:** the toast was generic; it now carries the server's reason ("Deal stage was not changed: Pipeline stage is inactive.") |
| Keyboard alternative | ✔ each card's "Change stage for …" select |
| **Fixed:** the stage was fetched only when the Stage column was visible | In board mode the list query always adds `sales_stage`, otherwise every card fell into Unstaged |

The board shows the loaded page of deals, not every deal ("Showing loaded records x–y of N").
Per-column totals are in the stat row above it. Not changed.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. New
`opportunities-board.spec.ts` passes 3 of 3 (pipeline columns with an occupied inactive column
and no move into it, `fields` includes `sales_stage`, a keyboard move saves, a refused move
rolls back with its reason). `opportunities-revamp.spec.ts` passes 3 of 3.

**Next:** Wave 2E frontend Phase 4. A saved view remembers List/Board: persist the display in
the saved-view config (backend saved views store arbitrary config? check `useSavedViews` /
`SavedViewConfig`), keep `?display=` as the address, and apply a view's display when it is
selected. Then the full rendered design-guard walk, which closes Wave 2E.

## Wave 2E — Phase 4: the legacy constraint goes, tenants can add stages (2026-09-29)

- `20260819_drop_stage_check` drops `ck_sales_opportunities_sales_stage`. A stage is valid
  when the deal's own tenant's pipeline has it (`assign_opportunity_stage`). The downgrade
  refuses while any deal holds a non-legacy key, then restores the check. `sales_stage`
  stays as the mirrored stable key, because filters, search and export read it. The stage
  PATCH schema's fixed-list `pattern` is gone as well; an unknown key is a 400 from the service.
- `POST /sales/opportunities/pipeline/stages` (`configure`, audited): `label`, optional `key`,
  `semantic_type` (default `ongoing`), and optional `probability` (defaults by outcome: 10 / 50 /
  100 / 0). A derived key is slugged from the name and gets `_2`, `_3`… while taken; `unstaged`
  is reserved, and a key must start with a letter. An explicit key must be free and
  well-formed. A non-outcome stage is inserted before the first won/lost stage; an outcome goes
  last. A stage is never deleted, only deactivated.
- Settings page: `AddPipelineStage` has name, outcome and an explicit **Add stage** button. It
  is a create, so it does not autosave (R1). A refusal (duplicate name) shows under the form and
  keeps the typed name.

Verification: `test_pipeline_add_stage.py` 11 of 11. The full backend suite passes 1105 of 1105
with Redis up. `verify_migrations` passes at `20260819_drop_stage_check`, and `verify_openapi`
passes (362 paths). On a throwaway PostgreSQL database: a custom key is accepted at head, a
downgrade with it is refused, and after moving the deal back the downgrade restores the check
(a `CheckViolation` proves it), then re-upgrades. Frontend lint and build are clean;
`check-design.sh` passes 21 of 21; `pipeline-settings.spec.ts` passes 6 of 6.

## Wave 2E — frontend Phase 2: the pipeline settings screen (2026-09-29)

`/dashboard/settings/pipeline` ("Deal pipeline", Customization group; `SETTINGS_ROUTES.pipeline`).
It is archetype 4: one `FormSection` holding a `SortableList` of `PipelineStageRow`s.

- Each row is one stage: name (commits on blur or Enter), outcome (`Open` / `In progress` /
  `Won` / `Lost`), probability %, `Active`/`Inactive` (`SegmentedBoolean`), and move up/down.
  Each change autosaves (R1) through `useAutosave`, and the row's `SaveStateIndicator`
  reports it. A server refusal, such as a duplicate name or the last active open stage, shows
  its own reason under the row and marks the field invalid. The stable key and the live deal
  count are shown under the name.
- Deactivating a stage that holds deals asks first and names the count. The deals stay put.
- Reorder: the move buttons are the contract, and drag is an enhancement (the `SortableList`
  primitive). The order is applied optimistically and rolled back on failure, with its own
  indicator in the section header. The list is **not** disabled while saving: a disabled list
  drops its move buttons, and focus went with them. A move made during a save is ignored.
- A save writes the server's pipeline into the `sales-opportunity-pipeline` cache and
  invalidates usage, deal lists, totals and the deal summary, so labels change everywhere.
- The route was added to the design-rules and scroll-containers route lists and to the census.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21.
`pipeline-settings.spec.ts` passes 5 of 5: rename and Saved, a refused name in place, reorder
with focus kept, deactivate with the count and a working Cancel, and the permission wall. A
theme probe gave dark body `rgb(11, 13, 16)` and light `rgb(247, 248, 250)`; at 390px there is
no horizontal overflow and the row wraps. **Not run:** the full rendered design-guard walk,
which has no route filter. It is owed once at the end of Wave 2E.

## Wave 2E — pipeline settings API (2026-09-29)

The backend half of 04 frontend Phase 2, on a new `pipelines_routes.py` mounted before the
opportunities router. Every route needs Opportunities `configure` on top of module and
department access, so a salesperson can move deals but not redefine stages.

- `PATCH /sales/opportunities/pipeline/stages/{id}` changes `label`, `semantic_type`,
  `probability` or `is_active`. The stable `key` is not in the contract. Names are unique per
  pipeline, case-insensitively, and at most 80 characters. The pipeline must keep at least one
  active stage that is not won or lost, so a deactivation or reclassification that removes the
  last one is refused. Deactivation keeps its deals where they are and refuses only new
  assignments.
- `PUT /sales/opportunities/pipeline/stage-order` takes the full list of stage ids. An
  incomplete, duplicated or foreign list is a 409 ("reload and try again"), so a stale client
  cannot misplace a stage it never saw.
- `GET /sales/opportunities/pipeline/stage-usage` returns live deals per stage in the caller's
  tenant, for the UI's impact warnings.
- Every change writes one `ActivityLog` row (`entity_type=sales_pipeline`,
  `action=configure`) with the before and after pipeline. A stage from another tenant is a 404.
- Not built: adding a stage (blocked on the legacy check constraint) and deleting one (never,
  by design).

Verification: `test_pipeline_settings.py` 12 of 12. The full backend suite passes 1094 of 1094
with Redis up. `verify_openapi` passes (361 paths). No migration.

## Wave 2E — frontend Phase 1: configurable selectors (2026-09-29)

The client no longer lists stages. Options, order, labels and outcome come from
`GET /sales/opportunities/pipeline` (`hooks/sales/useOpportunityPipeline.ts`, with a 5-minute
stale time), and a deal's own stage from its `pipeline_stage`.

- `opportunityStages.ts` is now helpers only: `stageTone` (won → success, lost → critical,
  everything else neutral, per R5), `resolveStage`, `selectableStages` (active stages, plus
  the current one if it was deactivated), and `defaultStageKey` (the first active stage that
  is not an outcome). `OPPORTUNITY_STAGE_ORDER`/`LABELS`, the `statusStyles.ts` stage map and
  `scripts/check-opportunity-stages.py` are deleted.
- `OpportunityStageSelect` is the one picker. The full form, Quick Create and Lead conversion
  use it; conversion offers only stages past the entry stage and starts at the first `ongoing`
  one. An empty value displays the pipeline default, and `buildOpportunityPayload` submits that
  same default, so what is shown is what is saved. Conversion's dirty-check baseline moved from
  `"qualified"` to `""` with it; missing that made an untouched conversion prompt on Cancel.
- Deal record page: the spine track is the tenant's stages minus `lost` ones, the inline Stage
  options come from the pipeline, and the header status comes from `pipeline_stage`. A stage
  change writes the saved record back, so the label is never stale. An unstaged deal now shows
  "Unstaged" instead of pretending to be at Lead.
- Table status and overdue, the board's columns (inactive columns only while occupied, and they
  accept no cards), the list's loading stat tiles, the Stage saved-view filter options (by
  stable key, inactive stages marked), related-deal labels on Contact/Account, the linked-record
  picker, and the dashboard funnel (which drops `lost` by meaning; the backend dashboard rows now
  carry `semantic_type`).
- `opportunities-revamp.spec.ts` "pipeline totals … retry": the spec was at fault.
  `getByText("Lead")` also matched real deals in the table. It is now scoped to the stat tile.
- `lib/moduleViewConfigs.ts` keeps its static Stage options as the fallback for any caller that
  does not have the pipeline. The list page overrides them.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. Backend
`test_pipeline_business_logic`, forecasting and API-route tests pass 80 of 80.
`opportunities-revamp.spec.ts` plus `opportunity-participants.spec.ts` pass 8 of 8, including
the retry test. `leads-revamp.spec.ts` plus `contact-organization-rollout.spec.ts` pass 22 of 22 (the first
run failed 1, the dirty-baseline bug above, now fixed). Not checked: the rendered design guards,
and a both-theme pass. No styling changed; only where the labels and options come from.

## Wave 2E — pipeline Phase 3: dependent business logic (2026-09-29)

Every backend `3` row of `04a-stage-inventory.md` is migrated. The file's closing section
records how.

- **Meaning comes from the stage row.** `OpportunityStageFacts` (key, label, semantic type,
  probability, position) per deal, plus null-safe SQL clauses for closed and won. The stale
  deal scan, the stage PATCH's `close` audit action, the forecast (won, lost, open counts,
  weights, bucket labels), the CRM dashboard (won/lost counts, open pipeline value, stage
  buckets) and the owner scorecard's won count all read `semantic_type`/`probability`.
  Seeded values equal the old hardcoded ones, so untouched tenants see the same numbers.
  Visible differences: bucket labels are now sentence case, and the dashboard's no-stage
  bucket is `unstaged` / "Unstaged" instead of `__empty__`.
- **Pipeline summary** (`GET /pipeline-summary`): columns come from the tenant's pipeline in
  position order. An inactive stage appears only while deals sit in it, then Unstaged. Rows
  are keyed by stage row and carry `stage_id`, `semantic_type`, `probability` and `is_active`.
- **Events.** `opportunity.stage_changed` now carries `sales_stage`, `stage_id`,
  `stage_label`, `stage_semantic_type`, their `previous_` pair, and a `field_changes`
  entry. **Bug fixed:** the automation *Stage* condition reads `payload.sales_stage`, which the
  event never carried, so stage conditions could not match. `opportunity.won` /
  `opportunity.lost` were registered triggers that nothing emitted. They now fire on entering
  a won/lost semantic type, and not on moving between two stages of the same outcome. There is
  a new `Stage outcome` automation condition (`stage_semantic_type`). Neither new event is a
  Slack alert.
- **Display.** Global search, the recycle bin and the `{{opportunity.stage}}` mail variable
  show the stage label instead of the raw key.
- Nothing else in `backend/app` compares a legacy key. What remains are stable-key uses the
  spec allows: filters, search document, export, and automation option values.

Verification: `test_pipeline_business_logic.py` 14 of 14. Each test changes a stage's
meaning or label on the row and checks the behaviour follows the meaning. The full backend
suite passes 1082 of 1082 with Redis up. `verify_openapi` passes. No migration and no frontend
change.

## Wave 2E — pipeline Phase 2: Opportunity references (2026-09-29)

- `sales_opportunities.pipeline_id` / `pipeline_stage_id` (`20260818_opp_stage_refs`), with a
  partial index `(tenant_id, pipeline_stage_id) WHERE deleted_at IS NULL` for board columns
  and "stage in use" counts. The backfill resolves by key within the deal's own tenant's
  default pipeline and covers soft-deleted deals. A NULL `sales_stage` stays unstaged, with
  the pipeline still set. The upgrade aborts if any deal is left unresolved.
- Both columns stay **nullable** during compatibility: NULL pipeline = tenant default, NULL
  stage = unstaged. Making `pipeline_id` required belongs with Phase 4.
- `pipelines_services.assign_opportunity_stage` is the only writer of `sales_stage`,
  `pipeline_id` and `pipeline_stage_id`. Create, update (and so CSV import), the stage PATCH
  and Lead conversion all go through it. A caller may send the legacy key, the stage id, or
  both, and both must agree. A stage from another tenant gets the same 400 as a missing one.
  An inactive stage or pipeline cannot be newly assigned, but a deal already in one may stay.
  An unknown key is now a 400 rather than a check-constraint error. Lead conversion resolves
  its stage before writing anything.
- API: `pipeline_stage_id` is accepted on create/update/stage PATCH. Responses add
  `pipeline_id`, `pipeline_stage_id` and `pipeline_stage` (`key`, `label`, `semantic_type`,
  `probability`, `is_active`). List items include them only when the Stage column is visible.
  A tenant that disabled Stage cannot write it through `pipeline_stage_id` either. Every
  existing field keeps its meaning, so current clients are unaffected.
- **The legacy check constraint still limits stage keys to the six seeded ones.** Adding a
  stage (the frontend Phase 2 settings UI) therefore needs Phase 4's constraint drop, or a
  bounded relaxation of it, first. Renaming, reordering, re-weighting and deactivating
  stages do not.

Verification: `test_opportunity_stage_refs.py` 24 of 24 (backfill for every legacy stage
across two tenants and a soft-deleted deal, idempotency, the unresolved block, key/id
agreement, cross-tenant rejection, inactive handling, clearing, conversion, serialization,
field-config mapping). The two old `update_opportunity_stage` tests moved there onto a real
session. The full backend suite passes 1068 of 1068 with Redis up. `verify_migrations` passes
at `20260818_opp_stage_refs`, and `verify_openapi` passes. On a throwaway PostgreSQL database,
a populated upgrade matched 14 of 14 deals and a real `alembic downgrade` to
`20260816_opp_participants` removed both tables and columns before re-upgrading cleanly.
No frontend change.

## Wave 2E — pipeline Phase 1: models and compatibility resolver (2026-09-29)

Backend Phase 1 of `04-pipelines-kanban.md`. `sales_opportunities.sales_stage` is untouched;
no Opportunity references a stage row yet.

- **Inventory first.** `04a-stage-inventory.md` lists every place that compares, validates,
  groups or displays a legacy stage key, backend and frontend, each tagged with the 04 phase
  that migrates it. Phase 4 may not drop `ck_sales_opportunities_sales_stage` while a row is
  unticked.
- `sales_pipelines` / `sales_pipeline_stages` (`20260817_sales_pipelines`). A stage has a
  stable `key`, an editable `label`, `position`, `semantic_type`
  (`open | ongoing | won | lost`; `open` = entry, `ongoing` = active pursuit, both not-closed),
  `probability`, `is_active`. There is one default pipeline per tenant and module, enforced
  by a partial unique index, and a default must be active (a check constraint). `module_key`
  is constrained to `sales_opportunities`: pipelines are sales-domain, not generic metadata.
- The migration seeds a default pipeline for **every** tenant from the legacy catalog, using
  the same keys, the report's forecast weights as probabilities, and sentence-case labels.
  It then asserts that no stored `sales_stage` is orphaned.
- `pipelines_services.ensure_default_opportunity_pipeline` seeds tenants created later on
  first use (it flushes and does not commit; a losing concurrent seed reads the winner).
  `resolve_legacy_opportunity_stage` maps a stored value to its row **by key**, never label.
  Inactive stages still resolve, so history stays readable. The bootstrap seed calls ensure.
- `GET /sales/opportunities/pipeline` (Opportunity `view`) returns the resolved default with
  every stage, including `semantic_type` and `is_closed`, so clients never infer from labels.
- The backend label catalog is now sentence case (`Closed won`), matching the frontend
  mirror; `scripts/check-opportunity-stages.py` passes again (it was failing at HEAD). The
  pipeline-summary endpoint's labels change case accordingly.
- Tenant backups now export `sales_pipelines.json` / `sales_pipeline_stages.json` with
  Opportunities. Restore does not read them yet, same as `sales_opportunity_contacts.json`.
- `FORECAST_STAGE_PROBABILITIES` now derives from the catalog; the values are unchanged
  (pinned by a test).

Verification: `test_sales_pipelines.py` 21 of 21, which covers the populated backfill with
every legacy stage, idempotency, the orphan block, default uniqueness, inactive-default
rejection, the concurrent-seed loss, key-not-label resolution, inactive-stage history,
tenant isolation, and the route's permission and ordering. The full backend suite passes,
1046 of 1046: 4 rate-limit tests need Redis and were re-run with it. `verify_migrations` passes at
`20260817_sales_pipelines`, and `verify_openapi` passes for 358 paths. A populated upgrade on a
throwaway PostgreSQL database seeded 6 stages for each of three tenants and rejected a second
default. Not run: the contract drift check (layout family untouched), frontend lint/build (no
frontend change), and a real `alembic downgrade`.

## Wave 2D — participant management (2026-09-29)

Frontend Phase 2 of `05-relationships-data-model.md`, on the Phase 2 APIs that were already
in place. Phase 1 (display) and Opportunity Quick Create had landed earlier.

- `components/opportunities/OpportunityParticipants.tsx` — the `Participants` panel on the
  deal's `Related records` tab: add (contact picker, role, primary), change role, make
  primary, remove with a confirmation and an Undo that calls the restore route. A contact
  not yet in the CRM is created in place through Contact Quick Create with the deal's
  account filled in, and the add panel reopens with that contact selected.
- Placement follows design.md §4.7: a participant is a row pointing at the deal, so it is
  managed in the content region, not the spine. The spine's `Participants` count is now
  drawn at zero too, because the tab it opens is where people are added.
- Permissions mirror the routes: add, change role and make primary need deal `edit`;
  removal needs `delete`; Undo needs `restore`. The whole panel needs Contacts `view`
  (`can_view_contacts`). The server enforces all of it independently.
- No backend change, no migration, no contract change.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21;
`opportunity-participants.spec.ts` passes 5 of 5; the panel was checked in both themes
(body `rgb(11, 13, 16)` / `rgb(247, 248, 250)`). `opportunities-revamp.spec.ts` fails 3 of 3
at the default 30s both with and without this change (a stashed-HEAD baseline). At 90s it
fails only `pipeline totals … retry` on the list page, which this change does not touch.

Left open: see *Deferred* below.

## Deferred — not built, and when to build it

Each row is deliberately unbuilt. The trigger column says when it is due. Check this table at
the start of every wave, and build a row in the wave its trigger names, not earlier.

| Item | Why it waits | Build it when |
|---|---|---|
| Contextual email recipient selection from deal participants (05 frontend Phase 3) | Needs the Opportunity email rollout to consume it | **Wave 3A, Opportunity run** — explicit candidates, deliberate selection when more than one |
| Broader relationship rail on Contact/Account: related deals, quotes, orders, tasks, documents with permission-aware counts (05 frontend Phase 4) | Depends on relationship summaries (05 backend Phase 4), which is unbuilt | After 2E, as its own slice, backend Phase 4 first |
| Participants propagated through Lead conversion and Quote/Order creation (05 backend Phase 3) | A downstream behaviour change; out of 2D's scope | Its own slice after 2E, before 3A's Opportunity run |
| A view of removed participants (`/participants/recycle` has no UI) | Undo covers the immediate case | When an operator needs to restore a participant after the Undo toast is gone, or with a shared record-level recycle view |
| Catalog ↔ quote/order line items (`catalog_product_id` / `catalog_service_id`) | Filed by rebuild 5.3 as its own slice | A standalone slice; not tied to a wave |
| Custom-module EAV filtering over `custom_module_record_values` (rebuild Appendix B.2) | A backend query-parameter contract | A standalone slice; the toolbar already stopped claiming the filter works |
| `RequiredMark` not announced to screen readers (about 54 of 68 uses) | A primitive decision for the owner: a `Field` context, or the mark taking its control's id | When the owner picks the approach; then fix in the primitive, not at each call site |
| `opportunities-revamp.spec.ts` "pipeline totals … retry" fails (inherited, reproduces at HEAD) | Not caused by 2D; unread beyond attribution | 2E frontend Phase 1, the first 2E slice that touches the list page |
| Automation *Stage* condition options are the six seeded keys (`automation_registry.py`), so a tenant-added stage cannot be picked there | The registry is static per module; making one field's options tenant-dynamic is a registry contract change | When automation conditions gain tenant-resolved options; until then *Stage outcome* (semantic type) covers "a deal was won/lost" |
| Tenant restore of pipeline configuration and stage ids | Backups export pipelines, stages and each deal's stage ids; restore reads no sales files yet | When tenant restore gains sales-module restore: stage ids must be remapped, not copied |
