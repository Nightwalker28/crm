from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import LinkedRecordUserListResponse, LinkedRecordUserResponse
from app.modules.platform.services.linked_record_options import list_linked_record_user_options


router = APIRouter(prefix="/linked-record-options", tags=["Linked Record Options"])


@router.get("/users", response_model=LinkedRecordUserListResponse)
def get_linked_record_user_options(
    module_key: str = Query(..., min_length=1, max_length=100),
    query: str = Query(..., min_length=1, max_length=100),
    action: Literal["create", "edit"] = Query(default="create"),
    limit: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, action)(current_user=current_user, db=db)
    users = list_linked_record_user_options(db, tenant_id=current_user.tenant_id, query=query, limit=limit)
    return {
        "results": [
            LinkedRecordUserResponse(
                id=user["id"],
                label=user["label"],
                email=user["email"],
            )
            for user in users
        ]
    }
