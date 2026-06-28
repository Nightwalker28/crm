from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.calendar.services.calendar_services import (
    delete_external_participant_event,
    process_calendar_sync_job,
    sync_external_events_for_event_id,
)
from app.modules.platform.services.data_transfer_jobs import TRANSIENT_JOB_ERRORS, mark_data_transfer_job_failed_by_id
from requests import RequestException

CALENDAR_TRANSIENT_ERRORS = (*TRANSIENT_JOB_ERRORS, RequestException)


@celery_app.task(
    name="app.tasks.calendar.sync_event_to_external_providers",
    autoretry_for=CALENDAR_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=120,
    time_limit=180,
)
def sync_calendar_event_to_external_providers_task(event_id: int) -> dict:
    with SessionLocal() as db:
        synced_participants = sync_external_events_for_event_id(db, event_id=event_id)
        return {"event_id": event_id, "synced_participants": synced_participants}


@celery_app.task(
    name="app.tasks.calendar.delete_external_event",
    autoretry_for=CALENDAR_TRANSIENT_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=120,
    time_limit=180,
)
def delete_external_calendar_event_task(
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
    external_event_id: str,
) -> dict:
    with SessionLocal() as db:
        deleted = delete_external_participant_event(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            external_event_id=external_event_id,
        )
        return {"tenant_id": tenant_id, "user_id": user_id, "provider": provider, "deleted": deleted}


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
