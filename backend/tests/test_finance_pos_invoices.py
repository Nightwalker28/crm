import unittest
from decimal import Decimal
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.finance.models import FinancePosInvoice
from app.modules.finance.models import FinancePosInvoiceLine
from app.modules.finance.repositories import pos_invoice_repository
from app.modules.finance.services import io_search_services
from app.modules.finance.services import pos_invoice_services
from app.modules.finance.services.pos_invoice_services import serialize_invoice


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


class FinancePosInvoiceTests(unittest.TestCase):
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
            tax_rate=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
        )
        invoice.assigned_user = SimpleNamespace(first_name="Ava", last_name="Admin", email="ava@example.com")

        payload = serialize_invoice(invoice, current_user=SimpleNamespace(id=1), include_lines=False)

        self.assertEqual(payload["user_name"], "Ava Admin")

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
            status="issued",
            payment_status="unpaid",
            template_id="modern",
            accent_color="#14b8a6",
            customer_name="Buyer",
            currency="USD",
            subtotal_amount=Decimal("10.00"),
            discount_amount=Decimal("0.00"),
            tax_rate=Decimal("0.00"),
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

    def test_apply_totals_rejects_tax_rate_over_100(self):
        invoice = FinancePosInvoice(discount_amount=Decimal("0"), tax_rate=Decimal("0"), amount_paid=Decimal("0"))

        with self.assertRaises(HTTPException) as exc:
            pos_invoice_services._apply_totals(invoice, Decimal("100.00"), {"tax_rate": 101})

        self.assertEqual(exc.exception.status_code, 400)

    def test_apply_lines_preserves_existing_rows_by_id(self):
        invoice = FinancePosInvoice(id=1, tenant_id=10, invoice_number="POS-1")
        existing = FinancePosInvoiceLine(
            id=7,
            invoice_id=1,
            description="Existing",
            quantity=Decimal("1"),
            unit_price=Decimal("10"),
            line_total=Decimal("10"),
            sort_order=0,
        )
        invoice.lines = [existing]

        subtotal = pos_invoice_services._apply_lines(
            invoice,
            [
                {"id": 7, "description": "Updated", "quantity": 2, "unit_price": 15},
                {"description": "New", "quantity": 1, "unit_price": 5},
            ],
        )

        self.assertEqual(subtotal, Decimal("35.00"))
        self.assertIs(invoice.lines[0], existing)
        self.assertEqual(invoice.lines[0].description, "Updated")
        self.assertIsNone(invoice.lines[1].id)

    def test_parse_human_date_annotation_matches_date_return(self):
        self.assertEqual(io_search_services.parse_human_date.__annotations__["return"], "date | None")
        self.assertIsInstance(io_search_services.parse_human_date("2026-06-22"), date)


if __name__ == "__main__":
    unittest.main()
