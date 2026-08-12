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


def normalize_opportunity_contact_role(role_key: str | None) -> str:
    """Validate a caller-supplied role against the catalog.

    Raises `ValueError` rather than an HTTP error so the catalog stays a plain
    sales-domain module; the service maps it to a 400. An omitted role is the
    default rather than a rejection, matching the backfill and the legacy mirror.
    A role that has left the catalog cannot be written even though existing rows
    keep rendering it.
    """

    if role_key is None:
        return DEFAULT_OPPORTUNITY_CONTACT_ROLE
    normalized = role_key.strip().lower()
    if normalized not in OPPORTUNITY_CONTACT_ROLE_SET:
        raise ValueError(f"Unsupported opportunity contact role: {role_key}")
    return normalized


def opportunity_contact_role_catalog() -> list[dict[str, str]]:
    """The selectable roles, in product order, for clients that render a picker."""

    return [
        {"key": role, "label": OPPORTUNITY_CONTACT_ROLE_LABELS[role]}
        for role in OPPORTUNITY_CONTACT_ROLE_ORDER
    ]
