from __future__ import annotations

MAX_TEXT_FILTER_VALUE_LENGTH = 256
MAX_SEARCH_QUERY_LENGTH = 100
LIKE_ESCAPE = "\\"


def escape_like_pattern(value: str) -> str:
    return (
        value.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", f"{LIKE_ESCAPE}%")
        .replace("_", f"{LIKE_ESCAPE}_")
    )


def contains_pattern(value: str) -> str:
    return f"%{escape_like_pattern(value)}%"

