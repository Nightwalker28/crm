import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.secret_rotation import reencrypt_application_secrets
from app.core.secrets import decrypt_application_secret, encrypt_application_secret
from app.modules.user_management.models import Department, Role, Team, Tenant, User


class SecretRotationTests(unittest.TestCase):
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
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add(Tenant(id=1, slug="default", name="Default"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _add_user_with_old_mfa_secret(self):
        with patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "old-secret"), \
             patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v1"):
            encrypted = encrypt_application_secret("totp-secret")
        user = User(
            id=1,
            tenant_id=1,
            email="ada@example.com",
            encrypted_totp_secret=encrypted.ciphertext,
            mfa_secret_key_version=encrypted.key_version,
        )
        self.db.add(user)
        self.db.commit()
        return user

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "new-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_PREVIOUS_SECRETS", ["old-secret"])
    def test_secret_rotation_dry_run_reports_without_writing(self):
        user = self._add_user_with_old_mfa_secret()
        original_ciphertext = user.encrypted_totp_secret

        result = reencrypt_application_secrets(self.db, secret_types=["mfa_totp"], dry_run=True)
        self.db.refresh(user)

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["rotated"], 1)
        self.assertEqual(user.mfa_secret_key_version, "v1")
        self.assertEqual(user.encrypted_totp_secret, original_ciphertext)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "new-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_PREVIOUS_SECRETS", ["old-secret"])
    def test_secret_rotation_reencrypts_previous_key_records(self):
        user = self._add_user_with_old_mfa_secret()
        original_ciphertext = user.encrypted_totp_secret

        result = reencrypt_application_secrets(self.db, secret_types=["mfa_totp"], dry_run=False)
        self.db.refresh(user)

        self.assertFalse(result["dry_run"])
        self.assertEqual(result["rotated"], 1)
        self.assertEqual(user.mfa_secret_key_version, "v2")
        self.assertNotEqual(user.encrypted_totp_secret, original_ciphertext)
        self.assertEqual(decrypt_application_secret(user.encrypted_totp_secret, key_version="v2"), "totp-secret")


if __name__ == "__main__":
    unittest.main()
