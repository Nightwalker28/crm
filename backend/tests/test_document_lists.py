"""13c §3.2–3.4 (Step 7, F4 slice 4.2): document lists take saved views, search and export,
and global search finds the documents."""

import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.list_conditions import ListConditions, list_conditions
from app.core.pagination import create_pagination
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryAdjustment, InventoryTransfer, InventoryWarehouse
from app.modules.inventory.services import document_services
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse, ensure_product_levels
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.services import global_search
from app.modules.platform.services.document_exports import document_export_rows
from app.modules.purchasing.models import PurchaseBill
from app.modules.purchasing.routes import purchasing_routes
from app.modules.purchasing.services import bill_services, purchase_order_services
from app.modules.sales.models import SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserSavedView, UserStatus
from app.modules.user_management.services import profile

TENANT, OTHER = 10, 20


class ListConditionsTests(unittest.TestCase):
    def test_all_and_any_are_read_from_their_own_parameters(self):
        conditions = list_conditions(filter_logic="all", filters=None, filters_all='[{"field": "status", "operator": "is", "value": "draft"}]',
                                     filters_any='[{"field": "number", "operator": "contains", "value": "7"}]')
        self.assertEqual(conditions.all[0]["field"], "status")
        self.assertEqual(conditions.any[0]["field"], "number")

    def test_the_older_single_parameter_follows_its_logic(self):
        payload = '[{"field": "status", "operator": "is", "value": "draft"}]'
        self.assertEqual(len(list_conditions(filter_logic="any", filters=payload, filters_all=None, filters_any=None).any), 1)
        self.assertEqual(len(list_conditions(filter_logic="all", filters=payload, filters_all=None, filters_any=None).all), 1)

    def test_a_bad_payload_is_a_400(self):
        with self.assertRaises(HTTPException) as caught:
            list_conditions(filter_logic="all", filters=None, filters_all="not json", filters_any=None)
        self.assertEqual(caught.exception.status_code, 400)


class PresetTests(unittest.TestCase):
    def test_every_document_list_takes_saved_views_and_has_presets(self):
        for module_key in ("purchase_orders", "purchase_receipts", "purchase_bills", "inventory_deliveries", "inventory_returns",
                           "inventory_adjustments", "inventory_transfers", "finance_credit_notes", "finance_payments"):
            self.assertIn(module_key, profile.SAVED_VIEW_MODULES, module_key)
            self.assertIn(module_key, profile.PRESET_SAVED_VIEWS, module_key)

    def test_mine_is_the_visiting_user(self):
        user = SimpleNamespace(id=42)
        condition = {"field": "owner_id", "operator": "is", "value": profile.CURRENT_USER}
        self.assertEqual(profile._for_user(condition, user)["value"], 42)
        other = {"field": "status", "operator": "is", "value": "draft"}
        self.assertIs(profile._for_user(other, user), other)

    def test_every_preset_field_is_one_the_list_filters_on(self):
        maps = {
            "purchase_orders": purchase_order_services.list_field_map(),
            "purchase_bills": bill_services.list_field_map(),
            "inventory_adjustments": document_services.list_field_map("adjustments"),
            "inventory_transfers": document_services.list_field_map("transfers"),
        }
        from app.modules.finance.services import credit_note_services, payment_services
        from app.modules.inventory.services import delivery_services, return_services
        from app.modules.purchasing.services import receipt_services

        maps.update({
            "purchase_receipts": receipt_services.list_field_map(),
            "inventory_deliveries": delivery_services.list_field_map(),
            "inventory_returns": return_services.list_field_map(),
            "finance_credit_notes": credit_note_services.list_field_map(),
            "finance_payments": payment_services.list_field_map(),
        })
        for module_key, field_map in maps.items():
            for name, conditions in profile.PRESET_SAVED_VIEWS[module_key]:
                for condition in conditions:
                    self.assertIn(condition["field"], field_map, f"{module_key} · {name}")


class _Fixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, team_id=None)
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            Tenant(id=OTHER, slug="other", name="Other"),
            User(id=1, tenant_id=TENANT, email="buyer@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=TENANT, email="other@example.com", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Lens Supply", primary_email="a@lens.test", is_vendor=1, assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=TENANT, org_name="Grip Supply", primary_email="b@grip.test", is_vendor=1, assigned_to=2),
            CatalogProduct(id=1, tenant_id=TENANT, name="Camera", currency="USD", public_unit_price=10, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=TENANT)
        ensure_product_levels(self.db, tenant_id=TENANT, product_id=1)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def order(self, vendor_id, *, place=False, owner_id=None):
        order = purchase_order_services.save_order(self.db, tenant_id=TENANT, actor_user_id=1, payload={
            "vendor_id": vendor_id, "lines": [{"product_id": 1, "quantity": "2", "unit_cost": "3"}]})
        order.owner_id = owner_id
        self.db.commit()
        if place:
            purchase_order_services.mark_ordered(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id)
            self.db.commit()
        return order


class ConditionTests(_Fixture):
    def numbers(self, conditions: ListConditions):
        listed = purchasing_routes.list_orders(status=None, vendor_id=None, search=None, pagination=create_pagination(1, 50),
                                               conditions=conditions, db=self.db, user=self.user)
        rows, _ = document_export_rows(self.db, self.user, module_key="purchase_orders", filters=conditions.as_filters())
        listed_numbers = sorted(row["number"] for row in listed["results"])
        self.assertEqual(listed_numbers, sorted(row["number"] for row in rows))
        return listed_numbers

    def test_to_receive_and_mine_filter_the_list_and_its_export(self):
        placed = self.order(5, place=True, owner_id=1)
        draft = self.order(5, owner_id=2)
        self.assertEqual(self.numbers(ListConditions(all=[{"field": "to_receive", "operator": "is", "value": True}])), [placed.number])
        self.assertEqual(self.numbers(ListConditions(all=[{"field": "owner_id", "operator": "is", "value": 2}])), [draft.number])
        self.assertEqual(self.numbers(ListConditions(any=[{"field": "owner_id", "operator": "is", "value": 1},
                                                          {"field": "owner_id", "operator": "is", "value": 2}])),
                         sorted([placed.number, draft.number]))

    def test_an_unknown_field_is_ignored_as_on_every_list(self):
        self.order(5)
        self.assertEqual(len(self.numbers(ListConditions(all=[{"field": "secret", "operator": "is", "value": 1}]))), 1)

    def test_overdue_bills(self):
        today = date.today()
        for number, status, due, balance in (("B-1", "posted", today - timedelta(days=1), 10), ("B-2", "posted", today + timedelta(days=5), 10),
                                             ("B-3", "posted", today - timedelta(days=3), 0), ("B-4", "draft", today - timedelta(days=3), 10)):
            self.db.add(PurchaseBill(tenant_id=TENANT, number=number, vendor_id=5, vendor_invoice_number=f"V-{number}", bill_date=today,
                                     due_date=due, status=status, balance_due=balance, total=10))
        self.db.commit()
        rows = bill_services.list_query(self.db, tenant_id=TENANT, filters_all=[{"field": "overdue", "operator": "is", "value": True}]).all()
        self.assertEqual([row.number for row in rows], ["B-1"])


class InventoryDocumentListTests(_Fixture):
    def setUp(self):
        super().setUp()
        self.db.add_all([
            InventoryWarehouse(id=50, tenant_id=TENANT, code="EAST", name="East depot", is_default=0),
            InventoryWarehouse(id=60, tenant_id=OTHER, code="EAST", name="East depot", is_default=1),
        ])
        self.db.flush()
        self.db.add_all([
            InventoryAdjustment(tenant_id=TENANT, number="ADJ-1", warehouse_id=50, mode="count", reason="Stocktake", status="draft"),
            InventoryAdjustment(tenant_id=TENANT, number="ADJ-2", warehouse_id=50, mode="quantity", reason="Damaged", status="posted"),
            InventoryAdjustment(tenant_id=OTHER, number="ADJ-9", warehouse_id=60, mode="quantity", reason="Stocktake", status="draft"),
            InventoryTransfer(tenant_id=TENANT, number="TRF-1", from_warehouse_id=50, to_warehouse_id=50, status="draft"),
        ])
        self.db.commit()

    def numbers(self, kind, **kwargs):
        return sorted(row.number for row in document_services.list_query(self.db, tenant_id=TENANT, kind=kind, **kwargs).all())

    def test_search_by_number_reason_and_warehouse_inside_the_tenant(self):
        self.assertEqual(self.numbers("adjustments", search="stocktake"), ["ADJ-1"])
        self.assertEqual(self.numbers("adjustments", search="east"), ["ADJ-1", "ADJ-2"])
        self.assertEqual(self.numbers("transfers", search="east"), ["TRF-1"])
        self.assertEqual(self.numbers("adjustments", search="ADJ-9"), [])

    def test_conditions_and_status(self):
        self.assertEqual(self.numbers("adjustments", filters_all=[{"field": "mode", "operator": "is", "value": "count"}]), ["ADJ-1"])
        self.assertEqual(self.numbers("adjustments", status="posted"), ["ADJ-2"])
        with self.assertRaises(HTTPException):
            self.numbers("adjustments", status="shipped")

    def test_the_export_writes_what_the_list_shows(self):
        rows, headers = document_export_rows(self.db, self.user, module_key="inventory_adjustments", filters={"search": "stocktake"})
        self.assertEqual([row["number"] for row in rows], ["ADJ-1"])
        self.assertIn("warehouse_name", headers)


class GlobalSearchTests(_Fixture):
    def test_purchase_orders_by_vendor_name_and_bills_by_vendor(self):
        order = self.order(6)
        self.db.add(PurchaseBill(tenant_id=TENANT, number="BILL-1", vendor_id=6, vendor_invoice_number="INV-77", bill_date=date.today()))
        self.db.add(SalesOrganization(org_id=7, tenant_id=OTHER, org_name="Grip Supply", primary_email="c@grip.test", is_vendor=1))
        self.db.commit()
        results = global_search._purchase_order_results(self.db, tenant_id=TENANT, query="grip", limit=5)
        self.assertEqual([result["title"] for result in results], [order.number])
        self.assertTrue(results[0]["href"].endswith(f"/purchasing/orders/{order.id}"))
        bills = global_search._bill_results(self.db, tenant_id=TENANT, query="grip", limit=5)
        self.assertEqual([result["title"] for result in bills], ["BILL-1"])

    def test_every_document_module_has_a_builder(self):
        for module in global_search.GLOBAL_SEARCH_MODULES:
            self.assertIn(module["module_key"], global_search.SEARCH_BUILDERS)

    def test_adjustments_are_found_by_reason(self):
        self.db.add(InventoryAdjustment(tenant_id=TENANT, number="ADJ-5", warehouse_id=ensure_default_warehouse(self.db, tenant_id=TENANT).id,
                                        mode="quantity", reason="Water damage", status="draft"))
        self.db.commit()
        results = global_search.SEARCH_BUILDERS["inventory_adjustments"](self.db, tenant_id=TENANT, query="water", limit=5)
        self.assertEqual([result["title"] for result in results], ["ADJ-5"])


class SavedViewSeedingTests(_Fixture):
    def test_presets_are_seeded_on_first_visit_with_mine_as_the_user(self):
        user = self.db.get(User, 1)
        profile._seed_preset_views(self.db, user, "purchase_orders", ["number", "status"])
        views = {view.name: view for view in self.db.query(UserSavedView).filter(UserSavedView.user_id == 1)}
        self.assertEqual(set(views), {"Drafts", "To receive", "To bill", "Mine"})
        mine = views["Mine"].config["filters"]["all_conditions"][0]
        self.assertEqual((mine["field"], mine["value"]), ("owner_id", 1))


if __name__ == "__main__":
    unittest.main()
