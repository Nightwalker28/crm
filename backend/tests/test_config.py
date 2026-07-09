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
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "JWT_SECRET must be set"):
                config.validate_startup_settings()

    def test_startup_validation_rejects_missing_jwt_secret_in_debug_mode(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=True,
                JWT_SECRET="",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="sqlite://",
                ALLOWED_DOMAINS=[],
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "JWT_SECRET must be set"):
                config.validate_startup_settings()

    def test_startup_validation_rejects_missing_app_encryption_secret(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=True,
                JWT_SECRET="jwt-secret",
                APP_ENCRYPTION_SECRET="",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="sqlite://",
                ALLOWED_DOMAINS=[],
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "APP_ENCRYPTION_SECRET must be set"):
                config.validate_startup_settings()

    def test_startup_validation_rejects_missing_mail_credential_secret(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=True,
                JWT_SECRET="jwt-secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="",
                DATABASE_URL="sqlite://",
                ALLOWED_DOMAINS=[],
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "MAIL_CREDENTIAL_SECRET must be set"):
                config.validate_startup_settings()

    def test_startup_validation_rejects_missing_database_url(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=True,
                JWT_SECRET="jwt-secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL=None,
                ALLOWED_DOMAINS=[],
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL must be set"):
                config.validate_startup_settings()

    def test_startup_validation_requires_redis_for_production_public_rate_limits(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=120,
                PUBLIC_CLIENT_PAGE_ACTION_LIMIT=0,
                PUBLIC_BOOKING_SUBMIT_LIMIT=0,
                TENANT_RESOLUTION_MODE="host",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "production public rate limiting"):
                config.validate_startup_settings()

    def test_startup_validation_requires_redis_for_production_public_client_actions(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=0,
                PUBLIC_CLIENT_PAGE_ACTION_LIMIT=10,
                PUBLIC_BOOKING_SUBMIT_LIMIT=0,
                TENANT_RESOLUTION_MODE="auth",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "production public rate limiting"):
                config.validate_startup_settings()

    def test_startup_validation_requires_redis_for_production_manual_login_rate_limits(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=0,
                PUBLIC_CLIENT_PAGE_ACTION_LIMIT=0,
                PUBLIC_BOOKING_SUBMIT_LIMIT=0,
                MANUAL_LOGIN_FAILED_ATTEMPT_LIMIT=5,
                TENANT_RESOLUTION_MODE="auth",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "production public rate limiting"):
                config.validate_startup_settings()

    def test_startup_validation_requires_redis_for_production_mfa_challenge_rate_limits(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=0,
                PUBLIC_CLIENT_PAGE_ACTION_LIMIT=0,
                PUBLIC_BOOKING_SUBMIT_LIMIT=0,
                MANUAL_LOGIN_FAILED_ATTEMPT_LIMIT=0,
                MFA_CHALLENGE_FAILED_ATTEMPT_LIMIT=5,
                TENANT_RESOLUTION_MODE="auth",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "production public rate limiting"):
                config.validate_startup_settings()

    def test_startup_validation_requires_redis_for_production_host_tenant_resolution(self):
        with patch.object(
            config,
            "settings",
            SimpleNamespace(
                DEBUG=False,
                JWT_SECRET="secret",
                APP_ENCRYPTION_SECRET="app-secret",
                MAIL_CREDENTIAL_SECRET="mail-secret",
                DATABASE_URL="postgresql://db/app",
                ALLOWED_DOMAINS=[],
                REDIS_URL=None,
                WEBSITE_INTEGRATION_RATE_LIMIT_COUNT=0,
                PUBLIC_CLIENT_PAGE_ACTION_LIMIT=0,
                PUBLIC_BOOKING_SUBMIT_LIMIT=0,
                TENANT_RESOLUTION_MODE="host",
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "production host tenant resolution"):
                config.validate_startup_settings()

    def test_celery_worker_startup_validates_settings(self):
        from app.core import celery_app

        with patch.object(celery_app, "validate_startup_settings") as validate:
            celery_app.validate_celery_startup_config()

        validate.assert_called_once_with()

    def test_celery_stores_task_failures_when_results_are_ignored(self):
        from app.core.celery_app import celery_app

        self.assertTrue(celery_app.conf.task_ignore_result)
        self.assertTrue(celery_app.conf.task_store_errors_even_if_ignored)
        self.assertIsNotNone(celery_app.conf.result_backend)

    def test_celery_maintenance_jobs_use_wall_clock_schedules(self):
        from celery.schedules import crontab
        from app.core.celery_app import celery_app

        schedule = celery_app.conf.beat_schedule

        self.assertIsInstance(schedule["cleanup-expired-data-transfer-results"]["schedule"], crontab)
        self.assertIsInstance(schedule["cleanup-expired-refresh-tokens"]["schedule"], crontab)
        self.assertIsInstance(schedule["purge-expired-recycle-bin-records"]["schedule"], crontab)
        self.assertIsInstance(schedule["scan-due-task-alerts"]["schedule"], int)
        self.assertIsInstance(schedule["scan-follow-up-reminders"]["schedule"], int)
        self.assertIsInstance(schedule["scan-due-tenant-backups"]["schedule"], int)

    def test_cors_uses_configured_origins_without_wildcard_regex(self):
        from app.main import app

        cors_middleware = next(
            middleware
            for middleware in app.user_middleware
            if middleware.cls.__name__ == "CORSMiddleware"
        )

        self.assertEqual(cors_middleware.kwargs["allow_origins"], config.settings.FRONTEND_CORS_ORIGINS)
        self.assertIsNone(cors_middleware.kwargs["allow_origin_regex"])


if __name__ == "__main__":
    unittest.main()
