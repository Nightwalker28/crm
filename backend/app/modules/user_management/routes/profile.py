from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.modules.user_management.schema import ModuleSchema, UserProfile
from app.modules.user_management.services.auth import get_user_accessible_modules

router = APIRouter(tags=["Users"])

@router.get("/me", response_model=UserProfile)
def get_me(current_user = Depends(get_current_user)):
    return current_user


@router.get("/me/modules", response_model=list[ModuleSchema])
def get_my_modules(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_accessible_modules(current_user, db)
