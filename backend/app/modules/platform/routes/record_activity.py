from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_user
from app.modules.platform.schema import RecordActivityListResponse
from app.modules.platform.services.record_activity import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    list_record_activity,
)

router = APIRouter(prefix="/records", tags=["Record Activity"])


@router.get("/{module_key}/{entity_id}/activity", response_model=RecordActivityListResponse)
def get_record_activity(
    module_key: str,
    entity_id: str,
    types: str | None = Query(
        default=None,
        description="Comma-separated activity types. Omit for all types the viewer may see.",
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    cursor: str | None = Query(default=None, description="Opaque cursor from a previous page."),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """Relationship activity for one record.

    This is the salesperson-facing interaction feed. Immutable audit history is
    served separately by ``/activity/record`` and must not be merged in here.

    Permissions are enforced per layer: record module enablement, department
    availability and role view access gate the endpoint, then each source
    adapter is dropped when the viewer lacks that source module's view access.
    """

    return list_record_activity(
        db,
        user=current_user,
        module_key=module_key,
        entity_id=entity_id,
        types=types,
        limit=limit,
        cursor=cursor,
    )
