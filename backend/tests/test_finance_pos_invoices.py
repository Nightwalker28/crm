import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.finance.services import pos_invoice_services as services
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales import models as sales_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User


class PosInvoiceServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=7, tenant_id=10, email="user@example.com"),
                User(id=8, tenant_id=99, email="other@example.com"),
                CompanyProfile(id=1, tenant_id=10, name="Default Co", operating_currencies=["USD"]),
                CompanyProfile(id=2, tenant_id=99, name="Other Co", operating_currencies=["USD"]),
            ]
        )
        self.db.commit()
        self.user = SimpleNamespace(id=7, tenant_id=10, role_id=None, team_id=None)
        self.other_user = SimpleNamespace(id=8, tenant_id=99, role_id=None, team_id=None)

    def tearDown(self):
        self.db.close()

    def test_create_invoice_calculates_totals_and_stores_template(self):
        invoice = services.create_invoice(
            self.db,
            self.user,
            {
                "customer_name": "Walk-in Customer",
                "currency": "USD",
                "template_id": "compact",
                "status": "issued",
                "payment_status": "partial",
                "discount_amount": 5,
                "tax_rate": 10,
                "amount_paid": 20,
                "lines": [
                    {"description": "Item A", "quantity": 2, "unit_price": 15},
                    {"description": "Item B", "quantity": 1, "unit_price": 10},
                ],
            },
        )

        serialized = services.serialize_invoice(invoice, current_user=self.user)
        self.assertEqual(serialized["invoice_number"], "POS000001")
        self.assertEqual(serialized["template_id"], "compact")
        self.assertEqual(serialized["subtotal_amount"], 40.0)
        self.assertEqual(serialized["tax_amount"], 3.5)
        self.assertEqual(serialized["total_amount"], 38.5)
        self.assertEqual(serialized["balance_due"], 18.5)
        self.assertEqual(len(serialized["lines"]), 2)

    def test_invoice_access_is_tenant_scoped(self):
        invoice = services.create_invoice(
            self.db,
            self.user,
            {
                "customer_name": "Tenant Customer",
                "currency": "USD",
                "template_id": "modern",
                "lines": [{"description": "Item", "quantity": 1, "unit_price": 25}],
            },
        )

        with self.assertRaises(HTTPException) as exc:
            services.get_invoice_or_404(self.db, self.other_user, invoice.id)

        self.assertEqual(exc.exception.status_code, 404)

    def test_soft_delete_removes_invoice_from_list(self):
        invoice = services.create_invoice(
            self.db,
            self.user,
            {
                "customer_name": "Delete Me",
                "currency": "USD",
                "template_id": "modern",
                "lines": [{"description": "Item", "quantity": 1, "unit_price": 25}],
            },
        )
        services.soft_delete_invoice(self.db, self.user, invoice.id)

        with self.assertRaises(HTTPException) as exc:
            services.get_invoice_or_404(self.db, self.user, invoice.id)

        self.assertEqual(exc.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
