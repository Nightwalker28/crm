"""*Send by email* for commercial documents (13d §3.4).

The record composer (`POST /mail/records/{module}/{id}/send`) sends from the user's own
mailbox (decision 6). For a document it also:
- attaches the document's PDF when asked (`attach_document_pdf`), rendered as issued, so an
  RFQ or a quote being sent never carries the DRAFT mark;
- gives the template a `document.*` set of tokens, and a quote's proposal link;
- after the provider accepted the message: logs `document.sent` on the document's history
  with the recipients, marks a draft quote *Sent* and a draft PO (an RFQ) sent.

`send_context` is what the composer starts with: the recipients the document's people offer,
the type's email template and the PDF's filename.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.platform.services import document_pdfs
from app.modules.platform.services.activity_logs import log_activity

# Documents that may be sent while still a draft: a quote's first send is what makes it sent,
# and a draft PO is a request for quotation.
SENDABLE_DRAFTS = {"sales_quotes", "purchase_orders"}
VENDOR_DOCUMENTS = {"purchase_orders", "purchase_bills", "purchase_vendor_credits", "purchase_receipts"}


def is_document(module_key: str | None) -> bool:
    return bool(module_key) and module_key in document_pdfs.KINDS


def _people(db: Session, document, module_key: str) -> tuple[Any, Any]:
    """(account, contact) the document is addressed to."""
    if module_key == "purchase_receipts":
        from app.modules.purchasing.models import PurchaseOrder

        order = db.query(PurchaseOrder).filter(PurchaseOrder.id == document.order_id, PurchaseOrder.tenant_id == document.tenant_id).first()
        return (order.vendor if order else None), None
    if module_key in VENDOR_DOCUMENTS:
        return document.vendor, None
    if module_key == "finance_pos":
        return document.customer_organization, document.customer_contact
    if module_key == "finance_credit_notes":
        invoice = document.invoice
        return (invoice.customer_organization, invoice.customer_contact) if invoice else (None, None)
    if module_key == "inventory_deliveries":
        from app.modules.sales.models import SalesOrder

        order = db.query(SalesOrder).filter(SalesOrder.id == document.order_id, SalesOrder.tenant_id == document.tenant_id).first()
        return (order.organization, order.contact) if order else (None, None)
    return document.organization, document.contact


def _contact_name(contact) -> str:
    return " ".join(part for part in (contact.first_name, contact.last_name) if part).strip() or (contact.primary_email or "")


def document_contact_ids(db: Session, user, module_key: str, entity_id: int) -> set[int]:
    """The contacts a document's email may be filed against: its contact and its account's."""
    kind = document_pdfs.kind_for(module_key)
    document = kind.load(db, user, entity_id)
    account, contact = _people(db, document, module_key)
    ids = {contact.contact_id} if contact is not None else set()
    if account is not None:
        from app.modules.sales.models import SalesContact

        ids |= {row[0] for row in db.query(SalesContact.contact_id).filter(SalesContact.tenant_id == user.tenant_id,
                                                                            SalesContact.organization_id == account.org_id)}
    return ids


def send_context(db: Session, user, module_key: str, entity_id: int) -> dict:
    kind = document_pdfs.kind_for(module_key)
    document = kind.load(db, user, entity_id)
    account, contact = _people(db, document, module_key)
    candidates: list[dict] = []
    seen: set[str] = set()

    def offer(person, role: str | None, primary: bool = False):
        email = (person.primary_email or "").strip()
        key = email.lower()
        if not email or key in seen:
            return
        seen.add(key)
        candidates.append({"contact_id": person.contact_id, "name": _contact_name(person), "email": email, "role": role,
                           "is_primary": primary, "opted_out": bool(getattr(person, "email_opt_out", False))})

    if contact is not None:
        offer(contact, "On this document", primary=True)
    if account is not None:
        from app.modules.sales.models import SalesContact

        for person in (db.query(SalesContact).filter(SalesContact.tenant_id == user.tenant_id, SalesContact.organization_id == account.org_id,
                                                     SalesContact.deleted_at.is_(None)).order_by(SalesContact.contact_id).limit(20)):
            offer(person, None)
    setting = document_pdfs._setting(db, user.tenant_id, kind.kind)
    number = kind.number(document)
    company = document_pdfs._company(db, user.tenant_id)
    title = document_pdfs._title(db, kind, document)
    return {
        "module_key": module_key,
        "entity_id": entity_id,
        "label": f"{title} {number}" if number else title,
        "account_email": (account.primary_email if account is not None else None) or None,
        "recipients": candidates,
        "email_template_id": setting.email_template_id if setting else None,
        "subject": f"{title} {number or ''} from {company['name']}".replace("  ", " ").strip(),
        "pdf_filename": document_pdfs._filename(kind, document),
        "can_send": kind.issued(document) or module_key in SENDABLE_DRAFTS,
        "draft_reason": None if kind.issued(document) or module_key in SENDABLE_DRAFTS else "Issue it first: a draft is not sent to anyone.",
    }


def prepare(db: Session, user, module_key: str, entity_id: str | int, *, attach_pdf: bool, recipients: list[str]) -> dict:
    """Before the send: the PDF attachment and the document tokens (a quote's link included)."""
    kind = document_pdfs.kind_for(module_key)
    document = kind.load(db, user, int(entity_id))
    if not kind.issued(document) and module_key not in SENDABLE_DRAFTS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Issue it first: a draft is not sent to anyone.")
    proposal_url = None
    if module_key == "sales_quotes":
        from app.modules.sales.services.quotes_services import send_quote_proposal

        if document.status in {"expired", "declined", "superseded", "converted"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This quote is {document.status}; revise it to send a new version.")
        _proposal, path, _expires = send_quote_proposal(db, document, sent_to=", ".join(recipients) or None, current_user=user)
        proposal_url = f"{settings.FRONTEND_ORIGIN.rstrip('/')}{path}"
    attachments = []
    if attach_pdf:
        content, filename = document_pdfs.document_pdf(db, user, module_key, int(entity_id), reason="send", as_issued=True)
        attachments.append({"document_id": None, "filename": filename, "content_type": "application/pdf",
                            "size_bytes": len(content), "content": content})
    return {"attachments": attachments, "tokens": token_values(document, kind, proposal_url=proposal_url)}


def token_values(document, kind, *, proposal_url: str | None = None) -> dict[str, str]:
    def amount(*names: str) -> str:
        for name in names:
            value = getattr(document, name, None)
            if value is not None:
                return f"{Decimal(value):,.2f}"
        return ""

    def text(*names: str) -> str:
        for name in names:
            value = getattr(document, name, None)
            if value:
                return value.isoformat() if hasattr(value, "isoformat") else str(value)
        return ""

    return {
        "number": kind.number(document) or "",
        "title": kind.label,
        "currency": getattr(document, "currency", None) or "",
        "total": amount("total_amount", "grand_total", "total"),
        "balance_due": amount("balance_due", "refund_due", "credit_remaining"),
        "issue_date": text("issue_date", "bill_date", "credit_date", "shipped_on", "received_on"),
        "due_date": text("due_date", "expiry_date", "expected_date"),
        "public_link": proposal_url or "",
    }


def after_send(db: Session, user, module_key: str, entity_id: str | int, *, recipients: list[str], attached_pdf: bool) -> None:
    """Once the provider accepted the message: history, and what sending means for the type."""
    kind = document_pdfs.kind_for(module_key)
    document = kind.load(db, user, int(entity_id))
    if module_key == "sales_quotes" and document.status == "draft":
        from app.modules.sales.services.quotes_services import update_sales_quote

        from app.modules.sales.services.quotes_services import announce_status_change

        # Sending is what makes a quote sent (H14): through the ordinary update, then the event.
        update_sales_quote(db, document, {"status": "sent"})
        announce_status_change(db, document, "draft", actor=user)
    elif module_key == "purchase_orders" and document.status == "draft":
        from app.modules.purchasing.services.purchase_order_services import mark_sent

        mark_sent(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=document.id)
    number = kind.number(document) or "draft"
    log_activity(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key=module_key, entity_type=module_key,
                 entity_id=document.id, action="document.sent",
                 description=f"Sent {kind.label.lower()} {number} to {', '.join(recipients)}" + (" with its PDF" if attached_pdf else ""),
                 after_state={"recipients": recipients, "attached_pdf": attached_pdf}, commit=False)
    db.commit()


DEFAULT_TEMPLATES: dict[str, tuple[str, str]] = {
    "quote": ("Send a quote", "Hello {{contact.first_name}},\n\nPlease find our quote {{document.number}} attached, for "
              "{{document.currency}} {{document.total}}. It is valid until {{document.due_date}}.\n\nYou can review it, choose any "
              "optional items and accept or decline it here:\n{{document.public_link}}\n\nKind regards,\n{{user.full_name}}"),
    "sales_order": ("Send an order confirmation", "Hello {{contact.first_name}},\n\nThank you for your order. Our confirmation "
                    "{{document.number}} is attached.\n\nKind regards,\n{{user.full_name}}"),
    "invoice": ("Send an invoice", "Hello {{contact.first_name}},\n\nPlease find invoice {{document.number}} attached, for "
                "{{document.currency}} {{document.total}}, due on {{document.due_date}}.\n\nKind regards,\n{{user.full_name}}"),
    "credit_note": ("Send a credit note", "Hello {{contact.first_name}},\n\nPlease find credit note {{document.number}} attached, for "
                    "{{document.currency}} {{document.total}}.\n\nKind regards,\n{{user.full_name}}"),
    "purchase_order": ("Send a purchase order", "Hello,\n\nPlease find our purchase order {{document.number}} attached. Kindly "
                       "confirm the delivery date.\n\nKind regards,\n{{user.full_name}}"),
    "bill": ("Write to a vendor about a bill", "Hello,\n\nAbout your invoice recorded as {{document.number}} for {{document.currency}} "
             "{{document.total}}:\n\n\nKind regards,\n{{user.full_name}}"),
    "vendor_credit": ("Send a vendor credit", "Hello,\n\nPlease find our record of credit {{document.number}} attached, for "
                      "{{document.currency}} {{document.total}}.\n\nKind regards,\n{{user.full_name}}"),
    "delivery_note": ("Send a delivery note", "Hello {{contact.first_name}},\n\nYour order has shipped; the delivery note "
                      "{{document.number}} is attached.\n\nKind regards,\n{{user.full_name}}"),
}


def ensure_document_email_templates(db: Session, tenant_id: int) -> None:
    """One system email template per document type, set as the type's default unless an admin
    chose another (13d §3.4). Re-running changes nothing an admin edited."""
    from app.modules.platform.models import DocumentSetting, MessageTemplate

    for kind_key, (name, body) in DEFAULT_TEMPLATES.items():
        kind = document_pdfs.DOCUMENT_KINDS[kind_key]
        template_key = f"document.{kind_key}"
        template = db.query(MessageTemplate).filter(MessageTemplate.tenant_id == tenant_id, MessageTemplate.template_key == template_key).first()
        if template is None:
            template = MessageTemplate(tenant_id=tenant_id, template_key=template_key, name=name, channel="email", module_key=kind.module_key,
                                       body=body, is_system=True, is_active=True,
                                       description=f"What *Send* starts with on a {kind.label.lower()}.")
            db.add(template)
            db.flush()
        setting = db.query(DocumentSetting).filter(DocumentSetting.tenant_id == tenant_id, DocumentSetting.kind == kind_key).first()
        if setting is None:
            db.add(DocumentSetting(tenant_id=tenant_id, kind=kind_key, email_template_id=template.id))
        elif setting.email_template_id is None and setting.updated_by is None:
            setting.email_template_id = template.id
    db.flush()
