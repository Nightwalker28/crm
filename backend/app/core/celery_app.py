from celery import Celery

from app.core.config import settings


celery_app = Celery(
    "lynk",
    broker=settings.CELERY_BROKER_URL,
    include=[
        "app.tasks.data_transfer_tasks",
        "app.tasks.task_reminder_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_backend=None,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "cleanup-expired-data-transfer-results": {
            "task": "app.tasks.data_transfer.cleanup_expired_results",
            "schedule": settings.DATA_TRANSFER_RESULT_CLEANUP_INTERVAL_SECONDS,
        },
        "scan-due-task-alerts": {
            "task": "app.tasks.task_reminders.scan_due_task_alerts",
            "schedule": settings.TASK_DUE_ALERT_SCAN_INTERVAL_SECONDS,
        },
        "scan-follow-up-reminders": {
            "task": "app.tasks.task_reminders.scan_follow_up_reminders",
            "schedule": settings.FOLLOW_UP_REMINDER_SCAN_INTERVAL_SECONDS,
        },
    },
)
