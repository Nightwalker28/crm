from __future__ import annotations

from sqlalchemy import ColumnElement

from app.core.postgres_search import apply_trigram_search


def apply_ranked_search(query, *, search: str | None, document, default_order_column: ColumnElement):
    if not search:
        return query.order_by(default_order_column.desc())

    filtered_query, rank = apply_trigram_search(query, search=search, document=document)
    if rank is None:
        return filtered_query.order_by(default_order_column.desc())
    return filtered_query.order_by(rank.desc(), default_order_column.desc())
