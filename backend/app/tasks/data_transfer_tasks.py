from celery.exceptions import SoftTimeLimitExceeded

from app.core.celery_app import celery_app
from app.modules.platform.services.data_transfer_jobs import (
    TRANSIENT_JOB_ERRORS,
    cleanup_expired_data_transfer_results_job,
    mark_data_transfer_job_failed_by_id,
    process_export_job,
    process_import_job,
)

DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS = 1500
DATA_TRANSFER_TIME_LIMIT_SECONDS = 1800


@celery_app.task(
    name="app.tasks.data_transfer.process_import_job",
    autoretry_for=TRANSIENT_JOB_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def process_import_job_task(job_id: int) -> None:
    try:
        process_import_job(job_id=job_id)
    except SoftTimeLimitExceeded:
        mark_data_transfer_job_failed_by_id(
            job_id=job_id,
            error_message="Import exceeded the 25 minute soft time limit.",
        )
    except TRANSIENT_JOB_ERRORS:
        raise
    except Exception as exc:
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=str(exc))


@celery_app.task(
    name="app.tasks.data_transfer.process_export_job",
    autoretry_for=TRANSIENT_JOB_ERRORS,
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def process_export_job_task(job_id: int) -> None:
    try:
        process_export_job(job_id=job_id)
    except SoftTimeLimitExceeded:
        mark_data_transfer_job_failed_by_id(
            job_id=job_id,
            error_message="Export exceeded the 25 minute soft time limit.",
        )
    except TRANSIENT_JOB_ERRORS:
        raise
    except Exception as exc:
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=str(exc))


@celery_app.task(
    name="app.tasks.data_transfer.cleanup_expired_results",
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def cleanup_expired_data_transfer_results_task() -> int:
    return cleanup_expired_data_transfer_results_job()
