# Task: Support Cases Module

## Purpose

Add customer service case/ticket management so the CRM supports post-sale customer operations.

## What this task will accomplish

- Add first-class support cases.
- Add case comments/events.
- Add assignment, priority, status, and SLA fields.
- Link cases to contacts, organizations, opportunities, quotes, or orders.
- Add support list/detail UI.
- Add saved-view/table support if the repo pattern requires it.

## Backend files to create or modify

- Create `backend/app/modules/support/__init__.py`
- Create `backend/app/modules/support/models.py`
- Create `backend/app/modules/support/schema.py`
- Create `backend/app/modules/support/services/cases_services.py`
- Create `backend/app/modules/support/routes/cases_routes.py`
- Create `backend/app/modules/support/routes/router.py` if module routing pattern uses one
- Update `backend/app/api/v1/router.py`
- Update seed/module registration if required
- Create Alembic migration
- Create backend tests

## Frontend files to create or modify

- Create `frontend/app/dashboard/support/cases/page.tsx`
- Create `frontend/app/dashboard/support/cases/[caseId]/page.tsx`
- Create `frontend/hooks/support/useCases.ts`
- Create `frontend/components/support/*`
- Update `frontend/lib/routes.ts`
- Update `frontend/lib/moduleViewConfigs.ts`
- Update sidebar/module config if required

## Database changes

Create a migration for:

- `support_cases`
  - `id`
  - `tenant_id`
  - `case_number`
  - `subject`
  - `description`
  - `status`
  - `priority`
  - `source`
  - `contact_id` nullable
  - `organization_id` nullable
  - `opportunity_id` nullable
  - `quote_id` nullable
  - `order_id` nullable if orders task exists
  - `assigned_to_id` nullable
  - `created_by_id`
  - `sla_due_at` nullable
  - `first_response_at` nullable
  - `resolved_at` nullable
  - `closed_at` nullable
  - `created_at`
  - `updated_at`

- `support_case_comments`
  - `id`
  - `tenant_id`
  - `case_id`
  - `author_id`
  - `body`
  - `is_internal`
  - `created_at`

- `support_case_events`
  - `id`
  - `tenant_id`
  - `case_id`
  - `event_type`
  - `payload_json`
  - `created_by_id`
  - `created_at`

Optional:

- `support_sla_policies`

## API changes

- Case CRUD
- Case list with filters
- Case comments
- Case status transitions
- Case assignment
- Case summary counts

## UI changes

- Cases list table.
- Case detail page.
- Comment panel.
- Status/priority controls.
- Related customer record links.
- Empty/loading/error states.

## Validation

- User can create case.
- User can assign case.
- User can comment on case.
- User can change status.
- Case appears on customer record timeline or related section if feasible.
- Permissions and tenant isolation are enforced.
