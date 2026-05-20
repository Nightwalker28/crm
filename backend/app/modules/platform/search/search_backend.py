from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.orm import Query


@dataclass(frozen=True)
class SearchQuery:
    tenant_id: int
    module_key: str
    search: str | None = None
    limit: int = 50
    cursor: int | None = None


class SearchBackend(Protocol):
    def apply_text_search(self, query: Query, *, search: str | None, document, default_order_column) -> Query:
        """Return a query with backend-specific search and ordering applied."""

    def apply_cursor(self, query: Query, *, id_column, cursor: int | None) -> Query:
        """Return a query with backend-specific cursor filtering applied."""
