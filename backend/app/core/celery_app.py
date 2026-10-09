from celery import Celery
from celery.schedules import crontab
from celery.signals import before_task_publish, beat_init, task_postrun, task_prerun, worker_init

from app.core.background_health import BEAT_HEARTBEAT_KEY, HEARTBEAT_TASK_NAME, stamp_heartbeat
from app.core.config import settings, validate_startup_settings
from app.core.observability import configure_logging, init_error_tracking, task_id_var


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
        "app.tasks.report_subscription_tasks",
        "app.tasks.tenant_backup_tasks",
        "app.tasks.platform_tasks",
        "app.tasks.quote_tasks",
        "app.tasks.receivables_tasks",
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
    # Celery would otherwise replace the root logger's handlers with its own plain-text ones.
    worker_hijack_root_logger=False,
    beat_schedule={
        "platform-heartbeat": {
            "task": HEARTBEAT_TASK_NAME,
            "schedule": settings.BACKGROUND_HEARTBEAT_INTERVAL_SECONDS,
            "options": {"expires": settings.BACKGROUND_HEARTBEAT_INTERVAL_SECONDS},
        },
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
        "scan-expired-quotes": {
            "task": "app.tasks.quotes.scan_expired",
            "schedule": crontab(minute=20, hour=0),
        },
        # 13d §3.6: recurring invoices hourly; payment reminders once a day, mid-morning UTC.
        "run-recurring-invoices": {
            "task": "app.tasks.receivables.run_recurring_invoices",
            "schedule": crontab(minute=5),
        },
        "send-payment-reminders": {
            "task": "app.tasks.receivables.send_payment_reminders",
            "schedule": crontab(minute=0, hour=9),
        },
        "scan-due-report-subscriptions": {
            "task": "app.tasks.report_subscriptions.scan_due",
            "schedule": crontab(minute="*"),
        },
    },
)


@worker_init.connect
def validate_celery_startup_config(**_: object) -> None:
    validate_startup_settings()
    configure_logging()
    init_error_tracking("worker")


@beat_init.connect
def init_beat_observability(**_: object) -> None:
    configure_logging()
    init_error_tracking("beat")


@before_task_publish.connect
def stamp_beat_heartbeat(sender: str | None = None, **_: object) -> None:
    # Only beat publishes the heartbeat task, so this runs in the beat process.
    if sender == HEARTBEAT_TASK_NAME:
        stamp_heartbeat(BEAT_HEARTBEAT_KEY)


@task_prerun.connect
def bind_task_log_context(task_id: str | None = None, **_: object) -> None:
    task_id_var.set(task_id)


@task_postrun.connect
def clear_task_log_context(**_: object) -> None:
    task_id_var.set(None)

