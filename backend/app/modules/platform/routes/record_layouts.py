from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.record_layout_schema import (
    RecordLayoutAdminStateResponse,
    RecordLayoutPreviewRequest,
    RecordLayoutPreviewResponse,
    RecordLayoutPublishRequest,
    ResolvedRecordLayoutResponse,
)
from app.modules.platform.services.record_layouts import (
    get_admin_record_layout,
    preview_record_layout,
    publish_record_layout,
    reset_record_layout,
    resolve_record_layout,
    validate_admin_module_and_surface,
    validate_module_and_surface,
)


router = APIRouter(prefix="/record-layouts", tags=["Record Layouts"])
admin_router = APIRouter(prefix="/admin/record-layouts", tags=["Record Layouts"])


@router.get("/{module_key}/{surface}/resolved", response_model=ResolvedRecordLayoutResponse)
def get_resolved_record_layout(
    module_key: str,
    surface: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    module_key, surface = validate_module_and_surface(module_key, surface)
    action = "create" if surface == "quick_create" else "view"
    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, action)(current_user=current_user, db=db)
    return resolve_record_layout(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        surface=surface,
    )


def _require_configure_access(module_key: str, *, current_user, db: Session) -> None:
    """Layout administration is a module configuration action, not a record action."""

    require_module_access(module_key)(current_user=current_user, db=db)
    require_action_access(module_key, "configure")(current_user=current_user, db=db)


@admin_router.get("/{module_key}/{surface}", response_model=RecordLayoutAdminStateResponse)
def get_record_layout_admin_state(
    module_key: str,
    surface: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    module_key, surface = validate_admin_module_and_surface(module_key, surface)
    _require_configure_access(module_key, current_user=current_user, db=db)
    return get_admin_record_layout(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        surface=surface,
    )


@admin_router.post("/{module_key}/{surface}/preview", response_model=RecordLayoutPreviewResponse)
def preview_record_layout_draft(
    module_key: str,
    surface: str,
    payload: RecordLayoutPreviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """Validate and resolve a candidate layout without publishing it."""

    module_key, surface = validate_admin_module_and_surface(module_key, surface)
    _require_configure_access(module_key, current_user=current_user, db=db)
    return preview_record_layout(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        surface=surface,
        definition=payload.definition,
    )


@admin_router.put("/{module_key}/{surface}", response_model=RecordLayoutAdminStateResponse)
def publish_tenant_record_layout(
    module_key: str,
    surface: str,
    payload: RecordLayoutPublishRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """Publish the tenant default. Takes effect for every user of the tenant immediately."""

    module_key, surface = validate_admin_module_and_surface(module_key, surface)
    _require_configure_access(module_key, current_user=current_user, db=db)
    return publish_record_layout(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key=module_key,
        surface=surface,
        definition=payload.definition,
        expected_version=payload.expected_version,
    )


@admin_router.delete("/{module_key}/{surface}", response_model=RecordLayoutAdminStateResponse)
def reset_tenant_record_layout(
    module_key: str,
    surface: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """Remove the tenant default so the system layout applies again."""

    module_key, surface = validate_admin_module_and_surface(module_key, surface)
    _require_configure_access(module_key, current_user=current_user, db=db)
    return reset_record_layout(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key=module_key,
        surface=surface,
    )
