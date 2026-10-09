import unittest
from decimal import Decimal
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.finance.models import FinancePosInvoice
from app.modules.finance.models import FinancePosInvoiceLine
from app.modules.finance.repositories import pos_invoice_repository
from app.modules.finance.services.common import finance_date_to_iso
from app.modules.finance.services import pos_invoice_services
from app.modules.finance.services.pos_invoice_services import serialize_invoice


def _empty_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.core.database import Base
    from app.modules.platform import models as _platform_models  # noqa: F401
    from app.modules.user_management import models as _user_management_models  # noqa: F401

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class FakePosInvoiceQuery:
    def __init__(self):
        self.operations = []

    def count(self):
        self.operations.append("count")
        return 3

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def offset(self, value):
        self.operations.append(f"offset:{value}")
        return self

    def limit(self, value):
        self.operations.append(f"limit:{value}")
        return self

    def all(self):
        self.operations.append("all")
        return [SimpleNamespace(id=2, invoice_number="POS-002")]


class FakeDeleteDB:
    def __init__(self):
        self.added = []
        self.committed = False

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.committed = True


class FakePaymentDB(FakeDeleteDB):
    def __init__(self):
        super().__init__()
        self.flushed = False
        self.refreshed = None

    def flush(self):
        self.flushed = True

    def refresh(self, value):
        self.refreshed = value


class FinancePosInvoiceTests(unittest.TestCase):
    def test_finance_date_to_iso_handles_none_date_and_datetime(self):
        self.assertIsNone(finance_date_to_iso(None))
        self.assertEqual(finance_date_to_iso(date(2026, 7, 10)), "2026-07-10")
        self.assertEqual(finance_date_to_iso(datetime(2026, 7, 10, 14, 30)), "2026-07-10")

    def test_serialize_invoice_uses_assigned_user_relationship_for_user_name(self):
        invoice = FinancePosInvoice(
            id=1,
            tenant_id=10,
            user_id=2,
            invoice_number="POS-1",
            mode="pos",
            status="issued",
            payment_status="unpaid",
            payment_method=None,
            template_id="modern",
            accent_color="#14b8a6",
            customer_name="Buyer",
            currency="USD",
            subtotal_amount=Decimal("10.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
        )
        invoice.assigned_user = SimpleNamespace(first_name="Ava", last_name="Admin", email="ava@example.com")

        payload = serialize_invoice(invoice, current_user=SimpleNamespace(id=1), include_lines=False)

        self.assertEqual(payload["user_name"], "Ava Admin")

    def test_serialize_invoice_includes_linked_customer_display_names(self):
        invoice = FinancePosInvoice(
            id=1,
            tenant_id=10,
            user_id=2,
            invoice_number="POS-1",
            mode="pos",
            status="issued",
            payment_status="unpaid",
            template_id="modern",
            accent_color="#14b8a6",
            customer_name="Buyer",
            currency="USD",
            subtotal_amount=Decimal("10.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
        )
        invoice.customer_contact = SimpleNamespace(first_name="Ada", last_name="Lovelace", primary_email="ada@example.com")
        invoice.customer_organization = SimpleNamespace(org_name="Analytical Engines")

        payload = serialize_invoice(invoice, current_user=SimpleNamespace(id=1), include_lines=False)

        self.assertEqual(payload["customer_contact_name"], "Ada Lovelace")
        self.assertEqual(payload["customer_organization_name"], "Analytical Engines")

    def test_list_invoices_keeps_lightweight_shape_without_lines(self):
        invoice = FinancePosInvoice(
            id=1,
            tenant_id=10,
            user_id=1,
            invoice_number="POS-1",
            mode="pos",
            status="issued",
            payment_status="unpaid",
            payment_method=None,
            template_id="modern",
            accent_color="#14b8a6",
            customer_name="Buyer",
            currency="USD",
            subtotal_amount=Decimal("10.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
        )
        invoice.lines = [
            FinancePosInvoiceLine(
                tenant_id=10,
                id=10,
                invoice_id=1,
                description="Line",
                quantity=Decimal("1.00"),
                unit_price=Decimal("10.00"),
                line_total=Decimal("10.00"),
            )
        ]

        with patch.object(pos_invoice_repository, "list_invoices", return_value=([invoice], 1)):
            response = pos_invoice_services.list_invoices(
                object(),
                SimpleNamespace(id=1, tenant_id=10),
                pagination=SimpleNamespace(page=1, page_size=10, offset=0, limit=10),
            )

        self.assertEqual(response["total_count"], 1)
        self.assertEqual(response["results"][0]["invoice_number"], "POS-1")
        self.assertNotIn("lines", response["results"][0])

    def test_list_invoices_sorts_before_pagination(self):
        query = FakePosInvoiceQuery()
        current_user = SimpleNamespace(id=1, tenant_id=10)
        pagination = SimpleNamespace(offset=10, limit=5)

        with patch.object(pos_invoice_repository, "build_invoice_query", return_value=query):
            records, total_count = pos_invoice_repository.list_invoices(
                object(),
                current_user,
                pagination=pagination,
                sort_by="invoice_number",
                sort_direction="asc",
            )

        self.assertEqual(total_count, 3)
        self.assertEqual([record.invoice_number for record in records], ["POS-002"])
        self.assertEqual(
            query.operations,
            ["count", "order_by_reset", "order_by", "offset:10", "limit:5", "all"],
        )

    def test_soft_delete_invoice_uses_aware_utc_timestamp(self):
        invoice = FinancePosInvoice(
            id=1,
            tenant_id=10,
            user_id=1,
            invoice_number="POS-1",
            mode="pos",
            status="draft",  # E5: only drafts can be removed
            payment_status="unpaid",
            template_id="modern",
            accent_color="#14b8a6",
            customer_name="Buyer",
            currency="USD",
            subtotal_amount=Decimal("10.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
        )
        db = FakeDeleteDB()

        with patch.object(pos_invoice_services, "get_invoice_or_404", return_value=invoice):
            pos_invoice_services.soft_delete_invoice(db, SimpleNamespace(id=1, tenant_id=10), invoice_id=1)

        self.assertIsNotNone(invoice.deleted_at)
        self.assertIsNotNone(invoice.deleted_at.tzinfo)
        self.assertTrue(db.committed)
        self.assertEqual(len(db.added), 2)

    def test_pos_invoice_number_unique_index_is_active_row_scoped(self):
        index = next(index for index in FinancePosInvoice.__table__.indexes if index.name == "uq_finance_pos_invoices_active_tenant_number")

        self.assertTrue(index.unique)
        self.assertIn("deleted_at IS NULL", str(index.dialect_options["postgresql"]["where"]))
        self.assertIn("deleted_at IS NULL", str(index.dialect_options["sqlite"]["where"]))

    def test_apply_lines_preserves_existing_rows_by_id(self):
        invoice = FinancePosInvoice(id=1, tenant_id=10, invoice_number="POS-1")
        existing = FinancePosInvoiceLine(
            tenant_id=10,
            id=7,
            invoice_id=1,
            description="Existing",
            quantity=Decimal("1"),
            unit_price=Decimal("10"),
            line_total=Decimal("10"),
            sort_order=0,
        )
        invoice.lines = [existing]

        # No line carries a catalog link or an account; the tax resolver finds no rates.
        db = _empty_session()
        pos_invoice_services._apply_lines(
            db,
            invoice,
            [
                {"id": 7, "description": "Updated", "quantity": 2, "unit_price": 15},
                {"description": "New", "quantity": 1, "unit_price": 5},
            ],
        )

        self.assertEqual(invoice.subtotal_amount, Decimal("35.00"))
        self.assertEqual(invoice.total_amount, Decimal("35.00"))
        self.assertIs(invoice.lines[0], existing)
        self.assertEqual(invoice.lines[0].description, "Updated")
        self.assertIsNone(invoice.lines[1].id)

    def test_invoice_dates_are_iso_and_a_bad_one_is_refused(self):
        self.assertEqual(pos_invoice_services._date("2026-06-22"), date(2026, 6, 22))
        self.assertIsNone(pos_invoice_services._date(""))
        with self.assertRaises(HTTPException) as error:
            pos_invoice_services._date("22 June 2026")
        self.assertEqual(error.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
