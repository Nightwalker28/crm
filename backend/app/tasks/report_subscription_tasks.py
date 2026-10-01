from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.report_subscriptions import scan_due


@celery_app.task(name="app.tasks.report_subscriptions.scan_due")
def scan_due_report_subscriptions() -> int:
    with SessionLocal() as db:
        return scan_due(db)
