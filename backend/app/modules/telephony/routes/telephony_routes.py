from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_user
from app.modules.telephony.schema import CallLogCreateRequest, CallLogResponse
from app.modules.telephony.services.call_logs import log_record_call


router = APIRouter(prefix="/telephony", tags=["Telephony"])


@router.post(
    "/records/{module_key}/{entity_id}/calls",
    response_model=CallLogResponse,
    status_code=status.HTTP_201_CREATED,
)
def log_call_on_record(
    module_key: str,
    entity_id: str,
    payload: CallLogCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    # The record's module is a path parameter, so its three access layers (enabled,
    # department, `edit`) are checked in the service rather than by a fixed dependency.
    return log_record_call(
        db,
        current_user=current_user,
        module_key=module_key,
        entity_id=entity_id,
        payload=payload.model_dump(),
    )
