from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_user
from app.modules.platform.services.clone_drafts import build_clone_draft

router = APIRouter(prefix="/records", tags=["Clone Drafts"])


class CloneDraftResponse(BaseModel):
    module_key: str
    source_id: int
    fields: dict[str, Any] = Field(default_factory=dict)
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    lines: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/{module_key}/{record_id}/clone-draft", response_model=CloneDraftResponse)
def get_clone_draft(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    """What a new record copies from this one (13b Phase 5). Read-only: the create form
    saves it as an ordinary create. Needs the module's view and create access."""

    return build_clone_draft(db, module_key=module_key, record_id=record_id, current_user=current_user)
