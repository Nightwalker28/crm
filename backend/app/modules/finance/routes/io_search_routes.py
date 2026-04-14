from fastapi import APIRouter, Depends, File, UploadFile, status, Request, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination
from app.core.security import get_current_user
from app.core.permissions import require_action_access
from app.core.database import get_db
from app.modules.finance.schema import (
    InsertionOrderImportResponse,
    InsertionOrderCreateRequest,
    InsertionOrderListResponse,
    InsertionOrderResponse,
    InsertionOrderUpdateRequest,
)
from app.modules.finance.services import io_search_api

router = APIRouter(tags=["Finance"])


@router.get("/insertion-orders", response_model=InsertionOrderListResponse)
def list_insertion_orders(
    pagination: Pagination = Depends(get_pagination),
    request: Request = None,
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "view")),
):
    return io_search_api.list_generic_insertion_orders_page(
        db,
        current_user,
        pagination=pagination,
        request=request,
        search=search,
        status_filter=status_filter,
    )


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

@router.post("/insertion-orders/import", response_model=InsertionOrderImportResponse)
async def import_insertion_orders(
    file: UploadFile = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    require_permission = Depends(require_action_access("finance_io", "create")),
):
    return await io_search_api.import_insertion_orders_csv(
        db,
        current_user,
        file,
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
    require_permission = Depends(require_action_access("finance_io", "view")),
):
    """Download a specific insertion order file by io_number with the same access rules as listing."""
    file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, io_number)

    return FileResponse(
        file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
