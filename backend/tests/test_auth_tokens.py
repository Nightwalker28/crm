import unittest

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


if __name__ == "__main__":
    unittest.main()
