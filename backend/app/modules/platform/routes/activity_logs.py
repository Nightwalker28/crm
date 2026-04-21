from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_admin, require_user
from app.modules.platform.schema import ActivityLogListResponse, ActivityLogResponse
from app.modules.platform.services.activity_logs import list_activity_logs

router = APIRouter(prefix="/activity", tags=["Activity"])

TIMELINE_ALLOWED_MODULES = {
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
}


@router.get("/record", response_model=ActivityLogListResponse)
def get_record_activity_logs(
    module_key: str = Query(...),
    entity_id: str = Query(...),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    if module_key not in TIMELINE_ALLOWED_MODULES:
        raise HTTPException(status_code=400, detail="Unsupported record timeline module")

    try:
        require_department_module_access(db, user=current_user, module_key=module_key)
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))

    items, total = list_activity_logs(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        module_key=module_key,
        entity_id=entity_id,
    )
    serialized = [ActivityLogResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.get("", response_model=ActivityLogListResponse)
def get_activity_logs(
    module_key: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    items, total = list_activity_logs(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        module_key=module_key,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
    )
    serialized = [ActivityLogResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)
