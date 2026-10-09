from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.sales.services.quotes_services import scan_expired_quotes


@celery_app.task(name="app.tasks.quotes.scan_expired")
def scan_expired_quotes_task() -> int:
    with SessionLocal() as db:
        return scan_expired_quotes(db)
