from pathlib import Path
from typing import Literal
import logging

from fastapi import HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
from app.core.duplicates import (
    detect_duplicates,
    drop_existing_duplicates,
    ensure_single_duplicate_action,
)
from app.core.pagination import Pagination, build_paged_response
from app.modules.platform.services.activity_logs import log_activity
from app.modules.finance.models import FinanceIO
from app.modules.finance.services.io_search_services import (
    IO_SEARCH_UPLOAD_DIR,
    create_insertion_order,
    get_finance_module_id,
    get_quarter_from_date,
    get_insertion_order_or_404,
    list_finance_io,
    list_insertion_orders,
    parse_io_files,
    persist_records_to_db,
    search_finance_io,
    soft_delete_insertion_order,
    update_insertion_order,
    _serialize_finance_record,
)

logger = logging.getLogger(__name__)


async def upload_multiple_docx(
    db: Session,
    current_user,
    files: list[UploadFile],
    *,
    replace_duplicates: bool,
    skip_duplicates: bool,
    create_new_records: bool,
):
    module_id = get_finance_module_id(db)
    try:
        ensure_single_duplicate_action(
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload one or more .docx or .pdf files.",
        )

    invalid_files = [f.filename for f in files if not f.filename.lower().endswith((".docx", ".pdf"))]
    if invalid_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only .docx or .pdf files are supported. Invalid files: {', '.join(invalid_files)}",
        )

    payload_map: dict[str, bytes] = {}
    for upload in files:
        file_name = Path(upload.filename).name
        content = await upload.read()

        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The uploaded file '{upload.filename}' is empty.",
            )

        payload_map[file_name] = content

    try:
        preview_records = parse_io_files(list(payload_map.items()), save_dir=None)
    except ValueError as exc:
        logger.warning("IO upload preview parse failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected IO upload preview parse failure")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to inspect uploaded files",
        ) from exc
    campaign_names_by_file: dict[str, str] = {}
    for record in preview_records:
        campaign = record.get("Campaign Name")
        if campaign:
            campaign_names_by_file[record["file_name"]] = campaign

    missing_campaign = [name for name in payload_map if name not in campaign_names_by_file]
    if missing_campaign:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing 'Campaign Name' in: {', '.join(missing_campaign)}",
        )

    uploaded_campaign_names = list(campaign_names_by_file.values())
    existing_duplicates = {
        row.campaign_name
        for row in db.query(FinanceIO.campaign_name)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.campaign_name.in_(uploaded_campaign_names),
            FinanceIO.deleted_at.is_(None),
        )
        .distinct()
    }

    detection = detect_duplicates(uploaded_campaign_names, existing_values=existing_duplicates)
    duplicate_campaigns = detection.duplicate_values
    if existing_duplicates and not any((replace_duplicates, skip_duplicates, create_new_records)):
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "message": (
                    "Duplicate campaigns detected. Resend with "
                    "replace_duplicates=true to overwrite them, "
                    "skip_duplicates=true to leave the existing campaigns untouched, or "
                    "create_new_records=true to add new records alongside the existing campaigns."
                ),
                "duplicate_campaigns": duplicate_campaigns,
                "requires_confirmation": True,
            },
        )

    campaign_payloads: dict[str, tuple[str, bytes]] = {}
    for file_name, content in payload_map.items():
        campaign = campaign_names_by_file.get(file_name)
        if not campaign:
            continue
        campaign_payloads[campaign] = (file_name, content)

    if skip_duplicates and existing_duplicates:
        campaign_payloads = drop_existing_duplicates(campaign_payloads, existing_duplicates)

    if not campaign_payloads:
        return {
            "message": "No new files were processed because all campaigns already exist for this user.",
            "duplicate_campaigns": duplicate_campaigns or None,
            "requires_confirmation": False,
        }

    docx_payloads = list(campaign_payloads.values())
    try:
        records = parse_io_files(docx_payloads, save_dir=IO_SEARCH_UPLOAD_DIR)
    except ValueError as exc:
        logger.warning("IO upload persistence parse failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected IO upload persistence parse failure")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to process uploaded files",
        ) from exc
    summary = persist_records_to_db(
        db,
        records,
        module_id=module_id,
        user_id=current_user.id,
        force_insert=create_new_records,
        replace_duplicates=replace_duplicates,
    )

    action_detail = ""
    if skip_duplicates and existing_duplicates:
        action_detail = f"Skipped {len(existing_duplicates)} existing campaign(s) for this user. "
    elif replace_duplicates and existing_duplicates:
        action_detail = f"Overwrote {len(existing_duplicates)} existing campaign(s) for this user. "
    elif create_new_records and existing_duplicates:
        action_detail = f"Created new records alongside {len(existing_duplicates)} existing campaign(s) for this user. "

    return {
        "message": (
            f"{action_detail}Processed {len(records)} record(s). "
            f"Inserted: {summary['inserted']}, updated: {summary['updated']}, "
            f"skipped duplicates: {len(summary['skipped_duplicates'])}."
        ).strip(),
        "duplicate_campaigns": duplicate_campaigns or None,
        "requires_confirmation": False,
    }


def get_downloadable_insertion_order(db: Session, current_user, io_number: str) -> tuple[Path, str]:
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    user_id_filter = user_scope.user_id_filter

    query = db.query(FinanceIO).filter(
        FinanceIO.module_id == module_id,
        FinanceIO.io_number == io_number,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id_filter is not None:
        query = query.filter(FinanceIO.user_id == user_id_filter)

    record = query.first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insertion order not found or not accessible.",
        )

    path_str = record.file_path or str(IO_SEARCH_UPLOAD_DIR / record.file_name)
    file_path = Path(path_str).resolve()

    try:
        allowed_root = IO_SEARCH_UPLOAD_DIR.resolve()
        if allowed_root not in file_path.parents and file_path != allowed_root:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file location.",
            )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve file path.",
        ) from exc

    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found.",
        )

    return file_path, record.file_name


def search_finance_files_page(
    db: Session,
    current_user,
    *,
    field: Literal[
        "file_name",
        "client_name",
        "campaign_name",
        "start_date",
        "end_date",
        "campaign_type",
        "total_leads",
        "seniority_split",
        "cpl",
        "total_cost_of_project",
        "target_persona",
        "targeting",
        "domain_cap",
        "target_geography",
        "delivery_format",
        "account_manager",
        "quarter",
    ],
    value: str,
    pagination: Pagination,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    user_id_filter = user_scope.user_id_filter

    try:
        matches, total_count = search_finance_io(
            db,
            field,
            value,
            module_id=module_id,
            user_id=user_id_filter,
            limit=pagination.limit,
            offset=pagination.offset,
            return_total=True,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported search field: {field}",
        ) from exc

    results = _serialize_finance_matches(matches, request=request, current_user=current_user, self_label="me")
    return build_paged_response(results, total_count, pagination)


def list_finance_files_page(
    db: Session,
    current_user,
    *,
    pagination: Pagination,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    user_id_filter = user_scope.user_id_filter

    total_count_query = db.query(FinanceIO).filter(
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id_filter is not None:
        total_count_query = total_count_query.filter(FinanceIO.user_id == user_id_filter)

    total_count = total_count_query.count()
    if pagination.page > 1 and pagination.offset >= total_count:
        return build_paged_response([], total_count, pagination)

    matches = list_finance_io(
        db,
        module_id=module_id,
        user_id=user_id_filter,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    results = _serialize_finance_matches(matches, request=request, current_user=current_user, self_label="You")
    return build_paged_response(results, total_count, pagination)


def list_generic_insertion_orders_page(
    db: Session,
    current_user,
    *,
    pagination: Pagination,
    request: Request | None,
    search: str | None = None,
    status_filter: str | None = None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    records, total_count = list_insertion_orders(
        db,
        module_id=module_id,
        user_id=user_scope.user_id_filter,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
    )
    return build_paged_response(
        [_serialize_finance_record(record, request=request, current_user=current_user) for record in records],
        total_count,
        pagination,
    )


def get_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
            db,
            module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _serialize_finance_record(record, request=request, current_user=current_user)


def create_generic_insertion_order(
    db: Session,
    current_user,
    *,
    data: dict,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    record = create_insertion_order(db, module_id=module_id, current_user=current_user, data=data)
    serialized = _serialize_finance_record(record, request=request, current_user=current_user)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        action="create",
        description=f"Created insertion order {record.io_number}",
        after_state=serialized,
    )
    return serialized


def update_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
    data: dict,
    request: Request | None,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
            db,
            module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    before_state = _serialize_finance_record(record, request=request, current_user=current_user)
    updated = update_insertion_order(db, record=record, current_user=current_user, data=data)
    serialized = _serialize_finance_record(updated, request=request, current_user=current_user)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=updated.id,
        action="update",
        description=f"Updated insertion order {updated.io_number}",
        before_state=before_state,
        after_state=serialized,
    )
    return serialized


def delete_generic_insertion_order(
    db: Session,
    current_user,
    *,
    io_id: int,
):
    module_id = get_finance_module_id(db)
    user_scope = get_finance_user_scope(db, current_user)
    try:
        record = get_insertion_order_or_404(
            db,
            module_id=module_id,
            io_id=io_id,
            user_id=user_scope.user_id_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    before_state = _serialize_finance_record(record, request=None, current_user=current_user)
    soft_delete_insertion_order(db, record=record)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="finance_insertion_orders",
        entity_type="finance_insertion_order",
        entity_id=record.id,
        action="soft_delete",
        description=f"Moved insertion order {record.io_number} to recycle bin",
        before_state=before_state,
    )


def _serialize_finance_matches(matches, *, request: Request | None, current_user, self_label: str):
    results = []
    for (
        io_number,
        file_name,
        file_path,
        campaign_name,
        updated_at,
        user_id,
        first_name,
        last_name,
        photo_url,
        client_name,
        cpl,
        start_date,
        end_date,
        campaign_type,
        account_manager,
        total_leads,
    ) in matches:
        full_name = " ".join([part for part in (first_name, last_name) if part]) or None
        user_name = self_label if current_user and user_id == current_user.id else full_name
        quarter = get_quarter_from_date(start_date)
        resolved_path = file_path or str(IO_SEARCH_UPLOAD_DIR / file_name)
        results.append(
            {
                "invoice_no": io_number,
                "file_url": str(request.url_for("download_insertion_order_file", io_number=io_number))
                if request and io_number
                else None,
                "campaign_name": campaign_name,
                "client_name": client_name,
                "cpl": cpl,
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat() if end_date else None,
                "campaign_type": campaign_type,
                "account_manager": account_manager,
                "total_leads": total_leads,
                "quarter": quarter,
                "file_path": resolved_path,
                "user_name": user_name,
                "photo_url": photo_url,
                "updated_at": updated_at.date().isoformat() if updated_at else None,
            }
        )

    return results
