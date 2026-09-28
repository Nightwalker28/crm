"""Configuration of the tenant's deal pipeline (04-pipelines-kanban).

Reading the pipeline is part of reading deals and lives with the opportunity routes
(`GET /opportunities/pipeline`). Changing it is a `configure` concern on the
Opportunities module, so a salesperson can move deals between stages without being
able to redefine what the stages are. Routes own HTTP, auth, audit and
serialization; rules live in `pipelines_services`.

Mounted before the opportunities router so these literal paths are never read as an
opportunity id.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.schema import (
    SalesPipelineResponse,
    SalesPipelineStageOrderUpdate,
    SalesPipelineStageUpdate,
    SalesPipelineStageUsageResponse,
)
from app.modules.sales.services import pipelines_services

router = APIRouter(prefix="/opportunities/pipeline", tags=["Sales"])

MODULE_KEY = "sales_opportunities"


def _audit(db: Session, *, current_user, pipeline_id: int, description: str, before: dict, after: dict) -> None:
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=MODULE_KEY,
        entity_type="sales_pipeline",
        entity_id=pipeline_id,
        action="configure",
        description=description,
        before_state=before,
        after_state=after,
    )


@router.get("/stage-usage", response_model=SalesPipelineStageUsageResponse)
def get_pipeline_stage_usage(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "configure")),
):
    """Live deals per stage, so settings can warn before a change that affects them."""

    usage = pipelines_services.stage_usage(db, current_user.tenant_id)
    db.commit()
    return usage


@router.patch("/stages/{stage_id}", response_model=SalesPipelineResponse)
def update_pipeline_stage(
    stage_id: int,
    payload: SalesPipelineStageUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "configure")),
):
    pipeline = pipelines_services.ensure_default_opportunity_pipeline(db, current_user.tenant_id)
    before = pipelines_services.serialize_pipeline(pipeline)
    stage = pipelines_services.update_pipeline_stage(
        db, current_user.tenant_id, stage_id, payload.model_dump(exclude_unset=True)
    )
    db.commit()
    db.refresh(stage.pipeline)
    after = pipelines_services.serialize_pipeline(stage.pipeline)
    _audit(
        db,
        current_user=current_user,
        pipeline_id=stage.pipeline_id,
        description=f"Updated pipeline stage {stage.label}",
        before=before,
        after=after,
    )
    return after


@router.put("/stage-order", response_model=SalesPipelineResponse)
def reorder_pipeline_stages(
    payload: SalesPipelineStageOrderUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(MODULE_KEY)),
    require_permission=Depends(require_action_access(MODULE_KEY, "configure")),
):
    pipeline = pipelines_services.ensure_default_opportunity_pipeline(db, current_user.tenant_id)
    before = pipelines_services.serialize_pipeline(pipeline)
    pipeline = pipelines_services.reorder_pipeline_stages(db, current_user.tenant_id, payload.stage_ids)
    db.commit()
    db.refresh(pipeline)
    after = pipelines_services.serialize_pipeline(pipeline)
    _audit(
        db,
        current_user=current_user,
        pipeline_id=pipeline.id,
        description="Reordered pipeline stages",
        before=before,
        after=after,
    )
    return after
