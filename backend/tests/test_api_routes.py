import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user, require_admin, require_user
from app.main import app
from app.modules.sales.schema import (
    SalesContactResponse,
    SalesOpportunityResponse,
    SalesOrganizationResponse,
)
from app.modules.user_management.schema import UserProfile


class APIRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    @staticmethod
    def _override_db():
        yield SimpleNamespace()

    @staticmethod
    def _active_user():
        return SimpleNamespace(id=7, email="user@example.com")

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
        fake_user = SimpleNamespace(id=7, email="user@example.com")

        with patch(
            "app.modules.user_management.routes.signin.authenticate_manual_user",
            return_value=fake_user,
        ), patch(
            "app.modules.user_management.routes.signin.create_access_token",
            return_value="access-token",
        ), patch(
            "app.modules.user_management.routes.signin.create_refresh_token",
            return_value="refresh-token",
        ):
            response = self.client.post(
                "/api/v1/auth/login",
                json={"email": "user@example.com", "password": "secret123"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "message": "Signed in"})
        set_cookie = response.headers.get("set-cookie", "")
        self.assertIn("lynk_access_token=access-token", set_cookie)
        self.assertIn("lynk_refresh_token=refresh-token", set_cookie)

    def test_refresh_returns_401_without_cookie(self):
        app.dependency_overrides[get_db] = self._override_db

        response = self.client.post("/api/v1/auth/refresh")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Missing refresh token")

    def test_admin_teams_route_returns_serialized_list(self):
        app.dependency_overrides[require_admin] = lambda: SimpleNamespace(id=1)
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
        app.dependency_overrides[require_admin] = lambda: SimpleNamespace(id=1)
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
        app.dependency_overrides[require_admin] = lambda: SimpleNamespace(id=1)
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

    def test_finance_list_route_returns_paged_payload(self):
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
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
        expected_response = {key: value for key, value in fake_payload.items() if key != "page_size"}

        with patch(
            "app.modules.finance.routes.io_search_routes.io_search_api.list_finance_files_page",
            return_value=fake_payload,
        ) as list_mock:
            response = self.client.get("/api/v1/finance/insertion-orders/all?page=1&page_size=10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected_response)
        list_mock.assert_called_once()

    def test_finance_search_route_returns_paged_payload(self):
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
        app.dependency_overrides[get_db] = self._override_db
        fake_payload = {
            "results": [
                {
                    "invoice_no": "IO-1",
                    "file_url": "/download/IO-1",
                    "campaign_name": "Campaign A",
                    "file_path": "uploads/io-search/a.docx",
                    "updated_at": "2026-04-11",
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
            "app.modules.finance.routes.io_search_routes.io_search_api.search_finance_files_page",
            return_value=fake_payload,
        ) as search_mock:
            response = self.client.get(
                "/api/v1/finance/insertion-orders/search?field=campaign_name&value=Campaign%20A&page=1&page_size=10"
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["range_start"], 1)
        self.assertEqual(body["range_end"], 1)
        self.assertEqual(body["total_count"], 1)
        self.assertEqual(body["total_pages"], 1)
        self.assertEqual(body["page"], 1)
        self.assertEqual(body["results"][0]["invoice_no"], "IO-1")
        self.assertEqual(body["results"][0]["campaign_name"], "Campaign A")
        self.assertEqual(body["results"][0]["file_path"], "uploads/io-search/a.docx")
        self.assertEqual(body["results"][0]["updated_at"], "2026-04-11")
        search_mock.assert_called_once()

    def test_finance_download_route_returns_file(self):
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
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
        self.assertEqual(response.json(), expected_response)
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
        self.assertEqual(response.json(), expected_response)
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
        self.assertEqual(response.json(), expected_response)
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
