from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_init

from app.core.config import settings, validate_startup_settings


celery_app = Celery(
    "lynk",
    broker=settings.CELERY_BROKER_URL,
    include=[
        "app.tasks.auth_tasks",
        "app.tasks.automation_tasks",
        "app.tasks.calendar_tasks",
        "app.tasks.data_transfer_tasks",
        "app.tasks.task_reminder_tasks",
        "app.tasks.recycle_purge_tasks",
        "app.tasks.tenant_backup_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_backend=settings.CELERY_RESULT_BACKEND,
    result_expires=settings.CELERY_RESULT_EXPIRES_SECONDS,
    task_ignore_result=settings.CELERY_TASK_IGNORE_RESULT,
    task_store_errors_even_if_ignored=True,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "cleanup-expired-data-transfer-results": {
            "task": "app.tasks.data_transfer.cleanup_expired_results",
            "schedule": crontab(minute=15, hour=2),
        },
        "cleanup-expired-refresh-tokens": {
            "task": "app.tasks.cleanup_expired_refresh_tokens",
            "schedule": crontab(minute=7),
        },
        "scan-due-task-alerts": {
            "task": "app.tasks.task_reminders.scan_due_task_alerts",
            "schedule": settings.TASK_DUE_ALERT_SCAN_INTERVAL_SECONDS,
        },
        "scan-follow-up-reminders": {
            "task": "app.tasks.task_reminders.scan_follow_up_reminders",
            "schedule": settings.FOLLOW_UP_REMINDER_SCAN_INTERVAL_SECONDS,
        },
        "purge-expired-recycle-bin-records": {
            "task": "app.tasks.recycle_bin.purge_expired_records",
            "schedule": crontab(minute=30, hour=3),
        },
        "scan-due-tenant-backups": {
            "task": "app.tasks.tenant_backups.scan_due_backup_schedules",
            "schedule": settings.TENANT_BACKUP_SCHEDULE_SCAN_INTERVAL_SECONDS,
        },
    },
)


@worker_init.connect
def validate_celery_startup_config(**_: object) -> None:
    validate_startup_settings()
