from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import (
    LinkedRecordTagListResponse,
    LinkedRecordTagResponse,
    LinkedRecordTeamListResponse,
    LinkedRecordTeamResponse,
    LinkedRecordUserListResponse,
    LinkedRecordUserResponse,
)
from app.modules.platform.services.linked_record_options import (
    list_linked_record_team_options,
    list_linked_record_user_options,
)
from app.modules.platform.services.record_tags import list_record_tag_options


router = APIRouter(prefix="/linked-record-options", tags=["Linked Record Options"])


#: The listing form's ceiling. The searching form's default stays at 10 — one screen of
#: matches for a typed string — while the record spine's Owner field asks for the whole set
#: at once, because `SearchableSelect` filters options it already holds (design.md 7.8). 500
#: is a seat count no tenant is expected to reach; passing it is reported rather than
#: silently truncated (7.9).
USER_OPTIONS_MAX_LIMIT = 500


@router.get("/users", response_model=LinkedRecordUserListResponse)
def get_linked_record_user_options(
    module_key: str = Query(..., min_length=1, max_length=100),
    # Optional, so the same endpoint can list as well as search. Empty used to be a 422,
    # which is why Owner could be searched from a form and not listed in the rail.
    query: str = Query(default="", max_length=100),
    action: Literal["create", "edit", "view"] = Query(default="create"),
    limit: int = Query(default=10, ge=1, le=USER_OPTIONS_MAX_LIMIT),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, action)(current_user=current_user, db=db)
    users, has_more = list_linked_record_user_options(
        db,
        tenant_id=current_user.tenant_id,
        query=query,
        limit=limit,
    )
    return {
        "results": [
            LinkedRecordUserResponse(
                id=user["id"],
                label=user["label"],
                email=user["email"],
            )
            for user in users
        ],
        "has_more": has_more,
    }


@router.get("/teams", response_model=LinkedRecordTeamListResponse)
def get_linked_record_team_options(
    module_key: str = Query(..., min_length=1, max_length=100),
    query: str = Query(..., min_length=1, max_length=100),
    action: Literal["create", "edit", "view"] = Query(default="create"),
    limit: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, action)(current_user=current_user, db=db)
    teams = list_linked_record_team_options(db, tenant_id=current_user.tenant_id, query=query, limit=limit)
    return {"results": [LinkedRecordTeamResponse(**team) for team in teams]}


@router.get("/tags", response_model=LinkedRecordTagListResponse)
def get_linked_record_tag_options(
    module_key: str = Query(..., min_length=1, max_length=100),
    query: str = Query(default="", max_length=100),
    action: Literal["create", "edit", "view"] = Query(default="create"),
    limit: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, action)(current_user=current_user, db=db)
    tags = list_record_tag_options(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        query=query,
        limit=limit,
    )
    return {"results": [LinkedRecordTagResponse(name=tag) for tag in tags]}
