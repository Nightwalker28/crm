from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level
from app.core.security import get_current_user, require_admin, require_user
from app.modules.user_management.schema import (
    CompanyProfileResponse,
    CompanyLogoUploadResponse,
    CompanyProfileUpdateRequest,
    ModuleSchema,
    SavedViewCreateRequest,
    SavedViewResponse,
    SavedViewsListResponse,
    SavedViewUpdateRequest,
    TablePreferenceResponse,
    TablePreferenceUpdateRequest,
    UserImageUploadResponse,
    UserProfile,
    UserProfileUpdateRequest,
)
from app.modules.user_management.services.auth import get_user_accessible_modules
from app.modules.user_management.services.profile import (
    get_or_create_company_profile,
    list_saved_views,
    create_saved_view,
    _is_system_saved_view,
    update_saved_view,
    delete_saved_view,
    get_user_table_preference,
    save_user_table_preference,
    upload_company_logo,
    upload_user_photo,
    update_company_profile,
    update_user_profile,
)

router = APIRouter(tags=["Users"])

@router.get("/me", response_model=UserProfile)
def get_me(
    current_user = Depends(require_user),
    db: Session = Depends(get_db),
):
    role_level = get_user_role_level(db, current_user)
    profile = UserProfile.model_validate(current_user).model_dump()
    profile["role_level"] = role_level
    profile["is_admin"] = bool(role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL)
    return profile


@router.put("/me", response_model=UserProfile)
def update_me(
    payload: UserProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    return update_user_profile(db, current_user, payload.model_dump(exclude_unset=True))


@router.post("/me/photo", response_model=UserImageUploadResponse)
async def upload_me_photo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    user = await upload_user_photo(db, current_user, file)
    return UserImageUploadResponse(photo_url=user.photo_url or "", user=user)


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
    return get_or_create_company_profile(db, current_user)


@router.put("/company", response_model=CompanyProfileResponse)
def save_company_profile(
    payload: CompanyProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_admin),
):
    return update_company_profile(db, current_user, payload.model_dump(exclude_unset=True))


@router.post("/company/logo", response_model=CompanyLogoUploadResponse)
async def upload_company_logo_route(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    company = await upload_company_logo(db, current_user, file)
    return CompanyLogoUploadResponse(logo_url=company.logo_url or "", company=company)


@router.get("/table-preferences/{module_key}", response_model=TablePreferenceResponse)
def get_table_preference(
    module_key: str,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        preference = get_user_table_preference(db, current_user, module_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TablePreferenceResponse(
        module_key=module_key,
        visible_columns=preference.visible_columns if preference else [],
    )


@router.put("/table-preferences/{module_key}", response_model=TablePreferenceResponse)
def update_table_preference(
    module_key: str,
    payload: TablePreferenceUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        preference = save_user_table_preference(db, current_user, module_key, payload.visible_columns)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TablePreferenceResponse(
        module_key=preference.module_key,
        visible_columns=preference.visible_columns or [],
    )


@router.get("/saved-views/{module_key}", response_model=SavedViewsListResponse)
def get_saved_views(
    module_key: str,
    default_columns: str = "",
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        views = list_saved_views(
            db,
            current_user,
            module_key,
            default_visible_columns=[item.strip() for item in default_columns.split(",") if item.strip()],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SavedViewsListResponse(views=[SavedViewResponse.model_validate(view) for view in views])


@router.post("/saved-views/{module_key}", response_model=SavedViewResponse)
def create_saved_view_route(
    module_key: str,
    payload: SavedViewCreateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        view = create_saved_view(
            db,
            current_user,
            module_key,
            name=payload.name,
            config=payload.config.model_dump(),
            is_default=payload.is_default,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SavedViewResponse.model_validate(
        {
            "id": view.id,
            "module_key": view.module_key,
            "name": view.name,
            "config": view.config or {},
            "is_default": bool(view.is_default),
            "is_system": _is_system_saved_view(view),
            "created_at": view.created_at,
            "updated_at": view.updated_at,
        }
    )


@router.put("/saved-views/{module_key}/{view_id}", response_model=SavedViewResponse)
def update_saved_view_route(
    module_key: str,
    view_id: int,
    payload: SavedViewUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        view = update_saved_view(
            db,
            current_user,
            module_key,
            view_id,
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SavedViewResponse.model_validate(
        {
            "id": view.id,
            "module_key": view.module_key,
            "name": view.name,
            "config": view.config or {},
            "is_default": bool(view.is_default),
            "is_system": _is_system_saved_view(view),
            "created_at": view.created_at,
            "updated_at": view.updated_at,
        }
    )


@router.delete("/saved-views/{module_key}/{view_id}", status_code=204)
def delete_saved_view_route(
    module_key: str,
    view_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
):
    try:
        delete_saved_view(db, current_user, module_key, view_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return None
