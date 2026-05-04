import unittest
from types import SimpleNamespace
from decimal import Decimal

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.client_portal.models import ClientAccount, ClientPageAction, CustomerGroup
from app.modules.client_portal.routes.client_portal_routes import get_client_me
from app.modules.client_portal.services import client_portal_services
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class ClientPortalServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                SalesOrganization(
                    org_id=3,
                    tenant_id=10,
                    org_name="Buyer Co",
                ),
                SalesContact(
                    contact_id=7,
                    tenant_id=10,
                    first_name="Buyer",
                    last_name="Contact",
                    primary_email="buyer@example.com",
                    assigned_to=1,
                ),
                SalesContact(
                    contact_id=8,
                    tenant_id=99,
                    first_name="Other",
                    last_name="Tenant",
                    primary_email="other@example.com",
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_default_customer_groups_are_seeded_per_tenant(self):
        groups = client_portal_services.list_customer_groups(self.db, tenant_id=10)

        self.assertIn("default", {group.group_key for group in groups})
        self.assertIn("wholesale", {group.group_key for group in groups})
        self.assertEqual(sum(1 for group in groups if group.is_default), 1)

    def test_assign_contact_customer_group_rejects_cross_tenant_group(self):
        other_group = CustomerGroup(
            id=99,
            tenant_id=99,
            group_key="vip",
            name="VIP",
            discount_type="percent",
            discount_value=10,
            is_active=1,
        )
        self.db.add(other_group)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.assign_contact_customer_group(
                self.db,
                tenant_id=10,
                contact_id=7,
                group_id=99,
            )

        self.assertEqual(exc.exception.status_code, 404)

    def test_client_account_setup_and_login_are_tenant_scoped(self):
        account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )

        self.assertEqual(account.status, "pending")
        self.assertTrue(setup_token)
        self.assertTrue(client_portal_services.serialize_client_account(account, setup_token=setup_token)["setup_link"])

        account = client_portal_services.setup_client_password(
            self.db,
            token=setup_token,
            password="ClientPass123",
        )
        self.assertEqual(account.status, "active")
        self.assertIsNone(account.setup_token_hash)

        account, access_token = client_portal_services.authenticate_client_account(
            self.db,
            tenant_id=10,
            email="buyer@example.com",
            password="ClientPass123",
        )
        self.assertEqual(account.id, 1)
        self.assertTrue(access_token)

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.authenticate_client_account(
                self.db,
                tenant_id=99,
                email="buyer@example.com",
                password="ClientPass123",
            )

        self.assertEqual(exc.exception.status_code, 401)

    def test_client_me_rejects_token_from_different_tenant_context(self):
        _account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )
        client_portal_services.setup_client_password(
            self.db,
            token=setup_token,
            password="ClientPass123",
        )
        _account, access_token = client_portal_services.authenticate_client_account(
            self.db,
            tenant_id=10,
            email="buyer@example.com",
            password="ClientPass123",
        )

        request = SimpleNamespace(state=SimpleNamespace(tenant=SimpleNamespace(id=99)))
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=access_token)

        with self.assertRaises(HTTPException) as exc:
            get_client_me(request=request, credentials=credentials, db=self.db)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertIn("tenant mismatch", exc.exception.detail)

    def test_create_client_account_rejects_cross_tenant_contact(self):
        with self.assertRaises(HTTPException) as exc:
            client_portal_services.create_client_account(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={"email": "other@example.com", "contact_id": 8, "status": "pending"},
            )

        self.assertEqual(exc.exception.status_code, 404)

    def test_create_client_account_rejects_duplicate_customer_link(self):
        client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.create_client_account(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={"email": "second@example.com", "contact_id": 7, "status": "pending"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("already exists", exc.exception.detail)

    def test_inactive_account_cannot_regenerate_setup_link(self):
        account, _setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )
        account = client_portal_services.update_client_account_status(
            self.db,
            account=account,
            status_value="inactive",
            actor_user_id=1,
        )

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.regenerate_client_setup_link(
                self.db,
                account=account,
                actor_user_id=1,
            )

        self.assertEqual(exc.exception.status_code, 403)

    def test_client_portal_writes_are_activity_logged(self):
        group = client_portal_services.create_customer_group(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "group_key": "dealer",
                "name": "Dealer",
                "discount_type": "percent",
                "discount_value": 5,
                "is_active": True,
            },
        )
        client_portal_services.assign_contact_customer_group(
            self.db,
            tenant_id=10,
            contact_id=7,
            group_id=group.id,
            actor_user_id=1,
        )
        account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )
        client_portal_services.setup_client_password(
            self.db,
            token=setup_token,
            password="ClientPass123",
        )

        actions = {row.action for row in self.db.query(ActivityLog).all()}

        self.assertIn("customer_group.create", actions)
        self.assertIn("customer_group.assign", actions)
        self.assertIn("client_account.create", actions)
        self.assertIn("client_account.password_setup", actions)

    def test_public_client_page_uses_default_pricing_and_client_identity_personalizes(self):
        group = client_portal_services.create_customer_group(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "group_key": "wholesale_special",
                "name": "Wholesale Special",
                "discount_type": "percent",
                "discount_value": 10,
                "is_active": True,
            },
        )
        client_portal_services.assign_contact_customer_group(
            self.db,
            tenant_id=10,
            contact_id=7,
            group_id=group.id,
            actor_user_id=1,
        )
        account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )
        account = client_portal_services.setup_client_password(
            self.db,
            token=setup_token,
            password="ClientPass123",
        )
        page = client_portal_services.create_client_page(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "title": "Proposal A",
                "contact_id": 7,
                "pricing_items": [
                    {
                        "sku": "SKU-1",
                        "name": "Implementation",
                        "quantity": 2,
                        "currency": "usd",
                        "public_unit_price": 100,
                    }
                ],
                "document_ids": [3, 3, 4],
            },
        )
        page, public_token = client_portal_services.publish_client_page_link(
            self.db,
            page=page,
            actor_user_id=1,
            expires_in_days=30,
        )

        public_page = client_portal_services.get_public_client_page(self.db, token=public_token)
        public_payload = client_portal_services.serialize_public_client_page(public_page)
        personalized_payload = client_portal_services.serialize_public_client_page(public_page, account=account)

        self.assertEqual(public_payload["pricing_mode"], "public")
        self.assertIsNone(public_payload["customer_group"])
        self.assertEqual(public_payload["pricing_items"][0]["resolved_unit_price"], Decimal("100.00"))
        self.assertEqual(public_payload["document_ids"], [3, 4])
        self.assertEqual(personalized_payload["pricing_mode"], "personalized")
        self.assertEqual(personalized_payload["customer_group"]["group_key"], "wholesale_special")
        self.assertEqual(personalized_payload["pricing_items"][0]["resolved_unit_price"], Decimal("90.00"))
        self.assertEqual(personalized_payload["pricing_items"][0]["resolved_total"], Decimal("180.00"))

    def test_client_page_action_is_persisted_and_activity_logged(self):
        page = client_portal_services.create_client_page(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "title": "Proposal A",
                "contact_id": 7,
                "pricing_items": [{"name": "Implementation", "quantity": 1, "currency": "USD", "public_unit_price": 100}],
            },
        )
        client_portal_services.publish_client_page_link(
            self.db,
            page=page,
            actor_user_id=1,
            expires_in_days=30,
        )

        action = client_portal_services.record_client_page_action(
            self.db,
            page=page,
            action="request_changes",
            payload={
                "message": "Please revise scope",
                "actor_name": "Buyer Contact",
                "actor_email": "buyer@example.com",
            },
            request_metadata={"client_host": "127.0.0.1"},
        )

        self.assertEqual(action.action, "request_changes")
        self.assertEqual(self.db.query(ClientPageAction).count(), 1)
        actions = {row.action for row in self.db.query(ActivityLog).all()}
        self.assertIn("client_page.request_changes", actions)

    def test_resolve_client_customer_group_from_linked_contact(self):
        group = client_portal_services.create_customer_group(
            self.db,
            tenant_id=10,
            payload={
                "group_key": "wholesale_special",
                "name": "Wholesale Special",
                "discount_type": "percent",
                "discount_value": 15,
                "is_active": True,
            },
        )
        client_portal_services.assign_contact_customer_group(
            self.db,
            tenant_id=10,
            contact_id=7,
            group_id=group.id,
        )
        account = ClientAccount(
            id=20,
            tenant_id=10,
            contact_id=7,
            email="buyer@example.com",
            status="active",
        )
        self.db.add(account)
        self.db.commit()
        account = self.db.query(ClientAccount).filter(ClientAccount.id == 20).first()

        resolved = client_portal_services.resolve_client_customer_group(self.db, account=account)

        self.assertEqual(resolved.group_key, "wholesale_special")


if __name__ == "__main__":
    unittest.main()
