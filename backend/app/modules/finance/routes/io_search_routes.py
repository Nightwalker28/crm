from typing import Literal

from fastapi import APIRouter, Depends, File, UploadFile, status, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination
from app.core.security import get_current_user
from app.core.database import get_db
from app.modules.finance.schema import DocxZipParseResponse, IOFileSearchResponse
from app.modules.finance.services import io_search_api

router = APIRouter(tags=["Finance"])

@router.post("/insertion-orders/upload", response_model=DocxZipParseResponse)
async def upload_multiple_docx(
    files: list[UploadFile] = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    return await io_search_api.upload_multiple_docx(
        db,
        current_user,
        files,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )


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
    file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, io_number)

    return FileResponse(
        file_path,
        filename=file_name,
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
    return io_search_api.search_finance_files_page(
        db,
        current_user,
        field=field,
        value=value,
        pagination=pagination,
        request=request,
    )


@router.get("/insertion-orders/all", response_model=IOFileSearchResponse)
def list_finance_files_paginated(
    pagination: Pagination = Depends(get_pagination),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Return paginated finance docx file names and paths (10 per page)."""
    return io_search_api.list_finance_files_page(
        db,
        current_user,
        pagination=pagination,
        request=request,
    )

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
