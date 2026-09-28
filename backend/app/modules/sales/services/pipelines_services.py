"""Configurable sales pipelines — Phase 1 of 04-pipelines-kanban.

During the compatibility period `sales_opportunities.sales_stage` still stores a
legacy stage key. This module seeds and resolves each tenant's default pipeline
and maps a legacy value to its stage row by stable key. Nothing here reads a
stage label to decide behaviour.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.sales.models import SalesPipeline, SalesPipelineStage
from app.modules.sales.opportunity_stages import (
    DEFAULT_OPPORTUNITY_PIPELINE_NAME,
    OPPORTUNITY_PIPELINE_MODULE_KEY,
    PIPELINE_STAGE_CLOSED_SEMANTICS,
    default_opportunity_pipeline_stages,
    normalize_legacy_opportunity_stage,
)
from app.modules.sales.repositories import pipelines_repository


def get_default_opportunity_pipeline(db: Session, tenant_id: int) -> SalesPipeline | None:
    return pipelines_repository.get_default_pipeline(
        db, tenant_id=tenant_id, module_key=OPPORTUNITY_PIPELINE_MODULE_KEY
    )


def ensure_default_opportunity_pipeline(db: Session, tenant_id: int) -> SalesPipeline:
    """The tenant's default Opportunity pipeline, seeding it on first use.

    The migration seeds every tenant that existed when it ran; this covers tenants
    created afterwards. It flushes but does not commit: the caller's transaction
    owns the seed, so a failed request leaves no half-seeded pipeline. A concurrent first use loses on the default-uniqueness
    index and reads the winner's row instead of creating a second default.
    """

    pipeline = get_default_opportunity_pipeline(db, tenant_id)
    if pipeline is not None:
        return pipeline

    try:
        with db.begin_nested():
            pipeline = SalesPipeline(
                tenant_id=tenant_id,
                module_key=OPPORTUNITY_PIPELINE_MODULE_KEY,
                name=DEFAULT_OPPORTUNITY_PIPELINE_NAME,
                is_default=True,
                is_active=True,
            )
            pipeline.stages = [
                SalesPipelineStage(tenant_id=tenant_id, is_active=True, **stage)
                for stage in default_opportunity_pipeline_stages()
            ]
            db.add(pipeline)
            db.flush()
    except IntegrityError:
        pipeline = get_default_opportunity_pipeline(db, tenant_id)
        if pipeline is None:
            raise
    return pipeline


def resolve_legacy_opportunity_stage(
    db: Session,
    tenant_id: int,
    sales_stage: str | None,
) -> SalesPipelineStage | None:
    """The stage row a stored `sales_stage` value refers to, or None.

    Blank and unknown values resolve to None ("unstaged") rather than being
    guessed. Inactive stages still resolve, so historical records stay readable.
    """

    key = normalize_legacy_opportunity_stage(sales_stage)
    if key is None:
        return None
    pipeline = ensure_default_opportunity_pipeline(db, tenant_id)
    return pipelines_repository.get_stage_by_key(db, tenant_id=tenant_id, pipeline_id=pipeline.id, key=key)


def is_closed_stage(stage: SalesPipelineStage | None) -> bool:
    return stage is not None and stage.semantic_type in PIPELINE_STAGE_CLOSED_SEMANTICS


def serialize_pipeline_stage(stage: SalesPipelineStage) -> dict:
    return {
        "id": stage.id,
        "key": stage.key,
        "label": stage.label,
        "position": stage.position,
        "semantic_type": stage.semantic_type,
        "is_closed": is_closed_stage(stage),
        "probability": float(stage.probability),
        "is_active": bool(stage.is_active),
    }


def serialize_pipeline(pipeline: SalesPipeline, *, include_inactive: bool = True) -> dict:
    stages = sorted(pipeline.stages, key=lambda stage: (stage.position, stage.id))
    if not include_inactive:
        stages = [stage for stage in stages if stage.is_active]
    return {
        "id": pipeline.id,
        "module_key": pipeline.module_key,
        "name": pipeline.name,
        "is_default": bool(pipeline.is_default),
        "is_active": bool(pipeline.is_active),
        "stages": [serialize_pipeline_stage(stage) for stage in stages],
    }
