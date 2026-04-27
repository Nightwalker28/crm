from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_get_json, cache_set_json
from app.core.uploads import build_media_url, delete_local_media_file, persist_media_file, read_image_upload
from app.modules.user_management.models import CompanyProfile, User, UserSavedView, UserTablePreference


TABLE_PREFERENCE_MODULES = {
    "tasks",
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
    "admin_users",
    "finance_io",
}

SAVED_VIEW_MODULES = TABLE_PREFERENCE_MODULES
SYSTEM_DEFAULT_VIEW_NAME = "Default View"
COMPANY_OPERATING_CURRENCIES_CACHE_TTL_SECONDS = 300


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _clean_currency_list(values: list[str] | None) -> list[str]:
    if not values:
        return ["USD"]
    normalized: list[str] = []
    for value in values:
        cleaned = (value or "").strip().upper()
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return normalized or ["USD"]


def _company_operating_currencies_cache_key(tenant_id: int) -> str:
    return f"company-operating-currencies:{tenant_id}"


def invalidate_company_operating_currencies_cache(tenant_id: int) -> None:
    cache_delete(_company_operating_currencies_cache_key(tenant_id))


def update_user_profile(db: Session, user: User, payload: dict) -> User:
    for field in {"first_name", "last_name", "photo_url", "phone_number", "job_title", "timezone", "bio"}:
        if field in payload:
            setattr(user, field, _clean(payload[field]))

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


async def upload_user_photo(db: Session, user: User, file: UploadFile) -> User:
    file_bytes, extension = await read_image_upload(file)
    relative_media_path = persist_media_file(
        category="profile-assets",
        owner_key=f"user-{user.id}",
        extension=extension,
        content=file_bytes,
    )
    previous = user.photo_url
    user.photo_url = build_media_url(relative_media_path)
    db.add(user)
    db.commit()
    db.refresh(user)
    delete_local_media_file(previous)
    return user


def get_or_create_company_profile(db: Session, current_user: User) -> CompanyProfile:
    profile = (
        db.query(CompanyProfile)
        .filter(CompanyProfile.tenant_id == current_user.tenant_id)
        .order_by(CompanyProfile.id.asc())
        .first()
    )
    if profile:
        if not getattr(profile, "operating_currencies", None):
            profile.operating_currencies = ["USD"]
            db.add(profile)
            db.commit()
            db.refresh(profile)
        return profile

    profile = CompanyProfile(
        tenant_id=current_user.tenant_id,
        name="Your Company",
        operating_currencies=["USD"],
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_company_profile(db: Session, current_user: User, payload: dict) -> CompanyProfile:
    profile = get_or_create_company_profile(db, current_user)
    should_invalidate_currencies = "operating_currencies" in payload

    for field in {"name", "primary_email", "website", "primary_phone", "industry", "country", "billing_address", "logo_url"}:
        if field in payload:
            setattr(profile, field, _clean(payload[field]))
    if "operating_currencies" in payload:
        profile.operating_currencies = _clean_currency_list(payload["operating_currencies"])

    profile.updated_by = current_user.id if current_user else None
    db.add(profile)
    db.commit()
    db.refresh(profile)
    if should_invalidate_currencies:
        invalidate_company_operating_currencies_cache(current_user.tenant_id)
    return profile


async def upload_company_logo(db: Session, current_user: User, file: UploadFile) -> CompanyProfile:
    profile = get_or_create_company_profile(db, current_user)
    if not profile.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company profile is not available.")

    file_bytes, extension = await read_image_upload(file)
    relative_media_path = persist_media_file(
        category="company-assets",
        owner_key=f"company-{profile.id}",
        extension=extension,
        content=file_bytes,
    )
    previous = profile.logo_url
    profile.logo_url = build_media_url(relative_media_path)
    profile.updated_by = current_user.id if current_user else None
    db.add(profile)
    db.commit()
    db.refresh(profile)
    delete_local_media_file(previous)
    return profile


def get_company_operating_currencies(db: Session, current_user: User) -> list[str]:
    cache_key = _company_operating_currencies_cache_key(current_user.tenant_id)
    cached = cache_get_json(cache_key)
    if isinstance(cached, list):
        return _clean_currency_list(cached)

    profile = get_or_create_company_profile(db, current_user)
    currencies = _clean_currency_list(getattr(profile, "operating_currencies", None))
    cache_set_json(cache_key, currencies, ttl_seconds=COMPANY_OPERATING_CURRENCIES_CACHE_TTL_SECONDS)
    return currencies


def get_user_table_preference(
    db: Session,
    user: User,
    module_key: str,
) -> UserTablePreference | None:
    _ensure_supported_table_module(module_key)
    return (
        db.query(UserTablePreference)
        .filter(
            UserTablePreference.user_id == user.id,
            UserTablePreference.module_key == module_key,
        )
        .first()
    )


def save_user_table_preference(
    db: Session,
    user: User,
    module_key: str,
    visible_columns: list[str],
) -> UserTablePreference:
    _ensure_supported_table_module(module_key)
    normalized_columns = [column.strip() for column in visible_columns if column and column.strip()]
    preference = get_user_table_preference(db, user, module_key)
    if not preference:
        preference = UserTablePreference(
            user_id=user.id,
            module_key=module_key,
        )

    preference.visible_columns = normalized_columns
    db.add(preference)
    db.commit()
    db.refresh(preference)
    return preference


def _ensure_supported_table_module(module_key: str) -> None:
    if module_key not in TABLE_PREFERENCE_MODULES:
        raise ValueError("Unsupported table preference module")


def _ensure_supported_saved_view_module(module_key: str) -> None:
    if module_key not in SAVED_VIEW_MODULES:
        raise ValueError("Unsupported saved-view module")


def _normalize_saved_view_config(module_key: str, config: dict | None) -> dict:
    config = dict(config or {})
    visible_columns = config.get("visible_columns")
    if not isinstance(visible_columns, list):
        visible_columns = []
    normalized_columns = [str(column).strip() for column in visible_columns if str(column).strip()]
    filters = config.get("filters")
    normalized_filters = dict(filters) if isinstance(filters, dict) else {}
    legacy_conditions = normalized_filters.get("conditions")
    all_conditions = normalized_filters.get("all_conditions")
    any_conditions = normalized_filters.get("any_conditions")

    def _normalize_conditions(raw_conditions):
        if not isinstance(raw_conditions, list):
            raw_conditions = []
        normalized_conditions = []
        for item in raw_conditions:
            if not isinstance(item, dict):
                continue
            field = str(item.get("field") or "").strip()
            operator = str(item.get("operator") or "").strip()
            if not field or not operator:
                continue
            normalized_conditions.append(
                {
                    "id": str(item.get("id") or "").strip() or None,
                    "field": field,
                    "operator": operator,
                    "value": item.get("value"),
                    "values": item.get("values"),
                }
            )
        return normalized_conditions

    normalized_all_conditions = _normalize_conditions(all_conditions)
    normalized_any_conditions = _normalize_conditions(any_conditions)
    if not normalized_all_conditions and not normalized_any_conditions and isinstance(legacy_conditions, list):
        legacy_normalized = _normalize_conditions(legacy_conditions)
        logic = str(normalized_filters.get("logic") or "all").strip().lower()
        if logic == "any":
            normalized_any_conditions = legacy_normalized
        else:
            normalized_all_conditions = legacy_normalized

    logic = str(normalized_filters.get("logic") or "all").strip().lower()
    normalized_filters["logic"] = "any" if logic == "any" else "all"
    normalized_filters["conditions"] = []
    normalized_filters["all_conditions"] = normalized_all_conditions
    normalized_filters["any_conditions"] = normalized_any_conditions
    search = normalized_filters.get("search")
    normalized_filters["search"] = search.strip() if isinstance(search, str) else ""
    sort = config.get("sort")
    normalized_sort = sort if isinstance(sort, dict) else None
    return {
        "visible_columns": normalized_columns,
        "filters": normalized_filters,
        "sort": normalized_sort,
    }


def _get_config_meta(config: dict | None) -> dict:
    if not isinstance(config, dict):
        return {}
    meta = config.get("_meta")
    return dict(meta) if isinstance(meta, dict) else {}


def _is_system_saved_view(view: UserSavedView | dict | None) -> bool:
    if not view:
        return False
    config = view.config if isinstance(view, UserSavedView) else view.get("config")
    return bool(_get_config_meta(config).get("system_default"))


def _build_system_default_config(module_key: str, visible_columns: list[str]) -> dict:
    filters = {
        "search": "",
        "logic": "all",
        "conditions": [],
        "all_conditions": [],
        "any_conditions": [],
    }
    if module_key == "tasks":
        filters["all_conditions"] = [
            {
                "id": "system-hide-completed",
                "field": "status",
                "operator": "is_not",
                "value": "completed",
                "values": None,
            }
        ]

    config = _normalize_saved_view_config(
        module_key,
        {
            "visible_columns": visible_columns,
            "filters": filters,
            "sort": None,
        },
    )
    config["_meta"] = {"system_default": True}
    return config


def _serialize_saved_view(module_key: str, view: UserSavedView) -> dict:
    return {
        "id": view.id,
        "module_key": view.module_key,
        "name": view.name,
        "config": _normalize_saved_view_config(module_key, view.config),
        "is_default": bool(view.is_default),
        "is_system": _is_system_saved_view(view),
        "created_at": view.created_at,
        "updated_at": view.updated_at,
    }


def _find_system_saved_view(db: Session, user: User, module_key: str) -> UserSavedView | None:
    saved_views = (
        db.query(UserSavedView)
        .filter(UserSavedView.user_id == user.id, UserSavedView.module_key == module_key)
        .order_by(UserSavedView.id.asc())
        .all()
    )
    return next((view for view in saved_views if _is_system_saved_view(view)), None)


def _get_or_create_system_saved_view(
    db: Session,
    user: User,
    module_key: str,
    *,
    visible_columns: list[str],
) -> UserSavedView:
    system_view = _find_system_saved_view(db, user, module_key)
    if system_view:
        return system_view

    system_view = UserSavedView(
        user_id=user.id,
        module_key=module_key,
        name=SYSTEM_DEFAULT_VIEW_NAME,
        config=_build_system_default_config(module_key, visible_columns),
        is_default=0,
    )
    db.add(system_view)
    try:
        db.commit()
        db.refresh(system_view)
    except IntegrityError:
        db.rollback()
        system_view = _find_system_saved_view(db, user, module_key)
        if not system_view:
            raise
    return system_view


def list_saved_views(
    db: Session,
    user: User,
    module_key: str,
    *,
    default_visible_columns: list[str],
) -> list[dict]:
    _ensure_supported_saved_view_module(module_key)
    legacy_preference = get_user_table_preference(db, user, module_key)
    default_columns = (
        legacy_preference.visible_columns
        if legacy_preference and legacy_preference.visible_columns
        else default_visible_columns
    )
    system_view = _get_or_create_system_saved_view(
        db,
        user,
        module_key,
        visible_columns=default_columns,
    )
    saved_views = (
        db.query(UserSavedView)
        .filter(UserSavedView.user_id == user.id, UserSavedView.module_key == module_key)
        .order_by(UserSavedView.is_default.desc(), UserSavedView.name.asc(), UserSavedView.id.asc())
        .all()
    )
    has_default = any(bool(view.is_default) for view in saved_views)
    if not has_default:
        system_view.is_default = 1
        db.add(system_view)
        db.commit()
        saved_views = (
            db.query(UserSavedView)
            .filter(UserSavedView.user_id == user.id, UserSavedView.module_key == module_key)
            .order_by(UserSavedView.is_default.desc(), UserSavedView.name.asc(), UserSavedView.id.asc())
            .all()
        )

    return [_serialize_saved_view(module_key, view) for view in saved_views]


def create_saved_view(
    db: Session,
    user: User,
    module_key: str,
    *,
    name: str,
    config: dict,
    is_default: bool = False,
) -> UserSavedView:
    _ensure_supported_saved_view_module(module_key)
    cleaned_name = _clean(name)
    if not cleaned_name:
        raise ValueError("View name is required")

    view = UserSavedView(
        user_id=user.id,
        module_key=module_key,
        name=cleaned_name,
        config=_normalize_saved_view_config(module_key, config),
        is_default=1 if is_default else 0,
    )

    if is_default:
        (
            db.query(UserSavedView)
            .filter(UserSavedView.user_id == user.id, UserSavedView.module_key == module_key)
            .update({"is_default": 0})
        )

    db.add(view)
    db.commit()
    db.refresh(view)
    return view


def get_saved_view_or_404(
    db: Session,
    user: User,
    module_key: str,
    view_id: int,
) -> UserSavedView:
    _ensure_supported_saved_view_module(module_key)
    view = (
        db.query(UserSavedView)
        .filter(
            UserSavedView.id == view_id,
            UserSavedView.user_id == user.id,
            UserSavedView.module_key == module_key,
        )
        .first()
    )
    if not view:
        raise ValueError("Saved view not found")
    return view


def update_saved_view(
    db: Session,
    user: User,
    module_key: str,
    view_id: int,
    payload: dict,
) -> UserSavedView:
    view = get_saved_view_or_404(db, user, module_key, view_id)
    is_system_view = _is_system_saved_view(view)

    if "name" in payload:
        cleaned_name = _clean(payload["name"])
        if not cleaned_name:
            raise ValueError("View name is required")
        view.name = cleaned_name

    if "config" in payload and payload["config"] is not None:
        next_config = _normalize_saved_view_config(module_key, payload["config"])
        if is_system_view:
            next_config["_meta"] = {"system_default": True}
        view.config = next_config

    if payload.get("is_default") is True:
        (
            db.query(UserSavedView)
            .filter(UserSavedView.user_id == user.id, UserSavedView.module_key == module_key)
            .update({"is_default": 0})
        )
        view.is_default = 1
    elif payload.get("is_default") is False:
        view.is_default = 0

    db.add(view)
    db.commit()
    db.refresh(view)
    return view


def delete_saved_view(
    db: Session,
    user: User,
    module_key: str,
    view_id: int,
) -> None:
    view = get_saved_view_or_404(db, user, module_key, view_id)
    db.delete(view)
    db.commit()
