from sqlalchemy.orm import Session

from app.modules.user_management.models import CompanyProfile, User, UserTablePreference


TABLE_PREFERENCE_MODULES = {
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
    "admin_users",
    "finance_io",
}


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


def update_user_profile(db: Session, user: User, payload: dict) -> User:
    for field in {"first_name", "last_name", "photo_url", "phone_number", "job_title", "timezone", "bio"}:
        if field in payload:
            setattr(user, field, _clean(payload[field]))

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_or_create_company_profile(db: Session) -> CompanyProfile:
    profile = db.query(CompanyProfile).order_by(CompanyProfile.id.asc()).first()
    if profile:
        if not getattr(profile, "operating_currencies", None):
            profile.operating_currencies = ["USD"]
            db.add(profile)
            db.commit()
            db.refresh(profile)
        return profile

    profile = CompanyProfile(name="Your Company", operating_currencies=["USD"])
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_company_profile(db: Session, current_user: User, payload: dict) -> CompanyProfile:
    profile = get_or_create_company_profile(db)

    for field in {"name", "primary_email", "website", "primary_phone", "industry", "country", "billing_address", "logo_url"}:
        if field in payload:
            setattr(profile, field, _clean(payload[field]))
    if "operating_currencies" in payload:
        profile.operating_currencies = _clean_currency_list(payload["operating_currencies"])

    profile.updated_by = current_user.id if current_user else None
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def get_company_operating_currencies(db: Session) -> list[str]:
    profile = get_or_create_company_profile(db)
    return _clean_currency_list(getattr(profile, "operating_currencies", None))


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
