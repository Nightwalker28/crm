import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.secrets import decrypt_application_secret
from app.modules.platform.models import ActivityLog
from app.modules.user_management.models import Department, Role, Team, Tenant, TenantSsoSettings, User, UserStatus
from app.modules.user_management.services import sso


class FakeResponse:
    def __init__(self, *, ok=True, status_code=200, body=None):
        self.ok = ok
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


class FakeRequest:
    headers = {}

    def __init__(self, tenant=None):
        self.state = SimpleNamespace(tenant=tenant)

    def url_for(self, _name):
        return "https://crm.example.com/api/v1/auth/oidc/callback"


class SsoServiceTests(unittest.TestCase):
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
                TenantSsoSettings.__table__,
                ActivityLog.__table__,
            ],
        )
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=1, slug="default", name="Default"),
                Tenant(id=2, slug="other", name="Other"),
                Department(id=1, tenant_id=1, name="Ops"),
                Team(id=1, tenant_id=1, department_id=1, name="Revenue"),
                Role(id=1, tenant_id=1, name="User", level=10),
                User(id=1, tenant_id=1, role_id=1, team_id=1, email="ada@example.com", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "sso-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v3")
    def test_update_sso_settings_encrypts_and_masks_client_secret(self):
        settings_row = sso.update_sso_settings(
            self.db,
            tenant_id=1,
            actor_user_id=1,
            payload={
                "enabled": True,
                "issuer_url": "https://idp.example.com/",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "allowed_email_domains": ["Example.com", "@example.com"],
                "auto_provision_users": True,
                "default_role_id": 1,
                "default_team_id": 1,
            },
        )

        serialized = sso.serialize_sso_settings(settings_row)
        self.assertTrue(serialized["enabled"])
        self.assertTrue(serialized["has_client_secret"])
        self.assertNotIn("client-secret", str(serialized))
        self.assertEqual(settings_row.client_secret_key_version, "v3")
        self.assertEqual(decrypt_application_secret(settings_row.encrypted_client_secret, key_version="v3"), "client-secret")
        self.assertEqual(settings_row.allowed_email_domains, ["example.com"])
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "sso.config.updated").count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "sso.enabled").count(), 1)
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "integration.secret.updated").count(), 1)
        enabled_event = self.db.query(ActivityLog).filter(ActivityLog.action == "sso.enabled").one()
        self.assertEqual(enabled_event.tenant_id, 1)
        self.assertEqual(enabled_event.actor_user_id, 1)
        self.assertEqual(enabled_event.before_state, {"enabled": False})
        self.assertEqual(enabled_event.after_state, {"enabled": True})
        self.assertNotIn("client-secret", str(enabled_event.before_state))
        self.assertNotIn("client-secret", str(enabled_event.after_state))
        secret_event = self.db.query(ActivityLog).filter(ActivityLog.action == "integration.secret.updated").one()
        self.assertEqual(secret_event.after_state, {"provider": "oidc", "secret_type": "client_secret", "has_secret": True})
        self.assertNotIn("client-secret", str(secret_event.after_state))

        sso.update_sso_settings(
            self.db,
            tenant_id=1,
            actor_user_id=1,
            payload={"enabled": False},
        )
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "sso.disabled").count(), 1)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "sso-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v3")
    @patch("app.modules.user_management.services.sso.requests.get")
    def test_sso_configuration_test_persists_safe_success_result(self, mock_get):
        mock_get.side_effect = [
            FakeResponse(
                body={
                    "issuer": "https://idp.example.com",
                    "authorization_endpoint": "https://idp.example.com/auth",
                    "token_endpoint": "https://idp.example.com/token",
                    "jwks_uri": "https://idp.example.com/jwks",
                }
            ),
            FakeResponse(body={"keys": [{"kid": "key-1", "kty": "RSA"}]}),
        ]
        sso.update_sso_settings(
            self.db,
            tenant_id=1,
            actor_user_id=1,
            payload={
                "issuer_url": "https://idp.example.com",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "allowed_email_domains": ["example.com"],
            },
        )

        result = sso.test_sso_settings(self.db, tenant_id=1, actor_user_id=1)

        settings_row = self.db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == 1).one()
        self.assertTrue(result["ok"])
        self.assertEqual(settings_row.status, "tested")
        self.assertEqual(settings_row.last_test_result["metadata"]["issuer"], "https://idp.example.com")
        self.assertNotIn("client-secret", str(settings_row.last_test_result))
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "sso.config.tested").count(), 1)

    @patch("app.core.secrets.settings.APP_ENCRYPTION_SECRET", "sso-secret")
    @patch("app.core.secrets.settings.APP_ENCRYPTION_KEY_VERSION", "v3")
    @patch("app.modules.user_management.services.sso.requests.get")
    def test_sso_configuration_test_reports_metadata_errors_without_secret_leak(self, mock_get):
        mock_get.return_value = FakeResponse(ok=False, status_code=404, body={})
        sso.update_sso_settings(
            self.db,
            tenant_id=1,
            actor_user_id=1,
            payload={
                "issuer_url": "https://idp.example.com",
                "client_id": "client-id",
                "client_secret": "client-secret",
                "allowed_email_domains": ["example.com"],
            },
        )

        result = sso.test_sso_settings(self.db, tenant_id=1, actor_user_id=1)

        settings_row = self.db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == 1).one()
        self.assertFalse(result["ok"])
        self.assertEqual(settings_row.status, "error")
        self.assertIn("OIDC discovery returned HTTP 404", result["errors"])
        self.assertNotIn("client-secret", str(result))
        self.assertTrue(settings_row.last_failed_login_reason)

    def test_resolve_sso_settings_for_email_is_tenant_and_domain_scoped(self):
        self.db.add_all(
            [
                TenantSsoSettings(tenant_id=1, enabled=True, issuer_url="https://idp.example.com", client_id="one", allowed_email_domains=["example.com"]),
                TenantSsoSettings(tenant_id=2, enabled=True, issuer_url="https://idp.other.com", client_id="two", allowed_email_domains=["other.com"]),
            ]
        )
        self.db.commit()

        resolved = sso.resolve_sso_settings_for_email(self.db, request=FakeRequest(), email="ada@example.com")
        self.assertEqual(resolved.tenant_id, 1)

        with self.assertRaises(HTTPException) as ctx:
            sso.resolve_sso_settings_for_email(self.db, request=FakeRequest(tenant=SimpleNamespace(id=2)), email="ada@example.com")
        self.assertEqual(ctx.exception.status_code, 404)

    @patch("app.modules.user_management.services.sso._resolve_oidc_metadata", return_value={"authorization_endpoint": "https://idp.example.com/auth"})
    @patch("app.modules.user_management.services.sso.get_frontend_origin_for_request", return_value="https://app.example.com")
    @patch("app.modules.user_management.services.sso.settings.JWT_SECRET", "state-secret")
    def test_build_sso_start_url_contains_state_and_nonce(self, _origin, _metadata):
        self.db.add(
            TenantSsoSettings(
                tenant_id=1,
                enabled=True,
                issuer_url="https://idp.example.com",
                client_id="client-id",
                allowed_email_domains=["example.com"],
            )
        )
        self.db.commit()

        auth_url = sso.build_sso_start_url(self.db, request=FakeRequest(), email="ada@example.com")

        self.assertIn("https://idp.example.com/auth?", auth_url)
        self.assertIn("client_id=client-id", auth_url)
        self.assertIn("nonce=", auth_url)
        self.assertIn("state=", auth_url)

    @patch("app.modules.user_management.services.sso._resolve_oidc_metadata", return_value={"issuer": "https://idp.example.com", "token_endpoint": "https://idp.example.com/token", "jwks_uri": "https://idp.example.com/jwks"})
    @patch("app.modules.user_management.services.sso._exchange_code_for_tokens", return_value={"id_token": "token"})
    @patch("app.modules.user_management.services.sso._validate_id_token", return_value={"email": "ada@example.com", "email_verified": True})
    @patch("app.modules.user_management.services.sso.get_frontend_origin_for_request", return_value="https://app.example.com")
    @patch("app.modules.user_management.services.sso.settings.JWT_SECRET", "state-secret")
    def test_oidc_callback_maps_existing_user(self, _origin, _claims, _tokens, _metadata):
        self.db.add(
            TenantSsoSettings(
                tenant_id=1,
                enabled=True,
                issuer_url="https://idp.example.com",
                client_id="client-id",
                allowed_email_domains=["example.com"],
            )
        )
        self.db.commit()
        state = sso._create_oidc_state(tenant_id=1, nonce="nonce", frontend_origin="https://app.example.com")

        result = sso.handle_oidc_callback(self.db, request=FakeRequest(), code="code", state=state)

        self.assertEqual(result["status"], "active")
        self.assertEqual(result["user"].id, 1)
        self.assertEqual(result["user"].last_login_provider, "oidc")
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.action == "sso.login.success").count(), 1)

    @patch("app.modules.user_management.services.sso._resolve_oidc_metadata", return_value={"issuer": "https://idp.example.com", "token_endpoint": "https://idp.example.com/token", "jwks_uri": "https://idp.example.com/jwks"})
    @patch("app.modules.user_management.services.sso._exchange_code_for_tokens", return_value={"id_token": "token"})
    @patch("app.modules.user_management.services.sso._validate_id_token", return_value={"email": "new@example.com", "given_name": "New", "family_name": "User", "email_verified": True})
    @patch("app.modules.user_management.services.sso.get_frontend_origin_for_request", return_value="https://app.example.com")
    @patch("app.modules.user_management.services.sso.settings.JWT_SECRET", "state-secret")
    def test_oidc_callback_auto_provisions_inside_tenant_defaults(self, _origin, _claims, _tokens, _metadata):
        self.db.add(
            TenantSsoSettings(
                tenant_id=1,
                enabled=True,
                issuer_url="https://idp.example.com",
                client_id="client-id",
                allowed_email_domains=["example.com"],
                auto_provision_users=True,
                default_role_id=1,
                default_team_id=1,
            )
        )
        self.db.commit()
        state = sso._create_oidc_state(tenant_id=1, nonce="nonce", frontend_origin="https://app.example.com")

        result = sso.handle_oidc_callback(self.db, request=FakeRequest(), code="code", state=state)

        user = result["user"]
        self.assertEqual(user.email, "new@example.com")
        self.assertEqual(user.tenant_id, 1)
        self.assertEqual(user.role_id, 1)
        self.assertEqual(user.team_id, 1)
        self.assertEqual(user.department_id, 1)


if __name__ == "__main__":
    unittest.main()
