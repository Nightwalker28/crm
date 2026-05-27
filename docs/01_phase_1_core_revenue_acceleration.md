# Phase 1: Core Revenue Acceleration

## Goal

Improve the sales workflow without changing the CRM’s core architecture. This phase adds prioritization, automation, proposal tracking, quote-to-order conversion, and forecasting.

## What this phase changes

- Leads become easier to prioritize through scoring.
- Repetitive CRM actions become automatable through configurable workflow rules.
- Quotes gain proposal-like behavior: generated documents, send state, and open/download tracking.
- Accepted quotes can be converted into orders.
- Reports and dashboards gain weighted forecast visibility.

## Included task files

1. `02_task_sales_lead_scoring_foundation.md`
2. `03_task_platform_automation_rules_core.md`
3. `04_task_sales_proposal_pdf_tracking.md`
4. `05_task_sales_quote_to_order.md`
5. `06_task_reports_forecasting.md`

## Excluded from this phase

- AI/copilot features
- Telephony/call-log features
- Full contract lifecycle
- Full support/case module

## Acceptance criteria for the whole phase

- Lead list/detail pages show usable score data.
- Admin users can create at least one automation rule that reacts to a CRM event.
- Quote detail pages show generated proposal/send/open history.
- Accepted quotes can be converted into order records.
- Forecast widgets appear in reports or dashboard views.
- All new tables are tenant-scoped and covered by migrations.
- New API routes are permission-gated.
