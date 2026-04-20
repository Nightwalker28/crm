from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_admin
from app.modules.platform.schema import ActivityLogListResponse, ActivityLogResponse
from app.modules.platform.services.activity_logs import list_activity_logs

router = APIRouter(prefix="/activity", tags=["Activity"])


@router.get("", response_model=ActivityLogListResponse)
def get_activity_logs(
    module_key: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
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
        action=action,
    )
    serialized = [ActivityLogResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)
