from __future__ import annotations

import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.access_control import (
    get_finance_user_scope,
    require_department_module_access,
    require_role_module_action_access,
)
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.job_errors import safe_data_transfer_error, technical_job_error
from app.core.json_serialization import to_json_safe
from app.core.pagination import Pagination
from app.modules.platform.models import DataTransferJob
from app.modules.user_management.models import User


DATA_TRANSFER_UPLOAD_DIR = Path(__file__).resolve().parents[4] / "uploads" / "data-transfer-jobs"
DATA_TRANSFER_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


MODULE_DISPLAY_NAMES = {
    "calendar": "Calendar",
    "sales_leads": "Leads",
    "sales_contacts": "Contacts",
    "sales_organizations": "Organizations",
    "sales_opportunities": "Opportunities",
    "sales_quotes": "Quotes",
    "finance_io": "Insertion Orders",
    "reports": "Reports",
    "inventory_stock": "Inventory stock",
    "inventory_deliveries": "Deliveries",
    "inventory_returns": "Returns",
    "purchase_orders": "Purchase orders",
    "purchase_receipts": "Receipts",
}
TRANSIENT_JOB_ERRORS = (OSError, ConnectionError, TimeoutError, OperationalError)
TERMINAL_JOB_STATUSES = {"completed", "failed"}
logger = logging.getLogger(__name__)


MODULE_LINKS = {
    "calendar": "/dashboard/calendar",
    "sales_leads": "/dashboard/sales/leads",
    "sales_contacts": "/dashboard/sales/contacts",
    "sales_organizations": "/dashboard/sales/organizations",
    "sales_opportunities": "/dashboard/sales/opportunities",
    "sales_quotes": "/dashboard/sales/quotes",
    "finance_io": "/dashboard/finance/insertion-orders",
    "reports": "/dashboard/reports",
    "inventory_stock": "/dashboard/inventory/stock",
    "inventory_deliveries": "/dashboard/inventory/deliveries",
    "inventory_returns": "/dashboard/inventory/returns",
    "purchase_orders": "/dashboard/purchasing/orders",
    "purchase_receipts": "/dashboard/purchasing/receipts",
}
DOWNLOAD_ACTION_BY_OPERATION = {
    "export": "export",
    "report_export": "export",
    "import": "create",
}


def _operation_label(operation_type: str) -> str:
    return "Report export" if operation_type == "report_export" else operation_type.title()


def require_data_transfer_module_access(
    db: Session,
    *,
    current_user: User,
    module_key: str,
    action: str,
) -> None:
    try:
        require_department_module_access(db, user=current_user, module_key=module_key)
        require_role_module_action_access(db, user=current_user, module_key=module_key, action=action)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def require_data_transfer_job_access(
    db: Session,
    *,
    current_user: User,
    job: DataTransferJob,
    action: str = "view",
) -> None:
    access_module = "inventory_adjustments" if job.module_key == "inventory_stock" and job.operation_type == "import" and action == "create" else job.module_key
    require_data_transfer_module_access(db, current_user=current_user, module_key=access_module, action=action)
    if job.operation_type == "report_export":
        source_key = (job.payload or {}).get("source_module_key")
        if not isinstance(source_key, str):
            raise HTTPException(status_code=404, detail="Report export source is unavailable")
        # Report sources that are not modules of their own answer to the module they read.
        permission_key = {"inventory_movements": "inventory_stock", "inventory_backorders": "sales_orders", "purchase_lines": "purchase_orders"}.get(source_key, source_key)
        require_data_transfer_module_access(db, current_user=current_user, module_key=permission_key, action="view")


def data_transfer_download_action(job: DataTransferJob) -> str:
    return DOWNLOAD_ACTION_BY_OPERATION.get(job.operation_type, "view")


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


def _notify_job_state_safely(
    db: Session,
    *,
    job: DataTransferJob,
    title: str,
    message: str,
) -> None:
    try:
        _notify_job_state(db, job=job, title=title, message=message)
    except Exception:
        db.rollback()
        logger.exception(
            "Background job notification creation failed",
            extra={"job_id": job.id, "tenant_id": job.tenant_id, "status": job.status},
        )


def _commit_job_state(db: Session, *, job: DataTransferJob, state: str) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    try:
        db.refresh(job)
    except Exception:
        logger.exception(
            "Background job could not be refreshed after commit",
            extra={"job_id": job.id, "tenant_id": job.tenant_id, "status": state},
        )


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
        payload=to_json_safe(payload) if payload is not None else None,
    )
    db.add(job)
    _commit_job_state(db, job=job, state="queued")
    module_name = MODULE_DISPLAY_NAMES.get(module_key, module_key)
    _notify_job_state_safely(
        db,
        job=job,
        title=f"{_operation_label(operation_type)} queued",
        message=f"{_operation_label(operation_type)} for {module_name} has been queued in the background.",
    )
    return job


def _get_job_actor(db: Session, *, job: DataTransferJob) -> User | None:
    if not job.actor_user_id:
        return None
    return (
        db.query(User)
        .filter(
            User.id == job.actor_user_id,
            User.tenant_id == job.tenant_id,
        )
        .first()
    )


def enqueue_import_job(job_id: int) -> None:
    from app.tasks.data_transfer_tasks import process_import_job_task

    process_import_job_task.delay(job_id)


def enqueue_export_job(job_id: int) -> None:
    from app.tasks.data_transfer_tasks import process_export_job_task

    process_export_job_task.delay(job_id)


def mark_job_running(db: Session, job: DataTransferJob) -> DataTransferJob:
    from sqlalchemy import func

    if job.status in TERMINAL_JOB_STATUSES:
        return job
    job.status = "running"
    job.started_at = func.now()
    job.progress_percent = max(job.progress_percent or 0, 5)
    job.progress_message = "Job started."
    db.add(job)
    _commit_job_state(db, job=job, state="running")
    return job


def update_job_progress(
    db: Session,
    job: DataTransferJob,
    *,
    progress_percent: int,
    progress_message: str,
) -> DataTransferJob:
    if job.status in TERMINAL_JOB_STATUSES:
        return job
    job.progress_percent = max(0, min(int(progress_percent), 100))
    job.progress_message = progress_message[:255]
    db.add(job)
    _commit_job_state(db, job=job, state="running")
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

    if job.status in TERMINAL_JOB_STATUSES:
        return job
    normalized_summary = to_json_safe(summary) if summary is not None else None
    job.status = "completed"
    job.summary = normalized_summary
    job.result_file_path = result_file_path
    job.result_file_name = result_file_name
    job.result_media_type = result_media_type
    job.completed_at = func.now()
    job.error_message = None
    job.progress_percent = 100
    job.progress_message = "Completed."
    db.add(job)
    _commit_job_state(db, job=job, state="completed")
    module_name = MODULE_DISPLAY_NAMES.get(job.module_key, job.module_key)
    _notify_job_state_safely(
        db,
        job=job,
        title=f"{_operation_label(job.operation_type)} completed",
        message=f"{_operation_label(job.operation_type)} for {module_name} completed successfully.",
    )
    return job


def mark_job_failed(db: Session, job: DataTransferJob, *, error_message: str, summary: dict | None = None) -> DataTransferJob:
    from sqlalchemy import func

    if job.status in TERMINAL_JOB_STATUSES:
        return job
    normalized_summary = to_json_safe(summary) if summary is not None else None
    job.status = "failed"
    job.error_message = technical_job_error(error_message)
    job.summary = normalized_summary
    job.completed_at = func.now()
    job.progress_percent = min(max(job.progress_percent or 0, 0), 99)
    job.progress_message = "Failed."
    db.add(job)
    _commit_job_state(db, job=job, state="failed")
    _notify_job_state_safely(
        db,
        job=job,
        title=f"{_operation_label(job.operation_type)} failed",
        message=safe_data_transfer_error(module_key=job.module_key, operation_type=job.operation_type),
    )
    return job


def mark_data_transfer_job_failed_by_id(*, job_id: int, error_message: str | None = None) -> None:
    with SessionLocal() as db:
        job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
        mark_job_failed(
            db,
            job,
            error_message=technical_job_error(error_message),
        )


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


def list_data_transfer_jobs_cursor(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None = None,
    limit: int,
    cursor: int | None = None,
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
    if cursor is not None:
        query = query.filter(DataTransferJob.id < cursor)
    return query.order_by(None).order_by(DataTransferJob.id.desc()).limit(limit + 1).all()


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


def persist_job_result(*, job_id: int, filename: str, content: bytes | Path) -> str:
    job_dir = DATA_TRANSFER_UPLOAD_DIR / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / filename
    if isinstance(content, Path):
        with content.open("rb") as source, path.open("wb") as target:
            shutil.copyfileobj(source, target)
    else:
        path.write_bytes(content)
    return str(path)


def _delete_data_transfer_file(path: Path) -> bool:
    resolved_path = path.resolve()
    allowed_root = DATA_TRANSFER_UPLOAD_DIR.resolve()
    if allowed_root not in resolved_path.parents and resolved_path != allowed_root:
        return False
    try:
        if resolved_path.exists():
            resolved_path.unlink()
        parent = resolved_path.parent
        if parent.exists() and parent != allowed_root and not any(parent.iterdir()):
            parent.rmdir()
        return True
    except OSError:
        return False


def cleanup_expired_data_transfer_results(db: Session) -> int:
    retention_days = max(settings.DATA_TRANSFER_RESULT_RETENTION_DAYS, 1)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    jobs = (
        db.query(DataTransferJob.id, DataTransferJob.result_file_path)
        .filter(
            DataTransferJob.operation_type.in_(["export", "report_export"]),
            DataTransferJob.status == "completed",
            DataTransferJob.result_file_path.isnot(None),
            DataTransferJob.completed_at.isnot(None),
            DataTransferJob.completed_at < cutoff,
        )
        .all()
    )
    cleaned = 0
    for job in jobs:
        path = Path(job.result_file_path)
        if _delete_data_transfer_file(path):
            cleaned += 1
        (
            db.query(DataTransferJob)
            .filter(DataTransferJob.id == job.id)
            .update(
                {
                    DataTransferJob.result_file_path: None,
                    DataTransferJob.result_file_name: None,
                    DataTransferJob.result_media_type: None,
                },
                synchronize_session=False,
            )
        )
    if jobs:
        db.commit()
    return cleaned


def cleanup_expired_data_transfer_results_job() -> int:
    with SessionLocal() as db:
        return cleanup_expired_data_transfer_results(db)


def process_import_job(*, job_id: int) -> None:
    path: Path | None = None
    try:
        with SessionLocal() as db:
            job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
            if job.status in TERMINAL_JOB_STATUSES:
                return
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

            current_user = _get_job_actor(db, job=job)
            if actor_user_id is not None and current_user is None:
                raise ValueError("Job actor was not found in the job tenant.")
            file_bytes = path.read_bytes()
            update_job_progress(db, job, progress_percent=25, progress_message="Validating import file.")

            if module_key == "sales_leads":
                from app.modules.sales.services.leads_services import import_leads_from_csv
                from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

                update_job_progress(db, job, progress_percent=65, progress_message="Importing leads.")
                summary = import_leads_from_csv(
                    db,
                    file_bytes,
                    tenant_id=job.tenant_id,
                    default_assigned_to=actor_user_id,
                    duplicate_mode=duplicate_mode,
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
                )
            elif module_key == "sales_contacts":
                from app.modules.sales.services.contacts_import_service import import_contacts_from_csv
                from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

                update_job_progress(db, job, progress_percent=65, progress_message="Importing contacts.")
                summary = import_contacts_from_csv(
                    db,
                    file_bytes,
                    tenant_id=job.tenant_id,
                    default_assigned_to=actor_user_id or 0,
                    duplicate_mode=duplicate_mode,
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
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
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
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
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
                )
            elif module_key == "sales_quotes":
                from app.modules.sales.services.quotes_services import import_quotes_from_csv
                from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

                update_job_progress(db, job, progress_percent=65, progress_message="Importing quotes.")
                summary = import_quotes_from_csv(
                    db,
                    file_bytes,
                    tenant_id=job.tenant_id,
                    default_assigned_to=actor_user_id,
                    duplicate_mode=duplicate_mode,
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
                )
            elif module_key == "finance_io":
                from app.modules.finance.services import io_search_api
                from app.modules.user_management.services.admin_modules import get_module_duplicate_mode

                update_job_progress(db, job, progress_percent=65, progress_message="Importing insertion orders.")
                summary = io_search_api.import_insertion_orders_csv_bytes(
                    db=db,
                    current_user=current_user,
                    file_bytes=file_bytes,
                    duplicate_mode=duplicate_mode,
                    default_duplicate_mode=get_module_duplicate_mode(db, module_key, tenant_id=job.tenant_id),
                    replace_duplicates=False,
                    skip_duplicates=False,
                    create_new_records=False,
                )
            elif module_key == "inventory_stock":
                from app.modules.inventory.services.opening_import import import_opening_stock

                if current_user is None:
                    raise ValueError("Opening stock import has no actor")
                for action in ("create", "edit"):
                    require_data_transfer_module_access(db, current_user=current_user, module_key="inventory_adjustments", action=action)
                update_job_progress(db, job, progress_percent=65, progress_message="Posting opening stock.")
                summary = import_opening_stock(db, tenant_id=job.tenant_id, actor_user_id=current_user.id, file_bytes=file_bytes, job_id=job.id)
            else:
                raise ValueError(f"Unsupported import module '{module_key}'.")

            update_job_progress(db, job, progress_percent=90, progress_message="Finalizing import summary.")
            mark_job_completed(db, job, summary=summary)
    finally:
        try:
            if path and path.exists():
                path.unlink()
            if path and path.parent.exists() and not any(path.parent.iterdir()):
                path.parent.rmdir()
        except OSError:
            pass


def process_export_job(*, job_id: int) -> None:
    with SessionLocal() as db:
        job = get_data_transfer_job_or_404(db, job_id=job_id, actor_user_id=None, is_admin=True)
        if job.status in TERMINAL_JOB_STATUSES:
            return
        mark_job_running(db, job)
        update_job_progress(db, job, progress_percent=10, progress_message="Preparing export job.")

        payload = job.payload or {}
        module_key = job.module_key
        mode = (payload.get("mode") or "all").strip().lower()
        selected_ids = list(payload.get("selected_ids") or [])
        current_page_ids = list(payload.get("current_page_ids") or [])
        export_ids = selected_ids if mode == "selected" else current_page_ids if mode == "current" else None
        search = (payload.get("search") or "").strip() or None
        status_filter = (payload.get("status") or "").strip() or None
        all_filter_conditions = payload.get("filters_all") or None
        any_filter_conditions = payload.get("filters_any") or None
        actor_user_id = job.actor_user_id
        current_user = _get_job_actor(db, job=job)
        if actor_user_id is not None and current_user is None:
            raise ValueError("Job actor was not found in the job tenant.")
        if job.operation_type == "report_export":
            from app.modules.platform.services import report_engine

            if current_user is None:
                raise ValueError("Report export has no subscriber")
            require_data_transfer_module_access(db, current_user=current_user, module_key="reports", action="export")
            source_key = payload["source_module_key"]
            require_data_transfer_module_access(db, current_user=current_user, module_key=source_key, action="view")
            if payload["config"].get("format") == "tabular":
                total = report_engine.run_records(db, current_user, module_key=source_key, config=payload["config"], group_keys=None, offset=0, limit=1)["total"]
                if total > 100_000:
                    raise ValueError("Report has more than 100,000 records; narrow its filters before exporting")
            file_format = payload["format"]
            if file_format == "xlsx":
                content = report_engine.report_xlsx_bytes(db, current_user, module_key=source_key, config=payload["config"], max_records=100_000)
                media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            elif file_format == "csv":
                content = report_engine.report_csv_bytes(db, current_user, module_key=source_key, config=payload["config"], max_records=100_000)
                media_type = "text/csv"
            else:
                raise ValueError("Unsupported report export format")
            file_name = f"report-{job.id}.{file_format}"
            result_path = persist_job_result(job_id=job.id, filename=file_name, content=content)
            mark_job_completed(db, job, summary={"file_name": file_name}, result_file_path=result_path, result_file_name=file_name, result_media_type=media_type)
            return
        update_job_progress(db, job, progress_percent=35, progress_message="Collecting records for export.")
        exported_rows = 0

        if module_key == "sales_leads":
            from app.modules.sales.models import SalesLead
            from app.modules.sales.services.leads_services import export_leads_to_csv
            from app.modules.sales.services.leads_services import list_all_sales_leads

            if export_ids is not None:
                query = db.query(SalesLead).filter(
                    SalesLead.tenant_id == job.tenant_id,
                    SalesLead.deleted_at.is_(None),
                    SalesLead.lead_id.in_(export_ids),
                )
                records = query.order_by(SalesLead.created_time.desc()).all()
            else:
                records = list_all_sales_leads(
                    db,
                    job.tenant_id,
                    search=search,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                )
            exported_rows = len(records)
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing leads export.")
            content = export_leads_to_csv(records, field_keys=payload.get("field_keys"))
            file_name = "sales_leads.csv"
            media_type = "text/csv"
        elif module_key == "sales_contacts":
            from app.modules.sales.models import SalesContact
            from app.modules.sales.services.contacts_export_service import export_contacts_to_csv
            from app.modules.sales.services.contacts_services import list_all_sales_contacts

            if export_ids is not None:
                query = db.query(SalesContact).filter(
                    SalesContact.tenant_id == job.tenant_id,
                    SalesContact.deleted_at.is_(None),
                    SalesContact.contact_id.in_(export_ids),
                )
                records = query.order_by(SalesContact.created_time.desc()).all()
            else:
                records = list_all_sales_contacts(
                    db,
                    job.tenant_id,
                    search=search,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                )
            exported_rows = len(records)
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing contacts export.")
            content = export_contacts_to_csv(records, field_keys=payload.get("field_keys"))
            file_name = "sales_contacts.csv"
            media_type = "text/csv"
        elif module_key == "sales_organizations":
            from app.modules.sales.services.organizations_services import export_organizations
            from app.modules.sales.services.organizations_services import export_organizations_for_view

            update_job_progress(db, job, progress_percent=70, progress_message="Building organizations export package.")
            if export_ids is not None:
                content, export_meta = export_organizations(
                    db=db,
                    tenant_id=job.tenant_id,
                    org_ids=export_ids,
                    field_keys=payload.get("field_keys"),
                )
            else:
                content, export_meta = export_organizations_for_view(
                    db=db,
                    tenant_id=job.tenant_id,
                    search=search,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                    field_keys=payload.get("field_keys"),
                )
            exported_rows = exported_rows or int(export_meta.get("rows") or 0)
            file_name = "organizations_export.zip"
            media_type = "application/zip"
        elif module_key == "sales_opportunities":
            from app.modules.sales.models import SalesOpportunity
            from app.modules.sales.services.opportunities_services import export_opportunities_to_csv
            from app.modules.sales.services.opportunities_services import list_all_opportunities

            if export_ids is not None:
                query = db.query(SalesOpportunity).filter(
                    SalesOpportunity.tenant_id == job.tenant_id,
                    SalesOpportunity.deleted_at.is_(None),
                    SalesOpportunity.opportunity_id.in_(export_ids),
                )
                records = query.order_by(SalesOpportunity.created_time.desc()).all()
            else:
                records = list_all_opportunities(
                    db,
                    job.tenant_id,
                    search=search,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                )
            exported_rows = len(records)
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing opportunities export.")
            content = export_opportunities_to_csv(records, field_keys=payload.get("field_keys"))
            file_name = "sales_opportunities.csv"
            media_type = "text/csv"
        elif module_key == "sales_quotes":
            from app.modules.sales.models import SalesQuote
            from app.modules.sales.services.quotes_services import export_quotes_to_csv, list_all_sales_quotes

            if export_ids is not None:
                query = db.query(SalesQuote).filter(
                    SalesQuote.tenant_id == job.tenant_id,
                    SalesQuote.deleted_at.is_(None),
                    SalesQuote.quote_id.in_(export_ids),
                )
                records = query.order_by(SalesQuote.created_time.desc()).all()
            else:
                records = list_all_sales_quotes(
                    db,
                    job.tenant_id,
                    search=search,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                )
            exported_rows = len(records)
            update_job_progress(db, job, progress_percent=70, progress_message="Serializing quotes export.")
            content = export_quotes_to_csv(records, field_keys=payload.get("field_keys"))
            file_name = "sales_quotes.csv"
            media_type = "text/csv"
        elif module_key == "inventory_stock":
            from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse
            from app.modules.catalog.models import CatalogProduct
            from app.core.module_export import dict_rows_to_csv_bytes

            if current_user is None:
                raise ValueError("Inventory export has no actor")
            require_data_transfer_module_access(db, current_user=current_user, module_key="inventory_stock", action="export")
            export_kind = payload.get("kind")
            if export_kind == "levels":
                rows = db.query(InventoryStockLevel, CatalogProduct, InventoryWarehouse).join(CatalogProduct, CatalogProduct.id == InventoryStockLevel.product_id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(InventoryStockLevel.tenant_id == job.tenant_id, CatalogProduct.tenant_id == job.tenant_id, InventoryWarehouse.tenant_id == job.tenant_id).order_by(InventoryStockLevel.id).all()
                headers = ("sku", "product", "warehouse_code", "on_hand", "reserved", "available", "reorder_point")
                content = dict_rows_to_csv_bytes(headers=headers, rows=({"sku": product.sku, "product": product.name, "warehouse_code": warehouse.code,
                    "on_hand": level.on_hand, "reserved": level.reserved, "available": level.on_hand - level.reserved,
                    "reorder_point": product.reorder_point} for level, product, warehouse in rows))
            elif export_kind == "movements":
                rows = db.query(InventoryStockMove, CatalogProduct, InventoryWarehouse).join(CatalogProduct, CatalogProduct.id == InventoryStockMove.product_id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockMove.warehouse_id).filter(InventoryStockMove.tenant_id == job.tenant_id, CatalogProduct.tenant_id == job.tenant_id, InventoryWarehouse.tenant_id == job.tenant_id).order_by(InventoryStockMove.id).all()
                headers = ("id", "occurred_at", "sku", "product", "warehouse_code", "move_type", "quantity", "on_hand_after", "source_type", "source_id", "unit_cost")
                content = dict_rows_to_csv_bytes(headers=headers, rows=({"id": move.id, "occurred_at": move.occurred_at,
                    "sku": product.sku, "product": product.name, "warehouse_code": warehouse.code,
                    "move_type": move.move_type, "quantity": move.quantity, "on_hand_after": move.on_hand_after,
                    "source_type": move.source_type, "source_id": move.source_id, "unit_cost": move.unit_cost} for move, product, warehouse in rows))
            else:
                raise ValueError("Inventory export kind must be levels or movements")
            exported_rows = len(rows)
            file_name = f"inventory_{export_kind}.csv"
            media_type = "text/csv"
        elif module_key in {"inventory_deliveries", "inventory_returns"}:
            from app.core.module_export import dict_rows_to_csv_bytes
            from app.modules.inventory.models import InventoryDelivery, InventoryReturn
            from app.modules.inventory.services.delivery_services import serialize_delivery
            from app.modules.inventory.services.return_services import serialize_return

            if current_user is None:
                raise ValueError("Inventory export has no actor")
            require_data_transfer_module_access(db, current_user=current_user, module_key=module_key, action="export")
            if module_key == "inventory_deliveries":
                docs = db.query(InventoryDelivery).filter(InventoryDelivery.tenant_id == job.tenant_id, InventoryDelivery.deleted_at.is_(None)).order_by(InventoryDelivery.id).all()
                rows = [serialize_delivery(db, tenant_id=job.tenant_id, doc=doc, include_lines=False) for doc in docs]
                headers = ("number", "status", "order_number", "customer_name", "warehouse_name", "shipped_on", "carrier", "tracking_number", "total_quantity", "posted_at", "cancel_reason")
            else:
                docs = db.query(InventoryReturn).filter(InventoryReturn.tenant_id == job.tenant_id, InventoryReturn.deleted_at.is_(None)).order_by(InventoryReturn.id).all()
                rows = [serialize_return(db, tenant_id=job.tenant_id, doc=doc, include_lines=False) for doc in docs]
                headers = ("number", "status", "reason", "delivery_number", "order_number", "customer_name", "warehouse_name", "total_quantity", "received_at", "cancel_reason")
            content = dict_rows_to_csv_bytes(headers=headers, rows=({key: row.get(key) for key in headers} for row in rows))
            exported_rows = len(rows)
            file_name = f"{module_key}.csv"
            media_type = "text/csv"
        elif module_key in {"purchase_orders", "purchase_receipts"}:
            from app.core.module_export import dict_rows_to_csv_bytes
            from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt
            from app.modules.purchasing.services.purchase_order_services import serialize_order
            from app.modules.purchasing.services.receipt_services import serialize_receipt

            if current_user is None:
                raise ValueError("Purchasing export has no actor")
            require_data_transfer_module_access(db, current_user=current_user, module_key=module_key, action="export")
            if module_key == "purchase_orders":
                docs = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == job.tenant_id, PurchaseOrder.deleted_at.is_(None)).order_by(PurchaseOrder.id).all()
                rows = [serialize_order(db, tenant_id=job.tenant_id, order=doc, include_lines=False) for doc in docs]
                headers = ("number", "status", "receipt_status", "vendor_name", "warehouse_name", "currency", "subtotal", "expected_date", "vendor_reference", "ordered_at", "close_reason", "cancel_reason")
            else:
                docs = db.query(PurchaseReceipt).filter(PurchaseReceipt.tenant_id == job.tenant_id, PurchaseReceipt.deleted_at.is_(None)).order_by(PurchaseReceipt.id).all()
                rows = [serialize_receipt(db, tenant_id=job.tenant_id, receipt=doc, include_lines=False) for doc in docs]
                headers = ("number", "status", "order_number", "vendor_name", "warehouse_name", "received_on", "vendor_delivery_ref", "total_quantity", "posted_at", "cancel_reason")
            content = dict_rows_to_csv_bytes(headers=headers, rows=({key: row.get(key) for key in headers} for row in rows))
            exported_rows = len(rows)
            file_name = f"{module_key}.csv"
            media_type = "text/csv"
        elif module_key == "finance_io":
            from app.modules.finance.models import FinanceIO
            from app.modules.finance.services.io_search_api import (
                INSERTION_ORDER_EXPORT_HEADERS,
                export_generic_insertion_orders,
                serialize_insertion_order_export_row,
            )
            from app.modules.finance.services.io_search_services import get_finance_module_id

            if export_ids:
                module_id = get_finance_module_id(db)
                user_scope = get_finance_user_scope(db, current_user)
                query = db.query(FinanceIO).filter(
                    FinanceIO.tenant_id == job.tenant_id,
                    FinanceIO.module_id == module_id,
                    FinanceIO.deleted_at.is_(None),
                )
                if user_scope.user_id_filter is not None:
                    query = query.filter(FinanceIO.user_id == user_scope.user_id_filter)
                query = query.filter(FinanceIO.id.in_(export_ids))
                records = query.order_by(FinanceIO.updated_at.desc()).all()
                exported_rows = len(records)
                from app.core.module_export import dict_rows_to_csv_bytes
                field_keys = [
                    field for field in (payload.get("field_keys") or INSERTION_ORDER_EXPORT_HEADERS)
                    if field in INSERTION_ORDER_EXPORT_HEADERS
                ] or ["id", "io_number"]

                update_job_progress(db, job, progress_percent=70, progress_message="Serializing insertion orders export.")
                content = dict_rows_to_csv_bytes(
                    headers=field_keys,
                    rows=(serialize_insertion_order_export_row(record) for record in records),
                )
            else:
                update_job_progress(db, job, progress_percent=70, progress_message="Serializing insertion orders export.")
                content, exported_rows = export_generic_insertion_orders(
                    db,
                    current_user,
                    search=search,
                    status_filter=status_filter,
                    all_filter_conditions=all_filter_conditions,
                    any_filter_conditions=any_filter_conditions,
                    field_keys=payload.get("field_keys"),
                )
            file_name = "insertion_orders.csv"
            media_type = "text/csv"
        else:
            raise ValueError(f"Unsupported export module '{module_key}'.")

        update_job_progress(db, job, progress_percent=90, progress_message="Writing export artifact.")
        temp_content_path = content if isinstance(content, Path) else None
        try:
            result_path = persist_job_result(job_id=job.id, filename=file_name, content=content)
        finally:
            if temp_content_path is not None:
                temp_content_path.unlink(missing_ok=True)
        summary = {
            "mode": mode,
            "exported_rows": exported_rows,
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
