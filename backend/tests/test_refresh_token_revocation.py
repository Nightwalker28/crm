import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.core.config import settings
from app.core.security import get_current_user
from app.modules.user_management.models import RefreshToken, User, UserStatus
from app.modules.user_management.routes.signin import refresh_access_token
from app.modules.user_management.services.auth import rotate_refresh_token


class FakeQuery:
    def __init__(self, db, entity):
        self.db = db
        self.entity = entity

    def filter(self, *conditions):
        return self

    def options(self, *options):
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
        return self.db.delete_count


class FakeDB:
    def __init__(self, *, user, refresh_token, delete_count=1):
        self.user = user
        self.refresh_token = refresh_token
        self.delete_count = delete_count
        self.revoked_refresh_token = False
        self.committed = False
        self.rolled_back = False
        self.added = []

    def query(self, entity):
        return FakeQuery(self, entity)

    def add(self, item):
        self.added.append(item)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


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


def _request_with_access_and_refresh_cookies():
    return SimpleNamespace(
        cookies={
            settings.ACCESS_TOKEN_COOKIE_NAME: "access-token",
            settings.REFRESH_TOKEN_COOKIE_NAME: "refresh-token",
        },
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

    def test_get_current_user_does_not_refresh_invalid_access_token(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.active),
            refresh_token=SimpleNamespace(id=99),
        )

        with patch(
            "app.core.security.decode_token",
            side_effect=HTTPException(status_code=401, detail="Invalid token"),
        ) as decode_mock:
            with self.assertRaises(HTTPException) as exc:
                get_current_user(_request_with_access_and_refresh_cookies(), db)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Invalid token")
        self.assertEqual(decode_mock.call_count, 1)

    def test_get_current_user_does_not_refresh_tenant_mismatched_access_token(self):
        request = _request_with_access_and_refresh_cookies()
        request.state.tenant = SimpleNamespace(id=2)
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.active),
            refresh_token=SimpleNamespace(id=99),
        )

        with patch(
            "app.core.security.decode_token",
            return_value={"sub": "7", "tenant_id": 1, "role_level": 100},
        ) as decode_mock:
            with self.assertRaises(HTTPException) as exc:
                get_current_user(request, db)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Session tenant mismatch")
        self.assertEqual(decode_mock.call_count, 1)

    def test_get_current_user_refreshes_expired_access_token(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.active),
            refresh_token=SimpleNamespace(id=99),
        )

        with patch(
            "app.core.security.decode_token",
            side_effect=[
                HTTPException(status_code=401, detail="Token expired"),
                {"sub": "7", "jti": "token-jti"},
                {"sub": "7", "role_level": 100},
            ],
        ), patch(
            "app.core.security.create_access_token",
            return_value="new-access-token",
        ), patch(
            "app.core.security.rotate_refresh_token",
            return_value="new-refresh-token",
        ):
            request = _request_with_access_and_refresh_cookies()
            user = get_current_user(request, db)

        self.assertEqual(user._token_role_level, 100)
        self.assertEqual(request.state._new_access_token, "new-access-token")
        self.assertEqual(request.state._new_refresh_token, "new-refresh-token")

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

    def test_refresh_endpoint_rotates_refresh_token_on_success(self):
        db = FakeDB(
            user=SimpleNamespace(id=7, tenant_id=1, is_active=UserStatus.active),
            refresh_token=SimpleNamespace(
                id=99,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ),
        )

        with patch(
            "app.modules.user_management.routes.signin.decode_token",
            return_value={"sub": "7", "jti": "token-jti"},
        ), patch(
            "app.modules.user_management.routes.signin.create_access_token",
            return_value="new-access-token",
        ), patch(
            "app.modules.user_management.routes.signin.rotate_refresh_token",
            return_value="new-refresh-token",
        ) as rotate_mock:
            response = refresh_access_token(_request_with_refresh_cookie(), db)

        rotate_mock.assert_called_once()
        set_cookie = "\n".join(
            value.decode("latin-1")
            for key, value in response.raw_headers
            if key == b"set-cookie"
        )
        self.assertIn("lynk_access_token=new-access-token", set_cookie)
        self.assertIn("lynk_refresh_token=new-refresh-token", set_cookie)

    @patch("app.modules.user_management.services.auth.settings.JWT_SECRET", "test-secret")
    def test_rotate_refresh_token_deletes_old_token_and_creates_new_token_once(self):
        user = SimpleNamespace(id=7, tenant_id=1)
        db = FakeDB(user=user, refresh_token=None, delete_count=1)

        token = rotate_refresh_token(user, db, old_refresh_token_id=99)

        self.assertTrue(token)
        self.assertTrue(db.revoked_refresh_token)
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 1)
        self.assertEqual(db.added[0].user_id, 7)

    def test_rotate_refresh_token_rejects_already_used_token(self):
        user = SimpleNamespace(id=7, tenant_id=1)
        db = FakeDB(user=user, refresh_token=None, delete_count=0)

        with self.assertRaises(HTTPException) as exc:
            rotate_refresh_token(user, db, old_refresh_token_id=99)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Session revoked")
        self.assertTrue(db.rolled_back)
        self.assertFalse(db.added)


if __name__ == "__main__":
    unittest.main()
