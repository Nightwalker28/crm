"""Query construction for configurable sales pipelines and their stages."""

from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.modules.sales.models import SalesPipeline, SalesPipelineStage


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
