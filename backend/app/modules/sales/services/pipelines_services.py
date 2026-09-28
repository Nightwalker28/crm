"""Configurable sales pipelines — Phase 1 of 04-pipelines-kanban.

During the compatibility period `sales_opportunities.sales_stage` still stores a
legacy stage key. This module seeds and resolves each tenant's default pipeline
and maps a legacy value to its stage row by stable key. Nothing here reads a
stage label to decide behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.sales.models import SalesOpportunity, SalesPipeline, SalesPipelineStage
from app.modules.sales.opportunity_stages import (
    DEFAULT_OPPORTUNITY_PIPELINE_NAME,
    OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES,
    OPPORTUNITY_STAGE_LABELS,
    OPPORTUNITY_STAGE_ORDER,
    OPPORTUNITY_STAGE_SEMANTIC_TYPES,
    OPPORTUNITY_UNSTAGED_KEY,
    OPPORTUNITY_UNSTAGED_PROBABILITY,
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


_UNSET = object()


def assign_opportunity_stage(
    db: Session,
    opportunity: SalesOpportunity,
    *,
    sales_stage=_UNSET,
    pipeline_stage_id=_UNSET,
) -> None:
    """Set a deal's stage, keeping the legacy key and the stage reference in step.

    The only writer of `sales_stage`, `pipeline_id` and `pipeline_stage_id` during
    the compatibility period (04-pipelines-kanban Phase 2). Callers pass the legacy
    key, the stage id, or both; both must name the same stage. The stage must
    belong to the deal's tenant, and an inactive stage or pipeline cannot be newly
    assigned, though a deal already in one may stay there. Passing neither just
    attaches the tenant default pipeline to a deal that has none.

    Raises 400 for anything unassignable. A stage id from another tenant is
    reported exactly like one that does not exist.
    """

    tenant_id = opportunity.tenant_id
    stage: SalesPipelineStage | None = None
    clears_stage = False

    if pipeline_stage_id is not _UNSET and pipeline_stage_id is not None:
        stage = (
            db.query(SalesPipelineStage)
            .filter(SalesPipelineStage.id == pipeline_stage_id, SalesPipelineStage.tenant_id == tenant_id)
            .first()
        )
        if stage is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline stage not found")
        if sales_stage is not _UNSET and sales_stage is not None:
            if normalize_legacy_opportunity_stage(sales_stage) != stage.key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="sales_stage and pipeline_stage_id name different stages",
                )
    elif sales_stage is not _UNSET and normalize_legacy_opportunity_stage(sales_stage) is not None:
        stage = resolve_legacy_opportunity_stage(db, tenant_id, sales_stage)
        if stage is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported opportunity stage")
    elif sales_stage is not _UNSET or pipeline_stage_id is not _UNSET:
        clears_stage = True

    if stage is None:
        if clears_stage:
            opportunity.sales_stage = None
            opportunity.pipeline_stage_id = None
            opportunity.pipeline_stage = None
        if opportunity.pipeline_id is None:
            opportunity.pipeline_id = ensure_default_opportunity_pipeline(db, tenant_id).id
        return

    if stage.id != opportunity.pipeline_stage_id:
        if not stage.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline stage is inactive")
        if not stage.pipeline.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pipeline is inactive")

    opportunity.pipeline_id = stage.pipeline_id
    opportunity.pipeline_stage_id = stage.id
    opportunity.pipeline_stage = stage
    opportunity.sales_stage = stage.key


@dataclass(frozen=True)
class OpportunityStageFacts:
    """What business logic may know about a deal's stage.

    Reports, forecasts, scans and events read these instead of comparing legacy
    keys or labels. `key` is `unstaged` when the deal has no stage.
    """

    key: str
    label: str
    semantic_type: str
    probability: Decimal
    position: int
    stage_id: int | None = None

    @property
    def is_closed(self) -> bool:
        return self.semantic_type in PIPELINE_STAGE_CLOSED_SEMANTICS

    @property
    def is_won(self) -> bool:
        return self.semantic_type == "won"

    @property
    def is_lost(self) -> bool:
        return self.semantic_type == "lost"


UNSTAGED_FACTS = OpportunityStageFacts(
    key=OPPORTUNITY_UNSTAGED_KEY,
    label=OPPORTUNITY_STAGE_LABELS[OPPORTUNITY_UNSTAGED_KEY],
    semantic_type="open",
    probability=OPPORTUNITY_UNSTAGED_PROBABILITY,
    position=10_000,
)


def stage_facts(stage: SalesPipelineStage) -> OpportunityStageFacts:
    return OpportunityStageFacts(
        key=stage.key,
        label=stage.label,
        semantic_type=stage.semantic_type,
        probability=Decimal(str(stage.probability)),
        position=stage.position,
        stage_id=stage.id,
    )


def legacy_stage_facts(sales_stage: str | None) -> OpportunityStageFacts:
    """Facts for a legacy key with no stage row, from the seeded catalog.

    Only rows written outside `assign_opportunity_stage` lack a reference; they
    keep exactly the meaning the key was seeded with. Unknown keys are unstaged.
    """

    key = normalize_legacy_opportunity_stage(sales_stage)
    if key not in OPPORTUNITY_STAGE_SEMANTIC_TYPES:
        return UNSTAGED_FACTS
    return OpportunityStageFacts(
        key=key,
        label=OPPORTUNITY_STAGE_LABELS[key],
        semantic_type=OPPORTUNITY_STAGE_SEMANTIC_TYPES[key],
        probability=OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES[key],
        position=OPPORTUNITY_STAGE_ORDER.index(key),
    )


def opportunity_stage_facts(opportunity) -> OpportunityStageFacts:
    stage = getattr(opportunity, "pipeline_stage", None)
    if stage is not None:
        return stage_facts(stage)
    return legacy_stage_facts(getattr(opportunity, "sales_stage", None))


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
