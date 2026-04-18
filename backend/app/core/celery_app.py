from celery import Celery

from app.core.config import settings


celery_app = Celery(
    "lynk",
    broker=settings.CELERY_BROKER_URL,
    include=["app.tasks.data_transfer_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_backend=None,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={},
)
