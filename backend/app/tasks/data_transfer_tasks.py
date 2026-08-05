import logging

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
logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="app.tasks.data_transfer.process_import_job",
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def process_import_job_task(self, job_id: int) -> None:
    try:
        process_import_job(job_id=job_id)
    except SoftTimeLimitExceeded:
        logger.warning("Import job exceeded its soft time limit", extra={"job_id": job_id}, exc_info=True)
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message="SoftTimeLimitExceeded: Import exceeded its soft time limit.")
    except TRANSIENT_JOB_ERRORS as exc:
        if self.request.retries >= self.max_retries:
            logger.warning("Import job exhausted retries", extra={"job_id": job_id}, exc_info=True)
            mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=f"{type(exc).__name__}: {exc}")
            raise
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.exception("Import job failed", extra={"job_id": job_id})
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=f"{type(exc).__name__}: {exc}")


@celery_app.task(
    bind=True,
    name="app.tasks.data_transfer.process_export_job",
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def process_export_job_task(self, job_id: int) -> None:
    try:
        process_export_job(job_id=job_id)
    except SoftTimeLimitExceeded:
        logger.warning("Export job exceeded its soft time limit", extra={"job_id": job_id}, exc_info=True)
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message="SoftTimeLimitExceeded: Export exceeded its soft time limit.")
    except TRANSIENT_JOB_ERRORS as exc:
        if self.request.retries >= self.max_retries:
            logger.warning("Export job exhausted retries", extra={"job_id": job_id}, exc_info=True)
            mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=f"{type(exc).__name__}: {exc}")
            raise
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.exception("Export job failed", extra={"job_id": job_id})
        mark_data_transfer_job_failed_by_id(job_id=job_id, error_message=f"{type(exc).__name__}: {exc}")


@celery_app.task(
    name="app.tasks.data_transfer.cleanup_expired_results",
    soft_time_limit=DATA_TRANSFER_SOFT_TIME_LIMIT_SECONDS,
    time_limit=DATA_TRANSFER_TIME_LIMIT_SECONDS,
)
def cleanup_expired_data_transfer_results_task() -> int:
    return cleanup_expired_data_transfer_results_job()
