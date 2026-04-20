from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.security import require_admin
from app.modules.platform.services.recycle_bin import (
    SUPPORTED_RECYCLE_MODULES,
    list_recycle_items,
    restore_recycle_item,
)

router = APIRouter(prefix="/recycle", tags=["Recycle Bin"])


@router.get("")
def get_recycle_items(
    module_key: str = Query(...),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    if module_key not in SUPPORTED_RECYCLE_MODULES:
        raise HTTPException(status_code=400, detail="Unsupported recycle module")
    return list_recycle_items(
        db,
        pagination=pagination,
        module_key=module_key,
        tenant_id=current_user.tenant_id,
    )


@router.post("/{module_key}/{record_id}/restore")
def restore_item(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    if module_key not in SUPPORTED_RECYCLE_MODULES:
        raise HTTPException(status_code=400, detail="Unsupported recycle module")
    try:
        return restore_recycle_item(
            db,
            module_key=module_key,
            record_id=record_id,
            current_user=current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
