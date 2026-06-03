# Phase 2 — Backup and Restore System

## Goal

Add backups as a real product feature with two layers:

1. Seller/admin-controlled platform safety backups.
2. Tenant/customer-controlled backup exports, schedules, destinations, and restores.

This phase should not depend on Kubernetes, cloud infrastructure, or paid services.

## Explicitly out of scope

- Kubernetes volume snapshots.
- Managed cloud backup services.
- Complex disaster recovery automation.
- Full production deployment automation.
- GitHub CI/CD.

## Backup model overview

There should be two backup categories:

### Platform backup

Controlled by the system owner/admin.

Purpose:

- Protect the whole app.
- Recover from accidental deploy/data mistakes.
- Keep reasonable rolling restore points.

### Tenant backup

Controlled by tenant/company admins.

Purpose:

- Let customers export their own data.
- Let customers choose backup frequency, retention, scope, and destination.
- Eventually allow module-level or whole-tenant restore.

## Task 2.1 — Platform backup service

### Objective

Create a backend service for seller/admin-controlled backups.

### Recommended default retention

- Daily backups: keep 7.
- Weekly backups: keep 4.
- Monthly backups: keep 3.

This is enough for an early solo-run system and avoids unbounded disk growth.

### Backup contents

Each platform backup should include:

- PostgreSQL dump.
- Uploaded files/documents if locally stored.
- Metadata file:
  - backup ID
  - timestamp
  - backup type: platform
  - app environment
  - app commit/version if available
  - Alembic revision if available
  - included paths/tables
  - file checksum if practical

### Implementation notes

- Prefer simple local filesystem storage first.
- Add configuration for backup directory.
- Use Celery task or host-triggered backend command if existing job infrastructure supports it.
- Keep implementation compatible with Docker Compose volumes.

### Acceptance criteria

- Admin can trigger a platform backup manually.
- Scheduled platform backups can run daily/weekly/monthly.
- Old backups are cleaned according to retention.
- Backup run history is stored.
- Failed backups record useful errors.

## Task 2.2 — Platform backup admin UI

### Objective

Allow the system owner/admin to see and manage platform backups.

### UI should show

- Backup type.
- Created time.
- Status.
- Size.
- Included data.
- Retention category.
- Download action if allowed.
- Delete action if allowed.
- Error details for failures.

### Acceptance criteria

- Platform admin can see backup history.
- Platform admin can trigger backup.
- Platform admin can delete old backups.
- Dangerous actions require confirmation.

## Task 2.3 — Tenant backup settings model

### Objective

Allow tenant/company admins to configure their own backups.

### Settings fields

- enabled: boolean
- frequency: manual, daily, weekly, monthly
- scope: full_tenant or selected_modules
- selected_modules: list
- retention_count: 3, 7, 14, 30
- destination: local_download, google_drive, onedrive
- include_documents: boolean
- created_by
- updated_by
- last_run_at
- next_run_at

### Start simple

Implement local download first. Google Drive and OneDrive can be destination adapters added after the base system exists.

### Acceptance criteria

- Tenant admin can view backup settings.
- Tenant admin can update backup frequency/scope/retention.
- Tenant admin can choose full tenant or selected modules.
- Tenant settings are tenant-scoped and permission-protected.

## Task 2.4 — Tenant backup run system

### Objective

Track every tenant backup job and result.

### Backup run fields

- id
- tenant_id
- requested_by_user_id
- schedule_id/settings_id
- backup_type: tenant
- scope: full_tenant or selected_modules
- modules included
- status: pending, running, completed, failed, cancelled
- started_at
- completed_at
- file_path/storage_ref
- size_bytes
- error_message
- destination
- destination_upload_status
- created_at

### Acceptance criteria

- Tenant admin can trigger manual backup.
- Tenant backup run creates a downloadable artifact.
- Failed backups show useful error details.
- Retention cleanup removes old tenant backups.
- Tenants cannot access each other’s backup artifacts.

## Task 2.5 — Tenant backup export format

### Objective

Choose a practical export format that supports future restore/import.

### Recommended format

Compressed archive containing:

- `metadata.json`
- one JSON or CSV file per module/table
- optional `documents/` folder if documents are included

### Metadata should include

- tenant ID
- tenant name
- created time
- export version
- app version/commit if available
- module list
- record counts
- restore compatibility version

### Acceptance criteria

- Export artifact is deterministic enough to inspect/debug.
- Metadata makes it clear what the backup contains.
- Format can be reused by import/restore later.

## Task 2.6 — Cloud destination adapters

### Objective

Allow tenant backups to upload to customer-owned storage.

### Initial destinations

- Google Drive.
- OneDrive.

### Implementation notes

- Reuse existing Google/Microsoft OAuth infrastructure where possible.
- Store destination credentials encrypted.
- Allow reconnect flow.
- Show upload status and last error.
- Do not block the base local backup system on cloud upload work.

### Acceptance criteria

- Tenant admin can connect Google Drive or OneDrive as backup destination.
- Backup job can upload artifact to selected destination.
- Upload failures do not corrupt local backup state.
- Credentials/secrets are encrypted at rest.

## Task 2.7 — Module-level restore/import

### Objective

Start restore functionality with selected module restore/import, not full-tenant restore first.

### Restore modes

- preview only
- create missing
- update existing
- skip duplicates
- replace module data

### Implementation notes

- Reuse or extend existing import feature if available.
- Add preview showing record counts and conflicts.
- Require strong confirmation for destructive modes.
- Record restore actions in audit log.

### Acceptance criteria

- Tenant admin can upload/select backup artifact.
- Tenant admin can preview selected module restore.
- Tenant admin can restore one module with chosen conflict strategy.
- Restore cannot affect another tenant.

## Task 2.8 — Whole-tenant restore

### Objective

Add full-tenant restore after module-level restore is reliable.

### Requirements

- Admin-only.
- Strong confirmation.
- Backup-before-restore automatically created.
- Restore run history.
- Clear destructive-operation warnings.

### Acceptance criteria

- Admin can restore whole tenant from a compatible backup.
- Restore creates a safety backup first.
- Restore logs all affected modules and record counts.
- Restore failure leaves useful diagnostics.

## Task 2.9 — Backup audit events

### Objective

Record important backup/restore actions.

### Events

- backup.settings.updated
- backup.run.started
- backup.run.completed
- backup.run.failed
- backup.downloaded
- backup.deleted
- restore.previewed
- restore.started
- restore.completed
- restore.failed

### Acceptance criteria

- Backup and restore actions are visible in audit/activity logs.
- Sensitive paths/secrets are not leaked in logs.
