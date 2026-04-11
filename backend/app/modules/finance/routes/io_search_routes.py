import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import get_current_user
from app.core.database import get_db
from app.core.permissions import require_module_access
from app.core.duplicates import (
    detect_duplicates,
    drop_existing_duplicates,
    ensure_single_duplicate_action,
)
from app.modules.finance.models import FinanceIO
from app.modules.user_management.models import Team
from app.modules.finance.schema import DocxZipParseResponse, IOFileSearchResponse
from app.modules.finance.services.io_search_services import (
    IO_SEARCH_UPLOAD_DIR,
    DATE_FIELDS,
    DEFAULT_MODULE_ID,
    TEXT_SEARCHABLE_FIELDS,
    get_quarter_from_date,
    parse_io_files,
    list_finance_io,
    persist_records_to_db,
    search_finance_io,
)

router = APIRouter(tags=["Finance"])


def _get_user_department_and_filter(db: Session, current_user):
    """Return (department_id, user_id_filter) for view scoping.

    Department 2: can view all (user_id_filter=None).
    Department 3: restricted to own uploads (user_id_filter=current_user.id).
    Others / missing team: default to own uploads.
    """

    department_id = None
    if current_user and getattr(current_user, "team_id", None):
        team = db.query(Team).filter(Team.id == current_user.team_id).first()
        department_id = team.department_id if team else None

    if department_id == 2:
        return department_id, None

    return department_id, current_user.id if current_user else None

@router.post("/insertion-orders/upload", response_model=DocxZipParseResponse)
async def upload_multiple_docx(
    files: list[UploadFile] = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
    Upload multiple docx or PDF files at once and persist parsed tables to the finance_io table.
    When duplicate campaign names already exist for the same user, require an explicit confirmation via
    replace_duplicates (overwrite), skip_duplicates (ignore existing campaigns), or create_new_records
    (add new rows while keeping existing ones).
    """
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

        # Keep the last occurrence if the same file name is provided multiple times
        payload_map[file_name] = content

    # Parse once without persisting to discover campaign names per file
    preview_records = parse_io_files(list(payload_map.items()), save_dir=None)
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
            FinanceIO.module_id == DEFAULT_MODULE_ID,
            FinanceIO.campaign_name.in_(uploaded_campaign_names),
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

    # Keep the last occurrence per campaign_name
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
    records = parse_io_files(docx_payloads, save_dir=IO_SEARCH_UPLOAD_DIR)
    summary = persist_records_to_db(
        db,
        records,
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


@router.get("/insertion-orders/files/{io_number}",
    response_class=FileResponse,
    name="download_insertion_order_file",
)
def download_insertion_order_file(
    io_number: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Download a specific insertion order file by io_number with the same access rules as listing."""
    _, user_id_filter = _get_user_department_and_filter(db, current_user)

    query = db.query(FinanceIO).filter(
        FinanceIO.module_id == DEFAULT_MODULE_ID,
        FinanceIO.io_number == io_number,
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

    # Prevent leaking files outside the configured upload directory
    try:
        allowed_root = IO_SEARCH_UPLOAD_DIR.resolve()
        if allowed_root not in file_path.parents and file_path != allowed_root:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file location.",
            )
    except RuntimeError:
        # Path resolution error
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve file path.",
        )

    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found.",
        )

    return FileResponse(
        file_path,
        filename=record.file_name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.get("/insertion-orders/search", response_model=IOFileSearchResponse)
def search_finance_files(
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
        'targeting',
        "domain_cap",
        "target_geography",
        "delivery_format",
        "account_manager",
        "quarter",
    ],
    value: str,
    pagination: Pagination = Depends(get_pagination),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Search finance_io by a specific column and return matching file names and file paths on this host."""
    _, user_id_filter = _get_user_department_and_filter(db, current_user)

    try:
        matches, total_count = search_finance_io(
            db,
            field,
            value,
            user_id=user_id_filter,
            limit=pagination.limit,
            offset=pagination.offset,
            return_total=True,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported search field: {field}",
        )

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
        user_name = "me" if current_user and user_id == current_user.id else full_name
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

    return build_paged_response(results, total_count, pagination)


@router.get("/insertion-orders/all", response_model=IOFileSearchResponse)
def list_finance_files_paginated(
    pagination: Pagination = Depends(get_pagination),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Return paginated finance docx file names and paths (10 per page)."""
    _, user_id_filter = _get_user_department_and_filter(db, current_user)

    total_count_query = db.query(FinanceIO).filter(FinanceIO.module_id == DEFAULT_MODULE_ID)

    if user_id_filter is not None:
        total_count_query = total_count_query.filter(FinanceIO.user_id == user_id_filter)

    total_count = total_count_query.count()

    if pagination.page > 1 and pagination.offset >= total_count:
        # Requested page is beyond the result set
        return build_paged_response([], total_count, pagination)

    matches = list_finance_io(db, user_id=user_id_filter, limit=pagination.limit, offset=pagination.offset)

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
        user_name = "You" if current_user and user_id == current_user.id else full_name
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
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No finance IO files found",
        )
    return build_paged_response(results, total_count, pagination)

# commented for the future use needs to be updated according to the upcoming use case
# @router.delete("/insertion-orders/delete/{io_number}")
# def delete_insertion_order(
#     io_number: str,
#     db: Session = Depends(get_db),
#     current_user = Depends(get_current_user),
# ):
#     record = (
#         db.query(FinanceIO)
#         .filter(
#             FinanceIO.module_id == DEFAULT_MODULE_ID,
#             FinanceIO.io_number == io_number,
#         )
#         .first()
#     )

#     if not record:
#         raise HTTPException(
#             status_code=status.HTTP_404_NOT_FOUND,
#             detail="Insertion order not found.",
#         )

#     if not current_user or record.user_id != current_user.id:
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="Not authorized to delete this insertion order.",
#         )

#     path_str = record.file_path or str(IO_SEARCH_UPLOAD_DIR / record.file_name)
#     try:
#         file_path = Path(path_str).resolve()
#         if file_path.is_file():
#             file_path.unlink()
#     except Exception:
#         pass

#     db.delete(record)
#     db.commit()

#     return {"message": "Insertion order deleted successfully."}
