# 04a — Opportunity stage dependency inventory

The inventory `04-pipelines-kanban.md` §3 requires before any reader migrates. Taken
2026-09-29 at the start of Wave 2E, against `20260817_sales_pipelines`. Each row is a place
that compares, validates, groups, or displays `sales_opportunities.sales_stage` by its
legacy key. The **Phase** column is the 04 phase that migrates it. Tick rows off here as
they migrate; Phase 4 may not drop the legacy check constraint while any row is unticked.

The legacy catalog is `backend/app/modules/sales/opportunity_stages.py`
(`lead, qualified, proposal, negotiation, closed_won, closed_lost`, plus a display-only
`unstaged` bucket for NULL). The frontend mirror is
`frontend/components/opportunities/opportunityStages.ts`.
`scripts/check-opportunity-stages.py` checks that mirror for drift. It is not part of
`codex-check.sh`.

## Storage and validation

| Where | What it assumes | Phase |
|---|---|---|
| `sales/models.py` `ck_sales_opportunities_sales_stage` | DB check: value ∈ the six legacy keys | 4 (drop last) |
| `sales/models.py` `ix_sales_opportunities_tenant_stage_active` | index on the text column | 4 |
| `sales/schema.py` `SalesOpportunityStageUpdate` | `OPPORTUNITY_STAGE_PATTERN` regex | 2 |
| `sales/schema.py` `SalesOpportunityCreate/Update.sales_stage` | free `str`, relies on the DB check | 2 |
| `sales/services/opportunities_services.py` `update_opportunity_stage` | normalizes, checks `OPPORTUNITY_STAGE_SET` | 2 |
| `sales/services/opportunities_services.py` import (`sales_stage` column) | CSV text passes through to the DB check | 3 |
| `sales/services/leads_services.py` `_validate_conversion_deal_stage` | conversion stage ∈ `OPPORTUNITY_STAGE_SET` | 2 |
| `sales/schema.py` `LeadConvert.deal_stage` default `"qualified"` | a legacy key as a default | 2 |

## Business logic by closed/won/lost

| Where | What it assumes | Phase |
|---|---|---|
| `sales/routes/opportunities_routes.py` stage PATCH | `action = "close"` when key ∈ `OPPORTUNITY_CLOSED_STAGE_SET` | 3 |
| `sales/services/reminder_scans.py` | stale-deal scan skips `OPPORTUNITY_CLOSED_STAGE_SET` | 3 |
| `platform/services/module_reports.py` forecast | `FORECAST_STAGE_PROBABILITIES` by key; `closed_won`/`closed_lost` special-cased | 3 |
| `platform/services/module_reports.py` CRM dashboard `deal_stages` | groups by raw key, excludes `closed_*` from open value, counts won/lost by key | 3 |
| `platform/services/module_reports.py` owner scorecard | `sales_stage == "closed_won"` | 3 |
| `platform/services/module_reports.py` `ReportField("sales_stage")` | report dimension on the text column | 3 |

## Grouping, filtering, search, export

| Where | What it assumes | Phase |
|---|---|---|
| `sales/repositories/opportunities_repository.py` sort/filter maps, `summarize_pipeline` | text column, grouped by raw value | 3 |
| `sales/services/opportunities_services.py` `summarize_opportunity_pipeline` | buckets in `OPPORTUNITY_STAGE_ORDER` + `unstaged`, labels from the catalog | 3 |
| `sales/services/opportunities_services.py` export row | raw key written to CSV | 3 |
| `sales/routes/opportunities_routes.py` import header aliases | `stage`, `pipeline stage`, `sales stage` → `sales_stage` | 3 |
| `platform/services/global_search.py` | raw key in the subtitle | 3 |
| `platform/services/recycle_bin.py` | raw key as a fallback subtitle | 3 |
| `mail/services/mail_services.py` template variables | raw key as `{{opportunity.stage}}` | 3 |

## Automation and events

| Where | What it assumes | Phase |
|---|---|---|
| `platform/services/automation_registry.py` condition `sales_stage` | select options are the six keys with labels | 3 |
| `platform/services/automation_registry.py` action `deal_stage` | options `qualified/proposal/negotiation` | 3 |
| `platform/services/automation_rules.py` convert action | defaults `deal_stage` to `"qualified"` | 3 |
| `platform/services/crm_events.py` / `opportunities_routes.py` `opportunity.stage_changed` | payload carries `previous_stage`/`stage` as raw keys, no semantic type | 3 |

## Layouts

| Where | What it assumes | Phase |
|---|---|---|
| `platform/services/record_layouts.py` `sales_stage` runtime field | a `select` field; options come from the client | 2 (frontend 1) |

## Frontend

| Where | What it assumes | Phase |
|---|---|---|
| `components/opportunities/opportunityStages.ts` | hardcoded order/labels mirror | frontend 1 |
| `lib/statusStyles.ts` `OPPORTUNITY_STAGE` | tone per key; `closed_won` success, `closed_lost` critical | frontend 1 (tone from `semantic_type`) |
| `components/opportunities/OpportunitiesPipelineBoard.tsx` | columns = legacy order + `unstaged`; overdue skips `closed_*` | frontend 3 (Kanban) |
| `components/opportunities/OpportunitiesTable.tsx` | overdue skips `closed_won`/`closed_lost` | frontend 1 |
| `app/dashboard/sales/opportunities/page.tsx` `EMPTY_STAGES` | hardcoded six stages for the empty summary | frontend 1 |
| `app/dashboard/sales/opportunities/[opportunityId]/page.tsx` `DEAL_TRACK_VALUES` | track is `lead…closed_won`; `closed_lost` is an exit | frontend 1 |
| `components/opportunities/OpportunityFormFields.tsx`, `OpportunityQuickCreateLayoutFields.tsx`, `opportunityMutation.ts` | options from the mirror; default `"lead"` | frontend 1 |
| `components/leads/LeadConversionForm.tsx` `DEAL_STAGES` | its own hardcoded option list | frontend 1 |
| `lib/moduleViewConfigs.ts` saved-view filter options | hardcoded six options | frontend 1 |
| `hooks/sales/useOpportunities.ts` stage PATCH | sends a legacy key | frontend 1 |
| `components/dashboard/DashboardCrmWidgets.tsx` funnel | drops `closed_lost` by key | frontend 1 |
| `app/dashboard/sales/contacts/[contactId]/page.tsx`, `organizations/[orgId]/page.tsx`, `components/crm/LinkedRecordPicker.tsx` | render the raw key | frontend 1 |
| `app/dashboard/reports/page.tsx` | `sales_stage` report dimension | frontend 1 |
