import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.finance.models import FinancePosInvoice
from app.modules.finance.repositories import pos_invoice_repository
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


if __name__ == "__main__":
    unittest.main()
