from sqlalchemy.orm import Session

from app.core.pagination import Pagination, build_paged_response
from app.modules.catalog.schema import CatalogProductResponse, CatalogServiceResponse
from app.modules.catalog.services.product_services import (
    get_product_or_404,
    list_deleted_products,
    restore_product,
    serialize_product,
)
from app.modules.catalog.services.service_services import (
    get_service_or_404,
    list_deleted_services,
    restore_service,
    serialize_service,
)
from app.modules.finance.services.io_search_services import (
    _finance_record_customer_name,
    _serialize_finance_record_state,
    get_deleted_insertion_order_or_404,
    get_finance_module_id,
    list_deleted_insertion_orders,
    restore_insertion_order,
)
from app.modules.documents.schema import DocumentResponse
from app.modules.documents.services.document_services import list_deleted_documents, restore_document
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services import custom_modules
from app.modules.sales.services.contacts_services import (
    get_contact_or_404,
    list_deleted_sales_contacts,
    restore_sales_contact,
)
from app.modules.sales.services.leads_services import (
    get_lead_or_404,
    list_deleted_sales_leads,
    restore_sales_lead,
)
from app.modules.sales.services.organizations_services import (
    get_organization,
    list_deleted_organizations_paginated,
    restore_organization,
)
from app.modules.sales.services.opportunities_services import (
    get_opportunity_or_404,
    list_deleted_opportunities,
    restore_opportunity,
)
from app.modules.sales.schema import SalesContactResponse, SalesLeadResponse, SalesOrganizationResponse
from app.modules.sales.schema import SalesOpportunityResponse
from app.modules.calendar.services.calendar_services import (
    get_calendar_event_or_404,
    list_deleted_calendar_events,
    restore_calendar_event,
    serialize_calendar_event,
)
from app.modules.tasks.services.tasks_services import (
    get_task_or_404,
    list_deleted_tasks,
    restore_task,
    serialize_task,
)


SUPPORTED_RECYCLE_MODULES = {
    "finance_insertion_orders",
    "sales_leads",
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
    "calendar",
    "tasks",
    "documents",
    "catalog_products",
    "catalog_services",
}


def list_recycle_items(
    db: Session,
    *,
    pagination: Pagination,
    module_key: str,
    tenant_id: int,
):
    if module_key == "finance_insertion_orders":
        module_id = get_finance_module_id(db)
        items, total = list_deleted_insertion_orders(
            db,
            tenant_id=tenant_id,
            module_id=module_id,
            pagination=pagination,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.io_number,
                "subtitle": _finance_record_customer_name(item),
                "deleted_at": item.deleted_at,
                "details": _serialize_finance_record_state(item),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "sales_contacts":
        items, total = list_deleted_sales_contacts(db, tenant_id, pagination)
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.contact_id,
                "title": " ".join([part for part in (item.first_name, item.last_name) if part]).strip() or item.primary_email,
                "subtitle": item.primary_email,
                "deleted_at": item.deleted_at,
                "details": SalesContactResponse.model_validate(item).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "sales_leads":
        items, total = list_deleted_sales_leads(db, tenant_id, pagination)
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.lead_id,
                "title": " ".join([part for part in (item.first_name, item.last_name) if part]).strip() or item.primary_email,
                "subtitle": item.company or item.status or item.primary_email,
                "deleted_at": item.deleted_at,
                "details": SalesLeadResponse.model_validate(item).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "sales_organizations":
        items, total = list_deleted_organizations_paginated(
            db,
            tenant_id=tenant_id,
            offset=pagination.offset,
            limit=pagination.limit,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.org_id,
                "title": item.org_name,
                "subtitle": item.primary_email or item.website or "Organization",
                "deleted_at": item.deleted_at,
                "details": SalesOrganizationResponse.model_validate(item).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "sales_opportunities":
        items, total = list_deleted_opportunities(db, tenant_id, pagination)
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.opportunity_id,
                "title": item.opportunity_name,
                "subtitle": item.client or item.sales_stage or "Opportunity",
                "deleted_at": item.deleted_at,
                "details": SalesOpportunityResponse.model_validate(item).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "tasks":
        items, total = list_deleted_tasks(
            db,
            tenant_id=tenant_id,
            pagination=pagination,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.title,
                "subtitle": item.assigned_by.email if getattr(item, "assigned_by", None) and item.assigned_by.email else item.status,
                "deleted_at": item.deleted_at,
                "details": serialize_task(item),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "calendar":
        items, total = list_deleted_calendar_events(
            db,
            tenant_id=tenant_id,
            pagination=pagination,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.title,
                "subtitle": item.source_label or item.location or "Calendar event",
                "deleted_at": item.deleted_at,
                "details": serialize_calendar_event(item, current_user=item.owner),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "documents":
        items, total = list_deleted_documents(
            db,
            tenant_id=tenant_id,
            pagination=pagination,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.title,
                "subtitle": item.original_filename,
                "deleted_at": item.deleted_at,
                "details": DocumentResponse.model_validate(item).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "catalog_products":
        items, total = list_deleted_products(
            db,
            tenant_id=tenant_id,
            offset=pagination.offset,
            limit=pagination.limit,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.name,
                "subtitle": item.sku or item.stock_status,
                "deleted_at": item.deleted_at,
                "details": CatalogProductResponse.model_validate(serialize_product(item)).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if module_key == "catalog_services":
        items, total = list_deleted_services(
            db,
            tenant_id=tenant_id,
            offset=pagination.offset,
            limit=pagination.limit,
        )
        serialized = [
            {
                "module_key": module_key,
                "record_id": item.id,
                "title": item.name,
                "subtitle": item.description or "Service",
                "deleted_at": item.deleted_at,
                "details": CatalogServiceResponse.model_validate(serialize_service(item)).model_dump(mode="json"),
            }
            for item in items
        ]
        return build_paged_response(serialized, total_count=total, pagination=pagination)

    if custom_modules.is_custom_module_key(db, tenant_id=tenant_id, module_key=module_key):
        return custom_modules.list_deleted_records_for_recycle(
            db,
            tenant_id=tenant_id,
            module_key=module_key,
            pagination=pagination,
        )

    raise ValueError("Unsupported recycle module")


def restore_recycle_item(
    db: Session,
    *,
    module_key: str,
    record_id: int,
    current_user,
):
    if module_key == "finance_insertion_orders":
        module_id = get_finance_module_id(db)
        record = get_deleted_insertion_order_or_404(
            db,
            tenant_id=current_user.tenant_id,
            module_id=module_id,
            io_id=record_id,
        )
        restored = restore_insertion_order(db, record=record)
        serialized = _serialize_finance_record_state(restored, current_user=current_user)
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="finance_insertion_order",
            entity_id=restored.id,
            action="restore",
            description=f"Restored insertion order {restored.io_number} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "sales_contacts":
        contact = get_contact_or_404(db, record_id, tenant_id=current_user.tenant_id, include_deleted=True)
        restored = restore_sales_contact(db, contact)
        serialized = SalesContactResponse.model_validate(restored).model_dump(mode="json")
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="sales_contact",
            entity_id=restored.contact_id,
            action="restore",
            description=f"Restored contact {restored.primary_email} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "sales_leads":
        lead = get_lead_or_404(db, record_id, tenant_id=current_user.tenant_id, include_deleted=True)
        restored = restore_sales_lead(db, lead)
        serialized = SalesLeadResponse.model_validate(restored).model_dump(mode="json")
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="sales_lead",
            entity_id=restored.lead_id,
            action="restore",
            description=f"Restored lead {restored.primary_email} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "sales_organizations":
        restored = restore_organization(db, record_id, tenant_id=current_user.tenant_id)
        if not restored:
            raise ValueError("Deleted organization not found")
        serialized = SalesOrganizationResponse.model_validate(restored).model_dump(mode="json")
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="sales_organization",
            entity_id=restored.org_id,
            action="restore",
            description=f"Restored organization {restored.org_name} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "sales_opportunities":
        opportunity = get_opportunity_or_404(db, record_id, tenant_id=current_user.tenant_id, include_deleted=True)
        restored = restore_opportunity(db, opportunity)
        serialized = SalesOpportunityResponse.model_validate(restored).model_dump(mode="json")
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="sales_opportunity",
            entity_id=restored.opportunity_id,
            action="restore",
            description=f"Restored opportunity {restored.opportunity_name} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "tasks":
        task = get_task_or_404(
            db,
            record_id,
            tenant_id=current_user.tenant_id,
            current_user=current_user,
            include_deleted=True,
        )
        restored = restore_task(db, task=task, current_user=current_user)
        serialized = serialize_task(restored)
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="task",
            entity_id=restored.id,
            action="restore",
            description=f"Restored task {restored.title} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "calendar":
        event = get_calendar_event_or_404(
            db,
            record_id,
            tenant_id=current_user.tenant_id,
            current_user=current_user,
            include_deleted=True,
            bypass_visibility=True,
        )
        restored = restore_calendar_event(db, event=event)
        serialized = serialize_calendar_event(restored, current_user=current_user)
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=module_key,
            entity_type="calendar_event",
            entity_id=restored.id,
            action="restore",
            description=f"Restored calendar event {restored.title} from recycle bin",
            after_state=serialized,
        )
        return serialized

    if module_key == "documents":
        restored = restore_document(
            db,
            tenant_id=current_user.tenant_id,
            document_id=record_id,
            current_user=current_user,
        )
        return DocumentResponse.model_validate(restored).model_dump(mode="json")

    if module_key == "catalog_products":
        product = get_product_or_404(
            db,
            tenant_id=current_user.tenant_id,
            product_id=record_id,
            include_deleted=True,
        )
        restored = restore_product(
            db,
            product=product,
            actor_user_id=current_user.id if current_user else None,
        )
        return CatalogProductResponse.model_validate(serialize_product(restored)).model_dump(mode="json")

    if module_key == "catalog_services":
        service = get_service_or_404(
            db,
            tenant_id=current_user.tenant_id,
            service_id=record_id,
            include_deleted=True,
        )
        restored = restore_service(
            db,
            service=service,
            actor_user_id=current_user.id if current_user else None,
        )
        return CatalogServiceResponse.model_validate(serialize_service(restored)).model_dump(mode="json")

    if custom_modules.is_custom_module_key(db, tenant_id=current_user.tenant_id, module_key=module_key):
        return custom_modules.restore_record(
            db,
            module_key=module_key,
            record_id=record_id,
            current_user=current_user,
        ).model_dump(mode="json")

    raise ValueError("Unsupported recycle module")
