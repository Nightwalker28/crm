"""A list route's saved-view conditions, read from its query string (13c §3.2).

Every list that takes saved views accepts the same four parameters `appendSavedViewFilterParams`
sends: `filters_all` and `filters_any` (JSON condition lists), or the older single `filters`
with `filter_logic`. Routes take them as one dependency so a list and its export job read
them the same way, and a bad payload is a 400 rather than a 500.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException, Query

from app.core.module_filters import apply_filter_conditions, normalize_filter_logic, parse_filter_conditions


@dataclass(frozen=True)
class ListConditions:
    all: list[dict[str, Any]] = field(default_factory=list)
    any: list[dict[str, Any]] = field(default_factory=list)

    def as_filters(self) -> dict[str, list[dict[str, Any]]]:
        """The `filters_all` / `filters_any` keys a `list_query` and an export job take."""
        return {"filters_all": self.all, "filters_any": self.any}


def list_conditions(
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
) -> ListConditions:
    logic = normalize_filter_logic(filter_logic)
    try:
        return ListConditions(
            all=parse_filter_conditions(filters_all or (filters if logic != "any" else None)),
            any=parse_filter_conditions(filters_any or (filters if logic == "any" else None)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def apply_list_conditions(query, *, field_map: dict[str, dict[str, Any]], filters_all=None, filters_any=None):
    """Both condition groups over one list's field map; unknown fields are ignored, as on every list."""
    query = apply_filter_conditions(query, conditions=filters_all, logic="all", field_map=field_map)
    return apply_filter_conditions(query, conditions=filters_any, logic="any", field_map=field_map)
