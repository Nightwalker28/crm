from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.tenant_backup_runs import run_due_tenant_backup_schedules


@celery_app.task(name="app.tasks.tenant_backups.scan_due_backup_schedules")
def scan_due_backup_schedules_task() -> dict[str, int]:
    db = SessionLocal()
    try:
        return run_due_tenant_backup_schedules(db)
    finally:
        db.close()
