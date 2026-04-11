from fastapi import Query, HTTPException, status
from pydantic import BaseModel

DEFAULT_PAGE_SIZE = 10
ALLOWED_PAGE_SIZES = [10, 25, 50]

class Pagination(BaseModel):
    page: int
    page_size: int
    offset: int
    limit: int


def get_pagination(
        page: int = Query(1, ge=1),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1),
) -> Pagination:
    if page_size not in ALLOWED_PAGE_SIZES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid page size. Allowed values: {ALLOWED_PAGE_SIZES}"
        )
    offset = (page - 1) * page_size
    return Pagination(page=page, page_size=page_size, offset=offset, limit=page_size)

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
    
