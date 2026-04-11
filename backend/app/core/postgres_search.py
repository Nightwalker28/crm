from __future__ import annotations

from sqlalchemy import func, literal, or_


TRIGRAM_SIMILARITY_THRESHOLD = 0.12


def searchable_text(*columns):
    if not columns:
        return func.lower(literal(""))

    expression = func.coalesce(columns[0], literal(""))
    for column in columns[1:]:
        expression = expression.op("||")(literal(" ")).op("||")(func.coalesce(column, literal("")))
    return func.lower(expression)


def apply_trigram_search(query, *, search: str | None, document):
    if not search:
        return query, None

    normalized = search.strip().lower()
    if not normalized:
        return query, None

    rank = func.similarity(document, normalized)
    pattern = f"%{normalized}%"
    filtered_query = query.filter(
        or_(
            document.ilike(pattern),
            rank >= TRIGRAM_SIMILARITY_THRESHOLD,
        )
    )
    return filtered_query, rank
