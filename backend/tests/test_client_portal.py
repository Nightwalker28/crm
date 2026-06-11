import unittest
from types import SimpleNamespace
from decimal import Decimal

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.client_portal.models import ClientAccount, ClientPage, ClientPageAction, CustomerGroup
from app.modules.client_portal.routes.client_portal_routes import (
    _optional_client_account,
    _request_metadata,
    _resolve_client_auth_tenant,
    get_client_me,
)
from app.modules.client_portal.services import client_portal_services
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesContact, SalesOrganization, SalesQuote
from app.modules.sales.services.quotes_services import (
    get_client_quote_or_404,
    list_client_quotes,
    respond_to_client_quote,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus
from app.modules.website_integrations.models import WebsiteIntegrationOrder


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

    def test_client_accounts_sort_by_email(self):
        client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "zeta@example.com", "contact_id": 7},
        )
        client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "alpha@example.com", "organization_id": 3},
        )

        accounts = client_portal_services.list_client_accounts(
            self.db,
            tenant_id=10,
            sort_by="email",
            sort_direction="asc",
        )

        self.assertEqual([account.email for account in accounts], ["alpha@example.com", "zeta@example.com"])

    def test_client_pages_sort_by_title(self):
        client_portal_services.create_client_page(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "title": "Zeta Proposal",
                "contact_id": 7,
                "pricing_items": [{"name": "Implementation", "quantity": 1, "currency": "USD", "public_unit_price": 100}],
            },
        )
        client_portal_services.create_client_page(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "title": "Alpha Proposal",
                "organization_id": 3,
                "pricing_items": [{"name": "Support", "quantity": 1, "currency": "USD", "public_unit_price": 50}],
            },
        )

        pages = client_portal_services.list_client_pages(
            self.db,
            tenant_id=10,
            sort_by="title",
            sort_direction="asc",
        )

        self.assertEqual([page.title for page in pages], ["Alpha Proposal", "Zeta Proposal"])

    def test_client_password_setup_enforces_main_password_policy(self):
        _account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.setup_client_password(
                self.db,
                token=setup_token,
                password="short",
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("Password must be at least", exc.exception.detail)

    def test_client_password_setup_rejects_tenant_slug_mismatch(self):
        _account, setup_token = client_portal_services.create_client_account(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"email": "buyer@example.com", "contact_id": 7, "status": "pending"},
        )

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.setup_client_password(
                self.db,
                token=setup_token,
                password="ClientPass123",
                expected_tenant_id=99,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Setup link is invalid")

    def test_client_login_failed_attempts_are_rate_limited_and_clearable(self):
        email = "buyer@example.com"
        client_host = "203.0.113.10"
        for key in client_portal_services._client_login_attempt_keys(
            tenant_id=10,
            email=email,
            client_host=client_host,
        ):
            client_portal_services.cache_delete(key)

        try:
            for _ in range(5):
                client_portal_services.record_failed_client_login_attempt(
                    tenant_id=10,
                    email=email,
                    client_host=client_host,
                )

            with self.assertRaises(HTTPException) as exc:
                client_portal_services.check_client_login_rate_limit(
                    tenant_id=10,
                    email=email,
                    client_host=client_host,
                )

            self.assertEqual(exc.exception.status_code, 429)

            client_portal_services.clear_failed_client_login_attempts(
                tenant_id=10,
                email=email,
                client_host=client_host,
            )
            client_portal_services.check_client_login_rate_limit(
                tenant_id=10,
                email=email,
                client_host=client_host,
            )
        finally:
            for key in client_portal_services._client_login_attempt_keys(
                tenant_id=10,
                email=email,
                client_host=client_host,
            ):
                client_portal_services.cache_delete(key)

    def test_public_client_page_action_attempts_are_rate_limited_by_token_and_ip(self):
        token = "public-token"
        client_host = "203.0.113.20"
        cache_key = client_portal_services._public_client_page_action_rate_limit_key(
            token=token,
            client_host=client_host,
        )
        client_portal_services.cache_delete(cache_key)

        try:
            for _ in range(10):
                client_portal_services.record_public_client_page_action_attempt(
                    token=token,
                    client_host=client_host,
                )

            with self.assertRaises(HTTPException) as exc:
                client_portal_services.check_public_client_page_action_rate_limit(
                    token=token,
                    client_host=client_host,
                )

            self.assertEqual(exc.exception.status_code, 429)
        finally:
            client_portal_services.cache_delete(cache_key)

    def test_client_page_document_access_requires_matching_client_account(self):
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
        account = ClientAccount(
            id=20,
            tenant_id=10,
            organization_id=3,
            email="org@example.com",
            status="active",
        )
        self.db.add(account)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.require_client_account_matches_page(account, page)

        self.assertEqual(exc.exception.status_code, 403)

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

    def test_client_me_accepts_valid_client_token_without_request_tenant(self):
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
        _account, access_token = client_portal_services.authenticate_client_account(
            self.db,
            tenant_id=10,
            email="buyer@example.com",
            password="ClientPass123",
        )

        request = SimpleNamespace(state=SimpleNamespace())
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=access_token)

        response = get_client_me(request=request, credentials=credentials, db=self.db)

        self.assertEqual(response["tenant_id"], 10)
        self.assertEqual(response["email"], "buyer@example.com")
        self.assertEqual(response["contact_name"], "Buyer Contact")

        client_portal_services.update_client_account_status(
            self.db,
            account=account,
            status_value="inactive",
            actor_user_id=1,
        )

        with self.assertRaises(HTTPException) as exc:
            get_client_me(request=request, credentials=credentials, db=self.db)

        self.assertEqual(exc.exception.status_code, 401)

    def test_client_auth_tenant_resolves_from_public_page_token(self):
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
        _page, public_token = client_portal_services.publish_client_page_link(
            self.db,
            page=page,
            actor_user_id=1,
            expires_in_days=30,
        )
        request = SimpleNamespace(state=SimpleNamespace())

        tenant = _resolve_client_auth_tenant(
            self.db,
            request,
            page_token=public_token,
            tenant_slug=None,
        )

        self.assertEqual(tenant.id, 10)

    def test_client_auth_tenant_prefers_request_tenant_over_page_token(self):
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
        _page, public_token = client_portal_services.publish_client_page_link(
            self.db,
            page=page,
            actor_user_id=1,
            expires_in_days=30,
        )
        request = SimpleNamespace(state=SimpleNamespace(tenant=SimpleNamespace(id=99, slug="other")))

        tenant = _resolve_client_auth_tenant(
            self.db,
            request,
            page_token=public_token,
            tenant_slug=None,
        )

        self.assertEqual(tenant.id, 99)

    def test_request_metadata_truncates_user_agent_and_normalizes_ip(self):
        request = SimpleNamespace(
            client=SimpleNamespace(host="2001:0db8:0000:0000:0000:ff00:0042:8329"),
            headers={"user-agent": "A" * 600},
        )

        metadata = _request_metadata(request)

        self.assertEqual(metadata["client_host"], "2001:db8::ff00:42:8329")
        self.assertEqual(metadata["user_agent"], "A" * 500)

    def test_request_metadata_ignores_invalid_client_host(self):
        request = SimpleNamespace(
            client=SimpleNamespace(host="not an ip address"),
            headers={},
        )

        metadata = _request_metadata(request)

        self.assertIsNone(metadata["client_host"])
        self.assertIsNone(metadata["user_agent"])

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

    def test_client_catalog_lists_only_public_active_items_with_resolved_price(self):
        group = client_portal_services.create_customer_group(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "group_key": "portal_vip",
                "name": "Portal VIP",
                "discount_type": "percent",
                "discount_value": "10",
                "is_default": False,
                "is_active": True,
            },
        )
        contact = self.db.query(SalesContact).filter(SalesContact.contact_id == 7).one()
        contact.customer_group_id = group.id
        self.db.add_all(
            [
                contact,
                CatalogProduct(
                    id=100,
                    tenant_id=10,
                    name="Published Product",
                    currency="USD",
                    public_unit_price="100",
                    stock_status="in_stock",
                    is_public=1,
                    is_active=1,
                ),
                CatalogProduct(
                    id=101,
                    tenant_id=10,
                    name="Private Product",
                    currency="USD",
                    public_unit_price="100",
                    stock_status="in_stock",
                    is_public=0,
                    is_active=1,
                ),
                CatalogService(
                    id=200,
                    tenant_id=10,
                    name="Published Service",
                    currency="USD",
                    public_unit_price="50",
                    is_public=1,
                    is_active=1,
                ),
                CatalogService(
                    id=201,
                    tenant_id=10,
                    name="Inactive Service",
                    currency="USD",
                    public_unit_price="50",
                    is_public=1,
                    is_active=0,
                ),
            ]
        )
        self.db.commit()
        account = ClientAccount(id=30, tenant_id=10, contact_id=7, email="buyer@example.com", status="active")

        items = client_portal_services.list_client_catalog_items(self.db, account=account)
        payloads = [
            client_portal_services.serialize_client_catalog_item(
                item,
                group=client_portal_services.resolve_client_customer_group(self.db, account=account),
            )
            for item in items
        ]

        self.assertEqual({item["name"] for item in payloads}, {"Published Product", "Published Service"})
        product_payload = next(item for item in payloads if item["kind"] == "product")
        self.assertEqual(str(product_payload["resolved_unit_price"]), "90.00")
        self.assertEqual(product_payload["availability_status"], "in_stock")

    def test_client_catalog_request_is_activity_logged(self):
        product = CatalogProduct(
            id=110,
            tenant_id=10,
            name="Portal Product",
            currency="USD",
            public_unit_price="25",
            stock_status="preorder",
            is_public=1,
            is_active=1,
        )
        account = ClientAccount(id=31, tenant_id=10, contact_id=7, email="buyer@example.com", status="active")
        self.db.add_all([product, account])
        self.db.commit()

        request_id = client_portal_services.record_client_catalog_request(
            self.db,
            account=account,
            item=product,
            payload={"quantity": "2", "details": "Need delivery next month."},
        )

        entry = self.db.get(ActivityLog, request_id)
        self.assertEqual(entry.action, "portal.catalog.requested")
        self.assertEqual(entry.module_key, "client_portal")
        self.assertEqual(entry.after_state["source"], "client_portal")
        self.assertEqual(entry.after_state["client_account_id"], 31)
        self.assertEqual(entry.after_state["item"]["kind"], "product")

    def test_client_catalog_order_persists_order_and_activity(self):
        product = CatalogProduct(
            id=120,
            tenant_id=10,
            name="Portal Order Product",
            currency="USD",
            public_unit_price="40",
            stock_status="in_stock",
            stock_quantity="5",
            is_public=1,
            is_active=1,
        )
        account = ClientAccount(id=32, tenant_id=10, contact_id=7, email="buyer@example.com", status="active")
        self.db.add_all([product, account])
        self.db.commit()

        order = client_portal_services.create_client_catalog_order(
            self.db,
            account=account,
            item=product,
            payload={"quantity": "2", "details": "Ship after approval."},
        )

        self.assertEqual(order.status, "submitted")
        self.assertEqual(order.source_platform, "client_portal")
        self.assertEqual(order.customer_email, "buyer@example.com")
        self.assertEqual(str(order.subtotal_amount), "80.0000")
        self.assertEqual(order.metadata_json["client_account_id"], 32)
        self.assertEqual(str(product.stock_quantity), "5.0000")
        self.assertEqual(len(order.line_items), 1)
        self.assertEqual(order.line_items[0].catalog_product_id, 120)
        self.assertEqual(
            self.db.query(ActivityLog).filter(ActivityLog.action == "portal.order.submitted", ActivityLog.entity_id == str(order.id)).count(),
            1,
        )

        orders = client_portal_services.list_client_orders(self.db, account=account)
        self.assertEqual([item.id for item in orders], [order.id])

    def test_client_order_lookup_rejects_other_client_order(self):
        first = ClientAccount(id=33, tenant_id=10, contact_id=7, email="buyer@example.com", status="active")
        second = ClientAccount(id=34, tenant_id=10, organization_id=3, email="org@example.com", status="active")
        order = WebsiteIntegrationOrder(
            id=50,
            tenant_id=10,
            external_reference="portal-33-manual",
            source_platform="client_portal",
            status="submitted",
            request_hash="hash",
            customer_email="buyer@example.com",
            currency="USD",
            subtotal_amount="10",
        )
        self.db.add_all([first, second, order])
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            client_portal_services.get_client_order_or_404(self.db, account=second, order_id=50)

        self.assertEqual(exc.exception.status_code, 404)

    def test_client_quotes_are_scoped_to_linked_customer(self):
        self.db.add_all(
            [
                SalesQuote(
                    quote_id=501,
                    tenant_id=10,
                    quote_number="Q-501",
                    customer_name="Buyer Contact",
                    contact_id=7,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("1200"),
                ),
                SalesQuote(
                    quote_id=502,
                    tenant_id=10,
                    quote_number="Q-502",
                    customer_name="Buyer Co",
                    organization_id=3,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("2200"),
                ),
                SalesQuote(
                    quote_id=503,
                    tenant_id=99,
                    quote_number="Q-503",
                    customer_name="Other Tenant",
                    contact_id=7,
                    status="sent",
                    currency="USD",
                    total_amount=Decimal("3200"),
                ),
            ]
        )
        self.db.commit()

        contact_quotes = list_client_quotes(self.db, tenant_id=10, contact_id=7, organization_id=None)
        org_quotes = list_client_quotes(self.db, tenant_id=10, contact_id=None, organization_id=3)

        self.assertEqual([quote.quote_id for quote in contact_quotes], [501])
        self.assertEqual([quote.quote_id for quote in org_quotes], [502])
        with self.assertRaises(HTTPException) as exc:
            get_client_quote_or_404(self.db, tenant_id=10, contact_id=7, organization_id=None, quote_id=502)
        self.assertEqual(exc.exception.status_code, 404)

    def test_client_quote_approval_updates_status_and_logs_activity(self):
        quote = SalesQuote(
            quote_id=504,
            tenant_id=10,
            quote_number="Q-504",
            customer_name="Buyer Contact",
            contact_id=7,
            status="sent",
            currency="USD",
            total_amount=Decimal("1200"),
        )
        account = ClientAccount(id=42, tenant_id=10, contact_id=7, email="buyer@example.com", status="active")
        self.db.add_all([quote, account])
        self.db.commit()

        updated = respond_to_client_quote(
            self.db,
            quote=quote,
            action="approve",
            client_account_id=account.id,
            message="Looks good.",
        )

        self.assertEqual(updated.status, "accepted")
        log = (
            self.db.query(ActivityLog)
            .filter(ActivityLog.module_key == "sales_quotes", ActivityLog.entity_id == "504")
            .one()
        )
        self.assertEqual(log.action, "portal.quote.approve")
        self.assertEqual(log.after_state["client_account_id"], 42)
        self.assertEqual(log.after_state["message"], "Looks good.")

    def test_client_quote_reject_blocks_when_not_open(self):
        quote = SalesQuote(
            quote_id=505,
            tenant_id=10,
            quote_number="Q-505",
            customer_name="Buyer Contact",
            contact_id=7,
            status="accepted",
            currency="USD",
            total_amount=Decimal("1200"),
        )
        self.db.add(quote)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            respond_to_client_quote(
                self.db,
                quote=quote,
                action="reject",
                client_account_id=42,
                message="No longer needed.",
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Quote is not open for portal response.")

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

    def test_client_page_action_exact_replay_returns_existing_record(self):
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
        payload = {
            "message": "Approved",
            "actor_name": "Buyer Contact",
            "actor_email": "buyer@example.com",
        }

        first = client_portal_services.record_client_page_action(
            self.db,
            page=page,
            action="accept",
            payload=payload,
            request_metadata={"client_host": "127.0.0.1"},
        )
        second = client_portal_services.record_client_page_action(
            self.db,
            page=page,
            action="accept",
            payload=payload,
            request_metadata={"client_host": "127.0.0.2"},
        )
        changed = client_portal_services.record_client_page_action(
            self.db,
            page=page,
            action="request_changes",
            payload={**payload, "message": "Please revise scope"},
        )

        self.assertEqual(second.id, first.id)
        self.assertNotEqual(changed.id, first.id)
        self.assertEqual(self.db.query(ClientPageAction).count(), 2)

    def test_client_page_brand_proposal_and_actions_are_serialized(self):
        page = client_portal_services.create_client_page(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "title": "Proposal A",
                "contact_id": 7,
                "pricing_items": [{"name": "Implementation", "quantity": 1, "currency": "USD", "public_unit_price": 100}],
                "proposal_sections": [
                    {"title": "Scope", "body": "Build and launch.", "sort_order": 2},
                    {"title": "Overview", "body": "A focused project.", "sort_order": 1},
                ],
                "brand_settings": {
                    "company_name": "Buyer Portal",
                    "logo_url": "https://example.com/logo.png",
                    "accent_color": "#14b8a6",
                },
            },
        )
        client_portal_services.record_client_page_action(
            self.db,
            page=page,
            action="accept",
            payload={"actor_name": "Buyer Contact", "actor_email": "buyer@example.com"},
        )

        crm_payload = client_portal_services.serialize_client_page(page, db=self.db)
        public_payload = client_portal_services.serialize_public_client_page(page, db=self.db)

        self.assertEqual(crm_payload["brand_settings"]["company_name"], "Buyer Portal")
        self.assertEqual(public_payload["brand_settings"]["accent_color"], "#14b8a6")
        self.assertEqual([section["title"] for section in public_payload["proposal_sections"]], ["Overview", "Scope"])
        self.assertEqual(crm_payload["action_count"], 1)
        self.assertEqual(crm_payload["latest_action"]["action"], "accept")

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

    def test_public_client_page_resolves_customer_group_with_unloaded_account_relationship(self):
        group = client_portal_services.create_customer_group(
            self.db,
            tenant_id=10,
            payload={
                "group_key": "vip_special",
                "name": "VIP Special",
                "discount_type": "percent",
                "discount_value": 20,
                "is_active": True,
            },
        )
        client_portal_services.assign_contact_customer_group(
            self.db,
            tenant_id=10,
            contact_id=7,
            group_id=group.id,
        )
        page = ClientPage(
            id=30,
            tenant_id=10,
            contact_id=7,
            title="Proposal",
            status="published",
            pricing_items=[],
        )
        account = ClientAccount(
            id=21,
            tenant_id=10,
            contact_id=7,
            email="buyer2@example.com",
            status="active",
        )

        payload = client_portal_services.serialize_public_client_page(page, account=account, db=self.db)

        self.assertEqual(payload["pricing_mode"], "personalized")
        self.assertEqual(payload["customer_group"]["group_key"], "vip_special")

    def test_optional_client_account_treats_invalid_token_as_anonymous(self):
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-valid-token")

        self.assertIsNone(_optional_client_account(self.db, credentials))


if __name__ == "__main__":
    unittest.main()
