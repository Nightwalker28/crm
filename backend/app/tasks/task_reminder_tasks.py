from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.sales.services.reminder_scans import scan_follow_up_reminders
from app.modules.tasks.services.tasks_services import scan_due_task_alerts, scan_overdue_tasks


@celery_app.task(name="app.tasks.task_reminders.scan_due_task_alerts")
def scan_due_task_alerts_task() -> dict:
    db = SessionLocal()
    try:
        result = scan_due_task_alerts(db)
        # Same cadence and the same query shape, so `task.overdue` rides this schedule
        # rather than adding a beat entry.
        result["overdue"] = scan_overdue_tasks(db)
        # Invoices and bills past due (E5) ride the same hourly schedule.
        from app.modules.finance.services.overdue_scans import scan_overdue_documents

        result["overdue_documents"] = scan_overdue_documents(db)
        return result
    finally:
        db.close()


@celery_app.task(name="app.tasks.task_reminders.scan_follow_up_reminders")
def scan_follow_up_reminders_task() -> dict:
    db = SessionLocal()
    try:
        return scan_follow_up_reminders(db)
    finally:
        db.close()
