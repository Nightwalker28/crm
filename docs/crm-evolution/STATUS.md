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
| **2E** | **Backend Phases 1–3 of 4 done — see below** | `sales_pipelines`, `pipelines_services.py`, `GET /sales/opportunities/pipeline`, `sales_opportunities.pipeline_stage_id`; inventory in `04a-stage-inventory.md` |
| 3A onward | Not started | |

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

**Next:** Wave 2E frontend Phase 1, the configurable selectors. Forms, Quick Create, Lead
conversion, the deal header track, table/status styling and saved-view filter options should
read `GET /sales/opportunities/pipeline` and the `pipeline_stage` on each deal, not
`opportunityStages.ts` or `statusStyles.ts` keys; tone comes from `semantic_type`. Work from the
frontend rows of `04a-stage-inventory.md`. The inherited `opportunities-revamp.spec.ts`
"pipeline totals … retry" failure is due in this slice. Then frontend Phase 2 (settings UI;
adding a stage needs the legacy check constraint relaxed first) and Phase 3 (Kanban).

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
| Tenant restore of pipeline configuration and stage ids | Backups export pipelines, stages and each deal's stage ids; restore reads no sales files yet | When tenant restore gains sales-module restore: stage ids must be remapped, not copied |
