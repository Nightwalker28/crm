import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.core.config import settings
from app.core.security import get_current_user
from app.modules.user_management.models import RefreshToken, User, UserStatus
from app.modules.user_management.routes.signin import refresh_access_token


class FakeQuery:
    def __init__(self, db, entity):
        self.db = db
        self.entity = entity

    def filter(self, *conditions):
        return self

    def first(self):
        if self.entity is RefreshToken:
            return self.db.refresh_token
        if self.entity is User:
            return self.db.user
        return None

    def delete(self):
        if self.entity is RefreshToken:
            self.db.revoked_refresh_token = True
        return 1


class FakeDB:
    def __init__(self, *, user, refresh_token):
        self.user = user
        self.refresh_token = refresh_token
        self.revoked_refresh_token = False
        self.committed = False

    def query(self, entity):
        return FakeQuery(self, entity)

    def commit(self):
        self.committed = True


def _request_with_refresh_cookie():
    return SimpleNamespace(
        cookies={settings.REFRESH_TOKEN_COOKIE_NAME: "refresh-token"},
        state=SimpleNamespace(tenant=None),
    )


def _request_with_access_cookie():
    return SimpleNamespace(
        cookies={settings.ACCESS_TOKEN_COOKIE_NAME: "access-token"},
        state=SimpleNamespace(tenant=None),
    )


class RefreshTokenRevocationTests(unittest.TestCase):
    def test_get_current_user_attaches_access_token_role_level_claim(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.active),
            refresh_token=None,
        )

        with patch(
            "app.core.security.decode_token",
            return_value={"sub": "7", "role_level": 100},
        ):
            user = get_current_user(_request_with_access_cookie(), db)

        self.assertEqual(user._token_role_level, 100)

    def test_get_current_user_revokes_refresh_token_for_inactive_user(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.inactive),
            refresh_token=SimpleNamespace(id=99),
        )

        with patch(
            "app.core.security.decode_token",
            return_value={"sub": "7", "jti": "token-jti"},
        ):
            with self.assertRaises(HTTPException) as exc:
                get_current_user(_request_with_refresh_cookie(), db)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Inactive account")
        self.assertTrue(db.revoked_refresh_token)
        self.assertTrue(db.committed)

    def test_refresh_endpoint_revokes_refresh_token_for_inactive_user(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.inactive),
            refresh_token=SimpleNamespace(
                id=99,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ),
        )

        with patch(
            "app.modules.user_management.routes.signin.decode_token",
            return_value={"sub": "7", "jti": "token-jti"},
        ):
            with self.assertRaises(HTTPException) as exc:
                refresh_access_token(_request_with_refresh_cookie(), db)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Inactive account")
        self.assertTrue(db.revoked_refresh_token)
        self.assertTrue(db.committed)


if __name__ == "__main__":
    unittest.main()
