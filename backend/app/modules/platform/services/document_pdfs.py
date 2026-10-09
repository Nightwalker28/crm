"""Document PDFs and previews (13d §3.3): what each document type prints, and its snapshots.

Every kind builds the same context shape for the shared templates:
`company`, `layout`, `document` (title, number, facts), `parties`, `lines`, `columns`,
`tax_summary`, `totals`, `terms`, `notes`, `payment`.

An issued document is served from its snapshot: the first download or send stores one, and a
document changed since its latest snapshot gets a new version. A draft renders live.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.document_pdf import LAYOUTS, image_data_uri, render_html, render_pdf
from app.core.uploads import UPLOADS_DIR
from app.modules.platform.models import DocumentPdfSnapshot, DocumentSetting

SNAPSHOT_DIR = UPLOADS_DIR / "document-pdfs"
DEFAULT_BRAND = "#0f766e"  # design-exempt: the PDF's fallback accent when the tenant set none


@dataclass(frozen=True)
class DocumentKind:
    module_key: str
    kind: str  # the `document_settings` kind
    label: str  # the default printed title
    load: Callable[[Session, Any, int], Any]
    build: Callable[[Session, Any, Any], dict]
    issued: Callable[[Any], bool]
    number: Callable[[Any], str | None]


# Loading -------------------------------------------------------------------------------------

def _scoped(model, db: Session, user, record_id: int, *, label: str):
    record = db.query(model).filter(model.id == record_id, model.tenant_id == user.tenant_id).first()
    if record is None or getattr(record, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return record


def _load_quote(db, user, record_id):
    from app.modules.sales.services.quotes_services import get_quote_or_404

    return get_quote_or_404(db, record_id, tenant_id=user.tenant_id)


def _load_order(db, user, record_id):
    from app.modules.sales.services.orders_services import get_order_or_404

    return get_order_or_404(db, tenant_id=user.tenant_id, order_id=record_id)


def _load_invoice(db, user, record_id):
    from app.modules.finance.services.pos_invoice_services import get_invoice_or_404

    return get_invoice_or_404(db, user, record_id)


def _load_credit_note(db, user, record_id):
    from app.modules.finance.services.credit_note_services import get_credit_note

    return get_credit_note(db, user, record_id)


def _load_model(model_path: str, label: str):
    def load(db, user, record_id):
        module_name, _, class_name = model_path.rpartition(".")
        module = __import__(module_name, fromlist=[class_name])
        return _scoped(getattr(module, class_name), db, user, record_id, label=label)
    return load


# Building ------------------------------------------------------------------------------------

def _company(db: Session, tenant_id: int) -> dict:
    from app.modules.user_management.models import CompanyProfile

    profile = db.query(CompanyProfile).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).first()
    if profile is None:
        return {"name": "", "address": "", "email": None, "phone": None, "website": None, "logo": None, "brand_color": DEFAULT_BRAND,
                "footer": None, "bank_details": None, "layout": "modern"}
    color = profile.brand_color if profile.brand_color and re.fullmatch(r"#[0-9a-fA-F]{6}", profile.brand_color) else DEFAULT_BRAND
    return {
        "name": profile.name, "address": profile.billing_address or "", "email": profile.primary_email, "phone": profile.primary_phone,
        "website": profile.website, "logo": image_data_uri(profile.logo_url), "brand_color": color, "footer": profile.document_footer,
        "bank_details": profile.bank_details, "layout": profile.document_layout if profile.document_layout in LAYOUTS else "modern",
    }


def _setting(db: Session, tenant_id: int, kind: str) -> DocumentSetting | None:
    return db.query(DocumentSetting).filter(DocumentSetting.tenant_id == tenant_id, DocumentSetting.kind == kind).first()


def _address(record, prefix: str) -> list[str]:
    """A document's structured address (13a C2) as printed lines."""
    street = getattr(record, f"{prefix}_address", None)
    street2 = getattr(record, f"{prefix}_street2", None)
    city = getattr(record, f"{prefix}_city", None)
    state = getattr(record, f"{prefix}_state", None)
    postal = getattr(record, f"{prefix}_postal_code", None)
    country = getattr(record, f"{prefix}_country", None)
    locality = " ".join(part for part in (city, state, postal) if part)
    return [line for line in (street, street2, locality, country) if line]


def _person(contact) -> str | None:
    if contact is None:
        return None
    return " ".join(part for part in (contact.first_name, contact.last_name) if part).strip() or contact.primary_email


def _party(label: str, name: str | None, lines: list[str], extra: list[str] | None = None) -> dict:
    return {"label": label, "name": name or "", "lines": [*lines, *(extra or [])]}


def _rate_names(db: Session, tenant_id: int, lines) -> dict[int, str]:
    from app.modules.finance.services.tax_rates import rates_lookup

    return {rate_id: rate.name for rate_id, rate in rates_lookup(db, tenant_id=tenant_id, rate_ids=[getattr(line, "tax_rate_id", None) for line in lines]).items()}


def _priced_lines(db: Session, tenant_id: int, lines, *, name: Callable[[Any], str], price: str = "unit_price") -> list[dict]:
    names = _rate_names(db, tenant_id, lines)
    result = []
    for line in lines:
        line_type = getattr(line, "line_type", None) or "item"
        if line_type != "item":
            result.append({"type": line_type, "name": name(line)})
            continue
        result.append({
            "type": "item", "name": name(line), "description": getattr(line, "description", None) if name(line) != getattr(line, "description", None) else None,
            "quantity": line.quantity, "unit": getattr(line, "unit", None), "unit_price": getattr(line, price),
            "discount": getattr(line, "discount_amount", None), "discount_percent": getattr(line, "discount_percent", None),
            "tax": line.tax_amount, "tax_rate": names.get(getattr(line, "tax_rate_id", None)), "total": line.line_total,
            "optional": bool(getattr(line, "is_optional", False)),
        })
    return result


def _totals(rows: list[tuple[str, Any, bool]]) -> list[dict]:
    return [{"label": label, "amount": amount, "strong": strong} for label, amount, strong in rows if amount is not None]


def _facts(*pairs: tuple[str, Any]) -> list[dict]:
    return [{"label": label, "value": value} for label, value in pairs if value not in (None, "")]


PRICED = {"price": True, "discount": True, "tax": True}
QUANTITIES = {"price": False, "discount": False, "tax": False}


def _build_quote(db, user, quote) -> dict:
    lines = [line for line in quote.items]
    return {
        "document": {"number": quote.quote_number, "facts": _facts(("Date", quote.issue_date), ("Valid until", quote.expiry_date),
                                                                   ("Your reference", quote.customer_po_reference)),
                     "subject": quote.title, "currency": quote.currency, "inclusive": quote.tax_mode == "inclusive"},
        "parties": [_party("Prepared for", quote.organization.org_name if quote.organization else quote.customer_name,
                           _address(quote, "billing"), [line for line in [_person(quote.contact)] if line])],
        "lines": _priced_lines(db, user.tenant_id, lines, name=lambda line: line.name),
        "columns": PRICED,
        "tax_summary": quote.tax_summary,
        "totals": _totals([("Subtotal", quote.subtotal_amount, False), ("Discount", -Decimal(quote.discount_amount or 0) or None, False),
                           ("Tax", quote.tax_amount, False), ("Shipping", quote.shipping_charge or None, False), ("Total", quote.total_amount, True)]),
        "terms": quote.terms_and_conditions, "notes": quote.notes,
    }


def _build_order(db, user, order) -> dict:
    return {
        "document": {"number": order.order_number, "facts": _facts(("Date", order.created_at), ("Delivery by", order.delivery_date),
                                                                   ("Your PO", order.customer_po_reference), ("Payment terms", order.payment_terms)),
                     "currency": order.currency, "inclusive": order.tax_mode == "inclusive"},
        "parties": [
            _party("Bill to", order.organization.org_name if order.organization else _person(order.contact), _address(order, "billing")),
            _party("Ship to", order.organization.org_name if order.organization else _person(order.contact), _address(order, "shipping")),
        ],
        "lines": _priced_lines(db, user.tenant_id, order.items, name=lambda line: line.name),
        "columns": PRICED,
        "tax_summary": order.tax_summary,
        "totals": _totals([("Subtotal", order.subtotal, False), ("Discount", -Decimal(order.discount_total or 0) or None, False),
                           ("Tax", order.tax_total, False), ("Shipping", order.shipping_charge or None, False), ("Total", order.grand_total, True)]),
        "terms": order.terms_and_conditions, "notes": order.notes,
    }


def _invoice_party(invoice) -> dict:
    organization = invoice.customer_organization
    if organization is not None:
        # The account's billing address, not the contact's email (H16).
        return _party("Bill to", organization.org_name, _address(organization, "billing"), [line for line in [_person(invoice.customer_contact)] if line])
    return _party("Bill to", invoice.customer_name, (invoice.customer_address or "").splitlines())


def _build_invoice(db, user, invoice) -> dict:
    return {
        "document": {"number": invoice.invoice_number or "Draft", "facts": _facts(("Date", invoice.issue_date), ("Due", invoice.due_date),
                                                                                  ("Payment terms", invoice.payment_terms)),
                     "currency": invoice.currency, "inclusive": invoice.tax_mode == "inclusive"},
        "parties": [_invoice_party(invoice)],
        "lines": _priced_lines(db, user.tenant_id, invoice.lines, name=lambda line: line.description),
        "columns": PRICED,
        "tax_summary": invoice.tax_summary,
        "totals": _totals([("Subtotal", invoice.subtotal_amount, False), ("Discount", -Decimal(invoice.discount_amount or 0) or None, False),
                           ("Tax", invoice.tax_amount, False), ("Total", invoice.total_amount, True),
                           ("Paid", -Decimal(invoice.amount_paid or 0) or None, False), ("Credited", -Decimal(invoice.amount_credited or 0) or None, False),
                           ("Written off", -Decimal(invoice.amount_written_off or 0) or None, False),
                           ("Balance due", invoice.balance_due if invoice.status == "issued" else None, True)]),
        "notes": invoice.notes, "payment": True,
        # An invoice keeps its own layout choice (the old invoice template), else the company's.
        "layout_override": invoice.template_id if invoice.template_id in LAYOUTS else None,
    }


def _build_credit_note(db, user, note) -> dict:
    invoice = note.invoice
    return {
        "document": {"number": note.number or "Draft", "facts": _facts(("Date", note.issue_date), ("Invoice", invoice.invoice_number if invoice else None),
                                                                       ("Reason", note.reason)),
                     "currency": note.currency, "inclusive": note.tax_mode == "inclusive"},
        "parties": [_invoice_party(invoice)] if invoice else [],
        "lines": _priced_lines(db, user.tenant_id, note.lines, name=lambda line: line.description),
        "columns": PRICED,
        "tax_summary": note.tax_summary,
        "totals": _totals([("Subtotal", note.subtotal_amount, False), ("Discount", -Decimal(note.discount_amount or 0) or None, False),
                           ("Tax", note.tax_amount, False), ("Total credit", note.total_amount, True)]),
        "notes": note.notes,
    }


def _vendor_party(label: str, vendor) -> dict:
    return _party(label, vendor.org_name if vendor else "", _address(vendor, "billing") if vendor else [])


def _build_purchase_order(db, user, order) -> dict:
    return {
        "document": {"number": order.number, "facts": _facts(("Date", order.ordered_at or order.created_at), ("Expected", order.expected_date),
                                                             ("Your reference", order.vendor_reference)),
                     "currency": order.currency, "inclusive": False},
        "parties": [_vendor_party("Vendor", order.vendor),
                    _party("Deliver to", order.warehouse.name if order.warehouse else "", (order.warehouse.address or "").splitlines() if order.warehouse else [])],
        "lines": _priced_lines(db, user.tenant_id, order.lines, name=lambda line: line.item_name, price="unit_cost"),
        "columns": PRICED,
        "tax_summary": order.tax_summary,
        "totals": _totals([("Subtotal", order.subtotal, False), ("Tax", order.tax_total, False), ("Total", order.total, True)]),
        "notes": order.notes,
    }


def _build_bill(db, user, bill) -> dict:
    return {
        "document": {"number": bill.number, "facts": _facts(("Vendor invoice", bill.vendor_invoice_number), ("Date", bill.bill_date), ("Due", bill.due_date),
                                                            ("Purchase order", bill.order.number if bill.order else None)),
                     "currency": bill.currency, "inclusive": False},
        "parties": [_vendor_party("Vendor", bill.vendor)],
        "lines": _priced_lines(db, user.tenant_id, bill.lines, name=lambda line: line.description, price="unit_cost"),
        "columns": {**PRICED, "discount": False},
        "tax_summary": bill.tax_summary,
        "totals": _totals([("Subtotal", bill.subtotal, False), ("Tax", bill.tax_total, False), ("Total", bill.total, True),
                           ("Balance due", bill.balance_due if bill.status == "posted" else None, True)]),
        "notes": bill.notes,
    }


def _build_vendor_credit(db, user, credit) -> dict:
    return {
        "document": {"number": credit.number or "Draft", "facts": _facts(("Date", credit.credit_date), ("Vendor reference", credit.vendor_reference),
                                                                         ("Reason", credit.reason)),
                     "currency": credit.currency, "inclusive": False},
        "parties": [_vendor_party("Vendor", credit.vendor)],
        "lines": _priced_lines(db, user.tenant_id, credit.lines, name=lambda line: line.description, price="unit_cost"),
        "columns": {**PRICED, "discount": False},
        "tax_summary": credit.tax_summary,
        "totals": _totals([("Subtotal", credit.subtotal, False), ("Tax", credit.tax_total, False), ("Total credit", credit.total, True)]),
        "notes": credit.notes,
    }


def _quantity_lines(rows) -> list[dict]:
    return [{"type": "item", "name": name, "description": None, "quantity": quantity, "unit": unit, "optional": False} for name, quantity, unit in rows]


def _build_delivery(db, user, delivery) -> dict:
    from app.modules.catalog.models import CatalogProduct
    from app.modules.sales.models import SalesOrder, SalesOrderItem

    order = db.query(SalesOrder).filter(SalesOrder.id == delivery.order_id, SalesOrder.tenant_id == user.tenant_id).first()
    items = {item.id: item for item in db.query(SalesOrderItem).filter(SalesOrderItem.id.in_([line.order_line_id for line in delivery.lines] or [0]))}
    products = {product.id: product for product in db.query(CatalogProduct).filter(CatalogProduct.id.in_([line.product_id for line in delivery.lines] or [0]))}
    rows = [((items[line.order_line_id].name if line.order_line_id in items else products.get(line.product_id).name if products.get(line.product_id) else ""),
             line.quantity, items[line.order_line_id].unit if line.order_line_id in items else None) for line in delivery.lines]
    customer = (order.organization.org_name if order and order.organization else _person(order.contact) if order else "") or ""
    return {
        "document": {"number": delivery.number, "facts": _facts(("Shipped", delivery.shipped_on), ("Order", order.order_number if order else None),
                                                                ("Customer PO", order.customer_po_reference if order else None),
                                                                ("Carrier", delivery.carrier), ("Tracking", delivery.tracking_number)),
                     "currency": None, "inclusive": False},
        "parties": [_party("Ship to", customer, _address(order, "shipping") if order else []),
                    _party("Ship from", delivery.warehouse.name if delivery.warehouse else "", (delivery.warehouse.address or "").splitlines() if delivery.warehouse else [])],
        "lines": _quantity_lines(rows),
        "columns": QUANTITIES,
        "tax_summary": [],
        "totals": [],
        "notes": delivery.notes,
    }


def _build_receipt(db, user, receipt) -> dict:
    from app.modules.purchasing.models import PurchaseOrder, PurchaseOrderLine

    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == receipt.order_id, PurchaseOrder.tenant_id == user.tenant_id).first()
    po_lines = {line.id: line for line in db.query(PurchaseOrderLine).filter(PurchaseOrderLine.id.in_([line.order_line_id for line in receipt.lines] or [0]))}
    rows = [(po_lines[line.order_line_id].item_name if line.order_line_id in po_lines else "", line.quantity,
             po_lines[line.order_line_id].unit if line.order_line_id in po_lines else None) for line in receipt.lines]
    return {
        "document": {"number": receipt.number, "facts": _facts(("Received", receipt.received_on), ("Purchase order", order.number if order else None),
                                                               ("Vendor delivery", receipt.vendor_delivery_ref)),
                     "currency": None, "inclusive": False},
        "parties": [_vendor_party("Vendor", order.vendor if order else None)],
        "lines": _quantity_lines(rows),
        "columns": QUANTITIES,
        "tax_summary": [],
        "totals": [],
        "notes": receipt.notes,
    }


KINDS: dict[str, DocumentKind] = {
    "sales_quotes": DocumentKind("sales_quotes", "quote", "Quote", _load_quote, _build_quote,
                                 lambda quote: quote.status not in {"draft"}, lambda quote: quote.quote_number),
    "sales_orders": DocumentKind("sales_orders", "sales_order", "Order confirmation", _load_order, _build_order,
                                 lambda order: order.status != "draft", lambda order: order.order_number),
    "finance_pos": DocumentKind("finance_pos", "invoice", "Invoice", _load_invoice, _build_invoice,
                                lambda invoice: invoice.status in {"issued", "void"}, lambda invoice: invoice.invoice_number),
    "finance_credit_notes": DocumentKind("finance_credit_notes", "credit_note", "Credit note", _load_credit_note, _build_credit_note,
                                         lambda note: note.status in {"issued", "void"}, lambda note: note.number),
    "purchase_orders": DocumentKind("purchase_orders", "purchase_order", "Purchase order", _load_model("app.modules.purchasing.models.PurchaseOrder", "Purchase order"),
                                    _build_purchase_order, lambda order: order.status != "draft", lambda order: order.number),
    "purchase_bills": DocumentKind("purchase_bills", "bill", "Bill", _load_model("app.modules.purchasing.models.PurchaseBill", "Bill"),
                                   _build_bill, lambda bill: bill.status in {"posted", "void"}, lambda bill: bill.number),
    "purchase_vendor_credits": DocumentKind("purchase_vendor_credits", "vendor_credit", "Vendor credit",
                                            _load_model("app.modules.purchasing.models.PurchaseVendorCredit", "Vendor credit"),
                                            _build_vendor_credit, lambda credit: credit.status in {"issued", "void"}, lambda credit: credit.number),
    "inventory_deliveries": DocumentKind("inventory_deliveries", "delivery_note", "Delivery note",
                                         _load_model("app.modules.inventory.models.InventoryDelivery", "Delivery"),
                                         _build_delivery, lambda delivery: delivery.status in {"posted", "cancelled"}, lambda delivery: delivery.number),
    "purchase_receipts": DocumentKind("purchase_receipts", "receipt", "Goods received note",
                                      _load_model("app.modules.purchasing.models.PurchaseReceipt", "Receipt"),
                                      _build_receipt, lambda receipt: receipt.status in {"posted", "cancelled"}, lambda receipt: receipt.number),
}
DOCUMENT_KINDS = {kind.kind: kind for kind in KINDS.values()}


def kind_for(module_key: str) -> DocumentKind:
    kind = KINDS.get(module_key)
    if kind is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This record has no printable document")
    return kind


def _title(db: Session, kind: DocumentKind, record) -> str:
    if kind.module_key == "purchase_orders" and getattr(record, "status", None) in {"draft", "sent"}:
        return "Request for quotation"
    setting = _setting(db, record.tenant_id, kind.kind)
    return (setting.title if setting and setting.title else None) or kind.label


def build_context(db: Session, user, module_key: str, record_id: int, *, as_issued: bool = False) -> tuple[DocumentKind, Any, dict]:
    kind = kind_for(module_key)
    record = kind.load(db, user, record_id)
    context = {"terms": None, "notes": None, "payment": False, "tax_summary": [], "totals": [], **kind.build(db, user, record)}
    company = _company(db, user.tenant_id)
    context["document"]["title"] = _title(db, kind, record)
    context["document"].setdefault("subject", None)
    context["company"] = company
    context["layout"] = context.pop("layout_override", None) or company["layout"]
    context["draft"] = not (as_issued or kind.issued(record))
    # Payment details print on invoices only, and only when the company set them.
    context["payment"] = company["bank_details"] if context["payment"] else None
    return kind, record, context


def render_preview(db: Session, user, module_key: str, record_id: int) -> str:
    _kind, _record, context = build_context(db, user, module_key, record_id)
    return render_html("document.html", context)


def _filename(kind: DocumentKind, record) -> str:
    number = kind.number(record) or f"draft-{record.id}"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", f"{kind.label}-{number}").strip("-")
    return f"{safe}.pdf"


def _changed_since(record, snapshot: DocumentPdfSnapshot) -> bool:
    changed = getattr(record, "updated_at", None) or getattr(record, "posted_at", None)
    if changed is None or snapshot.created_at is None:
        return False
    changed = changed if changed.tzinfo else changed.replace(tzinfo=timezone.utc)
    taken = snapshot.created_at if snapshot.created_at.tzinfo else snapshot.created_at.replace(tzinfo=timezone.utc)
    return changed > taken


def latest_snapshot(db: Session, *, tenant_id: int, module_key: str, entity_id: int) -> DocumentPdfSnapshot | None:
    return (
        db.query(DocumentPdfSnapshot)
        .filter(DocumentPdfSnapshot.tenant_id == tenant_id, DocumentPdfSnapshot.module_key == module_key, DocumentPdfSnapshot.entity_id == entity_id)
        .order_by(DocumentPdfSnapshot.version.desc())
        .first()
    )


def _snapshot_path(snapshot: DocumentPdfSnapshot) -> Path:
    root = SNAPSHOT_DIR.resolve()
    path = (UPLOADS_DIR / snapshot.file_path).resolve()
    if root not in path.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The document's PDF is not available")
    return path


def _store_snapshot(db: Session, *, kind: DocumentKind, record, content: bytes, actor_user_id: int | None, reason: str) -> DocumentPdfSnapshot:
    previous = latest_snapshot(db, tenant_id=record.tenant_id, module_key=kind.module_key, entity_id=record.id)
    version = (previous.version if previous else 0) + 1
    directory = SNAPSHOT_DIR / str(record.tenant_id) / kind.module_key
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{record.id}-v{version}.pdf"
    path.write_bytes(content)
    snapshot = DocumentPdfSnapshot(
        tenant_id=record.tenant_id, module_key=kind.module_key, entity_id=record.id, version=version,
        file_path=path.relative_to(UPLOADS_DIR).as_posix(), filename=_filename(kind, record), size_bytes=len(content),
        reason=reason, created_by=actor_user_id, created_at=datetime.now(timezone.utc),
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def document_pdf(db: Session, user, module_key: str, record_id: int, *, reason: str = "download",
                 as_issued: bool = False) -> tuple[bytes, str]:
    """The document's PDF and filename: its snapshot when issued (taken now if it has none or
    the document changed since), a live render for a draft. `as_issued` renders a draft that is
    being sent (a quote's first send, an RFQ) without the DRAFT mark, and keeps it as a snapshot."""
    kind, record, context = build_context(db, user, module_key, record_id, as_issued=as_issued)
    if not (as_issued or kind.issued(record)):
        return render_pdf("document.html", context), _filename(kind, record)
    snapshot = latest_snapshot(db, tenant_id=record.tenant_id, module_key=kind.module_key, entity_id=record.id)
    if snapshot is not None and not _changed_since(record, snapshot):
        path = _snapshot_path(snapshot)
        if path.is_file():
            return path.read_bytes(), snapshot.filename
    content = render_pdf("document.html", context)
    snapshot = _store_snapshot(db, kind=kind, record=record, content=content, actor_user_id=getattr(user, "id", None), reason=reason)
    return content, snapshot.filename


# Settings ------------------------------------------------------------------------------------

def list_document_settings(db: Session, *, tenant_id: int) -> list[dict]:
    stored = {row.kind: row for row in db.query(DocumentSetting).filter(DocumentSetting.tenant_id == tenant_id).all()}
    return [
        {"kind": kind.kind, "label": kind.label, "module_key": kind.module_key,
         "title": stored[kind.kind].title if kind.kind in stored else None,
         "default_terms": stored[kind.kind].default_terms if kind.kind in stored else None,
         "default_notes": stored[kind.kind].default_notes if kind.kind in stored else None,
         "email_template_id": stored[kind.kind].email_template_id if kind.kind in stored else None}
        for kind in KINDS.values()
    ]


def save_document_setting(db: Session, *, tenant_id: int, actor_user_id: int | None, kind: str, payload: dict) -> DocumentSetting:
    if kind not in DOCUMENT_KINDS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown document type")
    if payload.get("email_template_id"):
        from app.modules.platform.models import MessageTemplate

        if db.query(MessageTemplate.id).filter(MessageTemplate.id == payload["email_template_id"], MessageTemplate.tenant_id == tenant_id).first() is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email template not found")
    setting = _setting(db, tenant_id, kind) or DocumentSetting(tenant_id=tenant_id, kind=kind)
    for field in ("title", "default_terms", "default_notes", "email_template_id"):
        if field in payload:
            value = payload[field]
            setattr(setting, field, (value.strip() or None) if isinstance(value, str) else value)
    setting.updated_by = actor_user_id
    db.add(setting)
    db.flush()
    return setting


def default_texts(db: Session, *, tenant_id: int, kind: str) -> dict:
    """The terms and notes a new document of this kind starts with."""
    setting = _setting(db, tenant_id, kind)
    return {"terms": setting.default_terms if setting else None, "notes": setting.default_notes if setting else None}
