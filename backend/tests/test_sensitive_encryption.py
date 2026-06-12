import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.core.encrypted_fields import get_encrypted_model_value, set_encrypted_model_value
from app.core.secrets import decrypt_application_secret, encrypt_application_secret


class SensitiveEncryptionTests(unittest.TestCase):
    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "current-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    def test_model_secret_setter_stores_ciphertext_and_key_version(self):
        model = SimpleNamespace(token=None, token_key_version=None)

        set_encrypted_model_value(model, "token", "raw-token", key_version_field="token_key_version")

        self.assertEqual(model.token_key_version, "v2")
        self.assertNotEqual(model.token, "raw-token")
        self.assertEqual(decrypt_application_secret(model.token, key_version="v2"), "raw-token")

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "current-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    def test_plaintext_legacy_model_secret_reencrypts_on_read(self):
        db = Mock()
        model = SimpleNamespace(token="legacy-token", token_key_version=None)

        token = get_encrypted_model_value(db, model, "token", key_version_field="token_key_version")

        self.assertEqual(token, "legacy-token")
        self.assertEqual(model.token_key_version, "v2")
        self.assertNotEqual(model.token, "legacy-token")
        self.assertEqual(db.flush.call_count, 1)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "wrong-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v2")
    def test_wrong_key_fails_for_versioned_secret(self):
        with patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "right-secret"):
            encrypted = encrypt_application_secret("raw-token")
        db = Mock()
        model = SimpleNamespace(token=encrypted.ciphertext, token_key_version=encrypted.key_version)

        with self.assertRaisesRegex(RuntimeError, "could not be decrypted"):
            get_encrypted_model_value(db, model, "token", key_version_field="token_key_version")


if __name__ == "__main__":
    unittest.main()
