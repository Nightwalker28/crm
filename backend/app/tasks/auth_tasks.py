from datetime import datetime, timezone

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.user_management.models import RefreshToken


@celery_app.task(name="app.tasks.cleanup_expired_refresh_tokens")
def cleanup_expired_refresh_tokens_task() -> int:
    db = SessionLocal()
    try:
        deleted = (
            db.query(RefreshToken)
            .filter(RefreshToken.expires_at < datetime.now(timezone.utc))
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(deleted or 0)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
