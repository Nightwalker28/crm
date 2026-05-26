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

    def test_frontend_cors_origins_include_loopback_alias(self):
        self.assertEqual(
            config._frontend_cors_origins("http://localhost:3000", []),
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        )

    def test_frontend_cors_origins_deduplicate_extra_origins(self):
        self.assertEqual(
            config._frontend_cors_origins(
                "http://localhost:3000",
                ["http://127.0.0.1:3000", "https://crm.example.com/"],
            ),
            ["http://localhost:3000", "http://127.0.0.1:3000", "https://crm.example.com"],
        )

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

    def test_startup_validation_requires_redis_for_production_website_rate_limits(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=120,
                TENANT_RESOLUTION_MODE="host",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "REDIS_URL must be set"):
                config.validate_startup_settings()


if __name__ == "__main__":
    unittest.main()
