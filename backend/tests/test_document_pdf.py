"""13d §3.3 (Step 7, F5 slice 5.3): one renderer for every document, snapshots of issued
documents, and nothing fetched from outside the document."""

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import document_pdf
from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.services import pos_invoice_services
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import DocumentPdfSnapshot
from app.modules.platform.services import document_pdfs
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.quotes_services import create_sales_quote
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10


class DocumentPdfTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT)
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Northwind Ltd", operating_currencies=["USD"], base_currency="USD",
                           billing_address="1 Harbour Road\nPort Town", bank_details="IBAN GB00 0000", brand_color="#123456"),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme Corp", primary_email="ap@acme.test", assigned_to=1,
                              billing_address="9 Market St", billing_city="Springfield", billing_country="US"),
        ])
        self.db.commit()
        self.snapshot_dir = tempfile.TemporaryDirectory()
        patcher = patch.object(document_pdfs, "SNAPSHOT_DIR", Path(self.snapshot_dir.name) / "document-pdfs")
        uploads = patch.object(document_pdfs, "UPLOADS_DIR", Path(self.snapshot_dir.name))
        patcher.start()
        uploads.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(uploads.stop)

    def tearDown(self):
        self.db.close()
        self.snapshot_dir.cleanup()

    def invoice(self, issue=False):
        return pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Acme Corp", "customer_organization_id": 5, "issue": issue,
            "lines": [{"description": "Setup", "quantity": 2, "unit_price": 50, "discount_amount": 10},
                      {"description": "Hardware", "line_type": "section"}]})

    def test_the_invoice_prints_as_an_invoice_for_the_account(self):
        invoice = self.invoice()
        html = document_pdfs.render_preview(self.db, self.user, "finance_pos", invoice.id)
        self.assertIn("<h1>Invoice</h1>", html)
        self.assertIn("Northwind Ltd", html)
        self.assertIn("Acme Corp", html)
        self.assertIn("9 Market St", html)  # the account's address, not the contact's email (H16)
        self.assertIn("DRAFT", html)
        self.assertNotIn("POS", html)
        self.assertIn("#123456", html)
        self.assertIn("Hardware", html)

    def test_every_kind_renders(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "items": [
            {"name": "A", "quantity": "1", "unit_price": "10", "discount_percent": "10"},
            {"name": "Extra", "quantity": "1", "unit_price": "5", "is_optional": True}]}, self.user)
        html = document_pdfs.render_preview(self.db, self.user, "sales_quotes", quote.quote_id)
        self.assertIn("10%", html)
        self.assertIn("Optional", html)
        self.assertNotIn("Status", html)  # no internal status on a customer document (H7)

    def test_an_issued_document_is_served_from_its_snapshot(self):
        invoice = self.invoice(issue=True)
        self.db.commit()
        with patch.object(document_pdfs, "render_pdf", return_value=b"%PDF-first") as render:
            first, filename = document_pdfs.document_pdf(self.db, self.user, "finance_pos", invoice.id)
            again, _ = document_pdfs.document_pdf(self.db, self.user, "finance_pos", invoice.id)
        self.assertEqual((first, again), (b"%PDF-first", b"%PDF-first"))
        self.assertEqual(render.call_count, 1)
        self.assertTrue(filename.startswith("Invoice-"))
        self.assertEqual(self.db.query(DocumentPdfSnapshot).count(), 1)

    def test_a_draft_renders_live_and_keeps_no_snapshot(self):
        invoice = self.invoice()
        with patch.object(document_pdfs, "render_pdf", return_value=b"%PDF-draft"):
            content, _ = document_pdfs.document_pdf(self.db, self.user, "finance_pos", invoice.id)
        self.assertEqual(content, b"%PDF-draft")
        self.assertEqual(self.db.query(DocumentPdfSnapshot).count(), 0)

    def test_another_tenants_document_is_not_found(self):
        invoice = self.invoice()
        with self.assertRaises(HTTPException) as error:
            document_pdfs.render_preview(self.db, SimpleNamespace(id=2, tenant_id=20), "finance_pos", invoice.id)
        self.assertEqual(error.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            document_pdfs.kind_for("sales_leads")

    def test_nothing_is_fetched_from_outside_the_document(self):
        for url in ("http://169.254.169.254/latest", "file:///etc/passwd", "https://example.com/logo.png"):
            with self.assertRaises(ValueError):
                document_pdf._refuse_remote(url)
        self.assertIsNone(document_pdf.image_data_uri("../../etc/passwd"))
        self.assertIsNone(document_pdf.image_data_uri("https://example.com/logo.png"))

    def test_default_texts_start_new_documents(self):
        document_pdfs.save_document_setting(self.db, tenant_id=TENANT, actor_user_id=1, kind="quote",
                                            payload={"default_terms": "Valid 30 days.", "title": "Proposal"})
        self.db.commit()
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "items": [{"name": "A", "quantity": "1", "unit_price": "1"}]}, self.user)
        self.assertEqual(quote.terms_and_conditions, "Valid 30 days.")
        html = document_pdfs.render_preview(self.db, self.user, "sales_quotes", quote.quote_id)
        self.assertIn("<h1>Proposal</h1>", html)
        self.assertEqual(Decimal(quote.total_amount), Decimal("1.00"))


if __name__ == "__main__":
    unittest.main()
