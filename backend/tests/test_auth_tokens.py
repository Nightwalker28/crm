import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from jose import jwt

from app.core.config import settings
from app.modules.user_management.models import Role, User
from app.modules.user_management.services.auth import create_access_token, decode_token


class AccessTokenClaimTests(unittest.TestCase):
    def test_access_token_includes_role_level_claim(self):
        user = User(id=7, tenant_id=1, email="admin@example.com", role_id=5)
        user.role = Role(id=5, tenant_id=1, name="Admin", level=100)

        token = create_access_token(user)
        payload = decode_token(token, expected_type="access")

        self.assertEqual(payload["sub"], "7")
        self.assertEqual(payload["tenant_id"], 1)
        self.assertEqual(payload["role_level"], 100)

    def test_access_token_requires_role_level_claim(self):
        user = User(id=7, tenant_id=1, email="admin@example.com", role_id=5)

        with self.assertRaisesRegex(ValueError, "role_level"):
            create_access_token(user)

    def test_decode_token_reports_expired_token_separately(self):
        token = jwt.encode(
            {
                "sub": "7",
                "tenant_id": 1,
                "type": "access",
                "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
            },
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM,
        )

        with self.assertRaises(HTTPException) as exc:
            decode_token(token, expected_type="access")

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Token expired")

    def test_decode_token_reports_malformed_token_as_invalid(self):
        with self.assertRaises(HTTPException) as exc:
            decode_token("not-a-jwt", expected_type="access")

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Invalid token")


if __name__ == "__main__":
    unittest.main()
