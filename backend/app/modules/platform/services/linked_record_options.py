from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.like_patterns import LIKE_ESCAPE, contains_pattern
from app.modules.user_management.models import Team
from app.modules.user_management.models import User, UserStatus


def list_linked_record_user_options(
    db: Session,
    *,
    tenant_id: int,
    query: str,
    limit: int = 10,
) -> tuple[list[dict], bool]:
    """The tenant's active users, as options — searched when a query is given, listed when it
    is not.

    Both forms exist because the two consumers ask different questions. `LinkedRecordPicker`
    resolves a *record reference* and always types first, so it wants the top matches for a
    string. `SearchableSelect` holds its options in memory (design.md 7.8) and filters them
    there, so the record spine's Owner field wants the whole set in one request — with no
    query, this returned an empty list, which is why Owner could be searched but never
    listed.

    `has_more` is the second half of that, and it is 7.9 rather than a nicety: a capped list
    that does not say it is capped is a control claiming a choice set it does not have.
    `TimezonePicker` shipped exactly that defect (`slice(0, 100)` over ~400 zones) and nothing
    caught it, so the ceiling is reported rather than hidden. One extra row is fetched to
    learn it, which costs nothing at these limits.
    """
    normalized = query.strip().lower()
    records = db.query(User).filter(
        User.tenant_id == tenant_id,
        User.is_active == UserStatus.active,
    )
    if normalized:
        pattern = f"%{normalized}%"
        records = records.filter(
            or_(
                func.lower(User.first_name).like(pattern),
                func.lower(User.last_name).like(pattern),
                func.lower(User.email).like(pattern),
                func.lower(func.coalesce(User.first_name, "") + " " + func.coalesce(User.last_name, "")).like(pattern),
            ),
        )
    users = (
        records.order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
        .limit(limit + 1)
        .all()
    )
    has_more = len(users) > limit
    return [
        {
            "id": user.id,
            "label": " ".join(part for part in [user.first_name, user.last_name] if part).strip() or user.email,
            "email": user.email,
        }
        for user in users[:limit]
    ], has_more


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
