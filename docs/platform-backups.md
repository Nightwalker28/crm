# Platform Backups

Platform backups are service-provider/operator artifacts for the whole CRM deployment. They are not tenant-scoped, must not be exposed through tenant APIs or UI, and are stored outside tenant activity logs.

## Configuration

Set these values in the operator environment or `.env.production`:

```env
PLATFORM_BACKUPS_ENABLED=true
PLATFORM_BACKUP_DIR=/var/backups/maad-crm
PLATFORM_BACKUP_RETENTION_DAILY=7
PLATFORM_BACKUP_RETENTION_WEEKLY=4
PLATFORM_BACKUP_RETENTION_MONTHLY=3
PLATFORM_BACKUP_INCLUDE_UPLOADS=true
PLATFORM_BACKUP_COMPRESSION=gzip
```

`PLATFORM_BACKUP_DIR` should be a private host path readable only by the operator account. Do not mount it into frontend/public static paths.

## Operator Commands

Create a manual platform backup:

```bash
./scripts/platform-backup.sh create
```

Create scheduled retention categories:

```bash
./scripts/platform-backup.sh create daily
./scripts/platform-backup.sh create weekly
./scripts/platform-backup.sh create monthly
```

List backups:

```bash
./scripts/platform-backup.sh list
```

Delete a backup:

```bash
./scripts/platform-backup.sh delete <backup_id> --confirm <backup_id>
```

Restore the platform database:

```bash
./scripts/platform-restore.sh <backup_id_or_db_dump_path> --confirm-restore <backup_id>
```

If restoring from a raw `db.dump` path without metadata, use:

```bash
./scripts/platform-restore.sh /var/backups/maad-crm/platform/manual/<backup_id>/db.dump --confirm-restore restore
```

## Scheduling

Use host cron or a systemd timer. Example cron entries:

```cron
0 3 * * * cd /path/to/crm && ./scripts/platform-backup.sh create daily >> /var/log/maad-crm-platform-backup.log 2>&1
30 3 * * 0 cd /path/to/crm && ./scripts/platform-backup.sh create weekly >> /var/log/maad-crm-platform-backup.log 2>&1
0 4 1 * * cd /path/to/crm && ./scripts/platform-backup.sh create monthly >> /var/log/maad-crm-platform-backup.log 2>&1
```

## Artifact Format

Each backup directory contains:

```text
metadata.json
db.dump
uploads.tar.gz
checksums.txt
```

`db.dump` is created with `pg_dump -Fc` for `pg_restore`. `metadata.json` always marks the backup as:

```json
{
  "backup_type": "platform",
  "tenant_scope": "none",
  "owner": "service_provider"
}
```

Restore metadata is written under `platform/restores/`. Backup and restore history stays in the private backup directory, not in tenant-facing activity logs.
