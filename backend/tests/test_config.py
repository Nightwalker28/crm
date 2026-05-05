import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core import config


class ConfigTests(unittest.TestCase):
    def test_env_bool_parses_false_string_as_false(self):
        with patch.dict(os.environ, {"LYNK_TEST_BOOL": "false"}):
            self.assertFalse(config._env_bool("LYNK_TEST_BOOL"))

    def test_debug_setting_is_boolean(self):
        self.assertIsInstance(config.settings.DEBUG, bool)

    def test_startup_validation_rejects_missing_jwt_secret_when_debug_is_false(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(DEBUG=False, JWT_SECRET="", DATABASE_URL="postgresql://db/app", ALLOWED_DOMAINS=[]),
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "JWT_SECRET must be set outside purely local debug mode",
            ):
                config.validate_startup_settings()

    def test_startup_validation_allows_missing_jwt_secret_in_debug_mode(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(DEBUG=True, JWT_SECRET="", DATABASE_URL="sqlite://", ALLOWED_DOMAINS=[]),
        ):
            config.validate_startup_settings()

    def test_startup_validation_rejects_missing_jwt_secret_in_debug_with_allowed_domains(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(DEBUG=True, JWT_SECRET="", DATABASE_URL="sqlite://", ALLOWED_DOMAINS=["example.com"]),
        ):
            with self.assertRaisesRegex(RuntimeError, "JWT_SECRET must be set"):
                config.validate_startup_settings()

    def test_startup_validation_rejects_missing_database_url(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(DEBUG=True, JWT_SECRET="", DATABASE_URL=None, ALLOWED_DOMAINS=[]),
        ):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL must be set"):
                config.validate_startup_settings()


if __name__ == "__main__":
    unittest.main()
