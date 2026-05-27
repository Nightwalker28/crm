# Task: Integrations Registry

## Purpose

Create a central registry for integration providers and connection state, so existing and future integrations have one settings surface.

## What this task will accomplish

- Add provider metadata records.
- Add connection records.
- Add sync run records.
- Create an integrations settings page.
- Surface existing mail/calendar/document/website integration status in one place where possible.

## Backend files to inspect and modify

- `backend/app/modules/platform/models.py`
- `backend/app/modules/platform/schema.py`
- Create `backend/app/modules/platform/services/integrations_registry.py`
- Create `backend/app/modules/platform/routes/integrations_registry.py`
- Existing mail/calendar/documents/website integration services
- `backend/app/api/v1/router.py`
- `backend/alembic/versions/*`
- Backend tests

## Frontend files to inspect and modify

- `frontend/app/dashboard/settings/integrations/page.tsx`
- Settings components
- Existing mail/calendar/document settings pages, if any

## Database changes

Create a migration for:

- `integration_providers`
  - `id`
  - `key`
  - `name`
  - `category`
  - `description`
  - `enabled`
  - `metadata_json`
  - `created_at`
  - `updated_at`

- `integration_connections`
  - `id`
  - `tenant_id`
  - `provider_key`
  - `status`
  - `connected_by_id`
  - `connected_at`
  - `last_sync_at`
  - `settings_json`
  - `created_at`
  - `updated_at`

- `integration_sync_runs`
  - `id`
  - `tenant_id`
  - `connection_id`
  - `status`
  - `started_at`
  - `finished_at`
  - `result_json`
  - `error_message`

## API changes

- List providers
- List connections
- Get integration health/status
- List sync runs

## UI changes

- Integrations settings page with provider cards.
- Connection status badges.
- Last sync time.
- Links to provider-specific configuration pages.

## Validation

- Provider registry seeds known providers.
- Existing connected services can be represented as connection status.
- Settings page renders connected/disconnected states.
- Tenant isolation is enforced.
