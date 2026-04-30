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
        with patch.object(config, "settings", SimpleNamespace(DEBUG=False, JWT_SECRET="")):
            with self.assertRaisesRegex(
                RuntimeError,
                "JWT_SECRET must be set when DEBUG is false",
            ):
                config.validate_startup_settings()

    def test_startup_validation_allows_missing_jwt_secret_in_debug_mode(self):
        with patch.object(config, "settings", SimpleNamespace(DEBUG=True, JWT_SECRET="")):
            config.validate_startup_settings()


if __name__ == "__main__":
    unittest.main()
