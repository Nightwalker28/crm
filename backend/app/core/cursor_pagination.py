from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Query, status


@dataclass(frozen=True)
class CursorPagination:
    limit: int
    cursor: int | None = None


def get_cursor_pagination(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: int | None = Query(default=None, ge=1),
) -> CursorPagination:
    return CursorPagination(limit=limit, cursor=cursor)


def build_cursor_response(items, *, limit: int, id_attr: str):
    has_more = len(items) > limit
    page_items = items[:limit]
    next_cursor = None
    if has_more and page_items:
        next_cursor = str(getattr(page_items[-1], id_attr))
    return {
        "results": page_items,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "limit": limit,
    }


def apply_desc_id_cursor(query, column, cursor: int | None):
    if cursor is None:
        return query
    if cursor < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor")
    return query.filter(column < cursor)

