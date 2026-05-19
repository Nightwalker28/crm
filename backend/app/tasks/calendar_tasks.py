from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.calendar.services.calendar_services import process_calendar_sync_job, sync_external_events_for_event_id
from app.modules.platform.services.data_transfer_jobs import TRANSIENT_JOB_ERRORS, mark_data_transfer_job_failed_by_id


@celery_app.task(name="app.tasks.calendar.sync_event_to_external_providers")
def sync_calendar_event_to_external_providers_task(event_id: int) -> dict:
    db = SessionLocal()
    try:
        synced_participants = sync_external_events_for_event_id(db, event_id=event_id)
        return {"event_id": event_id, "synced_participants": synced_participants}
    finally:
        db.close()


@celery_app.task(
    name="app.tasks.calendar.process_full_sync_job",
    autoretry_for=TRANSIENT_JOB_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=1500,
    time_limit=1800,
)
def process_calendar_full_sync_job_task(job_id: int) -> None:
    try:
        process_calendar_sync_job(job_id=job_id)
    except TRANSIENT_JOB_ERRORS:
        raise
    except Exception as exc:
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=str(exc))
