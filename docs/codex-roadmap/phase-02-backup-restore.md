# Phase 2 — Backup and Restore System

## Goal

Add backups as a real product feature with two clearly separated layers:

1. **Platform backups**
   Seller/service-provider controlled infrastructure safety backups managed by the system owner. These are not tenant-facing and are not bound to a specific tenant.

2. **Tenant backups**
   Tenant/customer-admin controlled exports, schedules, destinations, and tenant-aware restore/import flows.

This phase should not depend on Kubernetes, managed cloud backup services, paid services, or complex disaster recovery automation.

---

## Explicitly out of scope

* Kubernetes volume snapshots.
* Managed cloud backup services.
* Complex disaster recovery automation.
* Full production deployment automation.
* GitHub CI/CD.
* Exposing service-provider/platform backups to tenant users.
* Allowing tenants to manage or restore platform backups.

---

# Backup model overview

There should be two backup categories:

## 1. Platform backup

Controlled only by the **seller/service provider/system owner**.

This backup type is for the person operating the CRM platform, not the tenant/customer.

### Purpose

* Protect the whole deployed application.
* Protect the main PostgreSQL database.
* Recover from accidental deploy mistakes.
* Recover from accidental data or migration issues.
* Maintain rolling restore points for low-friction rollback.
* Support fast recovery without relying on tenant-specific backup settings.

### Important rule

Platform backups must **not** be shown anywhere in the normal tenant system UI.

They should not appear in:

* Tenant admin settings.
* Tenant backup pages.
* Tenant activity views.
* Tenant restore screens.
* Any customer-facing area of the CRM.

Platform backups are an infrastructure/operator concern.

They may be managed through:

* Environment variables.
* Docker Compose configuration.
* Host cron/systemd timers.
* Backend CLI commands.
* Private operator-only scripts.
* Private internal admin endpoint only if protected outside tenant UI.

### Tenant relationship

Platform backups are **not tenant-scoped**.

A platform backup may contain the full database and shared application data. Metadata must clearly mark the backup as:

```text
backup_type: platform
tenant_scope: none
owner: service_provider
```

The system must avoid treating platform backups as tenant records.

---

## 2. Tenant backup

Controlled by tenant/company admins.

### Purpose

* Let customers export their own tenant data.
* Let customers choose backup frequency, retention, scope, and destination.
* Let customers store backups in their own Google Drive, OneDrive, or local download.
* Eventually allow module-level or whole-tenant restore.

Tenant backups must always be tenant-scoped, permission-protected, and isolated from other tenants.

---

# Task 2.1 — Platform backup service

## Objective

Create a backend or infrastructure-level service for seller/service-provider controlled backups.

This service should prioritize the PostgreSQL database first because the database is the most important restore target.

## Core requirement

Platform backups should be configured and managed outside the tenant UI.

Recommended control methods:

* `.env.production`
* Docker Compose environment variables
* Host cron
* systemd timer
* Backend management command
* Private server-side script

Example environment variables:

```env
PLATFORM_BACKUPS_ENABLED=true
PLATFORM_BACKUP_DIR=/var/backups/maad-crm
PLATFORM_BACKUP_RETENTION_DAILY=7
PLATFORM_BACKUP_RETENTION_WEEKLY=4
PLATFORM_BACKUP_RETENTION_MONTHLY=3
PLATFORM_BACKUP_INCLUDE_UPLOADS=true
PLATFORM_BACKUP_ENCRYPTION_ENABLED=false
PLATFORM_BACKUP_COMPRESSION=gzip
PLATFORM_BACKUP_DB_ROLLBACK_MODE=pg_restore
```

## Recommended default retention

* Daily backups: keep 7.
* Weekly backups: keep 4.
* Monthly backups: keep 3.

This is enough for an early solo-run system and avoids unbounded disk growth.

## Backup contents

Each platform backup should include:

* PostgreSQL dump.
* Uploaded files/documents if locally stored and enabled.
* Metadata file.

## Metadata file

Each platform backup should include a `metadata.json` file containing:

```json
{
  "backup_id": "string",
  "backup_type": "platform",
  "tenant_scope": "none",
  "owner": "service_provider",
  "created_at": "timestamp",
  "app_environment": "production",
  "app_commit": "optional",
  "app_version": "optional",
  "alembic_revision": "optional",
  "database_name": "string",
  "included_components": ["postgresql", "uploads"],
  "included_paths": [],
  "included_tables": "all",
  "compression": "gzip",
  "checksum": "optional",
  "restore_notes": "Platform-level restore only. Not tenant-scoped."
}
```

## PostgreSQL backup format

Prefer a restore-friendly PostgreSQL custom-format dump:

```bash
pg_dump -Fc
```

Reason:

* Better for `pg_restore`.
* Easier to restore selectively if needed.
* More practical than plain SQL for larger databases.
* Supports cleaner rollback workflows.

## Rollback requirement

The platform database backup must be restorable with the least friction possible.

At minimum, provide a documented restore command/script that can:

1. Stop the app containers.
2. Create a safety backup before restore.
3. Restore the selected PostgreSQL dump.
4. Run/verify Alembic migration state.
5. Start the app containers again.
6. Run a health check.

Example operator flow:

```bash
./scripts/platform-backup.sh create
./scripts/platform-restore.sh /var/backups/maad-crm/platform/backup-id/db.dump
```

## Safety backup before restore

Before any platform restore, the restore script should automatically create a new safety backup of the current database.

This prevents a failed restore from destroying the current state without a fallback.

## Implementation notes

* Prefer simple local filesystem storage first.
* Keep backup storage compatible with Docker Compose volumes.
* Use a host-level scheduled job if simpler than Celery.
* Do not require Kubernetes or managed backup services.
* Do not expose platform backups through tenant APIs.
* Store platform backup run history either:

  * in a local metadata index file, or
  * in an operator-only database table not linked to tenants.

## Suggested directory structure

```text
/backups/maad-crm/
  platform/
    daily/
    weekly/
    monthly/
    manual/
  tenant/
    tenant-id/
```

Platform backup files should clearly indicate they are platform-level:

```text
platform-production-2026-06-05-030000/
  metadata.json
  db.dump
  uploads.tar.gz
  checksums.txt
```

## Acceptance criteria

* Service provider can trigger a platform backup manually.
* Scheduled platform backups can run daily, weekly, and monthly.
* Old platform backups are cleaned according to retention.
* Platform backup run history is recorded.
* Failed platform backups record useful errors.
* Platform backups are not tenant-scoped.
* Platform backups are not visible in tenant UI.
* Platform backup metadata clearly says `backup_type: platform`.
* Database restore is documented and scriptable.
* Restore flow creates a safety backup before replacing the database.

---

# Task 2.2 — Platform backup operator controls

## Objective

Allow the system owner/service provider to manage platform backups privately without exposing them to tenants.

This replaces the previous tenant-visible platform backup admin UI idea.

## Control surface

Use one or more of:

* CLI command.
* Host script.
* Docker Compose command.
* Private operator-only backend route.
* Private server dashboard outside tenant UI.

Recommended first version:

```bash
./scripts/platform-backup.sh create
./scripts/platform-backup.sh list
./scripts/platform-backup.sh delete <backup_id>
./scripts/platform-restore.sh <backup_path>
```

## Must not be visible in

* Tenant backup settings.
* Tenant admin pages.
* CRM sidebar.
* Module settings.
* Tenant activity timeline.
* Tenant restore pages.

## Operator list output should show

* Backup ID.
* Backup type.
* Created time.
* Status.
* Size.
* Included data.
* Retention category.
* Backup path.
* Checksum if available.
* Error details for failures.

## Acceptance criteria

* Service provider can list platform backups privately.
* Service provider can trigger a platform backup privately.
* Service provider can delete old platform backups privately.
* Dangerous actions require confirmation.
* Platform backups are never listed in tenant-facing UI.
* Platform backups are clearly marked as service-provider/operator backups.

---

# Task 2.3 — Tenant backup settings model

## Objective

Allow tenant/company admins to configure their own tenant-scoped backups.

These backups are separate from platform backups.

## Settings fields

```text
enabled: boolean
frequency: manual, daily, weekly, monthly
scope: full_tenant or selected_modules
selected_modules: list
retention_count: 3, 7, 14, 30
destination: local_download, google_drive, onedrive
include_documents: boolean
created_by
updated_by
last_run_at
next_run_at
```

## Start simple

Implement `local_download` first.

Google Drive and OneDrive can be destination adapters added after the base system exists.

## Tenant isolation rules

* Tenant backup settings must always include `tenant_id`.
* Tenant admins can only view/update their own tenant’s backup settings.
* Tenant backups must not include records from other tenants.
* Tenant backup artifacts must not be stored in a shared accessible path without tenant isolation.

## Acceptance criteria

* Tenant admin can view backup settings.
* Tenant admin can update backup frequency, scope, and retention.
* Tenant admin can choose full tenant or selected modules.
* Tenant settings are tenant-scoped and permission-protected.
* Tenant backup settings do not affect platform backups.
* Tenant admins cannot view platform backup configuration.

---

# Task 2.4 — Tenant backup run system

## Objective

Track every tenant backup job and result.

## Backup run fields

```text
id
tenant_id
requested_by_user_id
schedule_id/settings_id
backup_type: tenant
scope: full_tenant or selected_modules
modules_included
status: pending, running, completed, failed, cancelled
started_at
completed_at
file_path/storage_ref
size_bytes
error_message
destination
destination_upload_status
created_at
```

## Acceptance criteria

* Tenant admin can trigger manual tenant backup.
* Tenant backup run creates a downloadable artifact.
* Failed backups show useful error details.
* Retention cleanup removes old tenant backups.
* Tenants cannot access each other’s backup artifacts.
* Tenant backup runs are never mixed with platform backup runs in tenant UI.

---

# Task 2.5 — Tenant backup export format

## Objective

Choose a practical export format that supports future restore/import.

## Recommended format

Compressed archive containing:

```text
metadata.json
modules/
  contacts.json
  accounts.json
  deals.json
documents/
  optional files
```

Use one JSON or CSV file per module/table.

## Metadata should include

```json
{
  "backup_type": "tenant",
  "tenant_id": "string",
  "tenant_name": "string",
  "created_at": "timestamp",
  "export_version": "1",
  "app_version": "optional",
  "app_commit": "optional",
  "module_list": [],
  "record_counts": {},
  "include_documents": true,
  "restore_compatibility_version": "1"
}
```

## Acceptance criteria

* Export artifact is deterministic enough to inspect/debug.
* Metadata makes it clear what the backup contains.
* Metadata clearly marks the backup as `backup_type: tenant`.
* Format can be reused by import/restore later.
* Export never includes data from another tenant.

---

# Task 2.6 — Cloud destination adapters

## Objective

Allow tenant backups to upload to customer-owned storage.

## Initial destinations

* Google Drive.
* OneDrive.

## Implementation notes

* Reuse existing Google/Microsoft OAuth infrastructure where possible.
* Store destination credentials encrypted.
* Allow reconnect flow.
* Show upload status and last error.
* Do not block the base local backup system on cloud upload work.
* Upload failures should not corrupt the local backup artifact.

## Important separation

Cloud destination adapters are for **tenant backups only**.

Platform backups should remain controlled by the service provider through infrastructure/env configuration unless a separate private operator backup destination is added later.

## Acceptance criteria

* Tenant admin can connect Google Drive or OneDrive as backup destination.
* Tenant backup job can upload artifact to selected destination.
* Upload failures do not corrupt local backup state.
* Credentials/secrets are encrypted at rest.
* Tenant cloud destinations cannot access platform backups.

---

# Task 2.7 — Module-level restore/import

## Objective

Start restore functionality with selected module restore/import, not full-tenant restore first.

This applies to tenant backups.

## Restore modes

* Preview only.
* Create missing.
* Update existing.
* Skip duplicates.
* Replace module data.

## Implementation notes

* Reuse or extend existing import feature if available.
* Add preview showing record counts and conflicts.
* Require strong confirmation for destructive modes.
* Record restore actions in audit log.
* Validate tenant ownership before restore.
* Validate backup metadata before restore.

## Acceptance criteria

* Tenant admin can upload/select tenant backup artifact.
* Tenant admin can preview selected module restore.
* Tenant admin can restore one module with chosen conflict strategy.
* Restore cannot affect another tenant.
* Destructive restore modes require confirmation.

---

# Task 2.8 — Whole-tenant restore

## Objective

Add full-tenant restore after module-level restore is reliable.

This applies to tenant backups only.

## Requirements

* Tenant admin only.
* Strong confirmation.
* Backup-before-restore automatically created.
* Restore run history.
* Clear destructive-operation warnings.
* Compatibility check before restore.
* Tenant isolation validation before restore.

## Acceptance criteria

* Tenant admin can restore whole tenant from a compatible tenant backup.
* Restore creates a safety tenant backup first.
* Restore logs all affected modules and record counts.
* Restore failure leaves useful diagnostics.
* Restore cannot affect another tenant.
* Whole-tenant restore cannot use a platform backup artifact.

---

# Task 2.9 — Platform database rollback

## Objective

Add a low-friction operator-only rollback path for the main platform database.

This is separate from tenant restore.

## Requirements

* Restore from selected platform `pg_dump -Fc` backup.
* Create a safety backup before restore.
* Stop app services before restore where needed.
* Restore database cleanly.
* Verify app health after restore.
* Record restore metadata.
* Keep restore logs outside tenant UI.

## Suggested script

```bash
./scripts/platform-restore.sh <backup_id_or_path>
```

## Restore metadata should record

```json
{
  "restore_type": "platform",
  "source_backup_id": "string",
  "started_at": "timestamp",
  "completed_at": "timestamp",
  "status": "completed",
  "safety_backup_id": "string",
  "operator": "service_provider",
  "notes": "Database rollback restore"
}
```

## Acceptance criteria

* Service provider can restore the main database from a platform backup.
* Restore creates a safety backup first.
* Restore process is documented.
* Restore process is repeatable.
* Restore logs are available to the operator.
* Restore actions are not shown to tenant users.

---

# Task 2.10 — Backup audit events

## Objective

Record important backup/restore actions.

## Tenant-visible events

These may appear in tenant audit/activity logs:

```text
backup.settings.updated
backup.run.started
backup.run.completed
backup.run.failed
backup.downloaded
backup.deleted
restore.previewed
restore.started
restore.completed
restore.failed
```

## Platform/operator-only events

These must not appear in tenant-facing logs:

```text
platform_backup.run.started
platform_backup.run.completed
platform_backup.run.failed
platform_backup.deleted
platform_restore.started
platform_restore.completed
platform_restore.failed
```

## Acceptance criteria

* Tenant backup and restore actions are visible in tenant audit/activity logs.
* Platform backup and restore actions are visible only in operator logs.
* Sensitive paths/secrets are not leaked in logs.
* Platform backup paths are not exposed to tenant users.

---

# Final separation rules

## Platform backup

```text
Owner: service provider / seller / system operator
Scope: whole app / database / infrastructure
Tenant-bound: no
Visible in tenant UI: no
Managed by: env vars, infra, scripts, private operator controls
Primary purpose: rollback and disaster recovery
Main target: PostgreSQL database
Restore type: platform rollback
```

## Tenant backup

```text
Owner: tenant admin / customer admin
Scope: one tenant only
Tenant-bound: yes
Visible in tenant UI: yes
Managed by: tenant backup settings
Primary purpose: customer export and tenant restore
Main target: tenant data/modules/documents
Restore type: module-level or whole-tenant restore
```

## Critical implementation rule

Never mix platform backups and tenant backups in the same UI, permission model, restore flow, or audit stream.

Platform backups protect the service provider’s infrastructure.

Tenant backups give customers control over their own tenant data.
