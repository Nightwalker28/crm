# Task: Reports Forecasting

## Purpose

Add weighted pipeline forecasting to reports and dashboard widgets.

## What this task will accomplish

- Calculate forecast totals from opportunities.
- Support weighted revenue using opportunity probability/stage probability.
- Store optional forecast snapshots.
- Display forecast metrics in reports/dashboard.

## Backend files to inspect and modify

- `backend/app/modules/platform/services/module_reports.py`
- `backend/app/modules/platform/routes/module_reports.py`
- `backend/app/modules/sales/routes/opportunities_routes.py`
- `backend/app/modules/sales/services/opportunities_services.py`
- `backend/app/modules/sales/models.py`
- `backend/app/modules/platform/models.py` if snapshots live in platform
- `backend/alembic/versions/*`
- Backend report/forecast tests

## Frontend files to inspect and modify

- `frontend/app/dashboard/reports/page.tsx`
- `frontend/app/dashboard/page.tsx`
- Dashboard widget components
- Reports hooks/API utilities

## Database changes

Create a migration for:

- `forecast_snapshots`
  - `id`
  - `tenant_id`
  - `period_start`
  - `period_end`
  - `owner_id` nullable
  - `team_id` nullable
  - `pipeline_key` nullable
  - `gross_pipeline_amount`
  - `weighted_pipeline_amount`
  - `commit_amount`
  - `best_case_amount`
  - `snapshot_json`
  - `created_at`

## Forecast calculation

Implement a deterministic calculation:

- Sum open opportunities by expected close date.
- Use explicit opportunity probability when available.
- Fall back to stage probability mapping when probability is missing.
- Exclude closed-lost opportunities.
- Count closed-won separately as actual revenue for the period.

## API changes

Add or extend report endpoints for:

- forecast summary
- forecast by owner/team
- forecast by stage
- forecast period filter

## UI changes

- Add forecast cards to reports page.
- Add dashboard widget for weighted forecast.
- Add filter for period/owner/team if existing report filters allow it.

## Validation

- Weighted forecast matches known fixture data.
- Closed-lost is excluded.
- Closed-won appears as actual revenue.
- Dashboard/report UI renders empty and populated states.
- Snapshot creation does not block normal reporting.
