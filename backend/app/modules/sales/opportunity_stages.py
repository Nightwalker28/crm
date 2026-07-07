from __future__ import annotations

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
    "closed_won": "Closed Won",
    "closed_lost": "Closed Lost",
    "unstaged": "Unstaged",
}

OPPORTUNITY_STAGE_SET = set(OPPORTUNITY_STAGE_ORDER)
OPPORTUNITY_CLOSED_STAGE_SET = {"closed_won", "closed_lost"}
OPPORTUNITY_STAGE_PATTERN = f"^({'|'.join(OPPORTUNITY_STAGE_ORDER)})$"
OPPORTUNITY_STAGE_CHECK_SQL = (
    "sales_stage IS NULL OR sales_stage IN ("
    + ", ".join(f"'{stage}'" for stage in OPPORTUNITY_STAGE_ORDER)
    + ")"
)
