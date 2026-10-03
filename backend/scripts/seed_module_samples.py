"""Seed a couple of sample records for the modules the demo seed does not cover.

`seed_demo_crm.py` populates organizations, contacts, opportunities, catalog, finance
and tasks, but leaves leads, quotes, orders, contracts, support cases and inventory
documents empty. That is
fine for a demo walkthrough, but it means every `[id]` detail route for those modules is
unreachable — so UI audits and browser tests silently skip them.

This adds the minimum needed to make those routes reachable. It is additive and
idempotent: records are keyed by their reference number, so re-running changes nothing.

    docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
"""

from __future__ import annotations

import argparse
import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.database import SessionLocal

# Contract carries a foreign key to documents; the model must be registered on the
# shared metadata before any mapper is configured, even though nothing here uses it.
from app.modules.documents import models as _documents_models  # noqa: F401
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.services.costing import base_currency
from app.modules.contracts.models import Contract
from app.modules.inventory.models import (
    InventoryAdjustment, InventoryAdjustmentLine, InventoryStockLevel,
    InventoryTransfer, InventoryTransferLine, InventoryWarehouse,
)
from app.modules.sales.models import SalesLead, SalesOrder, SalesQuote, SalesQuoteDocument
from app.modules.support.models import SupportCase
from app.modules.user_management.models import Tenant, User

SAMPLE_COUNT = 3


def get_or_create(db: Session, model, defaults: dict | None = None, **filters):
    obj = db.query(model).filter_by(**filters).one_or_none()
    if obj:
        return obj, False
    payload = dict(filters)
    if defaults:
        payload.update(defaults)
    obj = model(**payload)
    db.add(obj)
    db.flush()
    return obj, True


def seed(db: Session, tenant: Tenant, owner: User) -> dict[str, int]:
    created: dict[str, int] = {}

    def bump(key: str, made: bool) -> None:
        created[key] = created.get(key, 0) + (1 if made else 0)

    for i in range(1, SAMPLE_COUNT + 1):
        _, made = get_or_create(
            db,
            SalesLead,
            tenant_id=tenant.id,
            primary_email=f"sample.lead{i}@sample.lynk.dev",
            defaults={
                "first_name": "Sample",
                "last_name": f"Lead {i}",
                "company": f"Sample Prospect {i}",
                "status": ["new", "contacted", "qualified"][i % 3],
                "assigned_to": owner.id,
            },
        )
        bump("sales_leads", made)

        quote, made = get_or_create(
            db,
            SalesQuote,
            tenant_id=tenant.id,
            quote_number=f"SAMPLE-QT-{i:04d}",
            defaults={
                "customer_name": f"Sample Customer {i}",
                "status": ["draft", "sent", "accepted"][i % 3],
                "currency": "USD",
                "subtotal_amount": Decimal("1000.00"),
                "total_amount": Decimal("1100.00"),
                "tax_amount": Decimal("100.00"),
                "title": f"Sample Quote {i}",
                "assigned_to": owner.id,
            },
        )
        bump("sales_quotes", made)

        # A shareable proposal, so /public/quotes/proposal/[token] is reachable.
        # The service hashes the raw token with plain sha256, so the usable link is
        #   /public/quotes/proposal/sample-proposal-<tenant>-<n>
        raw_token = f"sample-proposal-{tenant.id}-{i}"
        _, made = get_or_create(
            db,
            SalesQuoteDocument,
            tenant_id=tenant.id,
            quote_id=quote.quote_id,
            defaults={
                "title": f"Proposal for Sample Customer {i}",
                "content_text": (
                    "This sample proposal exists so the public proposal route can be "
                    "opened in tests and design audits."
                ),
                "status": "sent",
                "public_token_hash": hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                "public_expires_at": datetime.now(timezone.utc) + timedelta(days=3650),
                "created_by_id": owner.id,
            },
        )
        bump("sales_quote_documents", made)

        _, made = get_or_create(
            db,
            SalesOrder,
            tenant_id=tenant.id,
            order_number=f"SAMPLE-SO-{i:04d}",
            defaults={
                "status": ["draft", "confirmed", "fulfilled"][i % 3],
                "currency": "USD",
                "subtotal": Decimal("1000.00"),
                "grand_total": Decimal("1100.00"),
                "tax_total": Decimal("100.00"),
                "owner_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("sales_orders", made)

        _, made = get_or_create(
            db,
            Contract,
            tenant_id=tenant.id,
            contract_number=f"SAMPLE-CT-{i:04d}",
            defaults={
                "title": f"Sample Service Agreement {i}",
                "status": ["draft", "review", "sent"][i % 3],
                "owner_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("contracts", made)

        _, made = get_or_create(
            db,
            SupportCase,
            tenant_id=tenant.id,
            case_number=f"SAMPLE-CASE-{i:04d}",
            defaults={
                "subject": f"Sample support request {i}",
                "status": ["new", "open", "resolved"][i % 3],
                "priority": ["low", "medium", "high"][i % 3],
                "description": f"Sample case body {i}.",
                "assigned_to_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("support_cases", made)

    seed_inventory_drafts(db, tenant, bump)
    seed_fulfilment_samples(db, tenant, owner, bump)
    seed_purchasing_samples(db, tenant, owner, bump)
    seed_invoicing_samples(db, tenant, owner, bump)
    seed_costing_samples(db, tenant, owner, bump)
    return created


def seed_inventory_drafts(db: Session, tenant: Tenant, bump) -> None:
    """One draft adjustment and one draft transfer. Drafts never post to the stock ledger,
    so balances are untouched; they exist so the document record routes are reachable."""
    warehouse = (
        db.query(InventoryWarehouse)
        .filter_by(tenant_id=tenant.id, deleted_at=None, is_active=1)
        .order_by(InventoryWarehouse.is_default.desc(), InventoryWarehouse.id.asc())
        .first()
    )
    product = (
        db.query(CatalogProduct)
        .filter_by(tenant_id=tenant.id, deleted_at=None, is_active=1, track_inventory=1)
        .order_by(CatalogProduct.id.asc())
        .first()
    )
    if warehouse is None or product is None:
        return

    level = db.query(InventoryStockLevel).filter_by(
        tenant_id=tenant.id, warehouse_id=warehouse.id, product_id=product.id,
    ).one_or_none()
    adjustment, made = get_or_create(
        db,
        InventoryAdjustment,
        tenant_id=tenant.id,
        number="SAMPLE-ADJ-0001",
        defaults={"warehouse_id": warehouse.id, "mode": "quantity", "reason": "Sample adjustment"},
    )
    if made:
        adjustment.lines.append(InventoryAdjustmentLine(
            tenant_id=tenant.id, product_id=product.id,
            expected=level.on_hand if level else Decimal("0"), delta=Decimal("1"),
        ))
        db.flush()
    bump("inventory_adjustments", made)

    target, made = get_or_create(
        db,
        InventoryWarehouse,
        tenant_id=tenant.id,
        code="SAMPLE-WH",
        defaults={"name": "Sample warehouse"},
    )
    bump("inventory_warehouses", made)
    if target.id == warehouse.id or target.deleted_at is not None or not target.is_active:
        return
    transfer, made = get_or_create(
        db,
        InventoryTransfer,
        tenant_id=tenant.id,
        number="SAMPLE-TRF-0001",
        defaults={"from_warehouse_id": warehouse.id, "to_warehouse_id": target.id},
    )
    if made:
        transfer.lines.append(InventoryTransferLine(tenant_id=tenant.id, product_id=product.id, quantity=Decimal("1")))
        db.flush()
    bump("inventory_transfers", made)


def seed_fulfilment_samples(db: Session, tenant: Tenant, owner: User, bump) -> None:
    """A sample order with a posted delivery, a draft delivery and a draft return, so the
    delivery and return record routes are reachable (E3). Unlike the drafts above, the posted
    delivery is a real one-unit stock movement for a sample order, made through the services."""
    from app.modules.inventory.models import InventoryDelivery, InventoryReturn
    from app.modules.inventory.services import delivery_services, return_services
    from app.modules.inventory.services.stock_ledger import ensure_default_warehouse, reserve_for_order
    from app.modules.sales.models import SalesOrderItem

    warehouse = ensure_default_warehouse(db, tenant_id=tenant.id)
    product = (
        db.query(CatalogProduct).join(InventoryStockLevel, InventoryStockLevel.product_id == CatalogProduct.id)
        .filter(CatalogProduct.tenant_id == tenant.id, CatalogProduct.deleted_at.is_(None), CatalogProduct.is_active == 1,
                CatalogProduct.track_inventory == 1, InventoryStockLevel.warehouse_id == warehouse.id,
                InventoryStockLevel.on_hand - InventoryStockLevel.reserved >= 2)
        .order_by(CatalogProduct.id.asc()).first()
    )
    existing = db.query(SalesOrder).filter_by(tenant_id=tenant.id, order_number="SAMPLE-SO-E3").one_or_none()
    if existing is None and product is None:
        return
    order, made = get_or_create(
        db, SalesOrder, tenant_id=tenant.id, order_number="SAMPLE-SO-E3",
        defaults={"status": "confirmed", "currency": product.currency if product else "USD", "warehouse_id": warehouse.id,
                  "owner_id": owner.id, "created_by_id": owner.id},
    )
    if made:
        order.items.append(SalesOrderItem(tenant_id=tenant.id, catalog_product_id=product.id, name=product.name,
            quantity=Decimal("3"), unit_price=product.public_unit_price, line_total=product.public_unit_price * 3, sort_order=0))
        db.flush()
        reserve_for_order(db, tenant_id=tenant.id, order=order, actor_user_id=owner.id)
    bump("sales_orders", made)
    line = order.items[0] if order.items else None
    if line is None or order.status != "confirmed":
        return

    def delivery(number: str, *, post: bool):
        doc = db.query(InventoryDelivery).filter_by(tenant_id=tenant.id, number=number).one_or_none()
        if doc is not None:
            return doc, False
        doc = delivery_services.save_delivery(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "order_id": order.id, "carrier": "Sample carrier", "lines": [{"order_line_id": line.id, "quantity": "1"}]})
        doc.number = number
        db.flush()
        if post:
            delivery_services.post_delivery(db, tenant_id=tenant.id, actor_user_id=owner.id, delivery_id=doc.id)
        return doc, True

    shipped, made = delivery("SAMPLE-DEL-0001", post=True)
    bump("inventory_deliveries", made)
    _, made = delivery("SAMPLE-DEL-0002", post=False)
    bump("inventory_deliveries", made)
    if shipped.status == "posted" and db.query(InventoryReturn).filter_by(tenant_id=tenant.id, number="SAMPLE-RET-0001").one_or_none() is None:
        doc = return_services.save_return(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={"delivery_id": shipped.id, "reason": "Sample return"})
        doc.number = "SAMPLE-RET-0001"
        db.flush()
        bump("inventory_returns", True)


def seed_purchasing_samples(db: Session, tenant: Tenant, owner: User, bump) -> None:
    """A sample vendor, a placed purchase order with a posted receipt, and a draft one, so the
    purchasing record routes are reachable (E4). The receipt is a real two-unit stock move."""
    from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt
    from app.modules.purchasing.services import purchase_order_services, receipt_services
    from app.modules.sales.models import SalesOrganization

    product = (
        db.query(CatalogProduct)
        .filter_by(tenant_id=tenant.id, deleted_at=None, is_active=1, track_inventory=1)
        .order_by(CatalogProduct.id.asc())
        .first()
    )
    if product is None:
        return
    vendor, made = get_or_create(
        db, SalesOrganization, tenant_id=tenant.id, org_name="Sample Supplier Ltd",
        defaults={"primary_email": "orders@sample-supplier.test", "is_vendor": 1, "assigned_to": owner.id},
    )
    bump("sales_organizations", made)
    if not vendor.is_vendor:
        vendor.is_vendor = 1
    if product.preferred_vendor_id is None:
        product.preferred_vendor_id = vendor.org_id
    db.flush()

    def purchase_order(number: str, *, place: bool):
        order = db.query(PurchaseOrder).filter_by(tenant_id=tenant.id, number=number).one_or_none()
        if order is not None:
            return order, False
        order = purchase_order_services.save_order(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "vendor_id": vendor.org_id, "currency": base_currency(db, tenant_id=tenant.id), "vendor_reference": "SAMPLE",
            "lines": [{"product_id": product.id, "quantity": "5", "unit_cost": product.cost_price or 1}]})
        order.number = number
        db.flush()
        if place:
            purchase_order_services.mark_ordered(db, tenant_id=tenant.id, actor_user_id=owner.id, order_id=order.id)
        return order, True

    placed, made = purchase_order("SAMPLE-PO-0001", place=True)
    bump("purchase_orders", made)
    _, made = purchase_order("SAMPLE-PO-0002", place=False)
    bump("purchase_orders", made)
    if placed.status == "ordered" and db.query(PurchaseReceipt).filter_by(tenant_id=tenant.id, number="SAMPLE-RCV-0001").one_or_none() is None:
        receipt = receipt_services.save_receipt(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "order_id": placed.id, "vendor_delivery_ref": "SAMPLE", "lines": [{"order_line_id": placed.lines[0].id, "quantity": "2"}]})
        receipt.number = "SAMPLE-RCV-0001"
        db.flush()
        receipt_services.post_receipt(db, tenant_id=tenant.id, actor_user_id=owner.id, receipt_id=receipt.id)
        bump("purchase_receipts", True)


def seed_invoicing_samples(db: Session, tenant: Tenant, owner: User, bump) -> None:
    """An issued, part-paid invoice with a credit note, a draft invoice, and a posted, part-paid
    bill for the sample purchase order, so every E5 record route is reachable. Keyed by
    markers in their notes, reason and vendor invoice number, since their numbers are allocated."""
    from app.modules.finance.models import FinanceCreditNote, FinancePosInvoice
    from app.modules.finance.services import credit_note_services, payment_services, pos_invoice_services
    from app.modules.purchasing.models import PurchaseBill, PurchaseOrder
    from app.modules.purchasing.services import bill_services

    # The services take the acting user as `current_user`; the owner is an admin here.
    invoice = db.query(FinancePosInvoice).filter_by(tenant_id=tenant.id, notes="SAMPLE-E5-INV").one_or_none()
    if invoice is None:
        invoice = pos_invoice_services.create_invoice(db, owner, {
            "customer_name": "Sample Customer", "customer_email": "ap@sample-customer.test", "issue": True, "notes": "SAMPLE-E5-INV",
            "lines": [{"description": "Sample service", "quantity": 2, "unit_price": 50, "tax_amount": 10}]}, commit=False)
        db.flush()
        payment_services.record_payment(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "direction": "received", "method": "Bank transfer", "reference": "SAMPLE",
            "allocations": [{"invoice_id": invoice.id, "amount": "40"}]})
        bump("finance_pos_invoices", True)
        bump("finance_payments", True)
    if db.query(FinanceCreditNote).filter_by(tenant_id=tenant.id, reason="SAMPLE-E5-CN").one_or_none() is None and invoice.status == "issued":
        note = credit_note_services.save_draft(db, owner, payload={"invoice_id": invoice.id, "reason": "SAMPLE-E5-CN",
            "lines": [{"invoice_line_id": invoice.lines[0].id, "quantity": 1}]})
        credit_note_services.issue(db, owner, note.id)
        bump("finance_credit_notes", True)
    if db.query(FinancePosInvoice).filter_by(tenant_id=tenant.id, notes="SAMPLE-E5-DRAFT").one_or_none() is None:
        pos_invoice_services.create_invoice(db, owner, {"customer_name": "Sample Customer", "notes": "SAMPLE-E5-DRAFT",
            "lines": [{"description": "Sample draft line", "quantity": 1, "unit_price": 25}]}, commit=False)
        bump("finance_pos_invoices", True)

    order = db.query(PurchaseOrder).filter_by(tenant_id=tenant.id, number="SAMPLE-PO-0001").one_or_none()
    if order is not None and order.receipt_status != "none" and db.query(PurchaseBill).filter_by(
            tenant_id=tenant.id, vendor_invoice_number="SAMPLE-BILL-1").one_or_none() is None:
        bill = bill_services.save_bill(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "order_id": order.id, "vendor_invoice_number": "SAMPLE-BILL-1"})
        bill_services.post_bill(db, tenant_id=tenant.id, actor_user_id=owner.id, bill_id=bill.id)
        payment_services.record_payment(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "direction": "made", "method": "Bank transfer", "allocations": [{"bill_id": bill.id, "amount": "1"}]})
        bump("purchase_bills", True)
        bump("finance_payments", True)
    db.flush()


def seed_costing_samples(db: Session, tenant: Tenant, owner: User, bump) -> None:
    """A costed product received twice at different costs (4, then 6: average 5), and a bill for
    the second receipt at 6.50, so the valuation page, a bill price difference and a
    revaluation all have something to show (E6)."""
    from app.modules.purchasing.models import PurchaseBill, PurchaseOrder
    from app.modules.purchasing.services import bill_services, purchase_order_services, receipt_services
    from app.modules.sales.models import SalesOrganization

    vendor = db.query(SalesOrganization).filter_by(tenant_id=tenant.id, org_name="Sample Supplier Ltd").one_or_none()
    if vendor is None:
        return
    product, made = get_or_create(db, CatalogProduct, tenant_id=tenant.id, sku="SAMPLE-COSTED", defaults={
        "name": "Sample costed widget", "currency": base_currency(db, tenant_id=tenant.id), "public_unit_price": 12,
        "track_inventory": 1, "stock_quantity": 0, "stock_status": "out_of_stock", "preferred_vendor_id": vendor.org_id})
    bump("catalog_products", made)
    db.flush()
    for number, cost in (("SAMPLE-PO-E6-1", 4), ("SAMPLE-PO-E6-2", 6)):
        if db.query(PurchaseOrder).filter_by(tenant_id=tenant.id, number=number).one_or_none() is not None:
            continue
        order = purchase_order_services.save_order(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "vendor_id": vendor.org_id, "currency": base_currency(db, tenant_id=tenant.id), "vendor_reference": "SAMPLE-E6",
            "lines": [{"product_id": product.id, "quantity": "10", "unit_cost": cost}]})
        order.number = number
        db.flush()
        purchase_order_services.mark_ordered(db, tenant_id=tenant.id, actor_user_id=owner.id, order_id=order.id)
        receipt = receipt_services.save_receipt(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={"order_id": order.id})
        receipt_services.post_receipt(db, tenant_id=tenant.id, actor_user_id=owner.id, receipt_id=receipt.id)
        bump("purchase_orders", True)
        bump("purchase_receipts", True)
    second = db.query(PurchaseOrder).filter_by(tenant_id=tenant.id, number="SAMPLE-PO-E6-2").one_or_none()
    if second is not None and db.query(PurchaseBill).filter_by(tenant_id=tenant.id, vendor_invoice_number="SAMPLE-BILL-E6").one_or_none() is None:
        bill = bill_services.save_bill(db, tenant_id=tenant.id, actor_user_id=owner.id, payload={
            "order_id": second.id, "vendor_invoice_number": "SAMPLE-BILL-E6",
            "lines": [{"order_line_id": second.lines[0].id, "description": "Sample costed widget", "quantity": "10", "unit_cost": "6.50"}]})
        bill_services.post_bill(db, tenant_id=tenant.id, actor_user_id=owner.id, bill_id=bill.id)
        bump("purchase_bills", True)
    db.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-slug", default="default", help="Slug of the tenant to seed.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter_by(slug=args.tenant_slug).one_or_none()
        if not tenant:
            raise SystemExit(f"No tenant with slug '{args.tenant_slug}'.")

        owner = db.query(User).filter_by(tenant_id=tenant.id).order_by(User.id.asc()).first()
        if not owner:
            raise SystemExit(f"Tenant '{args.tenant_slug}' has no users to own the records.")

        created = seed(db, tenant, owner)
        db.commit()

        print(f"Sample records for {tenant.name} ({tenant.slug}):")
        for table, count in sorted(created.items()):
            print(f"  {table:24} +{count}")
        print("Re-running is a no-op; records are keyed by reference number.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
