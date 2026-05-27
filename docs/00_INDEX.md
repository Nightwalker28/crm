# CRM Codex Task Pack v3

This task pack is based on the CRM repository audit and excludes the items you asked to defer.

## Removed from this pack

- AI/copilot/LLM/provider/prompt/usage-log work
- Telephony, phone providers, dialers, call logs, and call recording
- Sandbox/demo environment tooling
- Campaign tracking
- Public lead-capture/web-form modules

## Recommended execution order

1. `01_phase_1_core_revenue_acceleration.md`
2. `02_task_sales_lead_scoring_foundation.md`
3. `03_task_platform_automation_rules_core.md`
4. `04_task_sales_proposal_pdf_tracking.md`
5. `05_task_sales_quote_to_order.md`
6. `06_task_reports_forecasting.md`
7. `07_phase_2_scheduling_and_documents.md`
8. `08_task_calendar_booking_links.md`
9. `09_task_documents_versioning_templates.md`
10. `10_phase_3_service_and_platform.md`
11. `11_task_support_cases_module.md`
12. `12_task_realtime_notifications_and_jobs.md`
13. `13_task_contracts_esign_lifecycle.md`
14. `14_task_integrations_registry.md`
15. `15_cross_cutting_refactors.md`

## What each file will accomplish

| File | What it will accomplish | What it will change |
|---|---|---|
| `01_phase_1_core_revenue_acceleration.md` | Defines the first implementation phase. It groups the highest-value sales functionality: lead scoring, automation, proposal tracking, quote-to-order, and forecasting. | Planning only. Tells Codex which Phase 1 task files to run and what the combined end state should be. |
| `02_task_sales_lead_scoring_foundation.md` | Adds deterministic lead scoring so sales users can prioritize leads. Includes score factors, score history, API exposure, and UI display. | Sales backend models/schemas/services/routes, Alembic migration, lead list/detail UI, lead API hooks, backend tests. |
| `03_task_platform_automation_rules_core.md` | Adds the first version of workflow automation. CRM events can trigger rule actions such as task creation or status updates. | Platform backend automation models/services/routes, Celery processing, admin/settings UI, event hooks, tests. |
| `04_task_sales_proposal_pdf_tracking.md` | Adds a proposal lifecycle on top of quotes. Quotes can generate proposal documents, track send status, and record open/download events. | Sales quote services/routes/UI, proposal-related tables, document integration, quote detail UI, tests. |
| `05_task_sales_quote_to_order.md` | Adds order records and safe quote-to-order conversion. Accepted quotes can become sales orders without duplicate conversion. | Sales order models/schemas/routes/services, quote conversion endpoint, sales order list/detail UI, tests. |
| `06_task_reports_forecasting.md` | Adds weighted sales forecasting based on opportunities, probabilities, expected close dates, and pipeline stage defaults. | Reports backend services/routes, forecast schema if needed, dashboard/report widgets, tests. |
| `07_phase_2_scheduling_and_documents.md` | Defines the second implementation phase after removing campaigns and web-form capture. It now covers booking links and document readiness only. | Planning only. Tells Codex to implement booking links and document versioning/templates. |
| `08_task_calendar_booking_links.md` | Adds public meeting booking links with availability windows, intake questions, available slot calculation, and calendar event creation. | Calendar backend models/schemas/routes/services, public booking route/page, admin booking-link UI, tests. |
| `09_task_documents_versioning_templates.md` | Adds document version history and reusable document templates. | Documents backend models/schemas/routes/services, document detail version UI, template management UI, tests. |
| `10_phase_3_service_and_platform.md` | Defines the third implementation phase after removing sandbox tooling. It covers support cases, realtime updates, contracts, integrations, and cross-cutting hardening. | Planning only. Tells Codex which platform/service tasks to run and what the combined end state should be. |
| `11_task_support_cases_module.md` | Adds customer support/case management with assignment, status, priority, SLA fields, comments, and customer links. | New support backend module, router registration, case list/detail UI, permissions, tests. |
| `12_task_realtime_notifications_and_jobs.md` | Adds realtime notifications and background job status delivery using SSE or WebSocket with polling fallback. | Backend transport route/main app wiring, notification/job services, frontend notification hooks/components, tests. |
| `13_task_contracts_esign_lifecycle.md` | Adds contract lifecycle tracking and a provider-agnostic e-signature structure. Does not require a paid provider. | New contracts backend module, document/customer links, contract status UI, signer records, webhook-ready abstraction, tests. |
| `14_task_integrations_registry.md` | Adds a central integrations registry/settings screen so existing and future integrations are visible in one place. | Platform integrations models/routes/services, settings UI, provider/connection metadata, tests. |
| `15_cross_cutting_refactors.md` | Hardens shared app patterns so the new modules stay consistent and maintainable. | Permission policy helpers, activity logging helpers, CRM event publishing, module registration checks, cross-module tests. |

## Rules for Codex

- Work one task file at a time.
- Do not implement AI, copilot, prompt templates, LLM providers, embedding search, or AI usage logging.
- Do not implement telephony, phone providers, dialers, call logs, or call recording.
- Do not implement sandbox/demo environment tooling.
- Do not implement campaign tracking, marketing campaign dashboards, public lead-capture forms, or public form-submission endpoints.
- Follow the existing module-template pattern in `docs/module-template/README.md`.
- Add Alembic migrations for schema changes.
- Add backend tests for new services/routes.
- Add frontend smoke coverage or focused component tests where the repo already supports it.
- Keep all new features tenant-scoped and permission-gated.
