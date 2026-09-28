"""Configurable sales pipelines — Phase 1 of 04-pipelines-kanban.

During the compatibility period `sales_opportunities.sales_stage` still stores a
legacy stage key. This module seeds and resolves each tenant's default pipeline
and maps a legacy value to its stage row by stable key. Nothing here reads a
stage label to decide behaviour.
"""

from __future__ import annotations

import re
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
    PIPELINE_STAGE_SEMANTIC_SET,
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


# ---------------------------------------------------------------------------
# Pipeline configuration (04 frontend Phase 2's backend): rename, re-weight,
# reclassify, deactivate/reactivate and reorder the stages of the tenant's
# default pipeline. Adding stages waits for the legacy `sales_stage` check
# constraint to go (Phase 4); a stage is never deleted, only deactivated.
# ---------------------------------------------------------------------------

STAGE_LABEL_MAX_LENGTH = 80


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _assert_pipeline_still_usable(stages: list[SalesPipelineStage]) -> None:
    """A pipeline must keep somewhere for a new deal to go.

    New deals and conversions start at an active stage that is not an outcome, so
    removing the last one would leave create forms with nothing to choose.
    """

    if not any(stage.is_active and stage.semantic_type not in PIPELINE_STAGE_CLOSED_SEMANTICS for stage in stages):
        raise _bad_request("The pipeline needs at least one active stage that is not won or lost")


def stage_usage(db: Session, tenant_id: int) -> dict:
    pipeline = ensure_default_opportunity_pipeline(db, tenant_id)
    counts = pipelines_repository.count_live_deals_by_stage(db, tenant_id=tenant_id, pipeline_id=pipeline.id)
    return {
        "pipeline_id": pipeline.id,
        "stages": [{"stage_id": stage.id, "live_deal_count": counts.get(stage.id, 0)} for stage in pipeline.stages],
    }


def update_pipeline_stage(db: Session, tenant_id: int, stage_id: int, changes: dict) -> SalesPipelineStage:
    """Apply a validated partial change to one stage. The caller commits.

    The stable `key` is not editable. A stage from another tenant is a 404, the
    same answer as one that does not exist.
    """

    stage = pipelines_repository.get_stage(db, tenant_id=tenant_id, stage_id=stage_id)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline stage not found")
    siblings = list(stage.pipeline.stages)

    if "label" in changes:
        label = (changes["label"] or "").strip()
        if not label:
            raise _bad_request("A stage needs a name")
        if len(label) > STAGE_LABEL_MAX_LENGTH:
            raise _bad_request(f"A stage name can be at most {STAGE_LABEL_MAX_LENGTH} characters")
        if any(other.id != stage.id and other.label.strip().lower() == label.lower() for other in siblings):
            raise _bad_request("Another stage in this pipeline already has that name")
        stage.label = label
    if "semantic_type" in changes:
        semantic_type = (changes["semantic_type"] or "").strip().lower()
        if semantic_type not in PIPELINE_STAGE_SEMANTIC_SET:
            raise _bad_request("Unsupported stage outcome")
        stage.semantic_type = semantic_type
    if "probability" in changes:
        probability = changes["probability"]
        if probability is None:
            raise _bad_request("A stage needs a probability")
        probability = Decimal(str(probability))
        if probability < 0 or probability > 100:
            raise _bad_request("Probability must be between 0 and 100")
        stage.probability = probability
    if "is_active" in changes and changes["is_active"] is not None:
        # Deals already in a deactivated stage stay there and stay readable; only new
        # assignments are refused (`assign_opportunity_stage`).
        stage.is_active = bool(changes["is_active"])

    _assert_pipeline_still_usable(siblings)
    db.flush()
    return stage


def reorder_pipeline_stages(db: Session, tenant_id: int, stage_ids: list[int]) -> SalesPipeline:
    """Set board order from a complete list of the pipeline's stage ids. The caller commits.

    The list must name every stage exactly once, inactive ones included, so a client
    working from a stale copy (a stage it has never seen) is refused rather than
    silently leaving that stage wherever it happened to fall.
    """

    pipeline = ensure_default_opportunity_pipeline(db, tenant_id)
    stages_by_id = {stage.id: stage for stage in pipeline.stages}
    if len(stage_ids) != len(set(stage_ids)) or set(stage_ids) != set(stages_by_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The stage order must list every stage of the pipeline exactly once; reload and try again",
        )
    for position, stage_id in enumerate(stage_ids):
        stages_by_id[stage_id].position = position
    db.flush()
    db.expire(pipeline, ["stages"])
    return pipeline


STAGE_KEY_MAX_LENGTH = 40
_RESERVED_STAGE_KEYS = {OPPORTUNITY_UNSTAGED_KEY}
_DEFAULT_PROBABILITY_BY_SEMANTIC = {
    "open": Decimal("10"),
    "ongoing": Decimal("50"),
    "won": Decimal("100"),
    "lost": Decimal("0"),
}


def _slug_stage_key(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if not slug or not slug[0].isalpha():
        slug = f"stage_{slug}".strip("_")
    return slug[:STAGE_KEY_MAX_LENGTH].rstrip("_")


def create_pipeline_stage(db: Session, tenant_id: int, data: dict) -> SalesPipelineStage:
    """Add a stage to the tenant's default pipeline. The caller commits.

    The key is the stage's permanent identity: supplied explicitly it must be free,
    derived from the name it gets a numeric suffix until it is. A stage that is not an
    outcome is placed before the first won/lost stage, where a new step of the sale
    belongs; an outcome goes last. Either can be moved afterwards.
    """

    pipeline = ensure_default_opportunity_pipeline(db, tenant_id)
    stages = list(pipeline.stages)

    label = (data.get("label") or "").strip()
    if not label:
        raise _bad_request("A stage needs a name")
    if len(label) > STAGE_LABEL_MAX_LENGTH:
        raise _bad_request(f"A stage name can be at most {STAGE_LABEL_MAX_LENGTH} characters")
    if any(stage.label.strip().lower() == label.lower() for stage in stages):
        raise _bad_request("Another stage in this pipeline already has that name")

    semantic_type = (data.get("semantic_type") or "ongoing").strip().lower()
    if semantic_type not in PIPELINE_STAGE_SEMANTIC_SET:
        raise _bad_request("Unsupported stage outcome")

    probability = data.get("probability")
    probability = _DEFAULT_PROBABILITY_BY_SEMANTIC[semantic_type] if probability is None else Decimal(str(probability))
    if probability < 0 or probability > 100:
        raise _bad_request("Probability must be between 0 and 100")

    taken = {stage.key for stage in stages} | _RESERVED_STAGE_KEYS
    requested_key = (data.get("key") or "").strip().lower()
    if requested_key:
        if not re.fullmatch(r"[a-z][a-z0-9_]*", requested_key) or len(requested_key) > STAGE_KEY_MAX_LENGTH:
            raise _bad_request(
                f"A stage key is lowercase letters, digits and underscores, starts with a letter, "
                f"and is at most {STAGE_KEY_MAX_LENGTH} characters"
            )
        if requested_key in taken:
            raise _bad_request("Another stage in this pipeline already uses that key")
        key = requested_key
    else:
        base = _slug_stage_key(label)
        key, suffix = base, 2
        while key in taken:
            tail = f"_{suffix}"
            key = f"{base[: STAGE_KEY_MAX_LENGTH - len(tail)]}{tail}"
            suffix += 1

    ordered = sorted(stages, key=lambda stage: (stage.position, stage.id))
    if semantic_type in PIPELINE_STAGE_CLOSED_SEMANTICS:
        insert_at = len(ordered)
    else:
        insert_at = next(
            (index for index, stage in enumerate(ordered) if stage.semantic_type in PIPELINE_STAGE_CLOSED_SEMANTICS),
            len(ordered),
        )
    for position, stage in enumerate(ordered):
        stage.position = position if position < insert_at else position + 1

    stage = SalesPipelineStage(
        tenant_id=tenant_id,
        pipeline_id=pipeline.id,
        key=key,
        label=label,
        position=insert_at,
        semantic_type=semantic_type,
        probability=probability,
        is_active=True,
    )
    db.add(stage)
    db.flush()
    db.expire(pipeline, ["stages"])
    return stage
