from __future__ import annotations

from sqlalchemy import func, literal

from app.core.config import settings
from app.core.like_patterns import LIKE_ESCAPE, contains_pattern

TRIGRAM_SIMILARITY_THRESHOLD = settings.POSTGRES_TRIGRAM_SIMILARITY_THRESHOLD
TRIGRAM_MIN_SEARCH_LENGTH = settings.POSTGRES_TRIGRAM_MIN_SEARCH_LENGTH


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
    pattern = contains_pattern(normalized)
    if len(normalized) < TRIGRAM_MIN_SEARCH_LENGTH:
        return query.filter(document.ilike(pattern, escape=LIKE_ESCAPE)), None

    filtered_query = query.filter((rank >= TRIGRAM_SIMILARITY_THRESHOLD) | document.ilike(pattern, escape=LIKE_ESCAPE))
    return filtered_query, rank
