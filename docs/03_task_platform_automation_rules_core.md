# Task: Platform Automation Rules Core

## Purpose

Add a configurable workflow engine so admins can automate repetitive CRM actions from existing CRM events.

## What this task will accomplish

- Add automation rule storage.
- Add rule run/audit records.
- Evaluate rules when supported CRM events occur.
- Execute safe actions through a service/Celery task.
- Add a settings UI for listing and editing rules.

## Backend files to inspect and modify

- `backend/app/modules/platform/models.py`
- `backend/app/modules/platform/schema.py`
- `backend/app/modules/platform/routes/crm_events.py`
- `backend/app/modules/platform/routes/notification_channels.py`
- `backend/app/core/celery_app.py`
- `backend/app/api/v1/router.py`
- Create `backend/app/modules/platform/services/automation_rules.py`
- Create `backend/app/modules/platform/routes/automation_rules.py`
- Create/update tests under `backend/tests/`

## Frontend files to inspect and modify

- `frontend/app/dashboard/settings/*`
- Create `frontend/app/dashboard/settings/automation/page.tsx`
- Create `frontend/components/settings/automation/*` if needed
- Existing API utilities/hooks

## Database changes

Create a migration for:

- `automation_rules`
  - `id`
  - `tenant_id`
  - `name`
  - `description`
  - `enabled`
  - `trigger_event`
  - `conditions_json`
  - `actions_json`
  - `created_by_id`
  - `updated_by_id`
  - `created_at`
  - `updated_at`

- `automation_rule_runs`
  - `id`
  - `tenant_id`
  - `rule_id`
  - `event_id` nullable
  - `status`
  - `input_json`
  - `result_json`
  - `error_message`
  - `started_at`
  - `finished_at`

- `automation_rule_dead_letters`
  - failed run payloads for retry/debugging

## Supported triggers for first version

Keep this small:

- `lead.created`
- `lead.updated`
- `lead.converted`
- `opportunity.stage_changed`
- `quote.created`
- `quote.status_changed`
- `task.overdue`

## Supported actions for first version

- Create task
- Send in-app notification
- Apply lead score recalculation
- Add record comment/activity note
- Send email from an existing template only if mail infrastructure already supports safe sending

## UI changes

- Automation settings page with rule list.
- Enable/disable toggle.
- Basic rule editor:
  - Name
  - Trigger
  - Conditions JSON/simple builder
  - Actions JSON/simple builder
- Rule run history panel.

## Validation

- Admin can create, update, disable, and delete a rule.
- Enabled rule fires on supported event.
- Disabled rule does not fire.
- Rule run is recorded.
- Failed rule run does not break the original CRM operation.
- Tenant isolation is enforced.

## Do not implement

- AI action generation
- Visual drag-and-drop workflow builder
- Unbounded arbitrary code execution
