from fastapi import Query, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings

DEFAULT_PAGE_SIZE = settings.PAGINATION_DEFAULT_PAGE_SIZE
PAGE_SIZE_OPTIONS = settings.PAGINATION_PAGE_SIZE_OPTIONS
MAX_PUBLIC_PAGE_SIZE = settings.PAGINATION_MAX_PUBLIC_PAGE_SIZE

class Pagination(BaseModel):
    page: int
    page_size: int
    offset: int
    limit: int


def create_pagination(page: int, page_size: int) -> Pagination:
    if page < 1:
        raise ValueError("page must be greater than or equal to 1")
    if page_size < 1:
        raise ValueError("page_size must be greater than or equal to 1")
    offset = (page - 1) * page_size
    return Pagination(page=page, page_size=page_size, offset=offset, limit=page_size)


def get_pagination(
        page: int = Query(1, ge=1),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1),
) -> Pagination:
    if page_size > MAX_PUBLIC_PAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid page size. Maximum value: {MAX_PUBLIC_PAGE_SIZE}"
        )
    return create_pagination(page, page_size)


def get_pagination_config() -> dict:
    return {
        "default_page_size": DEFAULT_PAGE_SIZE,
        "page_size_options": PAGE_SIZE_OPTIONS,
        "max_public_page_size": MAX_PUBLIC_PAGE_SIZE,
    }

def build_paged_response(items, total_count: int, pagination: Pagination):
    total_pages = (total_count + pagination.page_size - 1) // pagination.page_size if total_count else 0
    range_start = pagination.offset + 1 if total_count else 0
    range_end = min(pagination.offset + len(items), total_count) if total_count else 0
    return {
        "results": items,
        "range_start": range_start,
        "range_end": range_end,
        "total_count": total_count,
        "total_pages": total_pages,
        "page": pagination.page,
        "page_size": pagination.page_size
    }
    
