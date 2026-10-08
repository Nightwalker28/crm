"""A list's export holds exactly the rows the list shows (13a A5, E1, G3)."""

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.list_conditions import ListConditions
from app.core.module_filters import parse_filter_conditions
from app.core.pagination import create_pagination
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.routes import credit_payment_routes, pos_invoice_routes
from app.modules.finance.services import credit_note_services, payment_services
from app.modules.inventory.routes import delivery_routes, return_routes
from app.modules.inventory.services import delivery_services, return_services
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse, ensure_product_levels
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.services.document_exports import DOCUMENT_EXPORT_MODULES, document_export_rows
from app.modules.purchasing.routes import bill_routes, purchasing_routes
from app.modules.purchasing.services import bill_services, purchase_order_services, receipt_services
from app.modules.sales.models import SalesOrganization
from app.modules.sales.repositories import organizations_repository
from app.modules.sales.services.organizations_services import export_organizations_for_view
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


NO_CONDITIONS = ListConditions()
CONDITIONS = ListConditions(all=[{"field": "status", "operator": "is", "value": "draft"}],
                            any=[{"field": "number", "operator": "contains", "value": "7"}])


class _RecordingQuery:
    """Stands in for a list query: records nothing, returns no rows, chains like a Query."""

    def count(self):
        return 0

    def all(self):
        return []

    def order_by(self, *_args):
        return self

    def offset(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def options(self, *_args):
        return self


def _given(kwargs: dict) -> dict:
    """The filters actually applied: a list passes an unset one as None, a job leaves it out."""
    return {key: value for key, value in kwargs.items() if value not in (None, "", [])}


class ListAndExportShareOneQueryTests(unittest.TestCase):
    """Every document list and its export build their rows with the same function and filters."""

    def setUp(self):
        self.db = SimpleNamespace()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.pagination = create_pagination(1, 25)

    def _calls(self, target, attribute, run):
        calls = []

        def record(*args, **kwargs):
            calls.append(_given(kwargs))
            return _RecordingQuery()

        with patch.object(target, attribute, side_effect=record), \
             patch("app.modules.finance.repositories.pos_invoice_repository.get_finance_user_scope",
                   return_value=SimpleNamespace(user_id_filter=None)), \
             patch("app.modules.platform.services.custom_fields.export_columns", return_value=[]):
            # Exports also carry the module's custom fields (13b §3.4); none here.
            run()
        return calls

    def _assert_parity(self, module_key, target, attribute, list_call, filters):
        listed = self._calls(target, attribute, list_call)
        exported = self._calls(target, attribute, lambda: document_export_rows(self.db, self.user, module_key=module_key, filters=filters))
        self.assertEqual(len(listed), 1, module_key)
        self.assertEqual(len(exported), 1, module_key)
        self.assertEqual(listed[0], exported[0], module_key)

    def test_every_document_export_is_covered_here(self):
        self.assertEqual(DOCUMENT_EXPORT_MODULES, {
            "inventory_deliveries", "inventory_returns", "purchase_orders", "purchase_receipts", "purchase_bills",
            "finance_pos", "finance_credit_notes", "finance_payments",
            # 13c §3.3.
            "inventory_adjustments", "inventory_transfers", "sales_orders",
            "purchase_vendor_returns", "purchase_vendor_credits",
        })

    def test_adjustments_and_transfers(self):
        from app.modules.inventory.routes import document_routes
        from app.modules.inventory.services import document_services

        for kind in ("adjustments", "transfers"):
            with self.subTest(kind=kind):
                route = document_routes.adjustments if kind == "adjustments" else document_routes.transfers
                self._assert_parity(f"inventory_{kind}", document_services, "list_query",
                    lambda: route(status="draft", search="ADJ", include_deleted=False, conditions=CONDITIONS, pagination=self.pagination,
                                  db=self.db, user=self.user),
                    {"status": "draft", "search": "ADJ", **CONDITIONS.as_filters()})

    def test_saved_view_conditions_reach_the_export(self):
        """13c §3.2: a saved view's conditions filter the list and its export alike."""
        self._assert_parity("purchase_orders", purchase_order_services, "list_query",
            lambda: purchasing_routes.list_orders(status=None, vendor_id=None, search=None, pagination=self.pagination,
                                                  conditions=CONDITIONS, db=self.db, user=self.user),
            CONDITIONS.as_filters())
        self._assert_parity("purchase_bills", bill_services, "list_query",
            lambda: bill_routes.list_bills(status=None, vendor_id=None, order_id=None, search=None, sort_by=None, sort_direction=None,
                                           pagination=self.pagination, conditions=CONDITIONS, db=self.db, user=self.user),
            CONDITIONS.as_filters())

    def test_deliveries(self):
        self._assert_parity("inventory_deliveries", delivery_services, "list_query",
            lambda: delivery_routes.deliveries(status="posted", search="DEL", order_id=4, pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "posted", "search": "DEL", "order_id": 4})

    def test_returns(self):
        self._assert_parity("inventory_returns", return_services, "list_query",
            lambda: return_routes.returns(status="received", search="R", delivery_id=3, pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "received", "search": "R", "delivery_id": 3})

    def test_purchase_orders(self):
        self._assert_parity("purchase_orders", purchase_order_services, "list_query",
            lambda: purchasing_routes.list_orders(status="open", vendor_id=5, search="PO", pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "open", "vendor_id": 5, "search": "PO"})

    def test_receipts(self):
        self._assert_parity("purchase_receipts", receipt_services, "list_query",
            lambda: purchasing_routes.list_receipts(status="posted", order_id=2, search="GRN", pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "posted", "order_id": 2, "search": "GRN"})

    def test_bills(self):
        self._assert_parity("purchase_bills", bill_services, "list_query",
            lambda: bill_routes.list_bills(status="overdue", vendor_id=5, order_id=None, search="B", sort_by=None, sort_direction=None,
                                           pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "overdue", "vendor_id": 5, "search": "B"})

    def test_credit_notes(self):
        self._assert_parity("finance_credit_notes", credit_note_services, "list_query",
            lambda: credit_payment_routes.list_credit_notes(status_filter="issued", invoice_id=9, search="CN", pagination=self.pagination,
                                                            conditions=NO_CONDITIONS, db=self.db, user=self.user),
            {"status": "issued", "invoice_id": 9, "search": "CN"})

    def test_payments(self):
        self._assert_parity("finance_payments", payment_services, "list_query",
            lambda: credit_payment_routes.list_payments(direction="received", status_filter="posted", method="card", search="P",
                                                        date_from=date(2026, 1, 1), date_to=date(2026, 2, 1), sort_by=None,
                                                        sort_direction=None, pagination=self.pagination, conditions=NO_CONDITIONS, db=self.db, user=self.user),
            # Dates travel through the job payload as ISO strings.
            {"direction": "received", "status": "posted", "method": "card", "search": "P", "date_from": "2026-01-01", "date_to": "2026-02-01"})

    def test_invoices(self):
        from app.modules.finance.repositories import pos_invoice_repository

        calls = []

        def record(db, user, **kwargs):
            calls.append(_given(kwargs))
            return _RecordingQuery()

        conditions = '[{"field": "currency", "operator": "is", "value": "USD"}]'
        with patch.object(pos_invoice_repository, "build_invoice_query", side_effect=record), \
             patch("app.modules.platform.services.custom_fields.export_columns", return_value=[]):
            pos_invoice_routes.list_pos_invoices(pagination=self.pagination, search="INV", status_filter="issued", payment_status_filter="unpaid",
                filter_logic="all", filters=None, filters_all=conditions, filters_any=None, sort_by=None, sort_direction=None,
                db=self.db, current_user=self.user)
            document_export_rows(self.db, self.user, module_key="finance_pos", filters={
                "search": "INV", "status": "issued", "payment_status": "unpaid",
                "filters_all": parse_filter_conditions(conditions)})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])

    def test_a_filter_the_list_does_not_have_is_dropped(self):
        calls = self._calls(purchase_order_services, "list_query",
            lambda: document_export_rows(self.db, self.user, module_key="purchase_orders", filters={"status": "open", "owner_id": 3}))
        self.assertEqual(calls, [{"tenant_id": 10, "status": "open"}])


class ListAndExportReturnTheSameRowsTests(unittest.TestCase):
    """The same, on real rows: what the list shows under a filter is what the export writes."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            User(id=1, tenant_id=10, email="buyer@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=10, email="other@example.com", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Lens Supply", primary_email="a@lens.test", is_vendor=1, assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=10, org_name="Grip Supply", primary_email="b@grip.test", is_vendor=1, assigned_to=2),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=10, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=10)
        ensure_product_levels(self.db, tenant_id=10, product_id=1)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_purchase_orders_by_status_and_vendor(self):
        for vendor_id, place in ((5, True), (5, False), (6, True)):
            order = purchase_order_services.save_order(self.db, tenant_id=10, actor_user_id=1, payload={
                "vendor_id": vendor_id, "lines": [{"product_id": 1, "quantity": "2", "unit_cost": "3"}]})
            self.db.commit()
            if place:
                purchase_order_services.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
                self.db.commit()

        for filters in ({}, {"status": "ordered"}, {"vendor_id": 5}, {"status": "draft", "vendor_id": 5}, {"search": "Grip"}):
            with self.subTest(filters=filters):
                listed = purchasing_routes.list_orders(status=filters.get("status"), vendor_id=filters.get("vendor_id"), search=filters.get("search"),
                    pagination=create_pagination(1, 50), conditions=NO_CONDITIONS, db=self.db, user=self.user)
                rows, _headers = document_export_rows(self.db, self.user, module_key="purchase_orders", filters=filters)
                self.assertEqual(sorted(row["number"] for row in listed["results"]), sorted(row["number"] for row in rows))

    def test_account_export_applies_every_list_filter(self):
        # The export used its own copy of the list query, which had no owner filter: filtering
        # the list to one owner exported everyone's accounts.
        conditions = [{"field": "assigned_to", "operator": "is", "value": 1}]
        listed, total = organizations_repository.list_paginated(self.db, tenant_id=10, offset=0, limit=50, all_filter_conditions=conditions)
        path, meta = export_organizations_for_view(self.db, tenant_id=10, all_filter_conditions=conditions)
        path.unlink(missing_ok=True)
        self.assertEqual([org.org_id for org in listed], [5])
        self.assertEqual(int(meta["rows"]), total)


if __name__ == "__main__":
    unittest.main()
