from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.pagination import Pagination
from app.modules.platform.models import DataTransferJob
from app.modules.user_management.models import User


DATA_TRANSFER_UPLOAD_DIR = Path(__file__).resolve().parents[4] / "uploads" / "data-transfer-jobs"
DATA_TRANSFER_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


MODULE_DISPLAY_NAMES = {
    "sales_contacts": "Contacts",
    "sales_organizations": "Organizations",
    "sales_opportunities": "Opportunities",
    "finance_io": "Insertion Orders",
}


MODULE_LINKS = {
    "sales_contacts": "/dashboard/sales/contacts",
    "sales_organizations": "/dashboard/sales/organizations",
    "sales_opportunities": "/dashboard/sales/opportunities",
    "finance_io": "/dashboard/finance/insertion-orders",
}


def _notify_job_state(
    db: Session,
    *,
    job: DataTransferJob,
    title: str,
    message: str,
) -> None:
    if not job.actor_user_id:
        return
    from app.modules.platform.services.notifications import create_notification

    create_notification(
        db,
        tenant_id=job.tenant_id,
        user_id=job.actor_user_id,
        category="data_transfer",
        title=title,
        message=message,
        link_url=MODULE_LINKS.get(job.module_key),
        metadata={
            "job_id": job.id,
            "module_key": job.module_key,
            "operation_type": job.operation_type,
            "status": job.status,
        },
    )


def should_background_data_transfer(*, row_count: int | None = None) -> bool:
    return should_background_data_transfer_with_size(row_count=row_count, file_size_bytes=None)


def should_background_data_transfer_with_size(
    *,
    row_count: int | None = None,
    file_size_bytes: int | None = None,
) -> bool:
    if row_count is not None and row_count >= settings.DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD:
        return True
    if file_size_bytes is not None and file_size_bytes >= settings.DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD:
        return True
    return False


def create_data_transfer_job(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    operation_type: str,
    payload: dict | None = None,
    mode: str = "background",
) -> DataTransferJob:
    job = DataTransferJob(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        operation_type=operation_type,
        status="queued",
        mode=mode,
        payload=payload or None,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    module_name = MODULE_DISPLAY_NAMES.get(module_key, module_key)
    _notify_job_state(
        db,
        job=job,
        title=f"{operation_type.title()} queued",
        message=f"{operation_type.title()} for {module_name} has been queued in the background.",
    )
    return job


def enqueue_import_job(job_id: int) -> None:
    from app.tasks.data_transfer_tasks import process_import_job_task

    process_import_job_task.delay(job_id)


def enqueue_export_job(job_id: int) -> None:
    from app.tasks.data_transfer_tasks import process_export_job_task

    process_export_job_task.delay(job_id)


def mark_job_running(db: Session, job: DataTransferJob) -> DataTransferJob:
    from sqlalchemy import func

    job.status = "running"
    job.started_at = func.now()
    job.progress_percent = max(job.progress_percent or 0, 5)
    job.progress_message = "Job started."
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job_progress(
    db: Session,
    job: DataTransferJob,
    *,
    progress_percent: int,
    progress_message: str,
) -> DataTransferJob:
    job.progress_percent = max(0, min(int(progress_percent), 100))
    job.progress_message = progress_message[:255]
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_completed(
    db: Session,
    job: DataTransferJob,
    *,
    summary: dict | None = None,
    result_file_path: str | None = None,
    result_file_name: str | None = None,
    result_media_type: str | None = None,
) -> DataTransferJob:
    from sqlalchemy import func

    job.status = "completed"
    job.summary = summary or None
    job.result_file_path = result_file_path
    job.result_file_name = result_file_name
    job.result_media_type = result_media_type
    job.completed_at = func.now()
    job.error_message = None
    job.progress_percent = 100
    job.progress_message = "Completed."
    db.add(job)
    db.commit()
    db.refresh(job)
    module_name = MODULE_DISPLAY_NAMES.get(job.module_key, job.module_key)
    _notify_job_state(
        db,
        job=job,
        title=f"{job.operation_type.title()} completed",
        message=f"{job.operation_type.title()} for {module_name} completed successfully.",
    )
    return job


def mark_job_failed(db: Session, job: DataTransferJob, *, error_message: str, summary: dict | None = None) -> DataTransferJob:
    from sqlalchemy import func

    job.status = "failed"
    job.error_message = error_message
    job.summary = summary or None
    job.completed_at = func.now()
    job.progress_percent = min(max(job.progress_percent or 0, 0), 99)
    job.progress_message = "Failed."
    db.add(job)
    db.commit()
    db.refresh(job)
    module_name = MODULE_DISPLAY_NAMES.get(job.module_key, job.module_key)
    _notify_job_state(
        db,
        job=job,
        title=f"{job.operation_type.title()} failed",
        message=f"{job.operation_type.title()} for {module_name} failed: {error_message}",
    )
    return job


def list_data_transfer_jobs(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None = None,
    pagination: Pagination,
    module_key: str | None = None,
    operation_type: str | None = None,
):
    query = db.query(DataTransferJob).filter(DataTransferJob.tenant_id == tenant_id)
    if actor_user_id is not None:
        query = query.filter(DataTransferJob.actor_user_id == actor_user_id)
    if module_key:
        query = query.filter(DataTransferJob.module_key == module_key)
    if operation_type:
        query = query.filter(DataTransferJob.operation_type == operation_type)

    total = query.count()
    items = (
        query.order_by(DataTransferJob.created_at.desc())
        .offset((pagination.page - 1) * pagination.page_size)
        .limit(pagination.page_size)
        .all()
    )
    return items, total


def get_data_transfer_job_or_404(
    db: Session,
    *,
    job_id: int,
    tenant_id: int | None = None,
    actor_user_id: int | None = None,
    is_admin: bool = False,
) -> DataTransferJob:
    query = db.query(DataTransferJob).filter(DataTransferJob.id == job_id)
    if tenant_id is not None:
        query = query.filter(DataTransferJob.tenant_id == tenant_id)
    if actor_user_id is not None and not is_admin:
        query = query.filter(DataTransferJob.actor_user_id == actor_user_id)
    job = query.first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data transfer job not found.")
    return job


def get_job_result_path(job: DataTransferJob) -> Path:
    if not job.result_file_path or job.status != "completed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job result is not available.")
    path = Path(job.result_file_path).resolve()
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job result file no longer exists.")
    return path


def persist_job_upload(*, job_id: int, filename: str, file_bytes: bytes) -> str:
    job_dir = DATA_TRANSFER_UPLOAD_DIR / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / filename
    path.write_bytes(file_bytes)
    return str(path)


def persist_job_result(*, job_id: int, filename: str, content: bytes) -> str:
    job_dir = DATA_TRANSFER_UPLOAD_DIR / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / filename
    path.write_bytes(content)
    return str(path)


def process_import_job(*, job_id: int) -> None:
    db = SessionLocal()
    path: Path | None = None
    try:
        job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
        mark_job_running(db, job)
        update_job_progress(db, job, progress_percent=10, progress_message="Preparing import payload.")

        payload = job.payload or {}
        module_key = job.module_key
        actor_user_id = job.actor_user_id
        duplicate_mode = payload.get("duplicate_mode")
        file_path = payload.get("source_file_path")
        if not file_path:
            raise ValueError("Job source file path is missing.")
        path = Path(file_path)

        current_user = db.query(User).filter(User.id == actor_user_id).first() if actor_user_id else None
        file_bytes = path.read_bytes()
        update_job_progress(db, job, progress_percent=25, progress_message="Validating import file.")

        if module_key == "sales_contacts":
            from app.modules.sales.services.contacts_services import import_contacts_from_csv
            from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

            update_job_progress(db, job, progress_percent=65, progress_message="Importing contacts.")
            summary = import_contacts_from_csv(
                db,
                file_bytes,
                default_assigned_to=actor_user_id or 0,
                duplicate_mode=duplicate_mode,
                default_duplicate_mode=get_module_duplicate_mode(db, module_key),
            )
        elif module_key == "sales_organizations":
            from app.modules.sales.services.organizations_services import import_organizations_from_csv
            from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

            update_job_progress(db, job, progress_percent=65, progress_message="Importing organizations.")
            summary = import_organizations_from_csv(
                db=db,
                file_bytes=file_bytes,
                current_user=current_user,
                duplicate_mode=duplicate_mode,
                default_duplicate_mode=get_module_duplicate_mode(db, module_key),
            )
        elif module_key == "sales_opportunities":
            from app.modules.sales.services.opportunities_services import import_opportunities_from_csv
            from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

            update_job_progress(db, job, progress_percent=65, progress_message="Importing opportunities.")
            summary = import_opportunities_from_csv(
                db=db,
                file_bytes=file_bytes,
                current_user=current_user,
                duplicate_mode=duplicate_mode,
                default_duplicate_mode=get_module_duplicate_mode(db, module_key),
            )
        elif module_key == "finance_io":
            from app.modules.finance.services import io_search_api
            from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

            import asyncio

            update_job_progress(db, job, progress_percent=65, progress_message="Importing insertion orders.")
            summary = asyncio.run(
                io_search_api.import_insertion_orders_csv(
                    db=db,
                    current_user=current_user,
                    file=None,
                    file_bytes=file_bytes,
                    duplicate_mode=duplicate_mode,
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key),
                    replace_duplicates=False,
                    skip_duplicates=False,
                    create_new_records=False,
                )
            )
        else:
            raise ValueError(f"Unsupported import module '{module_key}'.")

        update_job_progress(db, job, progress_percent=90, progress_message="Finalizing import summary.")
        mark_job_completed(db, job, summary=summary)
    except Exception as exc:
        try:
            job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
            mark_job_failed(db, job, error_message=str(exc))
        except Exception:
            pass
    finally:
        try:
            if path and path.exists():
                path.unlink()
            if path and path.parent.exists() and not any(path.parent.iterdir()):
                path.parent.rmdir()
        except OSError:
            pass
        db.close()


def process_export_job(*, job_id: int) -> None:
    db = SessionLocal()
    try:
        job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
        mark_job_running(db, job)
        update_job_progress(db, job, progress_percent=10, progress_message="Preparing export job.")

        payload = job.payload or {}
        module_key = job.module_key
        mode = (payload.get("mode") or "all").strip().lower()
        selected_ids = list(payload.get("selected_ids") or [])
        current_page_ids = list(payload.get("current_page_ids") or [])
        export_ids = selected_ids if mode == "selected" else current_page_ids if mode == "current" else None
        actor_user_id = job.actor_user_id
        current_user = db.query(User).filter(User.id == actor_user_id).first() if actor_user_id else None
        update_job_progress(db, job, progress_percent=35, progress_message="Collecting records for export.")

        if module_key == "sales_contacts":
            from app.modules.sales.models import SalesContact
            from app.modules.sales.services.contacts_services import export_contacts_to_csv

            query = db.query(SalesContact).filter(SalesContact.deleted_at.is_(None))
            if export_ids:
                query = query.filter(SalesContact.contact_id.in_(export_ids))
            records = query.order_by(SalesContact.created_time.desc()).all()
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing contacts export.")
            content = export_contacts_to_csv(records)
            file_name = "sales_contacts.csv"
            media_type = "text/csv"
        elif module_key == "sales_organizations":
            from app.modules.sales.services.organizations_services import export_organizations

            update_job_progress(db, job, progress_percent=70, progress_message="Building organizations export package.")
            content, _ = export_organizations(db=db, org_ids=export_ids)
            file_name = "organizations_export.zip"
            media_type = "application/zip"
        elif module_key == "sales_opportunities":
            from app.modules.sales.models import SalesOpportunity
            from app.modules.sales.services.opportunities_services import export_opportunities_to_csv

            query = db.query(SalesOpportunity).filter(SalesOpportunity.deleted_at.is_(None))
            if export_ids:
                query = query.filter(SalesOpportunity.opportunity_id.in_(export_ids))
            records = query.order_by(SalesOpportunity.created_time.desc()).all()
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing opportunities export.")
            content = export_opportunities_to_csv(records)
            file_name = "sales_opportunities.csv"
            media_type = "text/csv"
        elif module_key == "finance_io":
            from app.modules.finance.models import FinanceIO
            from app.modules.finance.services.io_search_api import export_generic_insertion_orders
            from app.modules.finance.services.io_search_services import get_finance_module_id, get_finance_user_scope

            if export_ids:
                module_id = get_finance_module_id(db)
                user_scope = get_finance_user_scope(db, current_user)
                query = db.query(FinanceIO).filter(
                    FinanceIO.module_id == module_id,
                    FinanceIO.deleted_at.is_(None),
                )
                if user_scope.user_id_filter is not None:
                    query = query.filter(FinanceIO.user_id == user_scope.user_id_filter)
                query = query.filter(FinanceIO.id.in_(export_ids))
                records = query.order_by(FinanceIO.updated_at.desc()).all()
                from app.modules.finance.services.io_search_api import INSERTION_ORDER_EXPORT_HEADERS
                from app.core.module_export import dict_rows_to_csv_bytes

                update_job_progress(db, job, progress_percent=70, progress_message="Serializing insertion orders export.")
                content = dict_rows_to_csv_bytes(
                    headers=INSERTION_ORDER_EXPORT_HEADERS,
                    rows=(
                        {
                            "id": record.id,
                            "io_number": record.io_number or "",
                            "customer_name": record.customer_name or "",
                            "customer_contact_id": record.customer_contact_id or "",
                            "customer_organization_id": record.customer_organization_id or "",
                            "counterparty_reference": record.counterparty_reference or "",
                            "external_reference": record.external_reference or "",
                            "issue_date": record.issue_date.isoformat() if record.issue_date else "",
                            "effective_date": record.effective_date.isoformat() if record.effective_date else "",
                            "due_date": record.due_date.isoformat() if record.due_date else "",
                            "start_date": record.start_date.isoformat() if record.start_date else "",
                            "end_date": record.end_date.isoformat() if record.end_date else "",
                            "status": record.status or "",
                            "currency": record.currency or "",
                            "subtotal_amount": record.subtotal_amount if record.subtotal_amount is not None else "",
                            "tax_amount": record.tax_amount if record.tax_amount is not None else "",
                            "total_amount": record.total_amount if record.total_amount is not None else "",
                            "notes": record.notes or "",
                            "updated_at": record.updated_at.isoformat() if record.updated_at else "",
                        }
                        for record in records
                    ),
                )
            else:
                update_job_progress(db, job, progress_percent=70, progress_message="Serializing insertion orders export.")
                content = export_generic_insertion_orders(db, current_user)
            file_name = "insertion_orders.csv"
            media_type = "text/csv"
        else:
            raise ValueError(f"Unsupported export module '{module_key}'.")

        update_job_progress(db, job, progress_percent=90, progress_message="Writing export artifact.")
        result_path = persist_job_result(job_id=job.id, filename=file_name, content=content)
        summary = {
            "mode": mode,
            "exported_rows": len(export_ids) if export_ids is not None else None,
            "file_name": file_name,
        }
        mark_job_completed(
            db,
            job,
            summary=summary,
            result_file_path=result_path,
            result_file_name=file_name,
            result_media_type=media_type,
        )
    except Exception as exc:
        try:
            job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
            mark_job_failed(db, job, error_message=str(exc))
        except Exception:
            pass
    finally:
        db.close()
