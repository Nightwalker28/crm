from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.tenant_backup_runs import process_tenant_backup_run, run_due_tenant_backup_schedules


@celery_app.task(name="app.tasks.tenant_backups.scan_due_backup_schedules")
def scan_due_backup_schedules_task() -> dict[str, int]:
    with SessionLocal() as db:
        return run_due_tenant_backup_schedules(db)


@celery_app.task(name="app.tasks.tenant_backups.process_tenant_backup_run")
def process_tenant_backup_run_task(run_id: int) -> int:
    with SessionLocal() as db:
        run = process_tenant_backup_run(db, run_id=run_id)
        return int(run.id)
