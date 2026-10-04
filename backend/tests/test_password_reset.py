"""13 F0.7 B3/B4: forgot and reset password, change password, session revocation, emailed invites,
and which sender carries them."""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.passwords import hash_password, verify_password
from app.core.security import access_token_revoked
from app.modules.mail.models import TenantMailSettings
from app.modules.mail.services import tenant_mail
from app.modules.user_management.models import RefreshToken, Tenant, User, UserAuthMode, UserSetupToken, UserStatus
from app.modules.user_management.services import account_emails
from app.modules.user_management.services.auth import (
    RESET_TOKEN_PURPOSE,
    change_password,
    create_password_reset_link,
    create_user_setup_link,
    reset_password_with_token,
    set_initial_password,
)

OLD_PASSWORD = "OldPassword-7842-x"
NEW_PASSWORD = "NewPassword-9931-y"


def _token(link: str) -> str:
    return link.split("token=", 1)[1]


class PasswordResetTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            bind=engine,
            tables=[Tenant.__table__, User.__table__, UserSetupToken.__table__, RefreshToken.__table__, TenantMailSettings.__table__],
        )
        self.Session = sessionmaker(bind=engine)
        self.db = self.Session()
        self.db.add(Tenant(id=1, slug="default", name="Acme"))
        self.db.add(
            User(
                id=1,
                tenant_id=1,
                email="ada@example.com",
                password_hash=hash_password(OLD_PASSWORD),
                auth_mode=UserAuthMode.manual_only,
                is_active=UserStatus.active,
            )
        )
        self.db.add(RefreshToken(id=1, user_id=1, token_jti="old-session", expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
        self.db.commit()
        self.user = self.db.get(User, 1)

    def tearDown(self):
        self.db.close()

    def test_reset_link_sets_the_password_once_and_signs_out_everywhere(self):
        link = create_password_reset_link(self.db, self.user, frontend_origin="https://app.test")
        self.assertTrue(link.startswith("https://app.test/auth/reset-password?token="))
        token = self.db.query(UserSetupToken).one()
        self.assertEqual(token.purpose, RESET_TOKEN_PURPOSE)

        reset_password_with_token(self.db, token=_token(link), password=NEW_PASSWORD)
        self.db.refresh(self.user)
        self.assertTrue(verify_password(NEW_PASSWORD, self.user.password_hash))
        self.assertEqual(self.db.query(RefreshToken).count(), 0)
        self.assertIsNotNone(self.user.sessions_revoked_at)

        with self.assertRaises(HTTPException) as again:
            reset_password_with_token(self.db, token=_token(link), password="AnotherPassword-1234")
        self.assertEqual(again.exception.status_code, 400)

    def test_a_new_reset_link_voids_the_last_and_links_only_work_for_their_purpose(self):
        first = create_password_reset_link(self.db, self.user)
        second = create_password_reset_link(self.db, self.user)
        with self.assertRaises(HTTPException):
            reset_password_with_token(self.db, token=_token(first), password=NEW_PASSWORD)
        with self.assertRaises(HTTPException):
            set_initial_password(self.db, token=_token(second), password=NEW_PASSWORD)
        setup = create_user_setup_link(self.db, self.user)
        with self.assertRaises(HTTPException):
            reset_password_with_token(self.db, token=_token(setup), password=NEW_PASSWORD)
        # The invite link and the reset link live side by side.
        reset_password_with_token(self.db, token=_token(second), password=NEW_PASSWORD)

    def test_an_expired_reset_link_is_refused(self):
        link = create_password_reset_link(self.db, self.user)
        token = self.db.query(UserSetupToken).one()
        token.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            reset_password_with_token(self.db, token=_token(link), password=NEW_PASSWORD)
        self.assertIn("expired", ctx.exception.detail)

    def test_change_password_needs_the_current_one_and_revokes_older_access_tokens(self):
        with self.assertRaises(HTTPException) as wrong:
            change_password(self.db, user=self.user, current_password="not-it", new_password=NEW_PASSWORD)
        self.assertEqual(wrong.exception.detail["code"], "current_password_invalid")

        issued_before = int(datetime.now(timezone.utc).timestamp()) - 5
        change_password(self.db, user=self.user, current_password=OLD_PASSWORD, new_password=NEW_PASSWORD)
        self.assertTrue(verify_password(NEW_PASSWORD, self.user.password_hash))
        self.assertEqual(self.db.query(RefreshToken).count(), 0)
        self.assertTrue(access_token_revoked(self.user, {"iat": issued_before}))
        self.assertFalse(access_token_revoked(self.user, {"iat": int(datetime.now(timezone.utc).timestamp()) + 1}))

    def test_forgot_password_emails_a_link_only_for_an_active_password_account(self):
        with patch.object(account_emails, "SessionLocal", self.Session), \
             patch.object(account_emails, "safe_log_activity"), \
             patch.object(account_emails, "send_transactional_message") as send:
            account_emails.deliver_password_reset(tenant_id=1, email="nobody@example.com", frontend_origin=None)
            send.assert_not_called()
            account_emails.deliver_password_reset(tenant_id=1, email="ada@example.com", frontend_origin="https://app.test")
        send.assert_called_once()
        self.assertEqual(send.call_args.kwargs["recipient"], "ada@example.com")
        self.assertIn("https://app.test/auth/reset-password?token=", send.call_args.kwargs["body"])

        self.user.is_active = UserStatus.inactive
        self.db.commit()
        with patch.object(account_emails, "SessionLocal", self.Session), \
             patch.object(account_emails, "send_transactional_message") as send:
            account_emails.deliver_password_reset(tenant_id=1, email="ada@example.com", frontend_origin=None)
        send.assert_not_called()

    def test_forgot_password_is_rate_limited_per_email(self):
        store: dict = {}
        with patch.object(account_emails, "cache_get_json", side_effect=store.get), \
             patch.object(account_emails, "cache_set_json", side_effect=lambda key, value, ttl_seconds: store.__setitem__(key, value)), \
             patch.object(account_emails.settings, "PASSWORD_RESET_REQUEST_LIMIT", 2):
            results = [account_emails.password_reset_rate_limited(email="ada@example.com", client_host=None) for _ in range(3)]
        self.assertEqual(results, [False, False, True])

    def test_invite_email_reports_a_missing_sender_and_keeps_the_link(self):
        with patch.object(account_emails, "safe_log_activity"):
            result = account_emails.send_user_invite_email(self.db, user=self.user, setup_link="https://app.test/auth/setup-password?token=x", inviter=None)
        self.assertFalse(result.sent)
        self.assertIn("Settings → Integrations", result.error)

        with patch.object(account_emails, "safe_log_activity"), \
             patch.object(account_emails, "send_transactional_message") as send:
            result = account_emails.send_user_invite_email(self.db, user=self.user, setup_link="https://app.test/auth/setup-password?token=x", inviter=self.user)
        self.assertTrue(result.sent)
        self.assertIn("Acme", send.call_args.kwargs["subject"])
        self.assertIn("https://app.test/auth/setup-password?token=x", send.call_args.kwargs["body"])

    def test_resend_invite_is_refused_once_a_password_is_set(self):
        from app.modules.user_management.services.admin_users import resend_user_invite

        with self.assertRaises(HTTPException) as ctx:
            resend_user_invite(self.db, tenant_id=1, user_id=1, inviter=None)
        self.assertEqual(ctx.exception.status_code, 409)
        with self.assertRaises(HTTPException) as other_tenant:
            resend_user_invite(self.db, tenant_id=2, user_id=1, inviter=None)
        self.assertEqual(other_tenant.exception.status_code, 404)


class TransactionalSenderTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine, tables=[Tenant.__table__, TenantMailSettings.__table__])
        self.db = sessionmaker(bind=engine)()
        self.db.add(Tenant(id=1, slug="default", name="Acme"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_platform_sender_stands_in_only_in_cloud_mode(self):
        with patch.object(tenant_mail.app_settings, "PLATFORM_SMTP_HOST", "smtp.platform.test"), \
             patch.object(tenant_mail.app_settings, "PLATFORM_SMTP_SENDER_EMAIL", "noreply@platform.test"):
            with patch("app.core.tenancy.is_cloud_mode_enabled", return_value=False):
                self.assertIsNone(tenant_mail.transactional_sender(self.db, 1))
                with self.assertRaises(tenant_mail.MailSenderUnavailable):
                    tenant_mail.send_transactional_message(self.db, tenant_id=1, recipient="a@example.com", subject="s", body="b")
            with patch("app.core.tenancy.is_cloud_mode_enabled", return_value=True):
                self.assertEqual(tenant_mail.transactional_sender(self.db, 1), "platform")

    def test_the_workspace_sender_comes_first(self):
        self.db.add(
            TenantMailSettings(
                tenant_id=1,
                sender_email="crm@acme.test",
                smtp_host="smtp.acme.test",
                smtp_port=587,
                smtp_security="starttls",
                smtp_username="crm",
                encrypted_password="x",
            )
        )
        self.db.commit()
        with patch("app.core.tenancy.is_cloud_mode_enabled", return_value=True), \
             patch.object(tenant_mail.app_settings, "PLATFORM_SMTP_HOST", "smtp.platform.test"), \
             patch.object(tenant_mail.app_settings, "PLATFORM_SMTP_SENDER_EMAIL", "noreply@platform.test"):
            self.assertEqual(tenant_mail.transactional_sender(self.db, 1), "workspace")


if __name__ == "__main__":
    unittest.main()
