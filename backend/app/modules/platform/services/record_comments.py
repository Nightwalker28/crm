from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, require_role_module_action_access
from app.core.pagination import Pagination
from app.modules.catalog.models import CatalogProduct
from app.modules.platform.models import RecordComment
from app.modules.platform.services.notifications import create_notification
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.user_management.models import (
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    TeamModulePermission,
    User,
    UserStatus,
)

RECORD_COMMENT_MODULES = {
    "sales_contacts": {
        "model": SalesContact,
        "id_field": "contact_id",
        "entity_type": "sales_contact",
        "label_field": "primary_email",
        "record_path": "/dashboard/sales/contacts/{entity_id}",
    },
    "sales_organizations": {
        "model": SalesOrganization,
        "id_field": "org_id",
        "entity_type": "sales_organization",
        "label_field": "org_name",
        "record_path": "/dashboard/sales/organizations/{entity_id}",
    },
    "sales_opportunities": {
        "model": SalesOpportunity,
        "id_field": "opportunity_id",
        "entity_type": "sales_opportunity",
        "label_field": "opportunity_name",
        "record_path": "/dashboard/sales/opportunities/{entity_id}",
    },
    "catalog_products": {
        "model": CatalogProduct,
        "id_field": "id",
        "entity_type": "catalog_product",
        "label_field": "name",
        "record_path": "/dashboard/catalog/products/{entity_id}",
    },
}
INVALID_MENTION_DETAIL = "One or more mentioned users are invalid."


def get_record_comment_module_config(module_key: str) -> dict:
    config = RECORD_COMMENT_MODULES.get(module_key)
    if not config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported record comments module.")
    return config


def get_record_reference(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
):
    config = get_record_comment_module_config(module_key)
    model = config["model"]
    id_field = getattr(model, config["id_field"])
    try:
        normalized_entity_id = int(entity_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid record identifier.") from exc
    record = (
        db.query(model)
        .filter(
            model.tenant_id == tenant_id,
            id_field == normalized_entity_id,
            model.deleted_at.is_(None),
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found.")
    return record


def list_record_comments(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    pagination: Pagination,
) -> tuple[list[RecordComment], int]:
    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)

    query = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.tenant_id == tenant_id,
            RecordComment.module_key == module_key,
            RecordComment.entity_id == str(entity_id),
        )
    )
    total = query.count()
    items = (
        query.order_by(RecordComment.created_at.desc(), RecordComment.id.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total


def list_record_comments_cursor(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    limit: int,
    cursor: int | None = None,
) -> list[RecordComment]:
    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    query = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.tenant_id == tenant_id,
            RecordComment.module_key == module_key,
            RecordComment.entity_id == str(entity_id),
        )
    )
    if cursor is not None:
        query = query.filter(RecordComment.id < cursor)
    return query.order_by(None).order_by(RecordComment.id.desc()).limit(limit + 1).all()


def _display_user_name(user: User) -> str:
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email


def _user_can_view_record_module(db: Session, *, user: User, module_key: str) -> bool:
    try:
        require_role_module_action_access(db, user=user, module_key=module_key, action="view")
    except (PermissionError, ValueError):
        return False
    return True


def list_mentionable_record_users(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    query: str | None = None,
    limit: int = 8,
) -> list[dict]:
    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    normalized_query = (query or "").strip().lower()
    module = db.query(Module).filter(or_(Module.name == module_key, Module.base_route == module_key)).first()
    if not module:
        return []

    users_query = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.team))
        .filter(
            User.tenant_id == tenant_id,
            User.is_active == UserStatus.active,
        )
    )
    if normalized_query:
        like_query = f"%{normalized_query}%"
        users_query = users_query.filter(
            or_(
                func.lower(User.first_name).like(like_query),
                func.lower(User.last_name).like(like_query),
                func.lower(User.email).like(like_query),
                func.lower(func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")).like(like_query),
            )
        )

    users = users_query.order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc()).limit(max(limit * 5, limit)).all()
    role_ids_with_view = {
        role_id
        for (role_id,) in db.query(RoleModulePermission.role_id)
        .filter(RoleModulePermission.module_id == module.id, RoleModulePermission.can_view == 1)
        .all()
    }
    team_ids_with_access = {
        team_id
        for (team_id,) in db.query(TeamModulePermission.team_id)
        .filter(TeamModulePermission.module_id == module.id)
        .all()
    }
    department_ids_with_access = {
        department_id
        for (department_id,) in db.query(DepartmentModulePermission.department_id)
        .filter(DepartmentModulePermission.module_id == module.id)
        .all()
    }

    results: list[dict] = []
    for user in users:
        label = _display_user_name(user)
        role_level = getattr(getattr(user, "role", None), "level", None)
        is_admin = role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL
        department_id = user.department_id or getattr(getattr(user, "team", None), "department_id", None)
        can_view = is_admin or (
            bool(user.role_id and user.role_id in role_ids_with_view)
            and bool(
                (user.team_id and user.team_id in team_ids_with_access)
                or (department_id and department_id in department_ids_with_access)
            )
        )
        if not can_view:
            continue
        results.append({"id": user.id, "label": label, "email": user.email})
        if len(results) >= limit:
            break
    return results


def validate_record_mentions(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    entity_id: str | int,
    mentioned_user_ids: list[int] | None,
) -> list[User]:
    unique_ids = sorted({int(user_id) for user_id in (mentioned_user_ids or [])})
    if not unique_ids:
        return []

    get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    users = (
        db.query(User)
        .options(joinedload(User.role), joinedload(User.team))
        .filter(
            User.tenant_id == tenant_id,
            User.id.in_(unique_ids),
            User.is_active == UserStatus.active,
        )
        .all()
    )
    users_by_id = {int(user.id): user for user in users}
    if len(users_by_id) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_MENTION_DETAIL)

    allowed_users: list[User] = []
    for user_id in unique_ids:
        user = users_by_id[user_id]
        if not _user_can_view_record_module(db, user=user, module_key=module_key):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_MENTION_DETAIL)
        allowed_users.append(user)
    return allowed_users


def create_record_mention_notifications(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    actor_name: str,
    module_key: str,
    entity_id: str | int,
    record_label: str,
    mentioned_users: list[User],
    comment_id: int,
) -> None:
    config = get_record_comment_module_config(module_key)
    link_url = config["record_path"].format(entity_id=entity_id)
    for user in mentioned_users:
        if actor_user_id is not None and int(user.id) == int(actor_user_id):
            continue
        create_notification(
            db,
            tenant_id=tenant_id,
            user_id=user.id,
            category="record_mention",
            title=f"{actor_name} mentioned you",
            message=f"{actor_name} mentioned you in a note on {record_label}.",
            link_url=link_url,
            metadata={
                "module_key": module_key,
                "entity_id": str(entity_id),
                "comment_id": comment_id,
            },
        )


def create_record_comment(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    entity_id: str | int,
    body: str,
) -> tuple[RecordComment, object]:
    normalized_body = body.strip()
    if not normalized_body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Note body cannot be empty.")

    record = get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    comment = RecordComment(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_id=str(entity_id),
        body=normalized_body,
    )
    db.add(comment)
    db.commit()
    comment = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(RecordComment.id == comment.id, RecordComment.tenant_id == tenant_id)
        .first()
    )
    return comment, record


def get_record_comment_or_404(
    db: Session,
    *,
    comment_id: int,
    tenant_id: int,
) -> RecordComment:
    comment = (
        db.query(RecordComment)
        .options(joinedload(RecordComment.actor))
        .filter(
            RecordComment.id == comment_id,
            RecordComment.tenant_id == tenant_id,
        )
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record comment not found.")
    return comment


def delete_record_comment(
    db: Session,
    *,
    comment: RecordComment,
    tenant_id: int,
):
    record = get_record_reference(
        db,
        tenant_id=tenant_id,
        module_key=comment.module_key,
        entity_id=comment.entity_id,
    )
    db.delete(comment)
    db.commit()
    return record
