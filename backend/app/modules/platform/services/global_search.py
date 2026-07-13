from __future__ import annotations

from urllib.parse import quote

from sqlalchemy import and_, or_, text
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import get_finance_user_scope, require_department_module_access, require_role_module_action_access
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.contracts.models import Contract
from app.modules.documents.models import Document
from app.modules.finance.models import FinanceIO, FinancePosInvoice
from app.modules.mail.models import MailMessage
from app.modules.platform.models import CustomModuleDefinition
from app.modules.platform.repositories import custom_modules_repository
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.support.models import SupportCase
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
        "module_key": "contracts",
        "module_label": "Contracts",
    },
    {
        "module_key": "documents",
        "module_label": "Documents",
    },
    {
        "module_key": "support_cases",
        "module_label": "Support Cases",
    },
    {
        "module_key": "finance_io",
        "module_label": "Insertion Orders",
    },
    {
        "module_key": "finance_pos",
        "module_label": "POS",
    },
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
    for record in items:
        title = " ".join(part for part in [record.first_name, record.last_name] if part).strip() or record.primary_email or "Unnamed lead"
        subtitle = " · ".join(part for part in [record.company, record.title, record.status] if part) or None
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
            SalesOpportunity.client,
            SalesOpportunity.sales_stage,
            SalesOpportunity.target_geography,
            SalesOpportunity.target_audience,
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
            "subtitle": " · ".join(part for part in [record.client, record.sales_stage, record.target_geography] if part) or None,
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


def _contract_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(Contract).filter(Contract.tenant_id == tenant_id),
        search=query,
        document=searchable_text(Contract.contract_number, Contract.title, Contract.status, Contract.currency),
        default_order_column=Contract.updated_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "contracts",
            "module_label": "Contracts",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.contract_number, record.status.replace("_", " ").title()] if part) or None,
            "href": f"/dashboard/contracts/{record.id}",
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


def _support_case_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SupportCase).filter(SupportCase.tenant_id == tenant_id),
        search=query,
        document=searchable_text(
            SupportCase.case_number,
            SupportCase.subject,
            SupportCase.description,
            SupportCase.status,
            SupportCase.priority,
        ),
        default_order_column=SupportCase.updated_at,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "support_cases",
            "module_label": "Support Cases",
            "record_id": str(record.id),
            "title": record.subject,
            "subtitle": " · ".join(part for part in [record.case_number, record.priority.title(), record.status.title()] if part) or None,
            "href": f"/dashboard/support/cases/{record.id}",
        }
        for record in items
    ]


def _finance_io_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(FinanceIO).filter(FinanceIO.tenant_id == tenant_id, FinanceIO.deleted_at.is_(None)),
        search=query,
        document=searchable_text(
            FinanceIO.io_number,
            FinanceIO.customer_name,
            FinanceIO.external_reference,
            FinanceIO.counterparty_reference,
            FinanceIO.status,
            FinanceIO.notes,
        ),
        default_order_column=FinanceIO.updated_at,
    )
    user_scope = get_finance_user_scope(db, current_user)
    if user_scope.user_id_filter is not None:
        ranked = ranked.filter(FinanceIO.user_id == user_scope.user_id_filter)
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "finance_io",
            "module_label": "Insertion Orders",
            "record_id": str(record.id),
            "title": record.io_number,
            "subtitle": " · ".join(part for part in [record.customer_name, record.status.title(), record.currency] if part) or None,
            "href": f"/dashboard/finance/insertion-orders/{record.id}",
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
            "module_label": "POS",
            "record_id": str(record.id),
            "title": record.invoice_number,
            "subtitle": " · ".join(part for part in [record.customer_name, record.payment_status.title(), record.currency] if part) or None,
            "href": f"/dashboard/finance/pos?invoiceId={record.id}",
        }
        for record in items
    ]


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
    "contracts": _contract_results,
    "documents": _document_results,
    "support_cases": _support_case_results,
    "finance_io": _finance_io_results,
    "finance_pos": _finance_pos_results,
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
