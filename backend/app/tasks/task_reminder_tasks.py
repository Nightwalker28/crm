from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.sales.services.reminder_scans import scan_follow_up_reminders
from app.modules.tasks.services.tasks_services import scan_due_task_alerts


@celery_app.task(name="app.tasks.task_reminders.scan_due_task_alerts")
def scan_due_task_alerts_task() -> dict:
    db = SessionLocal()
    try:
        return scan_due_task_alerts(db)
    finally:
        db.close()


@celery_app.task(name="app.tasks.task_reminders.scan_follow_up_reminders")
def scan_follow_up_reminders_task() -> dict:
    db = SessionLocal()
    try:
        return scan_follow_up_reminders(db)
    finally:
        db.close()
