from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin, require_user
from app.modules.user_management.schema import (
    CompanyProfileResponse,
    CompanyProfileUpdateRequest,
    ModuleSchema,
    UserProfile,
    UserProfileUpdateRequest,
)
from app.modules.user_management.services.auth import get_user_accessible_modules
from app.modules.user_management.services.profile import (
    get_or_create_company_profile,
    update_company_profile,
    update_user_profile,
)

router = APIRouter(tags=["Users"])

@router.get("/me", response_model=UserProfile)
def get_me(current_user = Depends(require_user)):
    return current_user


@router.put("/me", response_model=UserProfile)
def update_me(
    payload: UserProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    return update_user_profile(db, current_user, payload.model_dump(exclude_unset=True))


@router.get("/me/modules", response_model=list[ModuleSchema])
def get_my_modules(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_accessible_modules(current_user, db)


@router.get("/company", response_model=CompanyProfileResponse)
def get_company_profile(
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    return get_or_create_company_profile(db)


@router.put("/company", response_model=CompanyProfileResponse)
def save_company_profile(
    payload: CompanyProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_admin),
):
    return update_company_profile(db, current_user, payload.model_dump(exclude_unset=True))
