"""E5 invoicing and bills (docs/crm-evolution/12c-erp-invoicing.md §4 acceptance)."""

import unittest
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinanceCreditAllocation, FinancePayment, FinancePaymentAllocation, FinancePosInvoice, FinancePosInvoiceLine
from app.modules.finance.services import credit_note_services, invoicing_services, payment_services, pos_invoice_services
from app.modules.finance.services.overdue_scans import scan_overdue_documents
from app.modules.inventory.services import delivery_services, return_services
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import CrmEvent
from app.modules.purchasing.services import bill_services
from app.modules.purchasing.services import purchase_order_services as purchase_orders
from app.modules.purchasing.services import receipt_services
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.orders_services import create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus


class InvoicingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.other = SimpleNamespace(id=2, tenant_id=20)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=20, email="other@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Main", operating_currencies=["USD"], default_payment_terms_days=30),
            CompanyProfile(id=2, tenant_id=20, name="Other", operating_currencies=["USD"]),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Acme", primary_email="ap@acme.test", payment_terms_days=14),
            SalesOrganization(org_id=6, tenant_id=10, org_name="Lens Supply", primary_email="s@lens.test", is_vendor=1),
            SalesOrganization(org_id=7, tenant_id=20, org_name="Foreign Vendor", primary_email="f@x.test", is_vendor=1),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=10, cost_price=Decimal("6"),
                           track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=10, name="Setup", currency="USD", public_unit_price=50, track_inventory=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        ensure_product_levels(self.db, tenant_id=10, product_id=1)
        self.db.commit()
        self.next_source = 5000

    def tearDown(self):
        self.db.close()

    # Helpers -------------------------------------------------------------------------------

    def stock(self, quantity):
        self.next_source += 1
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
            product_id=1, warehouse_id=self.main.id, quantity=Decimal(str(quantity)), move_type="adjustment",
            source_type="inventory_adjustment", source_id=self.next_source, source_line_id=self.next_source, reason="Test")])
        self.db.commit()

    def order(self, camera=10, setup=0, *, tax="0", discount="0"):
        items = [{"catalog_product_id": 1, "name": "Camera", "quantity": str(camera), "unit_price": "10",
                  "tax_amount": tax, "discount_amount": discount}]
        if setup:
            items.append({"catalog_service_id": None, "name": "Setup", "quantity": str(setup), "unit_price": "50"})
        return create_sales_order(self.db, {"status": "confirmed", "organization_id": 5, "items": items}, self.user)

    def deliver(self, order, quantity):
        line = next(item for item in order.items if item.catalog_product_id == 1)
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "lines": [{"order_line_id": line.id, "quantity": str(quantity)}]})
        self.db.commit()
        delivery_services.post_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=doc.id)
        self.db.commit()
        return doc

    def manual_invoice(self, total="100", issue=True):
        return pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Walk-in", "customer_organization_id": 5, "currency": "USD", "issue": issue,
            "lines": [{"description": "Service", "quantity": 1, "unit_price": total}]})

    def pay(self, invoice, amount):
        payment = payment_services.record_payment(self.db, tenant_id=10, actor_user_id=1, payload={
            "direction": "received", "allocations": [{"invoice_id": invoice.id, "amount": str(amount)}]}, finance_user=self.user)
        self.db.commit()
        return payment

    def reload(self, model, record_id):
        self.db.expire_all()
        return self.db.get(model, record_id)

    # Phase 1: invoices are documents --------------------------------------------------------

    def test_a_draft_has_no_number_and_issuing_numbers_it_per_tenant(self):
        draft = self.manual_invoice(issue=False)
        self.assertIsNone(draft.invoice_number)
        self.assertEqual(draft.status, "draft")
        issued = pos_invoice_services.issue_invoice(self.db, self.user, draft.id)
        self.assertTrue(issued.invoice_number.startswith("INV-"))
        self.assertEqual(issued.status, "issued")
        # Account terms (14 days) set the due date when none was given.
        self.assertEqual(issued.due_date, issued.issue_date + timedelta(days=14))
        foreign = pos_invoice_services.create_invoice(self.db, self.other, {
            "customer_name": "Other", "issue": True, "lines": [{"description": "X", "quantity": 1, "unit_price": 5}]})
        self.assertTrue(foreign.invoice_number.endswith("-0001"))
        self.assertTrue(issued.invoice_number.endswith("-0001"))

    def test_an_issued_invoice_refuses_line_and_status_edits(self):
        invoice = self.manual_invoice()
        with self.assertRaises(HTTPException) as caught:
            pos_invoice_services.update_invoice(self.db, self.user, invoice.id, {
                "lines": [{"description": "Changed", "quantity": 1, "unit_price": 1}]})
        self.assertEqual(caught.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            pos_invoice_services.update_invoice(self.db, self.user, invoice.id, {"customer_name": "Someone else"})
        updated = pos_invoice_services.update_invoice(self.db, self.user, invoice.id, {"notes": "Thanks"})
        self.assertEqual(updated.notes, "Thanks")

    def test_payments_are_records_and_voiding_restores_the_balance(self):
        invoice = self.manual_invoice("100")
        payment = self.pay(invoice, "40")
        invoice = self.reload(FinancePosInvoice, invoice.id)
        self.assertEqual(Decimal(invoice.balance_due), Decimal("60.00"))
        self.assertEqual(invoice.payment_status, "partial")
        self.assertTrue(payment.number.startswith("PAY-"))
        with self.assertRaises(HTTPException):
            self.pay(invoice, "60.01")
        payment_services.void_payment(self.db, self.user, payment.id, reason="Bounced")
        self.db.commit()
        invoice = self.reload(FinancePosInvoice, invoice.id)
        self.assertEqual(Decimal(invoice.balance_due), Decimal("100.00"))
        self.assertEqual(invoice.payment_status, "unpaid")
        self.pay(invoice, "100")
        self.assertEqual(self.reload(FinancePosInvoice, invoice.id).payment_status, "paid")

    def test_a_draft_cannot_be_paid_and_an_issued_invoice_cannot_be_removed(self):
        draft = self.manual_invoice(issue=False)
        with self.assertRaises(HTTPException):
            self.pay(draft, "1")
        invoice = self.manual_invoice()
        with self.assertRaises(HTTPException):
            pos_invoice_services.soft_delete_invoice(self.db, self.user, invoice.id)

    def test_void_is_refused_with_payments_and_void_and_copy_opens_a_draft(self):
        invoice = self.manual_invoice("100")
        payment = self.pay(invoice, "10")
        with self.assertRaises(HTTPException):
            pos_invoice_services.void_invoice(self.db, self.user, invoice.id, reason="Wrong")
        payment_services.void_payment(self.db, self.user, payment.id, reason="Mistake")
        self.db.commit()
        copy = pos_invoice_services.void_and_copy(self.db, self.user, invoice.id, reason="Wrong price")
        self.assertEqual(self.reload(FinancePosInvoice, invoice.id).status, "void")
        self.assertEqual(copy.status, "draft")
        self.assertIsNone(copy.invoice_number)
        self.assertEqual(len(copy.lines), 1)

    def test_pos_fast_path_issues_and_pays_in_one_step(self):
        invoice = pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Walk-in", "paid_now": {"method": "cash"},
            "lines": [{"description": "Coffee", "quantity": 2, "unit_price": "3.50"}]})
        self.assertEqual(invoice.status, "issued")
        self.assertEqual(invoice.payment_status, "paid")
        self.assertEqual(self.db.query(FinancePayment).filter_by(tenant_id=10).one().method, "cash")

    def test_line_discount_and_tax_and_header_rate_total_correctly(self):
        invoice = pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Walk-in", "tax_rate": 10, "discount_amount": 5,
            "lines": [{"description": "A", "quantity": 2, "unit_price": 10, "discount_amount": 2, "tax_amount": 1}]})
        # Net 18, header discount 5 → taxable 13, tax 1 + 1.30.
        self.assertEqual(Decimal(invoice.subtotal_amount), Decimal("18.00"))
        self.assertEqual(Decimal(invoice.tax_amount), Decimal("2.30"))
        self.assertEqual(Decimal(invoice.total_amount), Decimal("15.30"))

    def test_another_tenants_invoice_is_a_404(self):
        invoice = self.manual_invoice()
        with self.assertRaises(HTTPException) as caught:
            pos_invoice_services.get_invoice_or_404(self.db, self.other, invoice.id)
        self.assertEqual(caught.exception.status_code, 404)
        with self.assertRaises(HTTPException) as caught:
            payment_services.record_payment(self.db, tenant_id=20, actor_user_id=2, payload={
                "direction": "received", "allocations": [{"invoice_id": invoice.id, "amount": "1"}]})
        self.assertEqual(caught.exception.status_code, 404)

    # Phase 2: invoicing orders and credit notes --------------------------------------------

    def test_delivered_policy_invoices_what_shipped_then_the_rest(self):
        self.stock(10)
        order = self.order(10)
        self.assertEqual(order.invoice_status, "pending")
        with self.assertRaises(HTTPException):
            invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.deliver(order, 4)
        self.db.refresh(order)
        self.assertEqual(order.invoice_status, "to_invoice")
        first = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual(Decimal(first.lines[0].quantity), Decimal("4"))
        pos_invoice_services.issue_invoice(self.db, self.user, first.id)
        self.db.refresh(order)
        self.assertEqual(order.invoice_status, "partial")
        self.deliver(order, 6)
        second = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual(Decimal(second.lines[0].quantity), Decimal("6"))
        pos_invoice_services.issue_invoice(self.db, self.user, second.id)
        self.db.refresh(order)
        self.assertEqual(order.invoice_status, "invoiced")

    def test_ordered_policy_invoices_the_whole_order_at_once(self):
        profile = self.db.query(CompanyProfile).filter_by(tenant_id=10).one()
        profile.invoicing_policy = "ordered"
        self.db.commit()
        order = self.order(10, setup=1)
        draft = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual(sorted(Decimal(line.quantity) for line in draft.lines), [Decimal("1"), Decimal("10")])
        self.assertEqual(draft.sales_order_id, order.id)
        self.assertEqual(draft.customer_organization_id, 5)

    def test_services_invoice_as_ordered_under_the_delivered_policy(self):
        order = self.order(5, setup=2)
        draft = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual([(line.description, Decimal(line.quantity)) for line in draft.lines], [("Setup", Decimal("2"))])

    def test_two_invoices_cannot_both_take_the_same_remainder(self):
        self.stock(5)
        order = self.order(5)
        self.deliver(order, 5)
        first = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        # A second draft made by hand over the same order line.
        copy = FinancePosInvoice(id=999, tenant_id=10, user_id=1, status="draft", payment_status="unpaid", customer_name="Acme",
                                 currency="USD", sales_order_id=order.id, source="sales_order")
        copy.lines = [FinancePosInvoiceLine(id=999, description="Camera", quantity=Decimal("5"), unit_price=Decimal("10"), line_total=Decimal("50"),
                                            sales_order_item_id=first.lines[0].sales_order_item_id, sort_order=0)]
        copy.subtotal_amount = copy.total_amount = Decimal("50")
        self.db.add(copy)
        self.db.commit()
        pos_invoice_services.issue_invoice(self.db, self.user, first.id)
        with self.assertRaises(HTTPException) as caught:
            pos_invoice_services.issue_invoice(self.db, self.user, copy.id)
        self.assertEqual(caught.exception.status_code, 409)

    def test_discount_and_tax_are_pro_rated_and_the_last_invoice_takes_the_remainder(self):
        profile = self.db.query(CompanyProfile).filter_by(tenant_id=10).one()
        profile.invoicing_policy = "ordered"
        self.db.commit()
        order = self.order(3, tax="10.00", discount="1.00")
        line_id = order.items[0].id
        draft = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        pos_invoice_services.update_invoice(self.db, self.user, draft.id, {"lines": [
            {"id": draft.lines[0].id, "description": "Camera", "quantity": 1, "unit_price": 10, "discount_amount": "0.33", "tax_amount": "3.33"}]})
        pos_invoice_services.issue_invoice(self.db, self.user, draft.id)
        rest = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual(rest.lines[0].sales_order_item_id, line_id)
        self.assertEqual(Decimal(rest.lines[0].quantity), Decimal("2"))
        self.assertEqual(Decimal(rest.lines[0].tax_amount), Decimal("6.67"))
        self.assertEqual(Decimal(rest.lines[0].discount_amount), Decimal("0.67"))

    def test_an_invoiced_order_cannot_be_cancelled_until_credited(self):
        profile = self.db.query(CompanyProfile).filter_by(tenant_id=10).one()
        profile.invoicing_policy = "ordered"
        self.db.commit()
        order = self.order(2)
        draft = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        invoice = pos_invoice_services.issue_invoice(self.db, self.user, draft.id)
        with self.assertRaises(HTTPException) as caught:
            update_sales_order(self.db, order, {"status": "cancelled"}, actor_user_id=1)
        self.assertEqual(caught.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            update_sales_order(self.db, order, {"items": [{"id": order.items[0].id, "catalog_product_id": 1, "name": "Camera", "quantity": "1", "unit_price": "10"}]}, actor_user_id=1)
        self.db.rollback()
        note = credit_note_services.save_draft(self.db, self.user, payload={"invoice_id": invoice.id, "reason": "Cancelled"})
        self.db.commit()
        credit_note_services.issue(self.db, self.user, note.id)
        self.db.commit()
        order = update_sales_order(self.db, order, {"status": "cancelled"}, actor_user_id=1)
        self.assertEqual(order.status, "cancelled")

    def test_credit_notes_never_exceed_what_was_invoiced_and_overpayment_becomes_refund_due(self):
        invoice = self.manual_invoice("100")
        self.pay(invoice, "100")
        line_id = invoice.lines[0].id
        with self.assertRaises(HTTPException):
            credit_note_services.save_draft(self.db, self.user, payload={"invoice_id": invoice.id, "lines": [{"invoice_line_id": line_id, "quantity": 2}]})
        self.db.rollback()
        partial = pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Walk-in", "issue": True, "lines": [{"description": "Units", "quantity": 10, "unit_price": 10}]})
        self.pay(partial, "100")
        note = credit_note_services.save_draft(self.db, self.user, payload={
            "invoice_id": partial.id, "lines": [{"invoice_line_id": partial.lines[0].id, "quantity": 3}]})
        self.db.commit()
        note = credit_note_services.issue(self.db, self.user, note.id)
        self.db.commit()
        self.assertEqual(Decimal(note.total_amount), Decimal("30.00"))
        self.assertEqual(Decimal(note.refund_due), Decimal("30.00"))
        self.assertTrue(note.number.startswith("CN-"))
        refund = payment_services.record_payment(self.db, tenant_id=10, actor_user_id=1, payload={
            "direction": "made", "kind": "refund", "allocations": [{"credit_note_id": note.id, "amount": "30"}]})
        self.db.commit()
        self.assertEqual(refund.kind, "refund")
        self.db.refresh(note)
        self.assertEqual(Decimal(note.refund_due), Decimal("0.00"))
        with self.assertRaises(HTTPException):
            credit_note_services.void(self.db, self.user, note.id, reason="Oops")

    def test_a_credit_on_an_unpaid_invoice_reduces_its_balance(self):
        invoice = self.manual_invoice("100")
        note = credit_note_services.save_draft(self.db, self.user, payload={"invoice_id": invoice.id})
        self.db.commit()
        credit_note_services.issue(self.db, self.user, note.id)
        self.db.commit()
        invoice = self.reload(FinancePosInvoice, invoice.id)
        self.assertEqual(Decimal(invoice.amount_credited), Decimal("100.00"))
        self.assertEqual(Decimal(invoice.balance_due), Decimal("0.00"))
        self.assertEqual(invoice.payment_status, "paid")
        credit_note_services.void(self.db, self.user, note.id, reason="Issued by mistake")
        self.db.commit()
        self.assertEqual(Decimal(self.reload(FinancePosInvoice, invoice.id).balance_due), Decimal("100.00"))
        self.assertEqual(self.db.query(FinanceCreditAllocation).count(), 0)

    def test_a_return_offers_its_invoice_for_credit(self):
        self.stock(5)
        order = self.order(5)
        delivery = self.deliver(order, 5)
        draft = invoicing_services.draft_from_sources(self.db, self.user, sources=[{"order_id": order.id, "delivery_id": delivery.id}])
        self.assertEqual(draft.lines[0].delivery_line_id, delivery.lines[0].id)
        invoice = pos_invoice_services.issue_invoice(self.db, self.user, draft.id)
        doc = return_services.save_return(self.db, tenant_id=10, actor_user_id=1, payload={
            "delivery_id": delivery.id, "reason": "Damaged", "lines": [{"delivery_line_id": delivery.lines[0].id, "quantity": "2", "restock": True}]})
        self.db.commit()
        return_services.receive_return(self.db, tenant_id=10, actor_user_id=1, return_id=doc.id)
        self.db.commit()
        candidates = credit_note_services.return_candidates(self.db, self.user, return_id=doc.id)["candidates"]
        self.assertEqual([row["invoice_id"] for row in candidates], [invoice.id])
        self.assertEqual(Decimal(candidates[0]["lines"][0]["quantity"]), Decimal("2"))
        # Cancelling the delivery is refused while an issued invoice charges for it.
        with self.assertRaises(HTTPException):
            delivery_services.cancel_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=delivery.id, reason="Mistake")

    # Phase 3: vendor bills -----------------------------------------------------------------

    def po(self, quantity=10, unit_cost="7.25"):
        order = purchase_orders.save_order(self.db, tenant_id=10, actor_user_id=1, payload={
            "vendor_id": 6, "lines": [{"product_id": 1, "quantity": str(quantity), "unit_cost": unit_cost}]})
        self.db.commit()
        purchase_orders.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
        self.db.commit()
        return order

    def receive(self, order, quantity):
        receipt = receipt_services.save_receipt(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "lines": [{"order_line_id": order.lines[0].id, "quantity": str(quantity)}]})
        self.db.commit()
        receipt_services.post_receipt(self.db, tenant_id=10, actor_user_id=1, receipt_id=receipt.id)
        self.db.commit()
        return receipt

    def test_a_bill_is_limited_to_what_was_received(self):
        order = self.po(10)
        receipt = self.receive(order, 4)
        self.db.refresh(order)
        self.assertEqual(order.bill_status, "to_bill")
        with self.assertRaises(HTTPException) as caught:
            bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
                "order_id": order.id, "vendor_invoice_number": "V-1", "lines": [{"order_line_id": order.lines[0].id, "quantity": "5"}]})
        self.assertEqual(caught.exception.status_code, 409)
        self.db.rollback()
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "receipt_id": receipt.id, "vendor_invoice_number": "V-1"})
        self.db.commit()
        self.assertEqual(Decimal(bill.lines[0].quantity), Decimal("4"))
        self.assertEqual(Decimal(bill.total), Decimal("29.00"))
        bill_services.post_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        self.db.refresh(order)
        self.assertEqual(order.bill_status, "partial")
        self.assertEqual(bill.match_status, "matched")
        # The receipt a posted bill charges for cannot be cancelled.
        with self.assertRaises(HTTPException):
            receipt_services.cancel_receipt(self.db, tenant_id=10, actor_user_id=1, receipt_id=receipt.id, reason="Mistake")

    def test_a_price_difference_is_flagged_and_stock_cost_is_unchanged(self):
        order = self.po(2, "7.25")
        self.receive(order, 2)
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "vendor_invoice_number": "V-2",
            "lines": [{"order_line_id": order.lines[0].id, "quantity": "2", "unit_cost": "8.00", "tax_amount": "1.60"}]})
        self.db.commit()
        self.assertEqual(bill.match_status, "variance")
        bill_services.post_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        self.assertEqual(Decimal(bill.total), Decimal("17.60"))
        from app.modules.inventory.models import InventoryStockMove

        receipt_move = self.db.query(InventoryStockMove).filter_by(move_type="receipt").one()
        self.assertEqual(Decimal(receipt_move.unit_cost), Decimal("7.25"))
        self.db.refresh(order)
        self.assertEqual(order.bill_status, "billed")

    def test_vendor_invoice_numbers_are_unique_per_vendor_and_bills_are_paid(self):
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
            "vendor_id": 6, "vendor_invoice_number": "INV-77", "lines": [{"description": "Rent", "quantity": "1", "unit_cost": "500"}]})
        self.db.commit()
        with self.assertRaises(HTTPException):
            bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
                "vendor_id": 6, "vendor_invoice_number": "inv-77", "lines": [{"description": "Rent", "quantity": "1", "unit_cost": "500"}]})
        self.db.rollback()
        bill_services.post_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        payment_services.record_payment(self.db, tenant_id=10, actor_user_id=1, payload={
            "direction": "made", "allocations": [{"bill_id": bill.id, "amount": "500"}]})
        self.db.commit()
        self.db.refresh(bill)
        self.assertEqual(bill.payment_status, "paid")
        with self.assertRaises(HTTPException):
            bill_services.void_bill(self.db, tenant_id=10, actor_user_id=1, bill_id=bill.id, reason="x")

    def test_another_tenants_vendor_or_bill_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
                "vendor_id": 7, "vendor_invoice_number": "X", "lines": [{"description": "X", "quantity": "1", "unit_cost": "1"}]})
        self.assertEqual(caught.exception.status_code, 404)
        bill = bill_services.save_bill(self.db, tenant_id=10, actor_user_id=1, payload={
            "vendor_id": 6, "vendor_invoice_number": "Y", "lines": [{"description": "Y", "quantity": "1", "unit_cost": "1"}]})
        self.db.commit()
        with self.assertRaises(HTTPException) as caught:
            bill_services.post_bill(self.db, tenant_id=20, actor_user_id=2, bill_id=bill.id)
        self.assertEqual(caught.exception.status_code, 404)

    # Phase 4: the platform -----------------------------------------------------------------

    def test_overdue_invoices_and_bills_are_announced_once(self):
        invoice = self.manual_invoice("100")
        invoice.due_date = date.today() - timedelta(days=2)
        self.db.commit()
        first = scan_overdue_documents(self.db)
        second = scan_overdue_documents(self.db)
        self.assertEqual(first["events_created"], 1)
        self.assertEqual(second["events_created"], 0)
        self.assertEqual(self.db.query(CrmEvent).filter_by(event_type="finance.invoice_overdue").count(), 1)

    def test_issuing_and_paying_stage_automation_events(self):
        invoice = self.manual_invoice("10")
        self.pay(invoice, "10")
        types = {row.event_type for row in self.db.query(CrmEvent).all()}
        self.assertIn("finance.invoice_issued", types)
        self.assertIn("finance.payment_recorded", types)

    def test_a_payment_allocation_names_exactly_one_document(self):
        invoice = self.manual_invoice("10")
        with self.assertRaises(HTTPException):
            payment_services.record_payment(self.db, tenant_id=10, actor_user_id=1, payload={
                "direction": "received", "allocations": [{"invoice_id": invoice.id, "bill_id": 1, "amount": "1"}]})
        with self.assertRaises(HTTPException):
            payment_services.record_payment(self.db, tenant_id=10, actor_user_id=1, payload={
                "direction": "received", "amount": "5", "allocations": [{"invoice_id": invoice.id, "amount": "4"}]})
        self.assertEqual(self.db.query(FinancePaymentAllocation).count(), 0)


if __name__ == "__main__":
    unittest.main()
