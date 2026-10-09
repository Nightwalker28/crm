"""13d §3.4 (Step 7, F5 slice 5.4): sending a commercial document by email — recipients, the
PDF, the tokens, and what sending does to the document."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.services import pos_invoice_services
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import ActivityLog, DocumentSetting, MessageTemplate
from app.modules.platform.services import document_pdfs, document_send
from app.modules.purchasing.services import purchase_order_services as orders
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.sales.services.quotes_services import create_sales_quote
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10


class DocumentSendTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, first_name="Ada", last_name="Owner", email="owner@example.com")
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Northwind", operating_currencies=["USD"], base_currency="USD"),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme", primary_email="ap@acme.test", assigned_to=1),
            SalesOrganization(org_id=7, tenant_id=TENANT, org_name="Lens Supply", primary_email="sales@lens.test", is_vendor=1, assigned_to=1),
            SalesContact(contact_id=11, tenant_id=TENANT, first_name="Bea", last_name="Buyer", primary_email="bea@acme.test", organization_id=5, assigned_to=1),
            SalesContact(contact_id=12, tenant_id=TENANT, first_name="Cal", last_name="Clerk", primary_email="cal@acme.test", organization_id=5, assigned_to=1),
            SalesContact(contact_id=13, tenant_id=TENANT, first_name="Lou", last_name="Lens", primary_email="lou@lens.test", organization_id=7, assigned_to=1),
            CatalogProduct(id=1, tenant_id=TENANT, name="Lens", currency="USD", public_unit_price=10, track_inventory=0, cost_price=4),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=TENANT)
        self.db.commit()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for target, value in ((document_pdfs, Path(folder.name)),):
            patcher = patch.object(target, "UPLOADS_DIR", value)
            patcher.start()
            self.addCleanup(patcher.stop)
        snapshots = patch.object(document_pdfs, "SNAPSHOT_DIR", Path(folder.name) / "document-pdfs")
        snapshots.start()
        self.addCleanup(snapshots.stop)
        render = patch.object(document_pdfs, "render_pdf", return_value=b"%PDF-test")
        render.start()
        self.addCleanup(render.stop)

    def tearDown(self):
        self.db.close()

    def quote(self):
        return create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "contact_id": 11,
                                            "items": [{"name": "Lens", "quantity": "1", "unit_price": "10"}]}, self.user)

    def test_the_document_offers_its_people_and_its_template(self):
        document_send.ensure_document_email_templates(self.db, TENANT)
        self.db.commit()
        quote = self.quote()
        context = document_send.send_context(self.db, self.user, "sales_quotes", quote.quote_id)
        self.assertEqual([person["email"] for person in context["recipients"]], ["bea@acme.test", "cal@acme.test"])
        self.assertTrue(context["recipients"][0]["is_primary"])
        template = self.db.query(MessageTemplate).filter(MessageTemplate.template_key == "document.quote").one()
        self.assertEqual(context["email_template_id"], template.id)
        self.assertTrue(context["can_send"])
        self.assertIn(quote.quote_number, context["subject"])

    def test_a_draft_invoice_is_not_sent(self):
        invoice = pos_invoice_services.create_invoice(self.db, self.user, {"customer_name": "Acme", "customer_organization_id": 5,
                                                                           "lines": [{"description": "Work", "quantity": 1, "unit_price": 5}]})
        self.assertFalse(document_send.send_context(self.db, self.user, "finance_pos", invoice.id)["can_send"])
        with self.assertRaises(HTTPException) as error:
            document_send.prepare(self.db, self.user, "finance_pos", invoice.id, attach_pdf=True, recipients=["ap@acme.test"])
        self.assertEqual(error.exception.status_code, 409)

    def test_sending_a_quote_gives_it_a_link_a_pdf_and_marks_it_sent(self):
        quote = self.quote()
        prepared = document_send.prepare(self.db, self.user, "sales_quotes", quote.quote_id, attach_pdf=True, recipients=["bea@acme.test"])
        self.assertIn("/public/quotes/proposal/", prepared["tokens"]["public_link"])
        self.assertEqual(prepared["attachments"][0]["content"], b"%PDF-test")
        self.assertTrue(prepared["attachments"][0]["filename"].endswith(".pdf"))
        document_send.after_send(self.db, self.user, "sales_quotes", quote.quote_id, recipients=["bea@acme.test"], attached_pdf=True)
        self.db.refresh(quote)
        self.assertEqual(quote.status, "sent")
        log = self.db.query(ActivityLog).filter(ActivityLog.action == "document.sent").one()
        self.assertEqual(log.module_key, "sales_quotes")
        self.assertIn("bea@acme.test", log.description)

    def test_sending_a_draft_po_sends_the_request(self):
        order = orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": 7, "lines": [
            {"product_id": 1, "quantity": "5", "unit_cost": "4"}]})
        self.db.commit()
        context = document_send.send_context(self.db, self.user, "purchase_orders", order.id)
        self.assertEqual([person["email"] for person in context["recipients"]], ["lou@lens.test"])
        self.assertTrue(context["label"].startswith("Request for quotation"))
        document_send.after_send(self.db, self.user, "purchase_orders", order.id, recipients=["lou@lens.test"], attached_pdf=False)
        self.db.refresh(order)
        self.assertEqual(order.status, "sent")

    def test_only_the_documents_people_can_be_filed_against(self):
        quote = self.quote()
        allowed = document_send.document_contact_ids(self.db, self.user, "sales_quotes", quote.quote_id)
        self.assertEqual(allowed, {11, 12})

    def test_templates_are_seeded_once_and_an_admins_choice_stays(self):
        document_send.ensure_document_email_templates(self.db, TENANT)
        setting = self.db.query(DocumentSetting).filter(DocumentSetting.kind == "invoice").one()
        setting.email_template_id, setting.updated_by = None, 1
        self.db.commit()
        document_send.ensure_document_email_templates(self.db, TENANT)
        self.db.refresh(setting)
        self.assertIsNone(setting.email_template_id)
        self.assertEqual(self.db.query(MessageTemplate).filter(MessageTemplate.template_key == "document.invoice").count(), 1)


if __name__ == "__main__":
    unittest.main()
