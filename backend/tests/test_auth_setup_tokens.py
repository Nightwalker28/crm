import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.user_management.models import (
    Department,
    Role,
    Team,
    Tenant,
    User,
    UserAuthMode,
    UserSetupToken,
    UserStatus,
)
from app.modules.user_management.services import auth


class SetupTokenCleanupTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Tenant.__table__,
                Department.__table__,
                Team.__table__,
                Role.__table__,
                User.__table__,
                UserSetupToken.__table__,
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)

    def test_cleanup_removes_only_consumed_or_expired_tokens_past_retention(self):
        db = self.SessionLocal()
        now = datetime.now(timezone.utc)
        cutoff_days = 30

        db.add(Tenant(id=1, slug="default", name="Default Tenant"))
        db.add(
            User(
                id=1,
                tenant_id=1,
                email="setup@example.com",
                auth_mode=UserAuthMode.manual_only,
                is_active=UserStatus.active,
            )
        )
        db.add_all(
            [
                UserSetupToken(
                    id=1,
                    user_id=1,
                    token_hash="old-consumed",
                    expires_at=now + timedelta(days=1),
                    consumed_at=now - timedelta(days=cutoff_days + 1),
                ),
                UserSetupToken(
                    id=2,
                    user_id=1,
                    token_hash="old-expired",
                    expires_at=now - timedelta(days=cutoff_days + 1),
                ),
                UserSetupToken(
                    id=3,
                    user_id=1,
                    token_hash="recent-consumed",
                    expires_at=now + timedelta(days=1),
                    consumed_at=now - timedelta(days=cutoff_days - 1),
                ),
                UserSetupToken(
                    id=4,
                    user_id=1,
                    token_hash="active",
                    expires_at=now + timedelta(days=1),
                ),
            ]
        )
        db.commit()

        with patch.object(auth.settings, "USER_SETUP_TOKEN_RETENTION_DAYS", cutoff_days):
            deleted = auth._cleanup_stale_user_setup_tokens(db)
        db.commit()

        remaining = {
            token.token_hash
            for token in db.query(UserSetupToken).order_by(UserSetupToken.id).all()
        }

        self.assertEqual(deleted, 2)
        self.assertEqual(remaining, {"recent-consumed", "active"})
        db.close()


if __name__ == "__main__":
    unittest.main()
