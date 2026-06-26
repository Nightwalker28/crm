import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.user_management.models import (
    Department,
    RefreshToken,
    Role,
    Team,
    Tenant,
    User,
    UserAuthMode,
    UserSetupToken,
    UserStatus,
)
from app.modules.user_management.services import auth


class TokenTimestampModelTests(unittest.TestCase):
    def test_refresh_and_setup_token_timestamps_are_timezone_aware_server_defaults(self):
        refresh_created_at = RefreshToken.__table__.c.created_at
        setup_created_at = UserSetupToken.__table__.c.created_at
        setup_consumed_at = UserSetupToken.__table__.c.consumed_at

        self.assertTrue(refresh_created_at.type.timezone)
        self.assertFalse(refresh_created_at.nullable)
        self.assertIsNotNone(refresh_created_at.server_default)
        self.assertIsNone(refresh_created_at.default)

        self.assertTrue(setup_created_at.type.timezone)
        self.assertFalse(setup_created_at.nullable)
        self.assertIsNotNone(setup_created_at.server_default)
        self.assertIsNone(setup_created_at.default)

        self.assertTrue(setup_consumed_at.type.timezone)

    def test_setup_token_cleanup_and_replacement_indexes_are_declared(self):
        indexes = {
            index.name: tuple(column.name for column in index.columns)
            for index in UserSetupToken.__table__.indexes
        }

        self.assertEqual(indexes["ix_user_setup_tokens_expires_at"], ("expires_at",))
        self.assertEqual(
            indexes["ix_user_setup_tokens_consumed_expires"],
            ("consumed_at", "expires_at"),
        )
        self.assertEqual(
            indexes["ix_user_setup_tokens_user_consumed"],
            ("user_id", "consumed_at"),
        )


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
            result = auth._cleanup_stale_user_setup_tokens(db)
        db.commit()

        remaining = {
            token.token_hash
            for token in db.query(UserSetupToken).order_by(UserSetupToken.id).all()
        }

        self.assertIsNone(result)
        self.assertEqual(remaining, {"recent-consumed", "active"})
        db.close()


if __name__ == "__main__":
    unittest.main()
