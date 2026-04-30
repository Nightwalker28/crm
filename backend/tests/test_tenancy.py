import unittest
from unittest.mock import patch

from app.core import tenancy


class DeploymentLicenseCacheTests(unittest.TestCase):
    def setUp(self):
        tenancy.get_verified_deployment_license.cache_clear()

    def tearDown(self):
        tenancy.get_verified_deployment_license.cache_clear()

    def test_verified_deployment_license_cache_requires_explicit_clear_for_patched_settings(self):
        with patch.object(tenancy.settings, "DEPLOYMENT_LICENSE", "token-a"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_PUBLIC_KEY", "public-key"), \
             patch.object(
                 tenancy.jwt,
                 "decode",
                 return_value={"deployment_mode": "cloud", "license_id": "a"},
             ) as decode:
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )

        with patch.object(tenancy.settings, "DEPLOYMENT_LICENSE", "token-b"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_PUBLIC_KEY", "public-key"), \
             patch.object(
                 tenancy.jwt,
                 "decode",
                 return_value={"deployment_mode": "cloud", "license_id": "b"},
             ):
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )
            decode.assert_called_once()

            tenancy.get_verified_deployment_license.cache_clear()

            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "b"},
            )


if __name__ == "__main__":
    unittest.main()
