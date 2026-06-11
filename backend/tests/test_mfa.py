import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.passwords import hash_password
from app.core.secrets import decrypt_application_secret, encrypt_application_secret
from app.modules.platform.models import ActivityLog
from app.modules.user_management.models import Department, Role, Team, Tenant, User, UserMfaBackupCode, UserStatus
from app.modules.user_management.services import mfa

TEST_PASSWORD = "MfaSecurePass7842"


class MfaServiceTests(unittest.TestCase):
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
                UserMfaBackupCode.__table__,
                ActivityLog.__table__,
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=1, slug="default", name="Default"),
                Role(id=1, tenant_id=1, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=1,
                    role_id=1,
                    email="user@example.com",
                    password_hash=hash_password(TEST_PASSWORD),
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()
        self.user = self.db.query(User).filter(User.id == 1).one()

    def tearDown(self):
        self.db.close()

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "mfa-test-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v7")
    def test_setup_encrypts_secret_and_enable_issues_hashed_backup_codes(self):
        setup = mfa.start_mfa_setup(self.db, user=self.user)
        self.assertIn("otpauth://totp/", setup["otpauth_uri"])
        self.assertNotEqual(self.user.encrypted_totp_secret, setup["secret"])
        self.assertEqual(self.user.mfa_secret_key_version, "v7")

        code = mfa.generate_totp_code(setup["secret"])
        backup_codes = mfa.activate_mfa(self.db, user=self.user, code=code)

        self.assertTrue(self.user.mfa_enabled)
        self.assertEqual(len(backup_codes), mfa.MFA_BACKUP_CODE_COUNT)
        rows = self.db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == self.user.id).all()
        self.assertEqual(len(rows), mfa.MFA_BACKUP_CODE_COUNT)
        self.assertNotIn(backup_codes[0], {row.code_hash for row in rows})
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "mfa.enabled").count(), 1)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "mfa-test-secret")
    def test_backup_code_can_only_be_used_once(self):
        setup = mfa.start_mfa_setup(self.db, user=self.user)
        backup_code = mfa.activate_mfa(self.db, user=self.user, code=mfa.generate_totp_code(setup["secret"]))[0]

        self.assertEqual(mfa.verify_mfa_challenge(self.db, user=self.user, backup_code=backup_code), "backup_code")

        with self.assertRaises(HTTPException) as ctx:
            mfa.verify_mfa_challenge(self.db, user=self.user, backup_code=backup_code)

        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "mfa.backup_code.used").count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "mfa.challenge.failed").count(), 1)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "mfa-test-secret")
    def test_disable_requires_password_and_current_mfa(self):
        setup = mfa.start_mfa_setup(self.db, user=self.user)
        mfa.activate_mfa(self.db, user=self.user, code=mfa.generate_totp_code(setup["secret"]))

        with self.assertRaises(HTTPException) as ctx:
            mfa.disable_mfa(self.db, user=self.user, current_password="wrong", code=mfa.generate_totp_code(setup["secret"]))
        self.assertEqual(ctx.exception.status_code, 403)

        mfa.disable_mfa(
            self.db,
            user=self.user,
            current_password=TEST_PASSWORD,
            code=mfa.generate_totp_code(setup["secret"]),
        )

        self.assertFalse(self.user.mfa_enabled)
        self.assertIsNone(self.user.encrypted_totp_secret)
        self.assertEqual(self.db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == self.user.id).count(), 0)

    def test_update_tenant_mfa_policy_is_audited(self):
        policy = mfa.update_tenant_mfa_policy(
            self.db,
            tenant_id=1,
            actor_user_id=1,
            policy="admins_only",
        )

        tenant = self.db.query(Tenant).filter(Tenant.id == 1).one()
        activity = self.db.query(ActivityLog).filter(ActivityLog.action == "mfa.policy.updated").one()
        self.assertEqual(policy, "admins_only")
        self.assertEqual(tenant.mfa_policy, "admins_only")
        self.assertEqual(activity.tenant_id, 1)
        self.assertEqual(activity.actor_user_id, 1)
        self.assertEqual(activity.before_state["policy"], "off")
        self.assertEqual(activity.after_state["policy"], "admins_only")

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "mfa-test-secret")
    def test_admin_reset_user_mfa_is_tenant_scoped_and_audited(self):
        setup = mfa.start_mfa_setup(self.db, user=self.user)
        mfa.activate_mfa(self.db, user=self.user, code=mfa.generate_totp_code(setup["secret"]))
        self.db.add(Tenant(id=2, slug="other", name="Other"))
        self.db.add(User(id=2, tenant_id=2, email="other@example.com", is_active=UserStatus.active))
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            mfa.admin_reset_user_mfa(self.db, tenant_id=2, actor_user_id=2, user_id=1)
        self.assertEqual(ctx.exception.status_code, 404)

        mfa.admin_reset_user_mfa(self.db, tenant_id=1, actor_user_id=1, user_id=1)

        self.assertFalse(self.user.mfa_enabled)
        self.assertIsNone(self.user.encrypted_totp_secret)
        self.assertEqual(self.db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == 1).count(), 0)
        activity = self.db.query(ActivityLog).filter(ActivityLog.action == "mfa.admin_reset").one()
        self.assertEqual(activity.tenant_id, 1)
        self.assertEqual(activity.actor_user_id, 1)


class ApplicationSecretTests(unittest.TestCase):
    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "app-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    def test_application_secret_round_trip_uses_key_version(self):
        encrypted = encrypt_application_secret("secret-value")

        self.assertEqual(encrypted.key_version, "v2")
        self.assertNotEqual(encrypted.ciphertext, "secret-value")
        self.assertEqual(decrypt_application_secret(encrypted.ciphertext, key_version=encrypted.key_version), "secret-value")

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "")
    def test_missing_application_secret_fails_safely(self):
        with self.assertRaisesRegex(RuntimeError, "APP_ENCRYPTION_SECRET"):
            encrypt_application_secret("secret-value")


if __name__ == "__main__":
    unittest.main()
