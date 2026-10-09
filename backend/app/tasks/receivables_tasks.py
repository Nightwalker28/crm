from __future__ import annotations

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.finance.services import receivables, recurring_invoices


@celery_app.task(name="app.tasks.receivables.run_recurring_invoices")
def run_recurring_invoices_task() -> dict:
    with SessionLocal() as db:
        return recurring_invoices.scan_due(db)


@celery_app.task(name="app.tasks.receivables.send_payment_reminders")
def send_payment_reminders_task() -> dict:
    with SessionLocal() as db:
        return receivables.scan_reminders(db)
