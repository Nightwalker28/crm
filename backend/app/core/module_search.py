from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import ColumnElement

from app.core.postgres_search import apply_trigram_search


def apply_ranked_search(
    query,
    *,
    search: str | None,
    document,
    default_order_column: ColumnElement | None = None,
    default_order_by: Sequence[ColumnElement] | None = None,
):
    order_by = list(default_order_by) if default_order_by is not None else []
    if not order_by:
        if default_order_column is None:
            raise ValueError("Either default_order_column or default_order_by is required")
        order_by = [default_order_column.desc()]

    if not search:
        return query.order_by(*order_by)

    filtered_query, rank = apply_trigram_search(query, search=search, document=document)
    if rank is None:
        return filtered_query.order_by(*order_by)
    return filtered_query.order_by(rank.desc(), *order_by)
