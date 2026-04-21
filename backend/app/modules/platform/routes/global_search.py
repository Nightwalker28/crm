from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_user
from app.modules.platform.schema import GlobalSearchResponse, GlobalSearchResultResponse
from app.modules.platform.services.global_search import list_global_search_results

router = APIRouter(prefix="/global-search", tags=["Global Search"])


@router.get("", response_model=GlobalSearchResponse)
def get_global_search_results(
    query: str = Query(..., min_length=2, max_length=100),
    limit_per_module: int = Query(default=5, ge=1, le=10),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    results = list_global_search_results(
        db,
        current_user=current_user,
        query=query,
        limit_per_module=limit_per_module,
    )
    return {
        "query": query.strip(),
        "results": [GlobalSearchResultResponse.model_validate(item) for item in results],
    }
