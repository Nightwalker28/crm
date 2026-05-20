from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Query

from app.core.module_search import apply_ranked_search


class PostgresSearchBackend:
    def apply_text_search(self, query: Query, *, search: str | None, document, default_order_column) -> Query:
        return apply_ranked_search(
            query,
            search=search,
            document=document,
            default_order_column=default_order_column,
        )

    def apply_cursor(self, query: Query, *, id_column, cursor: int | None) -> Query:
        if cursor is None:
            return query
        if cursor < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor")
        return query.filter(id_column < cursor)
