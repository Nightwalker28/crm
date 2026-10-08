from __future__ import annotations

from urllib.parse import quote

from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import get_finance_user_scope, require_department_module_access, require_role_module_action_access
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.platform.services.picklists import PicklistResolver
from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents.models import Document
from app.modules.finance.models import FinancePosInvoice
from app.modules.mail.models import MailMessage
from app.modules.platform.models import CustomModuleDefinition
from app.modules.platform.repositories import custom_modules_repository
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.sales.services.pipelines_services import opportunity_stage_facts
from app.modules.tasks.models import Task, TaskAssignee


GLOBAL_SEARCH_MODULES = (
    {
        "module_key": "tasks",
        "module_label": "Tasks",
    },
    {
        "module_key": "calendar",
        "module_label": "Calendar",
    },
    {
        "module_key": "mail",
        "module_label": "Mail",
    },
    {
        "module_key": "sales_leads",
        "module_label": "Leads",
    },
    {
        "module_key": "sales_contacts",
        "module_label": "Contacts",
    },
    {
        "module_key": "sales_organizations",
        "module_label": "Organizations",
    },
    {
        "module_key": "sales_opportunities",
        "module_label": "Opportunities",
    },
    {
        "module_key": "sales_quotes",
        "module_label": "Quotes",
    },
    {
        "module_key": "sales_orders",
        "module_label": "Orders",
    },
    {
        "module_key": "catalog_products",
        "module_label": "Products",
    },
    {
        "module_key": "catalog_services",
        "module_label": "Services",
    },
    {
        "module_key": "documents",
        "module_label": "Documents",
    },
    {
        "module_key": "finance_pos",
        "module_label": "Invoices",
    },
    {
        "module_key": "finance_credit_notes",
        "module_label": "Credit notes",
    },
    {
        "module_key": "purchase_bills",
        "module_label": "Bills",
    },
    # ERP documents (13c §3.4).
    {"module_key": "purchase_orders", "module_label": "Purchase orders"},
    {"module_key": "purchase_receipts", "module_label": "Receipts"},
    {"module_key": "inventory_deliveries", "module_label": "Deliveries"},
    {"module_key": "inventory_returns", "module_label": "Returns"},
    {"module_key": "inventory_adjustments", "module_label": "Stock adjustments"},
    {"module_key": "inventory_transfers", "module_label": "Stock transfers"},
    {"module_key": "finance_payments", "module_label": "Payments"},
    {"module_key": "purchase_vendor_returns", "module_label": "Vendor returns"},
    {"module_key": "purchase_vendor_credits", "module_label": "Vendor credits"},
)
GLOBAL_SEARCH_STATEMENT_TIMEOUT_MS = 1500


def _task_results(db: Session, *, tenant_id: int, current_user, query: str, limit: int) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(Task)
        .filter(
            Task.tenant_id == tenant_id,
            Task.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(Task.title, Task.description, Task.status, Task.priority),
        default_order_column=Task.created_at,
    )

    visibility_filters = [
        Task.created_by_user_id == current_user.id,
        Task.assignees.any(TaskAssignee.user_id == current_user.id),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(Task.assignees.any(TaskAssignee.team_id == current_user.team_id))

    items = (
        ranked
        .filter(or_(*visibility_filters))
        .order_by(Task.due_at.is_(None), Task.due_at.asc(), Task.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "module_key": "tasks",
            "module_label": "Tasks",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.status.replace("_", " ").title(), record.priority.title()] if part) or None,
            "href": f"/dashboard/tasks?taskId={record.id}",
        }
        for record in items
    ]


def _calendar_results(db: Session, *, tenant_id: int, current_user, query: str, limit: int) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            CalendarEvent.title,
            CalendarEvent.description,
            CalendarEvent.location,
            CalendarEvent.source_label,
        ),
        default_order_column=CalendarEvent.start_at,
    )

    visibility_filters = [
        CalendarEvent.owner_user_id == current_user.id,
        CalendarEvent.participants.any(
            and_(
                CalendarEventParticipant.user_id == current_user.id,
                CalendarEventParticipant.response_status != "declined",
            )
        ),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(
            CalendarEvent.participants.any(
                and_(
                    CalendarEventParticipant.team_id == current_user.team_id,
                    CalendarEventParticipant.response_status == "shared",
                )
            )
        )

    items = (
        ranked
        .filter(or_(*visibility_filters))
        .order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "module_key": "calendar",
            "module_label": "Calendar",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.location, record.source_label] if part) or None,
            "href": f"/dashboard/calendar?eventId={record.id}",
        }
        for record in items
    ]


def _mail_results(db: Session, *, tenant_id: int, current_user, query: str, limit: int) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == tenant_id,
            MailMessage.owner_user_id == current_user.id,
            MailMessage.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            MailMessage.subject,
            MailMessage.snippet,
            MailMessage.from_email,
            MailMessage.from_name,
            MailMessage.source_label,
        ),
        default_order_column=MailMessage.created_at,
    )
    items = (
        ranked
        .order_by(MailMessage.received_at.desc().nullslast(), MailMessage.sent_at.desc().nullslast(), MailMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "module_key": "mail",
            "module_label": "Mail",
            "record_id": str(record.id),
            "title": record.subject or "(no subject)",
            "subtitle": " · ".join(part for part in [record.from_email, record.source_label, record.folder] if part) or None,
            "href": f"/dashboard/mail?messageId={record.id}",
        }
        for record in items
    ]


def _contact_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesContact)
        .outerjoin(SalesOrganization, SalesOrganization.org_id == SalesContact.organization_id)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesContact.first_name,
            SalesContact.last_name,
            SalesContact.primary_email,
            SalesContact.current_title,
            SalesOrganization.org_name,
        ),
        default_order_column=SalesContact.created_time,
    )
    items = ranked.limit(limit).all()
    results: list[dict] = []
    for record in items:
        title = " ".join(part for part in [record.first_name, record.last_name] if part).strip() or record.primary_email or "Unnamed contact"
        subtitle_parts = [record.current_title, record.organization_name, record.primary_email]
        subtitle = " · ".join(part for part in subtitle_parts if part) or None
        results.append(
            {
                "module_key": "sales_contacts",
                "module_label": "Contacts",
                "record_id": str(record.contact_id),
                "title": title,
                "subtitle": subtitle,
                "href": f"/dashboard/sales/contacts/{record.contact_id}",
            }
        )
    return results


def _lead_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesLead).filter(
            SalesLead.tenant_id == tenant_id,
            SalesLead.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesLead.first_name,
            SalesLead.last_name,
            SalesLead.company,
            SalesLead.primary_email,
            SalesLead.title,
            SalesLead.source,
            SalesLead.status,
        ),
        default_order_column=SalesLead.created_time,
    )
    items = ranked.limit(limit).all()
    results: list[dict] = []
    statuses = PicklistResolver(db, tenant_id)
    for record in items:
        title = " ".join(part for part in [record.first_name, record.last_name] if part).strip() or record.primary_email or "Unnamed lead"
        status_label = statuses.label("lead_status", record.status)
        subtitle = " · ".join(part for part in [record.company, record.title, status_label] if part) or None
        results.append(
            {
                "module_key": "sales_leads",
                "module_label": "Leads",
                "record_id": str(record.lead_id),
                "title": title,
                "subtitle": subtitle,
                "href": f"/dashboard/sales/leads/{record.lead_id}",
            }
        )
    return results


def _organization_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesOrganization).filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesOrganization.org_name,
            SalesOrganization.primary_email,
            SalesOrganization.website,
            SalesOrganization.industry,
            SalesOrganization.billing_country,
        ),
        default_order_column=SalesOrganization.created_time,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_organizations",
            "module_label": "Organizations",
            "record_id": str(record.org_id),
            "title": record.org_name,
            "subtitle": " · ".join(part for part in [record.industry, record.primary_email, record.website] if part) or None,
            "href": f"/dashboard/sales/organizations/{record.org_id}",
        }
        for record in items
    ]


def _opportunity_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesOpportunity).filter(
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesOpportunity.opportunity_name,
            SalesOpportunity.sales_stage,
            SalesOpportunity.next_step,
        ),
        default_order_column=SalesOpportunity.created_time,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_opportunities",
            "module_label": "Opportunities",
            "record_id": str(record.opportunity_id),
            "title": record.opportunity_name,
            "subtitle": " · ".join(part for part in [record.organization_name, record.sales_stage and opportunity_stage_facts(record).label] if part) or None,
            "href": f"/dashboard/sales/opportunities/{record.opportunity_id}",
        }
        for record in items
    ]


def _quote_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesQuote).filter(
            SalesQuote.tenant_id == tenant_id,
            SalesQuote.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesQuote.quote_number,
            SalesQuote.title,
            SalesQuote.customer_name,
            SalesQuote.status,
            SalesQuote.currency,
        ),
        default_order_column=SalesQuote.created_time,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_quotes",
            "module_label": "Quotes",
            "record_id": str(record.quote_id),
            "title": record.quote_number,
            "subtitle": " · ".join(part for part in [record.customer_name, record.status, record.currency] if part) or None,
            "href": f"/dashboard/sales/quotes/{record.quote_id}",
        }
        for record in items
    ]


def _order_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id),
        search=query,
        document=searchable_text(SalesOrder.order_number, SalesOrder.status, SalesOrder.currency),
        default_order_column=SalesOrder.created_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_orders",
            "module_label": "Orders",
            "record_id": str(record.id),
            "title": record.order_number,
            "subtitle": " · ".join(part for part in [record.status, record.currency] if part) or None,
            "href": f"/dashboard/sales/orders/{record.id}",
        }
        for record in items
    ]


def _product_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.deleted_at.is_(None)),
        search=query,
        document=searchable_text(CatalogProduct.name, CatalogProduct.sku, CatalogProduct.description, CatalogProduct.stock_status),
        default_order_column=CatalogProduct.updated_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "catalog_products",
            "module_label": "Products",
            "record_id": str(record.id),
            "title": record.name,
            "subtitle": " · ".join(part for part in [record.sku, record.stock_status.replace("_", " ").title()] if part) or None,
            "href": f"/dashboard/catalog/products/{record.id}",
        }
        for record in items
    ]


def _service_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(CatalogService).filter(CatalogService.tenant_id == tenant_id, CatalogService.deleted_at.is_(None)),
        search=query,
        document=searchable_text(CatalogService.name, CatalogService.description, CatalogService.currency),
        default_order_column=CatalogService.updated_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "catalog_services",
            "module_label": "Services",
            "record_id": str(record.id),
            "title": record.name,
            "subtitle": " · ".join(part for part in [record.currency, "Active" if record.is_active else "Inactive"] if part) or None,
            "href": f"/dashboard/catalog/services/{record.id}",
        }
        for record in items
    ]


def _document_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(Document).filter(Document.tenant_id == tenant_id, Document.deleted_at.is_(None)),
        search=query,
        document=searchable_text(Document.title, Document.description, Document.original_filename, Document.extension),
        default_order_column=Document.updated_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "documents",
            "module_label": "Documents",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.original_filename, record.extension.upper()] if part) or None,
            "href": f"/dashboard/documents?documentId={record.id}&search={quote(record.title[:100])}",
        }
        for record in items
    ]


def _finance_pos_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.deleted_at.is_(None)),
        search=query,
        document=searchable_text(
            FinancePosInvoice.invoice_number,
            FinancePosInvoice.customer_name,
            FinancePosInvoice.customer_email,
            FinancePosInvoice.status,
            FinancePosInvoice.payment_status,
            FinancePosInvoice.notes,
        ),
        default_order_column=FinancePosInvoice.updated_at,
    )
    user_scope = get_finance_user_scope(db, current_user)
    if user_scope.user_id_filter is not None:
        ranked = ranked.filter(FinancePosInvoice.user_id == user_scope.user_id_filter)
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "finance_pos",
            "module_label": "Invoices",
            "record_id": str(record.id),
            "title": record.invoice_number or "Draft invoice",
            "subtitle": " · ".join(part for part in [record.customer_name, record.status.title(), record.currency] if part) or None,
            "href": f"/dashboard/finance/invoices/{record.id}",
        }
        for record in items
    ]


def _credit_note_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.finance.models import FinanceCreditNote
    from app.modules.finance.services.credit_note_services import _scoped

    pattern = f"%{query}%"
    rows = _scoped(db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.deleted_at.is_(None),
        or_(FinanceCreditNote.number.ilike(pattern), FinanceCreditNote.reason.ilike(pattern))), db, current_user).order_by(
        FinanceCreditNote.id.desc()).limit(limit).all()
    return [{"module_key": "finance_credit_notes", "module_label": "Credit notes", "record_id": str(row.id),
             "title": row.number or "Draft credit note", "subtitle": " · ".join(part for part in [row.reason, row.status.title()] if part) or None,
             "href": f"/dashboard/finance/credit-notes/{row.id}"} for row in rows]


def _bill_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.purchasing.models import PurchaseBill

    pattern = f"%{query}%"
    rows = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == tenant_id, PurchaseBill.deleted_at.is_(None),
        or_(PurchaseBill.number.ilike(pattern), PurchaseBill.vendor_invoice_number.ilike(pattern),
            PurchaseBill.vendor_id.in_(_vendor_ids(db, tenant_id=tenant_id, pattern=pattern)))).order_by(PurchaseBill.id.desc()).limit(limit).all()
    return [{"module_key": "purchase_bills", "module_label": "Bills", "record_id": str(row.id), "title": row.number,
             "subtitle": " · ".join(part for part in [row.vendor.org_name if row.vendor else None, row.vendor_invoice_number, row.status.title()] if part) or None,
             "href": f"/dashboard/purchasing/bills/{row.id}"} for row in rows]


def _vendor_ids(db: Session, *, tenant_id: int, pattern: str):
    """Accounts whose name matches, as a subquery: a document found by its vendor or customer."""
    return db.query(SalesOrganization.org_id).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_name.ilike(pattern))


def _order_ids(db: Session, *, tenant_id: int, pattern: str):
    """Sales orders matching by number or by their account's name."""
    return db.query(SalesOrder.id).filter(SalesOrder.tenant_id == tenant_id, or_(
        SalesOrder.order_number.ilike(pattern), SalesOrder.organization_id.in_(_vendor_ids(db, tenant_id=tenant_id, pattern=pattern))))


def _subtitle(*parts) -> str | None:
    return " · ".join(part for part in parts if part) or None


def _purchase_order_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.purchasing.models import PurchaseOrder

    pattern = f"%{query}%"
    rows = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.deleted_at.is_(None), or_(
        PurchaseOrder.number.ilike(pattern), PurchaseOrder.vendor_reference.ilike(pattern),
        PurchaseOrder.vendor_id.in_(_vendor_ids(db, tenant_id=tenant_id, pattern=pattern)))).order_by(PurchaseOrder.id.desc()).limit(limit).all()
    return [{"module_key": "purchase_orders", "module_label": "Purchase orders", "record_id": str(row.id), "title": row.number,
             "subtitle": _subtitle(row.vendor.org_name if row.vendor else None, row.vendor_reference, row.status.title()),
             "href": f"/dashboard/purchasing/orders/{row.id}"} for row in rows]


def _receipt_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt

    pattern = f"%{query}%"
    orders = db.query(PurchaseOrder.id).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.number.ilike(pattern))
    rows = db.query(PurchaseReceipt).filter(PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.deleted_at.is_(None), or_(
        PurchaseReceipt.number.ilike(pattern), PurchaseReceipt.vendor_delivery_ref.ilike(pattern),
        PurchaseReceipt.order_id.in_(orders))).order_by(PurchaseReceipt.id.desc()).limit(limit).all()
    return [{"module_key": "purchase_receipts", "module_label": "Receipts", "record_id": str(row.id), "title": row.number,
             "subtitle": _subtitle(row.vendor_delivery_ref, row.status.title()),
             "href": f"/dashboard/purchasing/receipts/{row.id}"} for row in rows]


def _delivery_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.inventory.models import InventoryDelivery

    pattern = f"%{query}%"
    rows = db.query(InventoryDelivery).filter(InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.deleted_at.is_(None), or_(
        InventoryDelivery.number.ilike(pattern), InventoryDelivery.tracking_number.ilike(pattern),
        InventoryDelivery.order_id.in_(_order_ids(db, tenant_id=tenant_id, pattern=pattern)))).order_by(InventoryDelivery.id.desc()).limit(limit).all()
    return [{"module_key": "inventory_deliveries", "module_label": "Deliveries", "record_id": str(row.id), "title": row.number,
             "subtitle": _subtitle(row.carrier, row.tracking_number, row.status.title()),
             "href": f"/dashboard/inventory/deliveries/{row.id}"} for row in rows]


def _return_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.inventory.models import InventoryReturn

    pattern = f"%{query}%"
    rows = db.query(InventoryReturn).filter(InventoryReturn.tenant_id == tenant_id, InventoryReturn.deleted_at.is_(None), or_(
        InventoryReturn.number.ilike(pattern), InventoryReturn.reason.ilike(pattern),
        InventoryReturn.order_id.in_(_order_ids(db, tenant_id=tenant_id, pattern=pattern)))).order_by(InventoryReturn.id.desc()).limit(limit).all()
    return [{"module_key": "inventory_returns", "module_label": "Returns", "record_id": str(row.id), "title": row.number,
             "subtitle": _subtitle(row.reason, row.status.title()),
             "href": f"/dashboard/inventory/returns/{row.id}"} for row in rows]


def _inventory_document_results(kind: str):
    def search(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
        from app.modules.inventory.services.document_services import document_model, list_query

        label = "Stock adjustments" if kind == "adjustments" else "Stock transfers"
        rows = list_query(db, tenant_id=tenant_id, kind=kind, search=query)
        model = document_model(kind)
        return [{"module_key": f"inventory_{kind}", "module_label": label, "record_id": str(row.id), "title": row.number,
                 "subtitle": _subtitle(getattr(row, "reason", None), row.status.title()),
                 "href": f"/dashboard/inventory/{kind}/{row.id}"} for row in rows.order_by(model.id.desc()).limit(limit).all()]

    return search


def _payment_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    from app.modules.finance.models import FinancePayment
    from app.modules.finance.services.payment_services import _scoped

    pattern = f"%{query}%"
    rows = _scoped(db.query(FinancePayment).filter(FinancePayment.tenant_id == tenant_id, or_(
        FinancePayment.number.ilike(pattern), FinancePayment.party_name.ilike(pattern), FinancePayment.reference.ilike(pattern))),
        db, current_user).order_by(FinancePayment.id.desc()).limit(limit).all()
    return [{"module_key": "finance_payments", "module_label": "Payments", "record_id": str(row.id), "title": row.number,
             "subtitle": _subtitle(row.party_name, "Received" if row.direction == "received" else "Made", row.status.title()),
             "href": f"/dashboard/finance/payments/{row.id}"} for row in rows]


def _vendor_document_results(module_key: str):
    def search(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
        if module_key == "purchase_vendor_returns":
            from app.modules.purchasing.models import PurchaseVendorReturn as Model
            from app.modules.purchasing.services.vendor_return_services import list_query
            label, path = "Vendor returns", "/dashboard/purchasing/vendor-returns"
        else:
            from app.modules.purchasing.models import PurchaseVendorCredit as Model
            from app.modules.purchasing.services.vendor_credit_services import list_query
            label, path = "Vendor credits", "/dashboard/purchasing/vendor-credits"
        rows = list_query(db, tenant_id=tenant_id, search=query).order_by(Model.id.desc()).limit(limit).all()
        return [{"module_key": module_key, "module_label": label, "record_id": str(row.id), "title": row.number or "Draft vendor credit",
                 "subtitle": _subtitle(row.vendor.org_name if row.vendor else None, row.status.title()),
                 "href": f"{path}/{row.id}"} for row in rows]

    return search


def _custom_module_results(db: Session, *, current_user, query: str, limit: int) -> list[dict]:
    definitions = (
        db.query(CustomModuleDefinition)
        .options(selectinload(CustomModuleDefinition.module))
        .filter(
            CustomModuleDefinition.tenant_id == current_user.tenant_id,
            CustomModuleDefinition.is_active.is_(True),
            CustomModuleDefinition.deleted_at.is_(None),
        )
        .order_by(CustomModuleDefinition.name.asc())
        .all()
    )
    results: list[dict] = []
    for definition in definitions:
        if definition.module is None:
            continue
        try:
            require_department_module_access(db, user=current_user, module_key=definition.module.name)
            require_role_module_action_access(db, user=current_user, module_key=definition.module.name, action="view")
        except PermissionError:
            continue
        records = (
            custom_modules_repository.apply_record_sort(
                custom_modules_repository.build_records_query(db, definition=definition, search=query)
            )
            .limit(limit)
            .all()
        )
        results.extend(
            {
                "module_key": definition.key,
                "module_label": definition.name,
                "record_id": str(record.id),
                "title": record.title,
                "subtitle": definition.name,
                "href": f"/dashboard/custom/{definition.key}/{record.id}",
            }
            for record in records
        )
    return results


SEARCH_BUILDERS = {
    "tasks": _task_results,
    "calendar": _calendar_results,
    "mail": _mail_results,
    "sales_leads": _lead_results,
    "sales_contacts": _contact_results,
    "sales_organizations": _organization_results,
    "sales_opportunities": _opportunity_results,
    "sales_quotes": _quote_results,
    "sales_orders": _order_results,
    "catalog_products": _product_results,
    "catalog_services": _service_results,
    "documents": _document_results,
    "finance_pos": _finance_pos_results,
    "finance_credit_notes": _credit_note_results,
    "purchase_bills": _bill_results,
    "purchase_orders": _purchase_order_results,
    "purchase_receipts": _receipt_results,
    "inventory_deliveries": _delivery_results,
    "inventory_returns": _return_results,
    "inventory_adjustments": _inventory_document_results("adjustments"),
    "inventory_transfers": _inventory_document_results("transfers"),
    "finance_payments": _payment_results,
    "purchase_vendor_returns": _vendor_document_results("purchase_vendor_returns"),
    "purchase_vendor_credits": _vendor_document_results("purchase_vendor_credits"),
}


def list_global_search_results(
    db: Session,
    *,
    current_user,
    query: str,
    limit_per_module: int = 5,
) -> list[dict]:
    normalized_query = query.strip()
    if not normalized_query:
        return []

    uses_statement_timeout = bool(
        getattr(getattr(db, "bind", None), "dialect", None)
        and db.bind.dialect.name == "postgresql"
    )
    if uses_statement_timeout:
        db.execute(text(f"SET LOCAL statement_timeout = {GLOBAL_SEARCH_STATEMENT_TIMEOUT_MS}"))

    try:
        results: list[dict] = []
        for module in GLOBAL_SEARCH_MODULES:
            module_key = module["module_key"]
            try:
                require_department_module_access(db, user=current_user, module_key=module_key)
                require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
            except PermissionError:
                continue
            builder = SEARCH_BUILDERS[module_key]
            results.extend(
                builder(
                    db,
                    tenant_id=current_user.tenant_id,
                    current_user=current_user,
                    query=normalized_query,
                    limit=limit_per_module,
                )
            )
        results.extend(
            _custom_module_results(
                db,
                current_user=current_user,
                query=normalized_query,
                limit=limit_per_module,
            )
        )
        return results
    finally:
        if uses_statement_timeout:
            db.execute(text("SET LOCAL statement_timeout = DEFAULT"))
