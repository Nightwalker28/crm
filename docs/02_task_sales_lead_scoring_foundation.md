# Task: Sales Lead Scoring Foundation

## Purpose

Add practical lead scoring so users can rank, filter, and act on high-value leads first.

## What this task will accomplish

- Add a numeric score to each lead.
- Store score explanations/factors.
- Recalculate score when a lead is created or updated.
- Show score in lead list and lead detail UI.
- Allow filtering/sorting leads by score.
- Add tests for scoring behavior.

## Backend files to inspect and modify

- `backend/app/modules/sales/models.py`
- `backend/app/modules/sales/schema.py`
- `backend/app/modules/sales/services/leads_services.py`
- `backend/app/modules/sales/routes/leads_routes.py`
- `backend/alembic/versions/*`
- `backend/tests/*lead*` or create new lead scoring tests

## Frontend files to inspect and modify

- `frontend/hooks/sales/useLeads.ts`
- `frontend/components/leads/LeadsTable.tsx`
- `frontend/app/dashboard/sales/leads/page.tsx`
- `frontend/app/dashboard/sales/leads/[leadId]/page.tsx`
- Any lead form/detail components used by these pages

## Database changes

Create a migration for:

- `sales_lead_scores`
  - `id`
  - `tenant_id`
  - `lead_id`
  - `score`
  - `grade` nullable, for example `hot`, `warm`, `cold`
  - `factors_json`
  - `calculated_at`
  - `created_at`
  - `updated_at`

Optional but recommended:

- `sales_lead_score_events`
  - stores score changes over time
  - useful for audit/debugging

## Implementation notes

Use deterministic rules first. Do not add machine learning or AI.

Suggested default score factors:

- Has email: +10
- Has phone: +10
- Has organization/company: +10
- Has estimated value/budget: +20
- Has source/campaign attribution: +10
- Recent follow-up or activity: +10
- Converted/disqualified leads should not rank as active hot leads

## API changes

Expose score data on:

- Lead list response
- Lead detail response
- Lead create/update response

Add filters if the existing list pattern supports them:

- `min_score`
- `max_score`
- `score_grade`
- sort by `score`

## UI changes

- Add a score column/badge in `LeadsTable`.
- Add score card to lead detail page.
- Show score factors in an expandable section.
- Add score filter/sort controls if table filtering supports it.

## Validation

- Creating a lead calculates a score.
- Updating relevant fields recalculates score.
- Lead list includes score.
- Lead detail includes score and factors.
- Score sort/filter works.
- Tests cover missing email/phone/company, high-quality lead, and disqualified lead.

## Do not implement

- AI scoring
- Predictive/ML scoring
- External enrichment providers
