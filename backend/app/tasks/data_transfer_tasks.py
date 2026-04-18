from app.core.celery_app import celery_app
from app.modules.platform.services.data_transfer_jobs import process_export_job, process_import_job


@celery_app.task(
    name="app.tasks.data_transfer.process_import_job",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def process_import_job_task(job_id: int) -> None:
    process_import_job(job_id=job_id)


@celery_app.task(
    name="app.tasks.data_transfer.process_export_job",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def process_export_job_task(job_id: int) -> None:
    process_export_job(job_id=job_id)
