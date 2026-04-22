from fastapi import APIRouter, Body, Depends, File, UploadFile, status, Request, Query, HTTPException, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.security import get_current_user
from app.core.permissions import require_action_access
from app.core.database import get_db
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, parse_mapping_json, read_csv_upload, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.modules.finance.schema import (
    InsertionOrderCreateRequest,
    InsertionOrderListItem,
    InsertionOrderListResponse,
    InsertionOrderResponse,
    InsertionOrderUpdateRequest,
)
from app.modules.finance.services import io_search_api
from app.modules.user_management.services import admin_modules
from app.modules.platform.services.data_transfer_jobs import (
    create_data_transfer_job,
    enqueue_export_job,
    enqueue_import_job,
    persist_job_upload,
    should_background_data_transfer_with_size,
)
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest

router = APIRouter(tags=["Finance"])

INSERTION_ORDER_LIST_FIELDS = {
    "io_number",
    "customer_name",
    "status",
    "currency",
    "total_amount",
    "issue_date",
    "due_date",
    "external_reference",
    "user_name",
    "updated_at",
}

INSERTION_ORDER_IMPORT_TARGET_FIELDS = [
    "io_number",
    "customer_name",
    "customer_contact_id",
    "customer_organization_id",
    "create_customer_if_missing",
    "customer_email",
    "counterparty_reference",
    "external_reference",
    "issue_date",
    "effective_date",
    "due_date",
    "start_date",
    "end_date",
    "status",
    "currency",
    "subtotal_amount",
    "tax_amount",
    "total_amount",
    "notes",
]

INSERTION_ORDER_IMPORT_ALIASES = {
    "io_number": ["io", "io no", "io number", "order number"],
    "customer_name": ["customer", "client", "customer name", "client name"],
    "customer_contact_id": ["contact", "contact id", "customer contact id"],
    "customer_organization_id": ["organization", "organization id", "customer organization id", "org id"],
    "create_customer_if_missing": ["create customer", "create if missing"],
    "customer_email": ["email", "customer email", "client email"],
    "counterparty_reference": ["counterparty reference", "vendor reference"],
    "external_reference": ["reference", "external reference", "po number"],
    "issue_date": ["issue date"],
    "effective_date": ["effective date"],
    "due_date": ["due date"],
    "start_date": ["start date"],
    "end_date": ["end date"],
    "status": ["status"],
    "currency": ["currency"],
    "subtotal_amount": ["subtotal", "subtotal amount"],
    "tax_amount": ["tax", "tax amount"],
    "total_amount": ["total", "total amount"],
    "notes": ["notes", "description"],
}


def _parse_list_fields(raw_fields: str | None) -> set[str]:
    if not raw_fields:
        return INSERTION_ORDER_LIST_FIELDS
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & INSERTION_ORDER_LIST_FIELDS
    return valid or INSERTION_ORDER_LIST_FIELDS


def _serialize_insertion_order_list_item(record: dict, fields: set[str]) -> InsertionOrderListItem:
    safe_fields = set(fields)
    safe_fields.update(
        {
            "customer_contact_id",
            "customer_organization_id",
            "counterparty_reference",
            "external_reference",
            "effective_date",
            "start_date",
            "end_date",
            "subtotal_amount",
            "tax_amount",
            "total_amount",
            "status",
            "currency",
            "issue_date",
            "due_date",
            "notes",
            "custom_fields",
        }
    )
    payload = {"id": record["id"]}
    for field in safe_fields:
        payload[field] = record.get(field)
    return InsertionOrderListItem.model_validate(payload)


@router.get("/insertion-orders", response_model=InsertionOrderListResponse)
def list_insertion_orders(
    pagination: Pagination = Depends(get_pagination),
    request: Request = None,
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response = io_search_api.list_generic_insertion_orders_page(
        db,
        current_user,
        pagination=pagination,
        request=request,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields)
    response["results"] = [_serialize_insertion_order_list_item(item, selected_fields) for item in response["results"]]
    return response


@router.post("/insertion-orders", response_model=InsertionOrderResponse, status_code=status.HTTP_201_CREATED)
def create_insertion_order(
    payload: InsertionOrderCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "create")),
):
    return io_search_api.create_generic_insertion_order(
        db,
        current_user,
        data=payload.model_dump(),
        request=request,
    )


@router.get("/insertion-orders/{io_id}", response_model=InsertionOrderResponse)
def get_insertion_order(
    io_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "view")),
):
    return io_search_api.get_generic_insertion_order(
        db,
        current_user,
        io_id=io_id,
        request=request,
    )


@router.put("/insertion-orders/{io_id}", response_model=InsertionOrderResponse)
def update_insertion_order(
    io_id: int,
    payload: InsertionOrderUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "edit")),
):
    return io_search_api.update_generic_insertion_order(
        db,
        current_user,
        io_id=io_id,
        data=payload.model_dump(exclude_unset=True),
        request=request,
    )


@router.delete("/insertion-orders/{io_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_insertion_order(
    io_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "delete")),
):
    io_search_api.delete_generic_insertion_order(
        db,
        current_user,
        io_id=io_id,
    )

@router.post("/insertion-orders/import", response_model=ImportExecutionResponse)
async def import_insertion_orders(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    duplicate_mode: str | None = Query(default=None),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    mapping = parse_mapping_json(mapping_json, target_headers=INSERTION_ORDER_IMPORT_TARGET_FIELDS)
    remapped_file_bytes = remap_csv_bytes(
        file_bytes,
        target_headers=INSERTION_ORDER_IMPORT_TARGET_FIELDS,
        mapping=mapping,
    )
    _, remapped_rows = rows_from_csv_bytes(remapped_file_bytes)
    if should_background_data_transfer_with_size(
        row_count=len(remapped_rows),
        file_size_bytes=len(remapped_file_bytes),
    ):
        mode = duplicate_mode or admin_modules.get_module_duplicate_mode(db, "finance_io", tenant_id=current_user.tenant_id)
        job = create_data_transfer_job(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key="finance_io",
            operation_type="import",
            payload={"filename": file.filename, "row_count": len(remapped_rows), "duplicate_mode": mode},
        )
        stored_path = persist_job_upload(job_id=job.id, filename="insertion-orders-import.csv", file_bytes=remapped_file_bytes)
        job.payload = {
            **(job.payload or {}),
            "source_file_path": stored_path,
        }
        db.add(job)
        db.commit()
        db.refresh(job)
        enqueue_import_job(job.id)
        return ImportExecutionResponse(
            mode="background",
            message=f"Import queued in background as job #{job.id}.",
            job_id=job.id,
            job_status=job.status,
        )
    summary = await io_search_api.import_insertion_orders_csv(
        db,
        current_user,
        file=None,
        file_bytes=remapped_file_bytes,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "finance_io", tenant_id=current_user.tenant_id),
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    return ImportExecutionResponse(
        mode="inline",
        message=summary["message"],
        summary=StandardImportSummary(**summary),
    )


@router.post("/insertion-orders/import/preview")
async def preview_insertion_orders_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "create")),
):
    source_headers, _ = await read_csv_upload(file)
    return {
        "source_headers": source_headers,
        "target_headers": INSERTION_ORDER_IMPORT_TARGET_FIELDS,
        "required_headers": ["customer_name"],
        "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "finance_io", tenant_id=current_user.tenant_id),
        "suggested_mapping": suggest_header_mapping(
            source_headers=source_headers,
            target_headers=INSERTION_ORDER_IMPORT_TARGET_FIELDS,
            aliases=INSERTION_ORDER_IMPORT_ALIASES,
        ),
    }


@router.post("/insertion-orders/export", response_model=DataTransferExecutionResponse)
def export_insertion_orders(
    payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "export")),
):
    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_io",
        operation_type="export",
        payload=payload.model_dump(),
    )
    enqueue_export_job(job.id)
    return DataTransferExecutionResponse(
        mode="background",
        message=f"Export queued in background as job #{job.id}.",
        job_id=job.id,
        job_status=job.status,
    )


@router.get("/insertion-orders/files/{io_number}",
    response_class=FileResponse,
    name="download_insertion_order_file",
)
def download_insertion_order_file(
    io_number: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "view")),
):
    """Download a specific insertion order file by io_number with the same access rules as listing."""
    file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, io_number)

    return FileResponse(
        file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
