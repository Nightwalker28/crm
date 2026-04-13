from sqlalchemy.orm import Session

from app.modules.user_management.models import CompanyProfile, User


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


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
        return profile

    profile = CompanyProfile(name="Your Company")
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_company_profile(db: Session, current_user: User, payload: dict) -> CompanyProfile:
    profile = get_or_create_company_profile(db)

    for field in {"name", "primary_email", "website", "primary_phone", "industry", "country", "billing_address", "logo_url"}:
        if field in payload:
            setattr(profile, field, _clean(payload[field]))

    profile.updated_by = current_user.id if current_user else None
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile
