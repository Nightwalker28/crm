"""The legacy Opportunity stage catalog and its configurable-pipeline seed.

Each tenant's default pipeline is seeded from this catalog with the same keys, so a
legacy value resolves to exactly one stage row by key and never by label. Tenants may
add stages of their own since 04-pipelines-kanban Phase 4; the catalog is the seed and
the fallback meaning for a deal with no stage reference, not the list of valid stages.
"""

from __future__ import annotations

from decimal import Decimal

OPPORTUNITY_STAGE_ORDER = [
    "lead",
    "qualified",
    "proposal",
    "negotiation",
    "closed_won",
    "closed_lost",
]

OPPORTUNITY_STAGE_LABELS = {
    "lead": "Lead",
    "qualified": "Qualified",
    "proposal": "Proposal",
    "negotiation": "Negotiation",
    "closed_won": "Closed won",
    "closed_lost": "Closed lost",
    "unstaged": "Unstaged",
}

OPPORTUNITY_STAGE_SET = set(OPPORTUNITY_STAGE_ORDER)
OPPORTUNITY_CLOSED_STAGE_SET = {"closed_won", "closed_lost"}

OPPORTUNITY_PIPELINE_MODULE_KEY = "sales_opportunities"
DEFAULT_OPPORTUNITY_PIPELINE_NAME = "Sales pipeline"

# What a stage means to business logic, independent of its editable label.
# `open` is an entry stage not yet under active pursuit; `ongoing` is active
# pursuit. Both are not-closed. `won` and `lost` are the two closed outcomes.
PIPELINE_STAGE_SEMANTIC_ORDER = ["open", "ongoing", "won", "lost"]
PIPELINE_STAGE_SEMANTIC_SET = set(PIPELINE_STAGE_SEMANTIC_ORDER)
PIPELINE_STAGE_CLOSED_SEMANTICS = {"won", "lost"}
PIPELINE_STAGE_SEMANTIC_CHECK_SQL = (
    "semantic_type IN (" + ", ".join(f"'{value}'" for value in PIPELINE_STAGE_SEMANTIC_ORDER) + ")"
)
PIPELINE_MODULE_CHECK_SQL = f"module_key IN ('{OPPORTUNITY_PIPELINE_MODULE_KEY}')"

OPPORTUNITY_STAGE_SEMANTIC_TYPES = {
    "lead": "open",
    "qualified": "ongoing",
    "proposal": "ongoing",
    "negotiation": "ongoing",
    "closed_won": "won",
    "closed_lost": "lost",
}

# The forecast weights reports have always applied, so a seeded pipeline forecasts
# exactly what the hardcoded report did.
OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES = {
    "lead": Decimal("10"),
    "qualified": Decimal("25"),
    "proposal": Decimal("50"),
    "negotiation": Decimal("75"),
    "closed_won": Decimal("100"),
    "closed_lost": Decimal("0"),
}


# A deal with no stage. It is open business, weighted as the forecast always
# weighted it, and sorts after every real stage.
OPPORTUNITY_UNSTAGED_KEY = "unstaged"
OPPORTUNITY_UNSTAGED_PROBABILITY = Decimal("10")


def normalize_legacy_opportunity_stage(stage: str | None) -> str | None:
    """The key a stored or submitted legacy stage value refers to, or None when blank."""

    normalized = (stage or "").strip().lower().replace(" ", "_")
    return normalized or None


def default_opportunity_pipeline_stages() -> list[dict]:
    """Seed rows for a tenant's default Opportunity pipeline, in board order."""

    return [
        {
            "key": key,
            "label": OPPORTUNITY_STAGE_LABELS[key],
            "position": position,
            "semantic_type": OPPORTUNITY_STAGE_SEMANTIC_TYPES[key],
            "probability": OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES[key],
        }
        for position, key in enumerate(OPPORTUNITY_STAGE_ORDER)
    ]
