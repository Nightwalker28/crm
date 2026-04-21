from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import (
    RecordCommentCreateRequest,
    RecordCommentListResponse,
    RecordCommentResponse,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.record_comments import (
    create_record_comment,
    delete_record_comment,
    get_record_comment_module_config,
    get_record_comment_or_404,
    list_record_comments,
)

router = APIRouter(prefix="/record-comments", tags=["Record Comments"])


@router.get("", response_model=RecordCommentListResponse)
def get_record_comments(
    module_key: str,
    entity_id: str,
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    get_record_comment_module_config(module_key)
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, "view")(current_user=current_user, db=db)

    items, total = list_record_comments(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        entity_id=entity_id,
        pagination=pagination,
    )
    serialized = [RecordCommentResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.post("", response_model=RecordCommentResponse)
def post_record_comment(
    payload: RecordCommentCreateRequest,
    module_key: str,
    entity_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    config = get_record_comment_module_config(module_key)
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, "edit")(current_user=current_user, db=db)

    comment, record = create_record_comment(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=module_key,
        entity_id=entity_id,
        body=payload.body,
    )
    record_label = getattr(record, config["label_field"], None) or f"record {entity_id}"
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=module_key,
        entity_type=config["entity_type"],
        entity_id=entity_id,
        action="comment_added",
        description=f"Added a note on {record_label}",
    )
    return RecordCommentResponse.model_validate(comment)


@router.delete("/{comment_id}")
def remove_record_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    comment = get_record_comment_or_404(
        db,
        comment_id=comment_id,
        tenant_id=current_user.tenant_id,
    )
    config = get_record_comment_module_config(comment.module_key)
    require_module_access(comment.module_key)(current_user=current_user, db=db)
    require_action_access(comment.module_key, "edit")(current_user=current_user, db=db)

    record = delete_record_comment(
        db,
        comment=comment,
        tenant_id=current_user.tenant_id,
    )
    record_label = getattr(record, config["label_field"], None) or f"record {comment.entity_id}"
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=comment.module_key,
        entity_type=config["entity_type"],
        entity_id=comment.entity_id,
        action="comment_deleted",
        description=f"Deleted a note on {record_label}",
    )
    return {"ok": True}
