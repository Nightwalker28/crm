import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.passwords import hash_password
from app.modules.user_management.models import Tenant, User, UserAuthMode, UserSetupToken, UserStatus
from app.modules.user_management.services import auth
from app.modules.user_management.services.auth import authenticate_manual_user


TEST_PASSWORD = "ManualLoginPass7842"


class ManualLoginAuthTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[
                Tenant.__table__,
                User.__table__,
                UserSetupToken.__table__,
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add(Tenant(id=1, slug="default", name="Default"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_passwordless_manual_login_does_not_generate_setup_link_or_token(self):
        self.db.add(
            User(
                id=1,
                tenant_id=1,
                email="setup@example.com",
                auth_mode=UserAuthMode.manual_only,
                is_active=UserStatus.active,
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            authenticate_manual_user(
                self.db,
                tenant_id=1,
                email="setup@example.com",
                password="wrong-password",
                frontend_origin="https://app.example.com",
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(
            ctx.exception.detail,
            {
                "code": "password_setup_required",
                "message": "This account does not have a password set yet",
            },
        )
        self.assertEqual(self.db.query(UserSetupToken).count(), 0)

    def test_passwordless_manual_or_google_login_does_not_generate_setup_link_or_token(self):
        self.db.add(
            User(
                id=3,
                tenant_id=1,
                email="hybrid@example.com",
                auth_mode=UserAuthMode.manual_or_google,
                is_active=UserStatus.active,
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            authenticate_manual_user(
                self.db,
                tenant_id=1,
                email="hybrid@example.com",
                password="wrong-password",
                frontend_origin="https://app.example.com",
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["code"], "password_setup_required")
        self.assertNotIn("setup_link", ctx.exception.detail)
        self.assertEqual(self.db.query(UserSetupToken).count(), 0)

    def test_passwordless_inactive_manual_login_does_not_generate_setup_token(self):
        self.db.add(
            User(
                id=4,
                tenant_id=1,
                email="inactive@example.com",
                auth_mode=UserAuthMode.manual_only,
                is_active=UserStatus.inactive,
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            authenticate_manual_user(
                self.db,
                tenant_id=1,
                email="inactive@example.com",
                password="wrong-password",
                frontend_origin="https://app.example.com",
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertNotIn("setup_link", ctx.exception.detail)
        self.assertEqual(self.db.query(UserSetupToken).count(), 0)

    def test_manual_login_still_authenticates_password_user(self):
        self.db.add(
            User(
                id=2,
                tenant_id=1,
                email="active@example.com",
                password_hash=hash_password(TEST_PASSWORD),
                auth_mode=UserAuthMode.manual_only,
                is_active=UserStatus.active,
            )
        )
        self.db.commit()

        user = authenticate_manual_user(
            self.db,
            tenant_id=1,
            email=" active@example.com ",
            password=TEST_PASSWORD,
        )

        self.assertEqual(user.id, 2)
        self.assertEqual(user.last_login_provider, "manual")

    def test_manual_login_failed_attempts_are_rate_limited_and_clearable(self):
        email = "setup@example.com"
        client_host = "203.0.113.44"
        for key in auth._manual_login_attempt_keys(
            tenant_id=1,
            email=email,
            client_host=client_host,
        ):
            auth.cache_delete(key)

        try:
            for _ in range(auth.settings.MANUAL_LOGIN_FAILED_ATTEMPT_LIMIT):
                auth.record_failed_manual_login_attempt(
                    tenant_id=1,
                    email=email,
                    client_host=client_host,
                )

            with self.assertRaises(HTTPException) as ctx:
                auth.check_manual_login_rate_limit(
                    tenant_id=1,
                    email=email,
                    client_host=client_host,
                )

            self.assertEqual(ctx.exception.status_code, 429)

            auth.clear_failed_manual_login_attempts(
                tenant_id=1,
                email=email,
                client_host=client_host,
            )
            auth.check_manual_login_rate_limit(
                tenant_id=1,
                email=email,
                client_host=client_host,
            )
        finally:
            for key in auth._manual_login_attempt_keys(
                tenant_id=1,
                email=email,
                client_host=client_host,
            ):
                auth.cache_delete(key)


if __name__ == "__main__":
    unittest.main()
