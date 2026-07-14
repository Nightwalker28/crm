from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.like_patterns import LIKE_ESCAPE, contains_pattern
from app.modules.user_management.models import Team
from app.modules.user_management.models import User, UserStatus


def list_linked_record_user_options(db: Session, *, tenant_id: int, query: str, limit: int = 10) -> list[dict]:
    normalized = query.strip().lower()
    if not normalized:
        return []
    pattern = f"%{normalized}%"
    users = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.is_active == UserStatus.active,
            or_(
                func.lower(User.first_name).like(pattern),
                func.lower(User.last_name).like(pattern),
                func.lower(User.email).like(pattern),
                func.lower(func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")).like(pattern),
            ),
        )
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": user.id,
            "label": " ".join(part for part in [user.first_name, user.last_name] if part).strip() or user.email,
            "email": user.email,
        }
        for user in users
    ]


def list_linked_record_team_options(db: Session, *, tenant_id: int, query: str, limit: int = 10) -> list[dict]:
    normalized = query.strip().casefold()
    if not normalized:
        return []
    teams = (
        db.query(Team)
        .filter(
            Team.tenant_id == tenant_id,
            func.lower(Team.name).like(contains_pattern(normalized), escape=LIKE_ESCAPE),
        )
        .order_by(func.lower(Team.name).asc(), Team.id.asc())
        .limit(limit)
        .all()
    )
    return [{"id": team.id, "label": team.name} for team in teams]
