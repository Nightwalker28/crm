from fastapi import APIRouter

from app.core.pagination import get_pagination_config


router = APIRouter(prefix="/config", tags=["Config"])


@router.get("/pagination")
def pagination_config():
    return get_pagination_config()
