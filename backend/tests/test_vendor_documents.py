"""13c §3.6–3.8 (Step 7, F4 slice 4.4): RFQs, returns to vendor and vendor credits."""

import unittest
from decimal import Decimal

from fastapi import HTTPException

from app.modules.catalog.models import CatalogProduct
from app.modules.finance.services import payment_services
from app.modules.inventory.models import InventoryRevaluation, InventoryStockMove
from app.modules.purchasing.models import PurchaseReceipt, PurchaseVendorCreditAllocation
from app.modules.purchasing.services import bill_services, purchase_order_services as orders
from app.modules.purchasing.services import receipt_services, vendor_credit_services as credits, vendor_return_services as returns
from tests.test_purchase_order_lines import TENANT, PurchasingFixture


class RfqTests(PurchasingFixture):
    def test_a_request_is_sent_edited_and_placed(self):
        order = self.save([{"product_id": 1, "quantity": "2", "unit_cost": "5"}])
        orders.mark_sent(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id)
        self.db.commit()
        self.assertEqual(order.status, "sent")
        self.assertIsNotNone(order.sent_at)
        # Prices come back from the vendor: a sent request can still be edited.
        orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id,
                          payload={"vendor_id": 5, "lines": [{"product_id": 1, "quantity": "2", "unit_cost": "4.5"}]})
        self.place(order)
        self.assertEqual(order.status, "ordered")

    def test_alternatives_compare_and_placing_one_cancels_the_others(self):
        first = self.save([{"product_id": 1, "quantity": "10", "unit_cost": "5"}, {"catalog_service_id": 3, "quantity": "1", "unit_cost": "60"}])
        second = orders.create_alternative(self.db, tenant_id=TENANT, actor_user_id=1, order_id=first.id, vendor_id=6)
        self.db.commit()
        self.assertEqual(second.rfq_group_id, first.id)
        self.assertEqual(first.rfq_group_id, first.id)
        orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, order_id=second.id, payload={"vendor_id": 6, "lines": [
            {"product_id": 1, "quantity": "10", "unit_cost": "4"}, {"catalog_service_id": 3, "quantity": "1", "unit_cost": "75"}]})
        self.db.commit()
        comparison = orders.compare_group(self.db, tenant_id=TENANT, order_id=first.id)
        camera = next(item for item in comparison["items"] if item["kind"] == "product")
        self.assertEqual(camera["lowest_unit_cost"], Decimal("4.0000"))
        lowest = [vendor["order_id"] for vendor in comparison["vendors"] if vendor["is_lowest"]]
        # The camera is cheaper from the second vendor, but the first is cheaper in total (110 against 115).
        self.assertEqual(lowest, [first.id])
        self.place(second)
        self.db.refresh(first)
        self.assertEqual(first.status, "cancelled")
        self.assertIn(second.number, first.cancel_reason)

    def test_one_request_per_vendor_in_a_comparison(self):
        first = self.save([{"product_id": 1, "quantity": "1", "unit_cost": "5"}])
        orders.create_alternative(self.db, tenant_id=TENANT, actor_user_id=1, order_id=first.id, vendor_id=6)
        with self.assertRaises(HTTPException) as caught:
            orders.create_alternative(self.db, tenant_id=TENANT, actor_user_id=1, order_id=first.id, vendor_id=6)
        self.assertEqual(caught.exception.status_code, 409)

    def test_a_placed_order_is_locked(self):
        order = self.place(self.save([{"product_id": 1, "quantity": "1", "unit_cost": "5"}]))
        for action in (lambda: orders.mark_sent(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id),
                       lambda: orders.create_alternative(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id, vendor_id=6)):
            with self.assertRaises(HTTPException):
                action()


class VendorReturnTests(PurchasingFixture):
    def received(self, unit_cost="5"):
        order = self.place(self.save([{"product_id": 1, "quantity": "10", "unit_cost": unit_cost}]))
        return order, self.receive_all(order)

    def test_shipping_takes_stock_out_at_the_receipt_cost(self):
        _order, receipt = self.received(unit_cost="5")
        # A later, dearer receipt moves the average up; the return still leaves at 5.
        later = self.place(self.save([{"product_id": 1, "quantity": "10", "unit_cost": "7"}]))
        self.receive_all(later)
        doc = returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "Damaged",
            "lines": [{"receipt_line_id": receipt.lines[0].id, "quantity": "4"}]})
        returns.ship_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id)
        self.db.commit()
        move = self.db.query(InventoryStockMove).filter(InventoryStockMove.source_type == "purchase_vendor_return").one()
        self.assertEqual((move.quantity, move.unit_cost, move.value), (Decimal("-4"), Decimal("5.0000"), Decimal("-20.0000")))
        product = self.db.get(CatalogProduct, 1)
        self.assertEqual(Decimal(product.stock_value), Decimal("100"))  # 50 + 70 − 20

    def test_only_what_the_receipt_brought_in_less_other_returns(self):
        _order, receipt = self.received()
        line_id = receipt.lines[0].id
        returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "Short",
            "lines": [{"receipt_line_id": line_id, "quantity": "7"}]})
        with self.assertRaises(HTTPException) as caught:
            returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "More",
                "lines": [{"receipt_line_id": line_id, "quantity": "4"}]})
        self.assertEqual(caught.exception.status_code, 409)

    def test_replace_puts_the_quantity_back_to_receive(self):
        order, receipt = self.received()
        self.assertEqual(order.status, "received")
        doc = returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "Wrong model",
            "resolution": "replace", "lines": [{"receipt_line_id": receipt.lines[0].id, "quantity": "3"}]})
        returns.ship_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id)
        self.db.commit()
        self.db.refresh(order)
        self.assertEqual((order.status, order.receipt_status), ("ordered", "partial"))
        self.assertEqual(order.lines[0].quantity - orders.received_by_line(self.db, tenant_id=TENANT, line_ids=[order.lines[0].id])[order.lines[0].id], Decimal("3"))

    def test_cancel_reverses_and_a_receipt_with_returns_cannot_be_cancelled(self):
        _order, receipt = self.received()
        doc = returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "Damaged"})
        returns.ship_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id)
        self.db.commit()
        with self.assertRaises(HTTPException):
            receipt_services.cancel_receipt(self.db, tenant_id=TENANT, actor_user_id=1, receipt_id=receipt.id, reason="Oops")
        self.db.rollback()
        returns.cancel_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id, reason="Vendor refused")
        self.db.commit()
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_quantity), Decimal("10"))


class VendorCreditTests(PurchasingFixture):
    def billed(self):
        order = self.place(self.save([{"product_id": 1, "quantity": "10", "unit_cost": "5"}]))
        self.receive_all(order)
        return order, self.bill_all(order)

    def test_a_credit_from_a_bill_settles_it_first_and_the_rest_applies_elsewhere(self):
        _order, bill = self.billed()
        self.assertEqual(bill.balance_due, Decimal("50.00"))
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"bill_id": bill.id, "reason": "Price agreed after delivery",
            "lines": [{"bill_line_id": bill.lines[0].id, "quantity": "10", "unit_cost": "1"}]})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        self.db.commit()
        self.db.refresh(bill)
        self.assertEqual((credit.number[:2], credit.total, credit.credit_remaining), ("VC", Decimal("10.00"), Decimal("0.00")))
        self.assertEqual(bill.balance_due, Decimal("40.00"))
        self.assertEqual(bill.payment_status, "partial")

    def test_a_price_credit_on_stock_lowers_its_value(self):
        _order, bill = self.billed()
        before = Decimal(self.db.get(CatalogProduct, 1).stock_value)
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"bill_id": bill.id,
            "lines": [{"bill_line_id": bill.lines[0].id, "quantity": "10", "unit_cost": "1"}]})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        self.db.commit()
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_value), before - Decimal("10"))
        row = self.db.query(InventoryRevaluation).filter(InventoryRevaluation.kind == "vendor_credit").one()
        self.assertEqual(row.vendor_credit_line_id, credit.lines[0].id)
        credits.void_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id, reason="Entered twice")
        self.db.commit()
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_value), before)
        self.db.refresh(bill)
        self.assertEqual(bill.balance_due, Decimal("50.00"))

    def test_a_bill_cannot_be_credited_twice_over(self):
        _order, bill = self.billed()
        credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"bill_id": bill.id,
            "lines": [{"bill_line_id": bill.lines[0].id, "quantity": "8"}]})
        with self.assertRaises(HTTPException) as caught:
            credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"bill_id": bill.id,
                "lines": [{"bill_line_id": bill.lines[0].id, "quantity": "3"}]})
        self.assertEqual(caught.exception.status_code, 409)

    def test_apply_to_another_bill_and_refund_the_rest(self):
        _order, bill = self.billed()
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": 5, "currency": "USD",
            "lines": [{"description": "Goodwill", "quantity": "1", "unit_cost": "30"}]})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        credits.apply_to_bills(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id, allocations=[{"bill_id": bill.id, "amount": "20"}])
        self.db.commit()
        self.assertEqual(credit.credit_remaining, Decimal("10.00"))
        payment_services.record_payment(self.db, tenant_id=TENANT, actor_user_id=1, payload={"direction": "received", "kind": "refund",
            "allocations": [{"vendor_credit_id": credit.id, "amount": "10"}]})
        self.db.commit()
        self.db.refresh(credit)
        self.assertEqual(credit.credit_remaining, Decimal("0.00"))
        # Refunded: it can no longer be voided.
        with self.assertRaises(HTTPException):
            credits.void_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id, reason="No")

    def test_a_refund_must_be_received_and_not_exceed_what_is_left(self):
        _order, _bill = self.billed()
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": 5, "currency": "USD",
            "lines": [{"description": "Goodwill", "quantity": "1", "unit_cost": "5"}]})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        for payload in ({"direction": "made", "kind": "refund", "allocations": [{"vendor_credit_id": credit.id, "amount": "5"}]},
                        {"direction": "received", "kind": "refund", "allocations": [{"vendor_credit_id": credit.id, "amount": "6"}]}):
            with self.subTest(payload=payload), self.assertRaises(HTTPException):
                payment_services.record_payment(self.db, tenant_id=TENANT, actor_user_id=1, payload=payload)

    def test_a_credit_from_a_shipped_return(self):
        order, bill = self.billed()
        receipt = self.db.query(PurchaseReceipt).filter_by(order_id=order.id).one()
        doc = returns.save_return(self.db, tenant_id=TENANT, actor_user_id=1, payload={"receipt_id": receipt.id, "reason": "Damaged",
            "lines": [{"receipt_line_id": receipt.lines[0].id, "quantity": "2"}]})
        with self.assertRaises(HTTPException):  # not shipped yet
            credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_return_id": doc.id})
        returns.ship_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id)
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_return_id": doc.id})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        self.db.commit()
        self.assertEqual((credit.bill_id, credit.total), (bill.id, Decimal("10.00")))
        # A return's credit moves no stock and revalues nothing: the return already did.
        self.assertEqual(self.db.query(InventoryRevaluation).filter(InventoryRevaluation.kind == "vendor_credit").count(), 0)
        with self.assertRaises(HTTPException):
            returns.cancel_return(self.db, tenant_id=TENANT, actor_user_id=1, return_id=doc.id, reason="No")
        self.assertEqual(self.db.query(PurchaseVendorCreditAllocation).filter_by(credit_id=credit.id).count(), 1)

    def test_a_bill_with_an_issued_credit_cannot_be_voided(self):
        _order, bill = self.billed()
        credit = credits.save_credit(self.db, tenant_id=TENANT, actor_user_id=1, payload={"bill_id": bill.id,
            "lines": [{"bill_line_id": bill.lines[0].id, "quantity": "1"}]})
        credits.issue_credit(self.db, tenant_id=TENANT, actor_user_id=1, credit_id=credit.id)
        self.db.commit()
        with self.assertRaises(HTTPException):
            bill_services.void_bill(self.db, tenant_id=TENANT, actor_user_id=1, bill_id=bill.id, reason="Wrong")


if __name__ == "__main__":
    unittest.main()
