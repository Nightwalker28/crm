from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.recycle_purge import purge_expired_recycle_bin_records


@celery_app.task(name="app.tasks.recycle_bin.purge_expired_records")
def purge_expired_recycle_bin_records_task() -> dict[str, int]:
    db = SessionLocal()
    try:
        return purge_expired_recycle_bin_records(db)
    finally:
        db.close()

