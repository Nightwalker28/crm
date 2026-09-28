"""Query construction for configurable sales pipelines and their stages."""

from __future__ import annotations

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from app.modules.sales.models import SalesOpportunity, SalesPipeline, SalesPipelineStage
from app.modules.sales.opportunity_stages import OPPORTUNITY_STAGE_SEMANTIC_TYPES, PIPELINE_STAGE_CLOSED_SEMANTICS


def get_default_pipeline(db: Session, *, tenant_id: int, module_key: str) -> SalesPipeline | None:
    return (
        db.query(SalesPipeline)
        .options(selectinload(SalesPipeline.stages))
        .filter(
            SalesPipeline.tenant_id == tenant_id,
            SalesPipeline.module_key == module_key,
            SalesPipeline.is_default.is_(True),
        )
        .first()
    )


def get_stage_by_key(db: Session, *, tenant_id: int, pipeline_id: int, key: str) -> SalesPipelineStage | None:
    """A stage by its stable key, active or not: history must still resolve."""

    return (
        db.query(SalesPipelineStage)
        .filter(
            SalesPipelineStage.tenant_id == tenant_id,
            SalesPipelineStage.pipeline_id == pipeline_id,
            SalesPipelineStage.key == key,
        )
        .first()
    )


def _legacy_keys_for(semantics: set[str]) -> list[str]:
    return sorted(key for key, semantic in OPPORTUNITY_STAGE_SEMANTIC_TYPES.items() if semantic in semantics)


def opportunity_semantic_clause(semantics: set[str]):
    """SQL: the deal's stage has one of `semantics`.

    Reads the stage row. A deal with no stage reference (only possible for rows
    written outside the pipeline service) falls back to the legacy key's seeded
    meaning, so no deal silently changes class during the compatibility period.
    """

    return or_(
        SalesOpportunity.pipeline_stage.has(SalesPipelineStage.semantic_type.in_(sorted(semantics))),
        # `sales_stage IS NOT NULL` keeps the clause two-valued, so negating it
        # still matches unstaged deals instead of dropping them as NULL.
        and_(
            SalesOpportunity.pipeline_stage_id.is_(None),
            SalesOpportunity.sales_stage.is_not(None),
            SalesOpportunity.sales_stage.in_(_legacy_keys_for(semantics)),
        ),
    )


def opportunity_closed_clause():
    return opportunity_semantic_clause(set(PIPELINE_STAGE_CLOSED_SEMANTICS))


def opportunity_won_clause():
    return opportunity_semantic_clause({"won"})


def list_stages_by_ids(db: Session, *, tenant_id: int, stage_ids: set[int]) -> list[SalesPipelineStage]:
    if not stage_ids:
        return []
    return (
        db.query(SalesPipelineStage)
        .filter(SalesPipelineStage.tenant_id == tenant_id, SalesPipelineStage.id.in_(sorted(stage_ids)))
        .all()
    )


def get_stage(db: Session, *, tenant_id: int, stage_id: int) -> SalesPipelineStage | None:
    return (
        db.query(SalesPipelineStage)
        .filter(SalesPipelineStage.tenant_id == tenant_id, SalesPipelineStage.id == stage_id)
        .first()
    )


def count_live_deals_by_stage(db: Session, *, tenant_id: int, pipeline_id: int) -> dict[int, int]:
    """Live (not soft-deleted) deals per stage row of one pipeline."""

    rows = (
        db.query(SalesOpportunity.pipeline_stage_id, func.count(SalesOpportunity.opportunity_id))
        .filter(
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.pipeline_id == pipeline_id,
            SalesOpportunity.pipeline_stage_id.is_not(None),
            SalesOpportunity.deleted_at.is_(None),
        )
        .group_by(SalesOpportunity.pipeline_stage_id)
        .all()
    )
    return {int(stage_id): int(count) for stage_id, count in rows}
