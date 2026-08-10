from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.record_layout_schema import ResolvedRecordLayoutResponse
from app.modules.platform.services.record_layouts import resolve_record_layout, validate_module_and_surface


router = APIRouter(prefix="/record-layouts", tags=["Record Layouts"])


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
