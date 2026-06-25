import tempfile
import urllib.parse
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, patch

import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from app.core.database import get_db
from app.core.pagination import Pagination
from app.core.security import get_current_user, require_admin, require_user
from app.main import app
from app.modules.sales.routes import contacts_routes, organizations_routes
from app.modules.tasks.routes import tasks_routes
from app.modules.sales.schema import (
    SalesLeadResponse,
    SalesContactResponse,
    SalesOpportunityResponse,
    SalesOrganizationResponse,
)
from app.modules.user_management.models import Module, TenantModuleConfig, UserAuthMode, UserStatus
from app.modules.user_management.routes import admin as admin_routes
from app.modules.user_management.routes import signin as signin_routes
from app.modules.user_management.schema import UserProfile
from app.modules.user_management.services.auth import (
    _profile_from_google_id_token,
    decode_oauth_state,
    decode_microsoft_oauth_state,
    get_google_auth_url,
    get_microsoft_auth_url,
    handle_google_callback,
)


class RouteTestQuery:
    def __init__(self, *entities):
        self.entities = entities

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def first(self):
        if TenantModuleConfig in self.entities:
            return None
        if Module in self.entities:
            return SimpleNamespace(id=1, name="sales", base_route="sales", is_enabled=1)
        return None

    def scalar(self):
        if any(str(entity) == "Role.level" for entity in self.entities):
            return 100
        return None

    def all(self):
        return []

    def delete(self):
        return 1


class RouteTestSession:
    def query(self, *entities):
        return RouteTestQuery(*entities)

    def add(self, item):
        return None

    def commit(self):
        return None

    def refresh(self, item):
        return None

    def flush(self):
        return None

    def rollback(self):
        return None


class GoogleAuthModeQuery:
    def __init__(self, users):
        self.users = users

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def all(self):
        return self.users

    def first(self):
        return self.users[0] if self.users else None


class GoogleAuthModeSession:
    def __init__(self, users):
        self.users = users

    def query(self, *entities):
        return GoogleAuthModeQuery(self.users)

    def add(self, item):
        return None

    def commit(self):
        return None


class APIRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    @staticmethod
    def _override_db():
        yield RouteTestSession()

    @staticmethod
    def _active_user():
        return SimpleNamespace(
            id=7,
            email="user@example.com",
            tenant_id=1,
            team_id=1,
            role_id=1,
        )

    @staticmethod
    def _admin_user():
        return SimpleNamespace(
            id=1,
            email="admin@example.com",
            tenant_id=1,
            team_id=1,
            role_id=1,
        )

    def test_manual_signup_route_is_removed(self):
        response = self.client.post(
            "/api/v1/auth/signup",
            json={
                "email": "new.user@example.com",
                "password": "secret123",
                "first_name": "New",
                "last_name": "User",
            },
        )

        self.assertEqual(response.status_code, 404)

    def test_manual_login_sets_auth_cookies(self):
        fake_user = SimpleNamespace(id=7, tenant_id=1, email="user@example.com", mfa_enabled=False)

        with patch(
            "app.modules.user_management.routes.signin.authenticate_manual_user",
            return_value=fake_user,
        ), patch(
            "app.modules.user_management.routes.signin.create_access_token",
            return_value="access-token",
        ), patch(
            "app.modules.user_management.routes.signin.create_refresh_token",
            return_value="refresh-token",
        ), patch(
            "app.modules.user_management.routes.signin._tenant_mfa_policy_requires_setup",
            return_value=False,
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "message": "Signed in"})
        set_cookie = response.headers.get("set-cookie", "")
        self.assertIn("lynk_access_token=access-token", set_cookie)
        self.assertIn("lynk_refresh_token=refresh-token", set_cookie)
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "auth.login.success")
        self.assertEqual(log_mock.call_args.kwargs["tenant_id"], 1)
        self.assertEqual(log_mock.call_args.kwargs["actor_user_id"], 7)
        self.assertEqual(log_mock.call_args.kwargs["after_state"], {"provider": "manual"})

    def test_manual_login_failure_logs_without_secret_payload(self):
        with patch(
            "app.modules.user_management.routes.signin.authenticate_manual_user",
            side_effect=HTTPException(status_code=401, detail="Invalid email or password"),
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

        self.assertEqual(response.status_code, 401)
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "auth.login.failed")
        self.assertEqual(log_mock.call_args.kwargs["tenant_id"], 1)
        self.assertIsNone(log_mock.call_args.kwargs["actor_user_id"])
        self.assertEqual(log_mock.call_args.kwargs["after_state"], {"provider": "manual", "status_code": 401})
        self.assertNotIn("user@example.com", str(log_mock.call_args.kwargs))
        self.assertNotIn("secret123", str(log_mock.call_args.kwargs))

    def test_manual_login_returns_mfa_challenge_without_session_cookies(self):
        fake_user = SimpleNamespace(id=7, tenant_id=1, email="user@example.com", mfa_enabled=True)

        with patch(
            "app.modules.user_management.routes.signin.authenticate_manual_user",
            return_value=fake_user,
        ), patch(
            "app.modules.user_management.routes.signin.settings.JWT_SECRET",
            "test-secret",
        ), patch(
            "app.modules.user_management.routes.signin.create_access_token",
            return_value="access-token",
        ), patch(
            "app.modules.user_management.routes.signin.create_refresh_token",
            return_value="refresh-token",
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "mfa_required")
        self.assertIn("mfa_token", payload)
        set_cookie = response.headers.get("set-cookie", "")
        self.assertNotIn("lynk_access_token=access-token", set_cookie)
        self.assertNotIn("lynk_refresh_token=refresh-token", set_cookie)
        log_mock.assert_not_called()

    def test_manual_login_returns_mfa_setup_required_when_policy_requires_enrollment(self):
        fake_user = SimpleNamespace(id=7, tenant_id=1, email="user@example.com", mfa_enabled=False)

        with patch(
            "app.modules.user_management.routes.signin.authenticate_manual_user",
            return_value=fake_user,
        ), patch(
            "app.modules.user_management.routes.signin._tenant_mfa_policy_requires_setup",
            return_value=True,
        ), patch(
            "app.modules.user_management.routes.signin.create_access_token",
            return_value="access-token",
        ), patch(
            "app.modules.user_management.routes.signin.create_refresh_token",
            return_value="refresh-token",
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "mfa_setup_required", "message": "MFA setup required"})
        set_cookie = response.headers.get("set-cookie", "")
        self.assertIn("lynk_access_token=access-token", set_cookie)
        self.assertIn("lynk_refresh_token=refresh-token", set_cookie)
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "auth.login.success")
        self.assertEqual(log_mock.call_args.kwargs["after_state"], {"provider": "manual"})

    def test_google_callback_network_timeout_returns_controlled_auth_error(self):
        with patch(
            "app.modules.user_management.services.auth.requests.post",
            side_effect=requests.Timeout("timed out"),
        ), patch(
            "app.modules.user_management.services.auth.get_google_redirect_uri_for_request",
            return_value="http://localhost:8000/api/v1/auth/google/callback",
        ):
            with self.assertRaises(HTTPException) as context:
                handle_google_callback(
                    "oauth-code",
                    RouteTestSession(),
                    tenant=SimpleNamespace(id=1),
                    request=SimpleNamespace(headers={}),
                )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Failed to authenticate with Google")

    def test_google_login_url_uses_identity_only_scopes(self):
        auth_url = get_google_auth_url(
            request=SimpleNamespace(headers={}),
            tenant=SimpleNamespace(id=1),
        )
        params = urllib.parse.parse_qs(urllib.parse.urlparse(auth_url).query)
        scopes = set(params["scope"][0].split(" "))

        self.assertTrue({"openid", "email", "profile"}.issubset(scopes))
        self.assertNotIn("https://www.googleapis.com/auth/calendar.app.created", scopes)

    def test_google_login_url_allows_tenantless_auth_mode_state(self):
        with patch(
            "app.modules.user_management.services.auth.get_google_redirect_uri_for_request",
            return_value="https://crm.example.com/api/v1/auth/google/callback",
        ), patch(
            "app.modules.user_management.services.auth.get_frontend_origin_for_request",
            return_value="https://crm.example.com",
        ), patch(
            "app.modules.user_management.services.auth.settings.JWT_SECRET",
            "test-secret",
        ), patch(
            "app.core.tenancy.is_cloud_mode_enabled",
            return_value=True,
        ):
            auth_url = get_google_auth_url(
                request=SimpleNamespace(headers={"host": "crm.example.com"}),
                tenant=None,
            )
            params = urllib.parse.parse_qs(urllib.parse.urlparse(auth_url).query)
            state = decode_oauth_state(params["state"][0])

        self.assertIsNotNone(state)
        self.assertNotIn("tenant_id", state)
        self.assertEqual(state["frontend_origin"], "https://crm.example.com")

    def test_google_login_route_uses_verified_custom_domain_tenant(self):
        request = SimpleNamespace(
            state=SimpleNamespace(tenant=None),
            headers={"x-lynk-frontend-origin": "https://lynk.example.com"},
        )
        with patch(
            "app.modules.user_management.routes.signin._verified_tenant_from_request_origin",
            return_value=SimpleNamespace(id=42),
        ), patch(
            "app.modules.user_management.services.auth.get_google_redirect_uri_for_request",
            return_value="https://crm.example.com/api/v1/auth/google/callback",
        ), patch(
            "app.modules.user_management.services.auth.settings.JWT_SECRET",
            "test-secret",
        ), patch(
            "app.core.tenancy.is_cloud_mode_enabled",
            return_value=True,
        ):
            response = signin_routes.google_login(request=request, db=RouteTestSession())
            params = urllib.parse.parse_qs(urllib.parse.urlparse(response["auth_url"]).query)
            state = decode_oauth_state(params["state"][0])

        self.assertEqual(state["tenant_id"], 42)
        self.assertEqual(state["frontend_origin"], "https://lynk.example.com")

    def test_manual_login_tenant_resolution_prefers_verified_custom_domain(self):
        request = SimpleNamespace(headers={"x-lynk-frontend-origin": "https://lynk.example.com"})
        with patch(
            "app.modules.user_management.routes.signin.is_cloud_mode_enabled",
            return_value=True,
        ), patch(
            "app.modules.user_management.routes.signin.is_auth_tenant_resolution_enabled",
            return_value=True,
        ), patch(
            "app.modules.user_management.routes.signin._verified_tenant_from_request_origin",
            return_value=SimpleNamespace(id=42),
        ):
            tenant_id = signin_routes._resolve_manual_login_tenant_id(
                RouteTestSession(),
                email="shared@example.net",
                request=request,
                request_tenant=None,
            )

        self.assertEqual(tenant_id, 42)

    def test_microsoft_login_url_uses_configured_calendar_scopes(self):
        with patch("app.modules.user_management.services.auth.settings.MICROSOFT_CLIENT_ID", "client-id"), \
             patch("app.modules.user_management.services.auth.settings.MICROSOFT_CLIENT_SECRET", "client-secret"), \
             patch("app.modules.user_management.services.auth.settings.MICROSOFT_SCOPES", ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"]), \
             patch("app.modules.user_management.services.auth.get_microsoft_redirect_uri_for_request", return_value="https://crm.example.com/api/v1/auth/microsoft/callback"), \
             patch("app.modules.user_management.services.auth.get_frontend_origin_for_request", return_value="https://crm.example.com"), \
             patch("app.modules.user_management.services.auth.settings.JWT_SECRET", "test-secret"):
            auth_url = get_microsoft_auth_url(request=SimpleNamespace(headers={}), tenant=SimpleNamespace(id=1))
            params = urllib.parse.parse_qs(urllib.parse.urlparse(auth_url).query)
            state = decode_microsoft_oauth_state(params["state"][0])

        self.assertTrue({"openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"}.issubset(set(params["scope"][0].split())))
        self.assertEqual(state["tenant_id"], 1)

    def test_microsoft_login_route_uses_verified_custom_domain_tenant(self):
        request = SimpleNamespace(
            state=SimpleNamespace(tenant=None),
            headers={"x-lynk-frontend-origin": "https://lynk.example.com"},
        )
        with patch(
            "app.modules.user_management.routes.signin._verified_tenant_from_request_origin",
            return_value=SimpleNamespace(id=42),
        ), patch("app.modules.user_management.services.auth.settings.MICROSOFT_CLIENT_ID", "client-id"), \
             patch("app.modules.user_management.services.auth.settings.MICROSOFT_CLIENT_SECRET", "client-secret"), \
             patch("app.modules.user_management.services.auth.settings.MICROSOFT_SCOPES", ["openid", "profile", "offline_access", "User.Read"]), \
             patch("app.modules.user_management.services.auth.get_microsoft_redirect_uri_for_request", return_value="https://crm.example.com/api/v1/auth/microsoft/callback"), \
             patch("app.modules.user_management.services.auth.settings.JWT_SECRET", "test-secret"), \
             patch("app.core.tenancy.is_cloud_mode_enabled", return_value=True):
            response = signin_routes.microsoft_login(request=request, db=RouteTestSession())
            params = urllib.parse.parse_qs(urllib.parse.urlparse(response["auth_url"]).query)
            state = decode_microsoft_oauth_state(params["state"][0])

        self.assertEqual(state["tenant_id"], 42)
        self.assertEqual(state["frontend_origin"], "https://lynk.example.com")

    def test_google_callback_resolves_user_by_email_in_auth_tenant_mode(self):
        id_token = jose_jwt.encode(
            {
                "email": "user@example.com",
                "picture": "https://lh3.googleusercontent.com/photo.png",
            },
            "test-secret",
            algorithm="HS256",
        )
        user = SimpleNamespace(
            id=7,
            tenant_id=9,
            email="user@example.com",
            is_active=UserStatus.active,
            auth_mode=UserAuthMode.manual_or_google,
            photo_url=None,
            last_login_provider=None,
        )
        token_response = SimpleNamespace(
            ok=True,
            status_code=200,
            json=lambda: {"access_token": "access-token", "id_token": id_token},
        )

        with patch(
            "app.modules.user_management.services.auth.requests.post",
            return_value=token_response,
        ), patch(
            "app.modules.user_management.services.auth.get_google_redirect_uri_for_request",
            return_value="https://crm.example.com/api/v1/auth/google/callback",
        ), patch(
            "app.modules.user_management.services.auth.is_cloud_mode_enabled",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.auth.is_auth_tenant_resolution_enabled",
            return_value=True,
        ):
            result = handle_google_callback(
                "oauth-code",
                GoogleAuthModeSession([user]),
                tenant=None,
                request=SimpleNamespace(headers={"host": "crm.example.com"}),
            )

        self.assertEqual(result["status"], "active")
        self.assertIs(result["user"], user)
        self.assertEqual(user.photo_url, "https://lh3.googleusercontent.com/photo.png")
        self.assertEqual(user.last_login_provider, "google")

    def test_google_id_token_profile_claims_are_used_for_login_profile(self):
        id_token = jose_jwt.encode(
            {
                "email": "user@example.com",
                "picture": "https://lh3.googleusercontent.com/photo.png",
                "given_name": "Test",
                "family_name": "User",
            },
            "test-secret",
            algorithm="HS256",
        )

        profile = _profile_from_google_id_token(id_token)

        self.assertEqual(profile["email"], "user@example.com")
        self.assertEqual(profile["picture"], "https://lh3.googleusercontent.com/photo.png")
        self.assertEqual(profile["given_name"], "Test")
        self.assertEqual(profile["family_name"], "User")

    def test_refresh_returns_401_without_cookie(self):
        app.dependency_overrides[get_db] = self._override_db

        response = self.client.post("/api/v1/auth/refresh")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Missing refresh token")

    def test_refresh_failure_logs_when_tenant_context_is_known(self):
        app.dependency_overrides[get_db] = self._override_db

        with patch(
            "app.modules.user_management.routes.signin.decode_token",
            return_value={"sub": "7", "tenant_id": 1, "jti": "revoked"},
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/refresh",
                cookies={"lynk_refresh_token": "refresh-token"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Session revoked")
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "auth.refresh.failed")
        self.assertEqual(log_mock.call_args.kwargs["tenant_id"], 1)
        self.assertIsNone(log_mock.call_args.kwargs["actor_user_id"])

    def test_logout_logs_when_refresh_token_identifies_tenant(self):
        app.dependency_overrides[get_db] = self._override_db

        with patch(
            "app.modules.user_management.routes.signin.decode_token",
            return_value={"sub": "7", "tenant_id": 1},
        ), patch(
            "app.modules.user_management.routes.signin.safe_log_activity",
        ) as log_mock:
            response = self.client.post(
                "/api/v1/auth/logout",
                cookies={"lynk_refresh_token": "refresh-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "logged_out"})
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "auth.logout")
        self.assertEqual(log_mock.call_args.kwargs["tenant_id"], 1)
        self.assertEqual(log_mock.call_args.kwargs["after_state"], {"session": "revoked"})

    def test_admin_teams_route_returns_serialized_list(self):
        app.dependency_overrides[require_admin] = self._admin_user
        app.dependency_overrides[get_db] = self._override_db
        fake_teams = [{"id": 1, "name": "Revenue", "description": "RevOps", "department_id": 2}]

        with patch(
            "app.modules.user_management.routes.admin.admin_structure.list_teams",
            return_value=fake_teams,
        ) as list_mock:
            response = self.client.get("/api/v1/admin/users/teams")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), fake_teams)
        list_mock.assert_called_once()

    def test_setup_password_route_returns_success_message(self):
        app.dependency_overrides[get_db] = self._override_db

        with patch(
            "app.modules.user_management.routes.signin.set_initial_password",
            return_value=SimpleNamespace(id=55),
        ) as setup_mock:
            response = self.client.post(
                "/api/v1/auth/setup-password",
                json={"token": "setup-token", "password": "verysecure123"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "message": "Password set successfully"})
        setup_mock.assert_called_once()

    def test_admin_create_user_route_returns_setup_link(self):
        app.dependency_overrides[require_admin] = self._admin_user
        app.dependency_overrides[get_db] = self._override_db

        with patch(
            "app.modules.user_management.routes.admin.admin_users.create_user",
            return_value={
                "user": {
                    "id": 55,
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                    "email": "ada@example.com",
                    "team_id": 4,
                    "role_id": 9,
                    "team_name": "Platform",
                    "role_name": "Admin",
                    "photo_url": None,
                    "auth_mode": "manual_only",
                    "is_active": "active",
                },
                "setup_link": "http://localhost:3000/auth/setup-password?token=abc",
            },
        ) as create_mock:
            response = self.client.post(
                "/api/v1/admin/users",
                json={
                    "email": "ada@example.com",
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                    "team_id": 4,
                    "role_id": 9,
                    "auth_mode": "manual_only",
                    "is_active": "active",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["email"], "ada@example.com")
        self.assertEqual(
            response.json()["setup_link"],
            "http://localhost:3000/auth/setup-password?token=abc",
        )
        create_mock.assert_called_once()

    def test_admin_update_user_route_returns_serialized_profile(self):
        app.dependency_overrides[require_admin] = self._admin_user
        app.dependency_overrides[get_db] = self._override_db
        updated_user = UserProfile(
            id=55,
            first_name="Ada",
            last_name="Lovelace",
            email="ada@example.com",
            team_id=4,
            role_id=9,
            team_name="Platform",
            role_name="Admin",
            photo_url=None,
            auth_mode="manual_only",
            is_active="active",
        )

        with patch(
            "app.modules.user_management.routes.admin.admin_users.update_user",
            return_value=updated_user,
        ) as update_mock:
            response = self.client.put(
                "/api/v1/admin/users/55",
                json={"first_name": "Ada", "role_id": 9},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "ada@example.com")
        update_mock.assert_called_once()

    def test_admin_user_search_uses_current_filter_params(self):
        pagination = Pagination(page=1, page_size=10, offset=0, limit=10)
        db = object()
        admin = SimpleNamespace(id=7, tenant_id=42)

        with patch.object(
            admin_routes.admin_users,
            "search_users",
            return_value={
                "results": [],
                "range_start": 0,
                "range_end": 0,
                "total_count": 0,
                "total_pages": 0,
                "page": 1,
                "page_size": 10,
            },
        ) as search_mock:
            response = admin_routes.search_users(
                q=None,
                teams=None,
                roles=None,
                status=None,
                sort_by="name",
                sort_order="asc",
                fields=None,
                filters_all='[{"field":"email","operator":"contains","value":"ada"}]',
                filters_any='[{"field":"role_name","operator":"is","value":"Admin"}]',
                pagination=pagination,
                db=db,
                admin=admin,
            )

        self.assertEqual(response["total_count"], 0)
        search_mock.assert_called_once_with(
            db,
            tenant_id=42,
            pagination=pagination,
            q=None,
            teams=None,
            roles=None,
            status_filter=None,
            sort_by="name",
            sort_order="asc",
            all_filter_conditions=[{"field": "email", "operator": "contains", "value": "ada", "values": None}],
            any_filter_conditions=[{"field": "role_name", "operator": "is", "value": "Admin", "values": None}],
        )

    def test_admin_user_search_preserves_serialized_assignment_names(self):
        pagination = Pagination(page=1, page_size=10, offset=0, limit=10)
        db = object()
        admin = SimpleNamespace(id=7, tenant_id=42)
        profile = UserProfile(
            id=55,
            first_name="Ada",
            last_name="Lovelace",
            email="ada@example.com",
            team_id=4,
            role_id=9,
            team_name="Platform",
            role_name="Admin",
            role_level=100,
            photo_url=None,
            auth_mode="manual_only",
            is_active="active",
        )

        with patch.object(
            admin_routes.admin_users,
            "search_users",
            return_value={
                "results": [profile],
                "range_start": 1,
                "range_end": 1,
                "total_count": 1,
                "total_pages": 1,
                "page": 1,
                "page_size": 10,
            },
        ):
            response = admin_routes.search_users(
                q=None,
                teams=None,
                roles=None,
                status=None,
                sort_by="name",
                sort_order="asc",
                fields=None,
                filters_all=None,
                filters_any=None,
                pagination=pagination,
                db=db,
                admin=admin,
            )

        self.assertEqual(response["results"][0].team_name, "Platform")
        self.assertEqual(response["results"][0].role_name, "Admin")
        self.assertEqual(response["results"][0].role_level, 100)

    def test_contact_organization_search_passes_tenant_and_name_by_keyword(self):
        pagination = Pagination(page=1, page_size=10, offset=0, limit=10)
        db = object()
        user = SimpleNamespace(id=7, tenant_id=42)

        with patch.object(
            contacts_routes,
            "search_organizations_paginated",
            return_value=([], 0),
        ) as search_mock:
            response = contacts_routes.search_organizations_for_contacts(
                name="Acme",
                pagination=pagination,
                db=db,
                current_user=user,
            )

        self.assertEqual(response["total_count"], 0)
        search_mock.assert_called_once_with(
            db=db,
            tenant_id=42,
            name="Acme",
            offset=0,
            limit=10,
        )

    def test_organization_search_route_passes_tenant_and_name_by_keyword(self):
        pagination = Pagination(page=1, page_size=10, offset=0, limit=10)
        db = RouteTestSession()
        user = SimpleNamespace(id=7, tenant_id=42)

        with patch.object(
            organizations_routes,
            "search_organizations_paginated",
            return_value=([], 0),
        ) as search_mock:
            response = organizations_routes.search_sales_organizations(
                name="Acme",
                fields=None,
                filter_logic="all",
                filters=None,
                filters_all=None,
                filters_any=None,
                pagination=pagination,
                db=db,
                current_user=user,
            )

        self.assertEqual(response["total_count"], 0)
        search_mock.assert_called_once_with(
            db=db,
            tenant_id=42,
            name="Acme",
            offset=0,
            limit=10,
            all_filter_conditions=[],
            any_filter_conditions=[],
            sort_by=ANY,
            sort_direction=ANY,
        )

    def test_organizations_import_route_is_registered_once(self):
        matches = [
            route
            for route in organizations_routes.router.routes
            if getattr(route, "path", None) == "/organizations/import" and "POST" in getattr(route, "methods", set())
        ]

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].status_code, 201)

    def test_finance_list_route_returns_paged_payload(self):
        app.dependency_overrides[get_current_user] = self._active_user
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_payload = {
            "results": [],
            "range_start": 0,
            "range_end": 0,
            "total_count": 0,
            "total_pages": 0,
            "page": 1,
            "page_size": 10,
        }
        expected_response = fake_payload

        with patch(
            "app.modules.finance.routes.io_search_routes.io_search_api.list_generic_insertion_orders_page",
            return_value=fake_payload,
        ) as list_mock:
            response = self.client.get("/api/v1/finance/insertion-orders?page=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected_response)
        list_mock.assert_called_once()

    def test_finance_search_route_returns_paged_payload(self):
        app.dependency_overrides[get_current_user] = self._active_user
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_payload = {
            "results": [
                {
                    "id": 1,
                    "io_number": "IO-1",
                    "customer_name": "Campaign A",
                    "status": "draft",
                    "currency": "USD",
                    "total_amount": "100.00",
                }
            ],
            "range_start": 1,
            "range_end": 1,
            "total_count": 1,
            "total_pages": 1,
            "page": 1,
            "page_size": 10,
        }

        with patch(
            "app.modules.finance.routes.io_search_routes.io_search_api.list_generic_insertion_orders_page",
            return_value=fake_payload,
        ) as search_mock:
            response = self.client.get(
                "/api/v1/finance/insertion-orders?search=Campaign%20A&page=1&page_size=10"
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["range_start"], 1)
        self.assertEqual(body["range_end"], 1)
        self.assertEqual(body["total_count"], 1)
        self.assertEqual(body["total_pages"], 1)
        self.assertEqual(body["page"], 1)
        self.assertEqual(body["results"][0]["io_number"], "IO-1")
        self.assertEqual(body["results"][0]["customer_name"], "Campaign A")
        search_mock.assert_called_once()

    def test_finance_download_route_returns_file(self):
        app.dependency_overrides[get_current_user] = self._active_user
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "io.docx"
            file_path.write_bytes(b"docx-bytes")

            with patch(
                "app.modules.finance.routes.io_search_routes.io_search_api.get_downloadable_insertion_order",
                return_value=(file_path, "io.docx"),
            ) as download_mock:
                response = self.client.get("/api/v1/finance/insertion-orders/files/IO-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"docx-bytes")
        self.assertIn('filename="io.docx"', response.headers.get("content-disposition", ""))
        download_mock.assert_called_once()

    def test_sales_opportunities_list_route_returns_paged_payload(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_item = SalesOpportunityResponse(
            opportunity_id=11,
            opportunity_name="ACME Launch",
            client="ACME",
            attachments=[],
        )
        fake_payload = {
            "results": [fake_item],
            "range_start": 1,
            "range_end": 1,
            "total_count": 1,
            "total_pages": 1,
            "page": 1,
            "page_size": 10,
        }
        expected_response = {
            "results": [fake_item.model_dump(mode="json")],
            "range_start": 1,
            "range_end": 1,
            "total_count": 1,
            "total_pages": 1,
            "page": 1,
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.list_opportunities",
            return_value=([fake_item], 1),
        ) as list_mock:
            response = self.client.get("/api/v1/sales/opportunities?page=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["range_start"], expected_response["range_start"])
        self.assertEqual(body["total_count"], expected_response["total_count"])
        self.assertEqual(body["results"][0]["opportunity_id"], 11)
        self.assertEqual(body["results"][0]["opportunity_name"], "ACME Launch")
        list_mock.assert_called_once()

    def test_sales_opportunity_create_defaults_assigned_user(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        created = SalesOpportunityResponse(
            opportunity_id=12,
            opportunity_name="ACME Launch",
            client="ACME",
            assigned_to=7,
            attachments=[],
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.create_opportunity",
            return_value=created,
        ) as create_mock:
            response = self.client.post(
                "/api/v1/sales/opportunities",
                json={
                    "opportunity_name": "ACME Launch",
                    "client": "ACME",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["assigned_to"], 7)
        create_mock.assert_called_once()
        create_data = create_mock.call_args.args[1]
        self.assertEqual(create_data["assigned_to"], 7)

    def test_sales_opportunity_create_does_not_reintroduce_disabled_assigned_to_default(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        created = SalesOpportunityResponse(
            opportunity_id=12,
            opportunity_name="ACME Launch",
            client="ACME",
            assigned_to=None,
            attachments=[],
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.reject_disabled_field_writes",
        ), patch(
            "app.modules.sales.routes.opportunities_routes.sanitize_disabled_field_payload",
            return_value={"opportunity_name": "ACME Launch", "client": "ACME"},
        ) as sanitize_mock, patch(
            "app.modules.sales.routes.opportunities_routes.create_opportunity",
            return_value=created,
        ) as create_mock:
            response = self.client.post(
                "/api/v1/sales/opportunities",
                json={
                    "opportunity_name": "ACME Launch",
                    "client": "ACME",
                },
            )

        self.assertEqual(response.status_code, 201)
        sanitize_payload = sanitize_mock.call_args.kwargs["payload"]
        self.assertEqual(sanitize_payload["assigned_to"], 7)
        create_data = create_mock.call_args.args[1]
        self.assertNotIn("assigned_to", create_data)

    def test_sales_opportunity_attachment_upload_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        payload = SalesOpportunityResponse(
            opportunity_id=13,
            opportunity_name="ACME Launch",
            client="ACME",
            attachments=["uploads/opportunities-attachments/file.pdf"],
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.opportunities_api.upload_opportunity_attachments",
            return_value=payload,
        ) as upload_mock:
            response = self.client.post(
                "/api/v1/sales/opportunities/13/attachments",
                files=[("files", ("spec.pdf", b"hello", "application/pdf"))],
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["opportunity_id"], 13)
        upload_mock.assert_called_once()
        self.assertEqual(upload_mock.call_args.kwargs["tenant_id"], 1)
        self.assertEqual(upload_mock.call_args.kwargs["current_user"].id, 7)

    def test_task_recycle_route_passes_current_user_to_visibility_filtered_service(self):
        pagination = Pagination(page=1, page_size=10, offset=0, limit=10)
        db = object()
        user = SimpleNamespace(id=7, tenant_id=42)
        task = SimpleNamespace(id=11)
        serialized = {
            "id": 11,
            "title": "Deleted task",
            "description": None,
            "status": "todo",
            "priority": "medium",
            "start_at": None,
            "due_at": None,
            "completed_at": None,
            "source_module_key": None,
            "source_entity_id": None,
            "source_label": None,
            "created_by_user_id": 7,
            "updated_by_user_id": 7,
            "assigned_by_user_id": None,
            "created_by_name": None,
            "updated_by_name": None,
            "assigned_by_name": None,
            "assigned_at": None,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "assignees": [],
        }

        with patch.object(tasks_routes, "list_deleted_tasks", return_value=([task], 1)) as list_mock, \
             patch.object(tasks_routes, "serialize_task", return_value=serialized):
            response = tasks_routes.get_deleted_tasks(
                pagination=pagination,
                db=db,
                current_user=user,
            )

        self.assertEqual(response["total_count"], 1)
        list_mock.assert_called_once_with(
            db,
            tenant_id=42,
            current_user=user,
            pagination=pagination,
        )

    def test_task_restore_route_uses_deleted_only_lookup(self):
        db = object()
        user = SimpleNamespace(id=7, tenant_id=42)
        task = SimpleNamespace(id=11, title="Deleted task", source_module_key=None, source_entity_id=None)
        serialized = {
            "id": 11,
            "title": "Deleted task",
            "description": None,
            "status": "todo",
            "priority": "medium",
            "start_at": None,
            "due_at": None,
            "completed_at": None,
            "source_module_key": None,
            "source_entity_id": None,
            "source_label": None,
            "created_by_user_id": 7,
            "updated_by_user_id": 7,
            "assigned_by_user_id": None,
            "created_by_name": None,
            "updated_by_name": None,
            "assigned_by_name": None,
            "assigned_at": None,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "assignees": [],
        }

        with patch.object(tasks_routes, "get_deleted_task_or_404", return_value=task) as get_mock, \
             patch.object(tasks_routes, "restore_task", return_value=task) as restore_mock, \
             patch.object(tasks_routes, "serialize_task", return_value=serialized), \
             patch.object(tasks_routes, "log_activity"), \
             patch.object(tasks_routes, "_mirror_task_source_activity"):
            response = tasks_routes.restore_task_route(
                task_id=11,
                db=db,
                current_user=user,
            )

        self.assertEqual(response.id, 11)
        get_mock.assert_called_once_with(db, 11, tenant_id=42, current_user=user)
        restore_mock.assert_called_once_with(db, task=task, current_user=user)

    def test_sales_opportunity_create_finance_io_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_result = {"file_id": "doc-1", "doc_url": "https://docs.google.com/document/d/doc-1/edit"}

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.opportunities_api.create_finance_io_for_opportunity",
            return_value=fake_result,
        ) as create_mock:
            response = self.client.post("/api/v1/sales/opportunities/13/create_finance_io")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), fake_result)
        create_mock.assert_called_once()

    def test_lead_conversion_route_checks_target_module_permissions(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        lead = SalesLeadResponse(
            lead_id=15,
            first_name="Ada",
            last_name="Lovelace",
            company="Analytical Engines",
            primary_email="ada@example.com",
            status="qualified",
            assigned_to=7,
            created_time=datetime.utcnow(),
        )
        result = {
            "lead": lead,
            "account_id": 22,
            "contact_id": 33,
            "deal_id": 44,
            "created_account": False,
            "created_contact": False,
            "created_deal": True,
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.sales.routes.leads_routes.require_role_module_action_access",
        ) as target_permission_mock, patch(
            "app.modules.sales.routes.leads_routes.get_lead_or_404",
            return_value=lead,
        ), patch(
            "app.modules.sales.routes.leads_routes.convert_sales_lead",
            return_value=result,
        ), patch(
            "app.modules.sales.routes.leads_routes.log_activity",
        ):
            response = self.client.post(
                "/api/v1/sales/leads/15/convert",
                json={
                    "create_account": True,
                    "account_id": 22,
                    "create_contact": False,
                    "contact_id": 33,
                    "create_deal": True,
                    "deal_stage": "qualified",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [(call.kwargs["module_key"], call.kwargs["action"]) for call in target_permission_mock.call_args_list],
            [
                ("sales_organizations", "view"),
                ("sales_contacts", "view"),
                ("sales_opportunities", "create"),
            ],
        )

    def test_crm_summary_report_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_result = {
            "period_days": 14,
            "lead_status": [],
            "deal_stages": [],
            "quote_status": [],
            "owner_performance": [],
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.platform.routes.module_reports.module_reports.generate_crm_dashboard_summary",
            return_value=fake_result,
        ) as summary_mock:
            response = self.client.get("/api/v1/reports/crm-summary?period_days=14")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), fake_result)
        summary_mock.assert_called_once()
        self.assertEqual(summary_mock.call_args.kwargs["period_days"], 14)

    def test_forecast_report_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_result = {
            "period_start": "2026-06-01",
            "period_end": "2026-06-30",
            "gross_pipeline_amount": "3000.00",
            "weighted_pipeline_amount": "2100.00",
            "commit_amount": "2000.00",
            "best_case_amount": "3000.00",
            "actual_revenue_amount": "500.00",
            "open_opportunity_count": 2,
            "won_opportunity_count": 1,
            "by_stage": [],
            "by_owner": [],
            "by_team": [],
            "generated_at": "2026-05-28T00:00:00Z",
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.platform.routes.module_reports.module_reports.generate_forecast_summary",
            return_value=fake_result,
        ) as forecast_mock:
            response = self.client.get("/api/v1/reports/forecast?period_start=2026-06-01&period_end=2026-06-30")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["weighted_pipeline_amount"], "2100.00")
        forecast_mock.assert_called_once()
        self.assertEqual(forecast_mock.call_args.kwargs["period_start"].isoformat(), "2026-06-01")
        self.assertEqual(forecast_mock.call_args.kwargs["period_end"].isoformat(), "2026-06-30")

    def test_sales_opportunity_stage_route_logs_close_activity(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        before = SalesOpportunityResponse(
            opportunity_id=13,
            opportunity_name="ACME Launch",
            client="ACME",
            sales_stage="proposal",
            attachments=[],
        )
        updated = SalesOpportunityResponse(
            opportunity_id=13,
            opportunity_name="ACME Launch",
            client="ACME",
            sales_stage="closed_won",
            attachments=[],
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.opportunities_routes.get_opportunity_or_404",
            return_value=before,
        ), patch(
            "app.modules.sales.routes.opportunities_routes.update_opportunity_stage",
            return_value=updated,
        ) as update_mock, patch(
            "app.modules.sales.routes.opportunities_routes.log_activity",
        ) as activity_mock:
            response = self.client.patch(
                "/api/v1/sales/opportunities/13/stage",
                json={"sales_stage": "closed_won"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sales_stage"], "closed_won")
        update_mock.assert_called_once()
        self.assertEqual(update_mock.call_args.kwargs["sales_stage"], "closed_won")
        activity_mock.assert_called_once()
        self.assertEqual(activity_mock.call_args.kwargs["action"], "close")

    def test_calendar_booking_type_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_result = {
            "id": 5,
            "owner_id": 7,
            "owner_name": "Owner",
            "name": "Discovery",
            "slug": "discovery",
            "duration_minutes": 30,
            "buffer_before_minutes": 0,
            "buffer_after_minutes": 0,
            "timezone": "UTC",
            "enabled": True,
            "availability": [{"id": 1, "weekday": 0, "start_time": "09:00:00", "end_time": "17:00:00", "sort_order": 0}],
            "questions": [],
            "created_at": "2026-05-28T00:00:00Z",
            "updated_at": "2026-05-28T00:00:00Z",
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.calendar.routes.booking_routes.booking_services.create_booking_type",
            return_value=fake_result,
        ) as create_mock, patch("app.modules.calendar.routes.booking_routes.log_activity"):
            response = self.client.post(
                "/api/v1/calendar/booking-types",
                json={
                    "name": "Discovery",
                    "slug": "discovery",
                    "duration_minutes": 30,
                    "timezone": "UTC",
                    "availability": [{"weekday": 0, "start_time": "09:00", "end_time": "17:00"}],
                    "questions": [],
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["slug"], "discovery")
        create_mock.assert_called_once()

    def test_public_booking_slots_route_does_not_require_user(self):
        app.dependency_overrides[get_db] = self._override_db

        with patch(
            "app.modules.calendar.routes.booking_routes.booking_services.available_slots",
            return_value=[
                {
                    "start_at": datetime(2026, 6, 1, 9, 0),
                    "end_at": datetime(2026, 6, 1, 9, 30),
                    "label": "Mon, Jun 1, 9:00 AM",
                }
            ],
        ) as slots_mock:
            response = self.client.get("/api/v1/booking-links/discovery/slots?start_date=2026-06-01&end_date=2026-06-01")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 1)
        slots_mock.assert_called_once()

    def test_document_templates_route_calls_service_before_dynamic_document_route(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_document = {
            "id": 9,
            "title": "Proposal Template",
            "description": None,
            "original_filename": "proposal.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "extension": "docx",
            "file_size_bytes": 1200,
            "storage_provider": "local",
            "is_template": True,
            "template_category": "Proposals",
            "current_version_id": 4,
            "uploaded_by_user_id": 7,
            "created_at": datetime(2026, 5, 28, 10, 0, 0),
            "updated_at": datetime(2026, 5, 28, 10, 0, 0),
            "links": [],
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.documents.routes.document_routes.list_document_templates",
            return_value=([fake_document], 1),
        ) as templates_mock:
            response = self.client.get("/api/v1/documents/templates")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(response.json()["results"][0]["template_category"], "Proposals")
        templates_mock.assert_called_once()

    def test_document_template_update_route_calls_service(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        fake_document = {
            "id": 9,
            "title": "Proposal Template",
            "description": None,
            "original_filename": "proposal.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "extension": "docx",
            "file_size_bytes": 1200,
            "storage_provider": "local",
            "is_template": True,
            "template_category": "Proposals",
            "current_version_id": 4,
            "uploaded_by_user_id": 7,
            "created_at": datetime(2026, 5, 28, 10, 0, 0),
            "updated_at": datetime(2026, 5, 28, 10, 0, 0),
            "links": [],
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.core.permissions.require_role_module_action_access",
        ), patch(
            "app.modules.documents.routes.document_routes.update_document_template_status",
            return_value=fake_document,
        ) as update_mock:
            response = self.client.patch(
                "/api/v1/documents/9/template",
                json={"is_template": True, "template_category": "Proposals"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_template"])
        update_mock.assert_called_once()

    def test_sales_contacts_list_route_returns_paged_payload(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        contact = SalesContactResponse(
            contact_id=21,
            primary_email="contact@example.com",
            assigned_to=7,
            created_time=datetime(2026, 4, 11, 10, 0, 0),
            first_name="Ada",
            last_name="Lovelace",
        )
        expected_response = {
            "results": [contact.model_dump(mode="json")],
            "range_start": 1,
            "range_end": 1,
            "total_count": 1,
            "total_pages": 1,
            "page": 1,
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.contacts_routes.list_sales_contacts",
            return_value=([contact], 1),
        ) as list_mock:
            response = self.client.get("/api/v1/sales/contacts?page=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["range_start"], expected_response["range_start"])
        self.assertEqual(body["total_count"], expected_response["total_count"])
        self.assertEqual(body["results"][0]["contact_id"], 21)
        self.assertEqual(body["results"][0]["primary_email"], "contact@example.com")
        list_mock.assert_called_once()

    def test_sales_contacts_create_route_returns_contact(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        contact = SalesContactResponse(
            contact_id=22,
            primary_email="contact@example.com",
            assigned_to=7,
            created_time=datetime(2026, 4, 11, 10, 0, 0),
            first_name="Ada",
            last_name="Lovelace",
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.contacts_routes.create_sales_contact",
            return_value=contact,
        ) as create_mock:
            response = self.client.post(
                "/api/v1/sales/contacts",
                json={"primary_email": "contact@example.com"},
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["contact_id"], 22)
        create_mock.assert_called_once()

    def test_sales_organizations_list_route_returns_paged_payload(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        organization = SalesOrganizationResponse(
            org_id=31,
            org_name="ACME",
            primary_email="ops@acme.com",
            website="https://acme.com",
            assigned_to=7,
            created_time=datetime(2026, 4, 11, 10, 0, 0),
        )
        expected_response = {
            "results": [organization.model_dump(mode="json")],
            "range_start": 1,
            "range_end": 1,
            "total_count": 1,
            "total_pages": 1,
            "page": 1,
        }

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.organizations_routes.list_organizations_paginated",
            return_value=([organization], 1),
        ) as list_mock:
            response = self.client.get("/api/v1/sales/organizations?page=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["range_start"], expected_response["range_start"])
        self.assertEqual(body["total_count"], expected_response["total_count"])
        self.assertEqual(body["results"][0]["org_id"], 31)
        self.assertEqual(body["results"][0]["primary_email"], "ops@acme.com")
        list_mock.assert_called_once()

    def test_sales_organizations_create_route_returns_organization(self):
        app.dependency_overrides[require_user] = self._active_user
        app.dependency_overrides[get_db] = self._override_db
        organization = SalesOrganizationResponse(
            org_id=32,
            org_name="ACME",
            primary_email="ops@acme.com",
            website="https://acme.com",
            assigned_to=7,
            created_time=datetime(2026, 4, 11, 10, 0, 0),
        )

        with patch("app.core.permissions.require_department_module_access"), patch(
            "app.modules.sales.routes.organizations_routes.create_organization",
            return_value=organization,
        ) as create_mock:
            response = self.client.post(
                "/api/v1/sales/organizations/create",
                json={
                    "org_name": "ACME",
                    "primary_email": "ops@acme.com",
                    "website": "https://acme.com",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["org_id"], 32)
        create_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
