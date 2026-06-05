import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.contracts.models import Contract
from app.modules.contracts.services import contracts_services
from app.modules.contracts.services.contracts_services import add_contract_party, add_contract_signer, create_contract, get_contract_or_404, update_contract, update_contract_signer
from app.modules.documents.models import Document
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class FakeContractQuery:
    def __init__(self):
        self.operations = []

    def count(self):
        self.operations.append("count")
        return 0

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def offset(self, value):
        self.operations.append(("offset", value))
        return self

    def limit(self, value):
        self.operations.append(("limit", value))
        return self

    def all(self):
        self.operations.append("all")
        return []


class ContractTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="default", name="Default"),
            Tenant(id=99, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
            User(id=2, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
            SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
            SalesOrganization(org_id=99, tenant_id=99, org_name="Other", primary_email="hello@other.test"),
            SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
            SalesOpportunity(opportunity_id=40, tenant_id=10, opportunity_name="Acme Pilot", client="Ada", contact_id=30, organization_id=20),
            SalesQuote(quote_id=50, tenant_id=10, quote_number="Q-500", customer_name="Acme", status="accepted", currency="USD"),
            SalesOrder(id=60, tenant_id=10, order_number="SO-60", status="confirmed", currency="USD"),
            Document(id=70, tenant_id=10, uploaded_by_user_id=1, title="MSA", original_filename="msa.pdf", content_type="application/pdf", extension="pdf", file_size_bytes=100, storage_path="/tmp/msa.pdf"),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_create_contract_links_records_and_events(self):
        item = create_contract(self.db, {"title": "Acme MSA", "organization_id": 20, "contact_id": 30, "opportunity_id": 40, "quote_id": 50, "order_id": 60, "document_id": 70, "value_amount": "1000", "currency": "usd"}, self.user)

        self.assertEqual(item.tenant_id, 10)
        self.assertTrue(item.contract_number.startswith("CTR-"))
        self.assertEqual(item.status, "draft")
        self.assertEqual(item.value_amount, Decimal("1000.00"))
        self.assertEqual(len(item.events), 1)

    def test_create_contract_rejects_cross_tenant_link(self):
        with self.assertRaises(HTTPException) as exc:
            create_contract(self.db, {"title": "Bad contract", "organization_id": 99}, self.user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Organization not found")

    def test_update_status_records_event(self):
        item = create_contract(self.db, {"title": "Status contract"}, self.user)

        updated = update_contract(self.db, item, {"status": "sent"}, self.user)

        self.assertEqual(updated.status, "sent")
        self.assertEqual(updated.events[-1].event_type, "status_changed")

    def test_party_and_signer_lifecycle(self):
        item = create_contract(self.db, {"title": "Signer contract"}, self.user)
        party = add_contract_party(self.db, item, {"name": "Acme Ltd", "email": "legal@acme.test", "role": "customer"}, self.user)
        signer = add_contract_signer(self.db, item, {"party_id": party.id, "name": "Ada", "email": "ada@acme.test"}, self.user)

        updated_signer = update_contract_signer(self.db, item, signer.id, {"status": "signed"}, self.user)

        self.assertEqual(updated_signer.status, "signed")
        self.assertIsNotNone(updated_signer.signed_at)

    def test_get_contract_scopes_by_tenant(self):
        item = create_contract(self.db, {"title": "Tenant scoped"}, self.user)

        with self.assertRaises(HTTPException) as exc:
            get_contract_or_404(self.db, tenant_id=99, contract_id=item.id)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.query(Contract).filter(Contract.tenant_id == 10).count(), 1)

    def test_list_contracts_applies_explicit_sort_before_pagination(self):
        query = FakeContractQuery()
        pagination = SimpleNamespace(offset=10, limit=5)

        with patch.object(contracts_services, "build_contracts_query", return_value=query):
            items, total_count = contracts_services.list_contracts(
                self.db,
                tenant_id=10,
                pagination=pagination,
                sort_by="title",
                sort_direction="asc",
            )

        self.assertEqual(items, [])
        self.assertEqual(total_count, 0)
        self.assertEqual(query.operations, ["count", "order_by_reset", "order_by", ("offset", 10), ("limit", 5), "all"])


if __name__ == "__main__":
    unittest.main()
