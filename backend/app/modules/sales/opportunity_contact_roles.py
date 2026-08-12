"""Typed sales-domain catalog for the role a contact plays on an opportunity.

Kept next to `opportunity_stages` and shaped the same way so services, schema, and
the database check constraint all read one source. Roles describe a relationship
invariant, so the catalog stays domain configuration rather than layout metadata.
"""

from __future__ import annotations

OPPORTUNITY_CONTACT_ROLE_ORDER = [
    "decision_maker",
    "champion",
    "technical",
    "finance",
    "procurement",
    "legal",
    "influencer",
    "other",
]

OPPORTUNITY_CONTACT_ROLE_LABELS = {
    "decision_maker": "Decision maker",
    "champion": "Champion",
    "technical": "Technical",
    "finance": "Finance",
    "procurement": "Procurement",
    "legal": "Legal",
    "influencer": "Influencer",
    "other": "Other",
}

OPPORTUNITY_CONTACT_ROLE_SET = set(OPPORTUNITY_CONTACT_ROLE_ORDER)

# Backfilled and legacy-synchronized rows carry no stated role, so they land here
# rather than being guessed from anything.
DEFAULT_OPPORTUNITY_CONTACT_ROLE = "other"

OPPORTUNITY_CONTACT_ROLE_PATTERN = f"^({'|'.join(OPPORTUNITY_CONTACT_ROLE_ORDER)})$"
OPPORTUNITY_CONTACT_ROLE_CHECK_SQL = (
    "role_key IN (" + ", ".join(f"'{role}'" for role in OPPORTUNITY_CONTACT_ROLE_ORDER) + ")"
)


def opportunity_contact_role_label(role_key: str | None) -> str:
    """Display label for a stored role, falling back to the raw key.

    A role that is no longer in the catalog still has to render on an existing
    association rather than disappear from the relationship.
    """

    if not role_key:
        return OPPORTUNITY_CONTACT_ROLE_LABELS[DEFAULT_OPPORTUNITY_CONTACT_ROLE]
    return OPPORTUNITY_CONTACT_ROLE_LABELS.get(role_key, role_key)
