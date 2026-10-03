"""ERP E6: moving-average costing, valuation, revaluations and margin (12d-erp-costing.md §4)."""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.catalog.services import product_services
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.inventory.models import InventoryRevaluation, InventoryStockMove
from app.modules.inventory.services import delivery_services, inventory_services, return_services, valuation_services
from app.modules.inventory.services.costing import valuation_started
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves, reverse_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import CrmEvent
from app.modules.platform.services.report_catalog import BUILT_IN_SOURCES
from app.modules.platform.services.report_templates import REPORT_TEMPLATES
from app.modules.purchasing.services import bill_services
from app.modules.purchasing.services import purchase_order_services as orders
from app.modules.purchasing.services import receipt_services as receipts
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.orders_services import create_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus


class CostingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Main Co", operating_currencies=["USD", "EUR"], base_currency="USD"),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Lens Supply", primary_email="a@lens.test", is_vendor=1),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=20, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=10, name="Tripod", currency="USD", public_unit_price=5, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=3, tenant_id=20, name="Foreign", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        for product_id in (1, 2):
            ensure_product_levels(self.db, tenant_id=10, product_id=product_id)
        ensure_default_warehouse(self.db, tenant_id=20)
        ensure_product_levels(self.db, tenant_id=20, product_id=3)
        self.db.commit()
        self.line = 0

    def tearDown(self):
        self.db.close()

    # --- helpers -----------------------------------------------------------------------------

    def post(self, quantity, *, cost=None, product_id=1, source_id=1, move_type=None, source="receipt"):
        self.line += 1
        move_type = move_type or ("opening" if Decimal(str(quantity)) > 0 else "adjustment")
        moves = post_moves(self.db, tenant_id=10, actor_user_id=1, moves=[MoveSpec(
            product_id=product_id, warehouse_id=self.main.id, quantity=Decimal(str(quantity)), move_type=move_type,
            source_type="test", source_id=source_id, source_line_id=self.line, reason="Test",
            unit_cost=Decimal(str(cost)) if cost is not None else None, cost_source=source if cost is not None else None)])
        self.db.commit()
        return moves[0]

    def product(self, product_id=1) -> CatalogProduct:
        self.db.expire_all()
        return self.db.get(CatalogProduct, product_id)

    def assert_invariant(self, product_id=1):
        moves = self.db.query(func.coalesce(func.sum(InventoryStockMove.value), 0)).filter_by(product_id=product_id).scalar()
        revaluations = self.db.query(func.coalesce(func.sum(InventoryRevaluation.stock_change), 0)).filter_by(product_id=product_id).scalar()
        product = self.product(product_id)
        self.assertEqual(Decimal(moves) + Decimal(revaluations), Decimal(product.stock_value))
        if Decimal(product.stock_quantity or 0) > 0:
            self.assertLessEqual(abs(Decimal(product.stock_quantity) * Decimal(product.cost_price) - Decimal(product.stock_value)), Decimal("0.01"))
        else:
            self.assertEqual(Decimal(product.stock_value), Decimal(0))

    def po(self, quantity, unit_cost, *, currency=None, rate=None, place=True, product_id=1):
        payload = {"vendor_id": 5, "lines": [{"product_id": product_id, "quantity": str(quantity), "unit_cost": str(unit_cost)}]}
        if currency:
            payload["currency"] = currency
        if rate is not None:
            payload["exchange_rate"] = rate
        order = orders.save_order(self.db, tenant_id=10, actor_user_id=1, payload=payload)
        self.db.commit()
        if place:
            orders.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
            self.db.commit()
        return order

    def receive(self, order, quantity):
        receipt = receipts.save_receipt(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "lines": [{"order_line_id": order.lines[0].id, "quantity": str(quantity)}]})
        self.db.commit()
        receipts.post_receipt(self.db, tenant_id=10, actor_user_id=1, receipt_id=receipt.id)
        self.db.commit()
        return receipt

    def sales_order(self, quantity, price):
        order = create_sales_order(self.db, {"status": "confirmed", "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": str(quantity), "unit_price": str(price)}]}, self.user)
        self.db.commit()
        return order

    def deliver(self, order, quantity):
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "lines": [{"order_line_id": order.items[0].id, "quantity": str(quantity)}]})
        self.db.commit()
        delivery_services.post_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=doc.id)
        self.db.commit()
        return doc

    # --- averaging ---------------------------------------------------------------------------

    def test_receipts_move_the_average_and_deliveries_take_their_share(self):
        self.post(10, cost=5)
        self.post(10, cost=8)
        product = self.product()
        self.assertEqual((Decimal(product.cost_price), Decimal(product.stock_value)), (Decimal("6.5"), Decimal(130)))
        out = self.post(-5)
        self.assertEqual((Decimal(out.value), out.cost_source, Decimal(out.unit_cost)), (Decimal("-32.5"), "average", Decimal("6.5")))
        product = self.product()
        self.assertEqual((Decimal(product.cost_price), Decimal(product.stock_value)), (Decimal("6.5"), Decimal("97.5")))
        self.assert_invariant()
        last = self.post(-15)
        self.assertEqual(Decimal(last.value), Decimal("-97.5"))
        product = self.product()
        self.assertEqual(Decimal(product.stock_value), Decimal(0))
        # The last known average survives an empty shelf.
        self.assertEqual(Decimal(product.cost_price), Decimal("6.5"))
        self.assert_invariant()

    def test_the_last_unit_out_takes_the_rounding_so_the_value_is_zero(self):
        self.post(3, cost=Decimal("3.3333"))
        self.post(1, cost=Decimal("3.3334"))
        for _ in range(4):
            self.post(-1)
        self.assertEqual(Decimal(self.product().stock_value), Decimal(0))
        self.assert_invariant()

    def test_a_cancelled_receipt_reverses_at_its_own_cost(self):
        self.post(10, cost=5, source_id=1)
        self.post(10, cost=8, source_id=2)
        reverse_moves(self.db, tenant_id=10, actor_user_id=1, source_type="test", source_id=2, reason="Cancelled")
        self.db.commit()
        product = self.product()
        self.assertEqual((Decimal(product.cost_price), Decimal(product.stock_value)), (Decimal(5), Decimal(50)))
        reversal = self.db.query(InventoryStockMove).filter(InventoryStockMove.reverses_move_id.is_not(None)).one()
        self.assertEqual((reversal.cost_source, Decimal(reversal.value)), ("reversal", Decimal(-80)))
        self.assert_invariant()

    def test_a_cancelled_delivery_comes_back_at_the_cost_it_left_at(self):
        self.post(10, cost=5)
        self.post(-4, source_id=7, move_type="adjustment")
        self.post(10, cost=11)
        # Average now (30 + 110) / 16 = 8.75; the 4 units come back at 5, not 8.75.
        reverse_moves(self.db, tenant_id=10, actor_user_id=1, source_type="test", source_id=7, reason="Cancelled")
        self.db.commit()
        product = self.product()
        self.assertEqual(Decimal(product.stock_value), Decimal(160))
        self.assertEqual(Decimal(product.cost_price), Decimal(8))
        self.assert_invariant()

    def test_a_customer_return_comes_back_at_the_delivery_cost(self):
        self.post(10, cost=5)
        order = self.sales_order(10, 20)
        delivery = self.deliver(order, 10)
        self.post(10, cost=9)
        doc = return_services.save_return(self.db, tenant_id=10, actor_user_id=1, payload={
            "delivery_id": delivery.id, "reason": "Unwanted", "lines": [{"delivery_line_id": delivery.lines[0].id, "quantity": "2", "restock": True}]})
        self.db.commit()
        return_services.receive_return(self.db, tenant_id=10, actor_user_id=1, return_id=doc.id)
        self.db.commit()
        move = self.db.query(InventoryStockMove).filter_by(move_type="return").one()
        self.assertEqual((move.cost_source, Decimal(move.unit_cost), move.sales_order_item_id), ("return", Decimal(5), order.items[0].id))
        product = self.product()
        self.assertEqual(Decimal(product.stock_value), Decimal(100))
        self.assert_invariant()

    def test_transfers_keep_the_average(self):
        from app.modules.inventory.models import InventoryWarehouse

        second = InventoryWarehouse(tenant_id=10, code="B", name="Back room")
        self.db.add(second)
        self.db.commit()
        self.post(10, cost=5)
        self.post(10, cost=8)
        post_moves(self.db, tenant_id=10, actor_user_id=1, moves=[
            MoveSpec(product_id=1, warehouse_id=self.main.id, quantity=Decimal(-20), move_type="transfer_out", source_type="test_transfer", source_id=1, source_line_id=1),
            MoveSpec(product_id=1, warehouse_id=second.id, quantity=Decimal(20), move_type="transfer_in", source_type="test_transfer", source_id=1, source_line_id=1),
        ])
        self.db.commit()
        product = self.product()
        self.assertEqual((Decimal(product.cost_price), Decimal(product.stock_value)), (Decimal("6.5"), Decimal(130)))
        self.assert_invariant()

    # --- adjustments ---------------------------------------------------------------------------

    def test_adding_stock_to_a_product_with_no_cost_needs_a_unit_cost(self):
        with self.assertRaises(HTTPException) as error:
            inventory_services.quick_adjust(self.db, tenant_id=10, actor_user_id=1, product_id=2, warehouse_id=None,
                                            quantity=None, change=Decimal(5), reason="Found", note=None)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("unit cost", error.exception.detail)
        self.db.rollback()
        inventory_services.quick_adjust(self.db, tenant_id=10, actor_user_id=1, product_id=2, warehouse_id=None,
                                        quantity=None, change=Decimal(5), reason="Found", note=None, unit_cost=Decimal(4))
        # Once it has an average, more found stock takes it without asking.
        inventory_services.quick_adjust(self.db, tenant_id=10, actor_user_id=1, product_id=2, warehouse_id=None,
                                        quantity=None, change=Decimal(5), reason="Found more", note=None)
        moves = self.db.query(InventoryStockMove).filter_by(product_id=2).order_by(InventoryStockMove.id).all()
        self.assertEqual([(move.cost_source, Decimal(move.unit_cost)) for move in moves], [("manual", Decimal(4)), ("average", Decimal(4))])
        self.assertEqual(Decimal(self.product(2).stock_value), Decimal(40))
        self.assert_invariant(2)

    def test_a_tracked_products_cost_is_changed_by_revalue_not_the_form(self):
        self.post(3, cost=5)
        product = self.product()
        with self.assertRaises(HTTPException) as error:
            product_services.update_product(self.db, product=product, actor_user_id=1, payload={"cost_price": "9"})
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        # Sending the current cost back (a full form save) is fine.
        product_services.update_product(self.db, product=self.product(), actor_user_id=1, payload={"cost_price": "5", "name": "Camera 2"})
        self.db.commit()
        self.assertEqual(self.product().name, "Camera 2")

    # --- currency ------------------------------------------------------------------------------

    def test_a_foreign_currency_purchase_needs_a_rate_and_receives_at_it(self):
        order = self.po(5, 4, currency="EUR", place=False)
        with self.assertRaises(HTTPException) as error:
            orders.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        orders.set_exchange_rate(self.db, tenant_id=10, actor_user_id=1, order_id=order.id, exchange_rate="2")
        orders.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
        self.db.commit()
        self.receive(order, 5)
        move = self.db.query(InventoryStockMove).filter_by(move_type="receipt").one()
        self.assertEqual((Decimal(move.unit_cost), move.cost_source), (Decimal(8), "receipt"))
        self.assertEqual(Decimal(self.product().stock_value), Decimal(40))
        self.assertEqual(orders.serialize_order(self.db, tenant_id=10, order=order, include_lines=False)["base_currency"], "USD")

    def test_the_base_currency_locks_once_stock_is_valued(self):
        from app.modules.user_management.services.profile import update_company_profile

        owner = self.db.get(User, 1)
        update_company_profile(self.db, owner, {"base_currency": "EUR"})
        self.assertEqual(self.db.get(CompanyProfile, 1).base_currency, "EUR")
        self.assertFalse(valuation_started(self.db, tenant_id=10))
        self.post(2, cost=3)
        with self.assertRaises(HTTPException) as error:
            update_company_profile(self.db, owner, {"base_currency": "USD"})
        self.assertEqual(error.exception.status_code, 409)

    # --- bills ---------------------------------------------------------------------------------

    def test_a_bill_price_difference_revalues_what_is_still_in_stock(self):
        order = self.po(10, 8)
        self.receive(order, 10)
        self.post(-6)
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "vendor_invoice_number": "V-1",
            "lines": [{"order_line_id": order.lines[0].id, "quantity": "10", "unit_cost": "9"}]})
        self.db.commit()
        bill_services.post_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        revaluation = self.db.query(InventoryRevaluation).one()
        self.assertEqual((revaluation.kind, Decimal(revaluation.stock_change), Decimal(revaluation.cogs_change)), ("bill_variance", Decimal(4), Decimal(6)))
        product = self.product()
        self.assertEqual((Decimal(product.stock_value), Decimal(product.cost_price)), (Decimal(36), Decimal(9)))
        self.assert_invariant()
        line = bill_services.serialize_bill(self.db, tenant_id=10, bill=bill_services.bill_or_404(self.db, tenant_id=10, bill_id=bill.id))["lines"][0]
        self.assertEqual((Decimal(line["variance_stock_change"]), Decimal(line["variance_cogs_change"])), (Decimal(4), Decimal(6)))

        bill_services.void_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id, reason="Wrong price")
        self.db.commit()
        product = self.product()
        self.assertEqual((Decimal(product.stock_value), Decimal(product.cost_price)), (Decimal(32), Decimal(8)))
        reversal = self.db.query(InventoryRevaluation).filter(InventoryRevaluation.reverses_id.is_not(None)).one()
        self.assertEqual((Decimal(reversal.stock_change), Decimal(reversal.cogs_change)), (Decimal(-4), Decimal(-6)))
        self.assert_invariant()

    def test_a_bill_at_the_po_price_revalues_nothing(self):
        order = self.po(4, 8)
        self.receive(order, 4)
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": order.id, "vendor_invoice_number": "V-2"})
        self.db.commit()
        bill_services.post_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        self.assertEqual(self.db.query(InventoryRevaluation).count(), 0)

    # --- revaluation ---------------------------------------------------------------------------

    def test_revalue_sets_a_new_average_for_the_stock_on_hand(self):
        self.post(3, cost=5)
        row = valuation_services.revalue(self.db, tenant_id=10, actor_user_id=1, product_id=1, average_cost="7", reason="Supplier price list")
        self.db.commit()
        self.assertEqual((row.kind, Decimal(row.stock_change), Decimal(row.average_before), Decimal(row.average_after)),
                         ("manual", Decimal(6), Decimal(5), Decimal(7)))
        self.assertEqual(Decimal(self.product().stock_value), Decimal(21))
        self.assert_invariant()
        self.assertEqual(self.db.query(CrmEvent).filter_by(event_type="inventory.revalued").count(), 1)
        with self.assertRaises(HTTPException):
            valuation_services.revalue(self.db, tenant_id=10, actor_user_id=1, product_id=1, average_cost="7", reason="Again")
        self.db.rollback()

    def test_revaluing_a_product_with_missing_cost_is_a_migration_revaluation(self):
        # Stock with no cost anywhere: zero value, cost missing.
        post_moves(self.db, tenant_id=10, actor_user_id=1, moves=[MoveSpec(product_id=2, warehouse_id=self.main.id, quantity=Decimal(4),
            move_type="opening", source_type="test", source_id=9, source_line_id=99)])
        self.db.commit()
        move = self.db.query(InventoryStockMove).filter_by(product_id=2).one()
        self.assertEqual(move.cost_source, "missing")
        rows = valuation_services.valuation_rows(self.db, tenant_id=10, cost_missing=True)
        self.assertEqual([row["product_id"] for row in rows], [2])
        row = valuation_services.revalue(self.db, tenant_id=10, actor_user_id=1, product_id=2, average_cost="2.5", reason="Counted cost")
        self.db.commit()
        self.assertEqual((row.kind, Decimal(row.stock_change)), ("migration", Decimal(10)))
        self.assertEqual(valuation_services.valuation_rows(self.db, tenant_id=10, cost_missing=True), [])
        self.assert_invariant(2)

    def test_another_tenants_product_cannot_be_revalued(self):
        with self.assertRaises(HTTPException) as error:
            valuation_services.revalue(self.db, tenant_id=10, actor_user_id=1, product_id=3, average_cost="1", reason="No")
        self.assertEqual(error.exception.status_code, 404)

    # --- valuation -----------------------------------------------------------------------------

    def test_valuation_as_of_a_past_day_leaves_out_later_moves(self):
        early = self.post(10, cost=5)
        early.occurred_at = datetime.now(timezone.utc) - timedelta(days=3)
        self.db.commit()
        self.post(10, cost=8)
        yesterday = date.today() - timedelta(days=1)
        past = valuation_services.valuation_rows(self.db, tenant_id=10, as_of=yesterday)
        now = valuation_services.valuation_rows(self.db, tenant_id=10)
        self.assertEqual([(row["on_hand"], row["stock_value"]) for row in past], [(Decimal(10), Decimal(50))])
        self.assertEqual([(row["on_hand"], row["stock_value"], row["average_cost"]) for row in now], [(Decimal(20), Decimal(130), Decimal("6.5"))])
        summary = valuation_services.valuation_summary(self.db, tenant_id=10)
        self.assertEqual((summary["total_value"], summary["products_in_stock"], summary["base_currency"]), (Decimal(130), 1, "USD"))
        self.assertEqual(summary["by_warehouse"][0]["stock_value"], Decimal(130))
        # Another tenant's stock never shows.
        self.assertNotIn(3, [row["product_id"] for row in now])

    # --- margin --------------------------------------------------------------------------------

    def test_order_margin_uses_actual_cost_for_what_was_delivered(self):
        self.post(10, cost="6.5")
        order = self.sales_order(10, 20)
        self.deliver(order, 4)
        margin = valuation_services.order_margin(self.db, tenant_id=10, order=order)
        self.assertEqual((margin["actual_revenue"], margin["actual_cost"], margin["actual_margin"]), (Decimal(80), Decimal(26), Decimal(54)))
        # The other 6 are estimated at the current average.
        self.assertEqual((margin["revenue"], margin["cost"], margin["margin"], margin["estimated"]), (Decimal(200), Decimal(65), Decimal(135), True))
        line = margin["lines"][0]
        self.assertEqual((line["delivered"], line["estimated_quantity"]), (Decimal(4), Decimal(6)))

    def test_an_order_in_another_currency_needs_a_rate_for_margin(self):
        self.post(10, cost=5)
        order = create_sales_order(self.db, {"status": "confirmed", "currency": "EUR", "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "10"}]}, self.user)
        self.db.commit()
        self.deliver(order, 2)
        margin = valuation_services.order_margin(self.db, tenant_id=10, order=order)
        self.assertTrue(margin["rate_missing"])
        self.assertIsNone(margin["margin"])
        self.assertEqual(margin["cost"], Decimal(10))
        order.exchange_rate = Decimal("1.5")
        self.db.commit()
        margin = valuation_services.order_margin(self.db, tenant_id=10, order=order)
        self.assertEqual((margin["revenue"], margin["margin"]), (Decimal(30), Decimal(20)))

    # --- platform ------------------------------------------------------------------------------

    def test_costing_report_templates_name_fields_their_sources_offer(self):
        owner = self.db.get(User, 1)
        for template in REPORT_TEMPLATES:
            if template["module_key"] not in {"inventory_valuation", "inventory_cogs", "inventory_sales_margin"}:
                continue
            fields = {field.key for field in BUILT_IN_SOURCES[template["module_key"]].fields(self.db, owner)}
            config = template["config"]
            named = {item["field"] for item in config.get("groupings", [])} | {item["field"] for item in config.get("measures", []) if item.get("field")} \
                | set(config.get("columns") or []) | {condition["field"] for condition in (config.get("filters") or {}).get("all_conditions", [])}
            if config.get("date_filter"):
                named.add(config["date_filter"]["field"])
            self.assertLessEqual(named, fields, template["key"])


if __name__ == "__main__":
    unittest.main()
