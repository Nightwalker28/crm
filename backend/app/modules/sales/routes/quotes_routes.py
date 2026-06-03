from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, count_csv_rows_bytes, parse_mapping_json, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest
from app.modules.platform.services.activity_logs import safe_log_activity as log_activity
from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event, safe_publish_crm_event
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job, enqueue_import_job, persist_job_upload, should_background_data_transfer_with_size
from app.modules.platform.services.module_fields import enabled_module_fields, enabled_module_field_sequence, reject_disabled_field_writes, sanitize_data_transfer_export_payload, sanitize_disabled_field_payload, sanitize_disabled_filter_conditions
from app.modules.sales.schema import (
    FollowUpActionRequest,
    FollowUpActionResponse,
    QuoteSummaryResponse,
    SalesQuoteCreateRequest,
    SalesQuoteListItem,
    SalesQuoteListResponse,
    SalesQuoteProposalDocumentResponse,
    SalesQuoteProposalEventsResponse,
    SalesQuoteProposalPublicEventRequest,
    SalesQuoteProposalPublicResponse,
    SalesQuoteProposalSendRequest,
    SalesQuoteProposalSendResponse,
    SalesQuoteConvertToOrderRequest,
    SalesOrderResponse,
    SalesQuoteResponse,
    SalesQuoteUpdateRequest,
)
from app.modules.sales.services.followups import log_quote_follow_up
from app.modules.sales.services.orders_services import convert_quote_to_order
from app.modules.sales.services.quotes_services import (
    EXPORT_COLUMNS,
    create_sales_quote,
    delete_sales_quote,
    generate_quote_proposal,
    get_public_quote_proposal_or_404,
    get_quote_or_404,
    import_quotes_from_csv,
    list_deleted_sales_quotes,
    list_quote_proposal_events,
    list_sales_quotes,
    list_sales_quotes_cursor,
    record_quote_proposal_event,
    restore_sales_quote,
    send_quote_proposal,
    update_sales_quote,
)
from app.modules.sales.services.summary_services import build_quote_summary
from app.modules.user_management.services import admin_modules

router = APIRouter(prefix="/quotes", tags=["Sales"])

QUOTE_LIST_FIELDS = {
    "quote_number", "title", "customer_name", "contact_id", "organization_id", "opportunity_id", "status", "issue_date", "expiry_date",
    "currency", "subtotal_amount", "discount_amount", "tax_amount", "total_amount", "assigned_to", "created_time", "updated_at",
}
QUOTE_IMPORT_TARGET_FIELDS = [
    "quote_number", "title", "customer_name", "contact_id", "organization_id", "opportunity_id", "status", "currency",
    "subtotal_amount", "discount_amount", "tax_amount", "total_amount", "notes", "assigned_to",
]
QUOTE_IMPORT_ALIASES = {
    "quote_number": ["quote number", "quote no", "quote id"],
    "title": ["quote title", "subject"],
    "customer_name": ["customer", "client", "account", "customer name"],
    "contact_id": ["contact", "contact id"],
    "organization_id": ["organization", "organization id", "account id"],
    "opportunity_id": ["deal", "deal id", "opportunity", "opportunity id"],
    "status": ["quote status", "status"],
    "currency": ["currency"],
    "subtotal_amount": ["subtotal", "subtotal amount"],
    "discount_amount": ["discount", "discount amount"],
    "tax_amount": ["tax", "tax amount"],
    "total_amount": ["total", "total amount", "amount"],
    "notes": ["note", "notes"],
    "assigned_to": ["owner", "assignee", "assigned to"],
}


def _serialize_quote(quote) -> dict:
    return SalesQuoteResponse.model_validate(quote).model_dump(mode="json")


def _display_quote_name(quote) -> str:
    return getattr(quote, "quote_number", None) or getattr(quote, "title", None) or "Quote"


def _parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields


def _enabled_quote_list_fields(db: Session, tenant_id: int) -> set[str]:
    return enabled_module_fields(db, tenant_id=tenant_id, module_key="sales_quotes", field_keys=QUOTE_LIST_FIELDS)


def _enabled_quote_import_fields(db: Session, tenant_id: int) -> list[str]:
    return enabled_module_field_sequence(db, tenant_id=tenant_id, module_key="sales_quotes", field_keys=QUOTE_IMPORT_TARGET_FIELDS)


def _serialize_quote_list_item(quote, fields: set[str]) -> SalesQuoteListItem:
    payload = {"quote_id": quote.quote_id, "quote_number": quote.quote_number, "customer_name": quote.customer_name}
    for field in fields:
        payload[field] = getattr(quote, field, None)
    payload["custom_fields"] = getattr(quote, "custom_data", None)
    return SalesQuoteListItem.model_validate(payload)


def _parse_filters(db: Session, tenant_id: int, filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=tenant_id, module_key="sales_quotes", conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=tenant_id, module_key="sales_quotes", conditions=any_conditions)
    return all_conditions, any_conditions


@router.get("", response_model=SalesQuoteListResponse)
def list_quotes(fields: str | None = Query(default=None), sort_by: str | None = Query(default=None), sort_direction: str | None = Query(default=None), filter_logic: str = Query(default="all"), filters: str | None = Query(default=None), filters_all: str | None = Query(default=None), filters_any: str | None = Query(default=None), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    quotes, total_count = list_sales_quotes(db, current_user.tenant_id, pagination, all_filter_conditions=all_conditions, any_filter_conditions=any_conditions, sort_by=sort_by, sort_direction=sort_direction)
    selected_fields = _parse_list_fields(fields, _enabled_quote_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_quote_list_item(quote, selected_fields) for quote in quotes], total_count, pagination)


@router.get("/cursor")
def list_quotes_cursor(fields: str | None = Query(default=None), filter_logic: str = Query(default="all"), filters: str | None = Query(default=None), filters_all: str | None = Query(default=None), filters_any: str | None = Query(default=None), pagination: CursorPagination = Depends(get_cursor_pagination), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    quotes = list_sales_quotes_cursor(db, current_user.tenant_id, limit=pagination.limit, cursor=pagination.cursor, all_filter_conditions=all_conditions, any_filter_conditions=any_conditions)
    selected_fields = _parse_list_fields(fields, _enabled_quote_list_fields(db, current_user.tenant_id))
    return build_cursor_response([_serialize_quote_list_item(quote, selected_fields) for quote in quotes], limit=pagination.limit, id_attr="quote_id")


@router.get("/search", response_model=SalesQuoteListResponse)
def search_quotes(query: str = Query(..., min_length=1), fields: str | None = Query(default=None), sort_by: str | None = Query(default=None), sort_direction: str | None = Query(default=None), filter_logic: str = Query(default="all"), filters: str | None = Query(default=None), filters_all: str | None = Query(default=None), filters_any: str | None = Query(default=None), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    quotes, total_count = list_sales_quotes(db, current_user.tenant_id, pagination, search=query, all_filter_conditions=all_conditions, any_filter_conditions=any_conditions, sort_by=sort_by, sort_direction=sort_direction)
    selected_fields = _parse_list_fields(fields, _enabled_quote_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_quote_list_item(quote, selected_fields) for quote in quotes], total_count, pagination)


@router.get("/recycle", response_model=SalesQuoteListResponse)
def list_deleted_quotes(pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "restore"))):
    quotes, total_count = list_deleted_sales_quotes(db, current_user.tenant_id, pagination)
    return build_paged_response([SalesQuoteResponse.model_validate(quote) for quote in quotes], total_count, pagination)


@router.post("", response_model=SalesQuoteResponse, status_code=status.HTTP_201_CREATED)
def create_quote(payload: SalesQuoteCreateRequest, replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "create"))):
    submitted_fields = set(payload.model_fields_set) - {"custom_fields"}
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", field_keys=submitted_fields)
    sanitized_payload = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", payload=payload.model_dump())
    created = create_sales_quote(db, sanitized_payload, current_user, replace_duplicates, skip_duplicates, create_new_records)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=created.quote_id, action="create", description=f"Created quote {_display_quote_name(created)}", after_state=_serialize_quote(created))
    safe_emit_crm_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        event_type="quote.created",
        entity_type="sales_quote",
        entity_id=created.quote_id,
        payload={
            **actor_payload(current_user),
            "quote_id": created.quote_id,
            "quote_number": created.quote_number,
            "customer_name": created.customer_name,
            "status": created.status,
            "total_amount": str(created.total_amount),
            "href": f"/dashboard/sales/quotes/{created.quote_id}",
        },
    )
    return created


@router.post("/import", response_model=ImportExecutionResponse)
async def import_quotes(file: UploadFile = File(...), mapping_json: str | None = Form(default=None), duplicate_mode: str | None = Query(default=None), replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "create"))):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    target_headers = _enabled_quote_import_fields(db, current_user.tenant_id)
    mapping = parse_mapping_json(mapping_json, target_headers=target_headers)
    remapped_file_bytes = remap_csv_bytes(file_bytes, target_headers=target_headers, mapping=mapping)
    row_count = count_csv_rows_bytes(remapped_file_bytes)
    if should_background_data_transfer_with_size(row_count=row_count, file_size_bytes=len(remapped_file_bytes)):
        job = create_data_transfer_job(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key="sales_quotes", operation_type="import", payload={"filename": file.filename, "row_count": row_count, "duplicate_mode": duplicate_mode or admin_modules.get_module_duplicate_mode(db, "sales_quotes", tenant_id=current_user.tenant_id)})
        stored_path = persist_job_upload(job_id=job.id, filename="quotes-import.csv", file_bytes=remapped_file_bytes)
        job.payload = {**(job.payload or {}), "source_file_path": stored_path}
        db.add(job)
        db.commit()
        db.refresh(job)
        enqueue_import_job(job.id)
        return ImportExecutionResponse(mode="background", message=f"Import queued in background as job #{job.id}.", job_id=job.id, job_status=job.status)
    summary = import_quotes_from_csv(db, remapped_file_bytes, tenant_id=current_user.tenant_id, default_assigned_to=current_user.id, duplicate_mode=duplicate_mode, default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "sales_quotes", tenant_id=current_user.tenant_id), replace_duplicates=replace_duplicates, skip_duplicates=skip_duplicates, create_new_records=create_new_records)
    return ImportExecutionResponse(mode="inline", message=summary["message"], summary=StandardImportSummary(**summary))


@router.post("/import/preview")
async def preview_quote_import(file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "create"))):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(file_bytes)
    return {"source_headers": source_headers, "target_headers": _enabled_quote_import_fields(db, current_user.tenant_id), "required_headers": ["customer_name"], "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "sales_quotes", tenant_id=current_user.tenant_id), "suggested_mapping": suggest_header_mapping(source_headers=source_headers, target_headers=_enabled_quote_import_fields(db, current_user.tenant_id), aliases=QUOTE_IMPORT_ALIASES)}


@router.post("/export", response_model=DataTransferExecutionResponse)
def export_quotes(payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "export"))):
    sanitized_payload = sanitize_data_transfer_export_payload(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", payload=payload.model_dump(), export_field_keys=EXPORT_COLUMNS)
    job = create_data_transfer_job(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", operation_type="export", payload=sanitized_payload)
    enqueue_export_job(job.id)
    return DataTransferExecutionResponse(mode="background", message=f"Export queued in background as job #{job.id}.", job_id=job.id, job_status=job.status)


@router.get("/proposal/public/{token}", response_model=SalesQuoteProposalPublicResponse)
def view_public_quote_proposal(token: str, request: Request, db: Session = Depends(get_db)):
    proposal, quote = get_public_quote_proposal_or_404(db, token)
    record_quote_proposal_event(
        db,
        proposal=proposal,
        event_type="viewed",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {
        "quote_number": quote.quote_number,
        "customer_name": quote.customer_name,
        "title": proposal.title,
        "content_text": proposal.content_text,
        "currency": quote.currency,
        "total_amount": quote.total_amount,
        "expiry_date": quote.expiry_date,
    }


@router.post("/proposal/public/{token}/events", response_model=SalesQuoteProposalEventsResponse)
def record_public_quote_proposal_event(token: str, payload: SalesQuoteProposalPublicEventRequest, request: Request, db: Session = Depends(get_db)):
    proposal, _quote = get_public_quote_proposal_or_404(db, token)
    event = record_quote_proposal_event(
        db,
        proposal=proposal,
        event_type=payload.event_type,
        recipient_email=payload.recipient_email,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"results": [event]}


@router.get("/{quote_id}", response_model=SalesQuoteResponse)
def get_quote(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    return get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)


@router.get("/{quote_id}/summary", response_model=QuoteSummaryResponse)
def get_quote_summary(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    return build_quote_summary(db, get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id))


@router.post("/{quote_id}/follow-up", response_model=FollowUpActionResponse)
def log_quote_follow_up_route(quote_id: int, payload: FollowUpActionRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "edit"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    return log_quote_follow_up(db, quote=quote, payload=payload.model_dump(), current_user=current_user)


@router.post("/{quote_id}/proposal/generate", response_model=SalesQuoteProposalDocumentResponse)
def generate_quote_proposal_route(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "edit"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    proposal = generate_quote_proposal(db, quote, current_user)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id, action="proposal_generate", description=f"Generated proposal for quote {_display_quote_name(quote)}")
    return proposal


@router.post("/{quote_id}/proposal/send", response_model=SalesQuoteProposalSendResponse)
def send_quote_proposal_route(quote_id: int, payload: SalesQuoteProposalSendRequest = Body(default=SalesQuoteProposalSendRequest()), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "edit"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    proposal, public_url_path, expires_at = send_quote_proposal(db, quote, sent_to=str(payload.sent_to) if payload.sent_to else None, current_user=current_user)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id, action="proposal_send", description=f"Marked proposal sent for quote {_display_quote_name(quote)}")
    return {"proposal": proposal, "public_url_path": public_url_path, "expires_at": expires_at}


@router.get("/{quote_id}/proposal/events", response_model=SalesQuoteProposalEventsResponse)
def list_quote_proposal_events_route(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "view"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    return {"results": list_quote_proposal_events(db, quote)}


@router.post("/{quote_id}/convert-to-order", response_model=SalesOrderResponse)
def convert_quote_to_order_route(
    quote_id: int,
    payload: SalesQuoteConvertToOrderRequest = Body(default=SalesQuoteConvertToOrderRequest()),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_quote_module=Depends(require_module_access("sales_quotes")),
    require_quote_permission=Depends(require_action_access("sales_quotes", "edit")),
    require_order_module=Depends(require_module_access("sales_orders")),
    require_order_permission=Depends(require_action_access("sales_orders", "create")),
):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    order = convert_quote_to_order(db, quote, current_user, allow_duplicate=payload.allow_duplicate)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id, action="convert_to_order", description=f"Converted quote {_display_quote_name(quote)} to order {order.order_number}", after_state={"order_id": order.id, "order_number": order.order_number})
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_orders", entity_type="sales_order", entity_id=order.id, action="create_from_quote", description=f"Created order {order.order_number} from quote {_display_quote_name(quote)}", after_state=SalesOrderResponse.model_validate(order).model_dump(mode="json"))
    safe_publish_crm_event(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, event_type="order.created", entity_type="sales_order", entity_id=order.id, payload={"order_number": order.order_number, "status": order.status, "quote_id": quote.quote_id})
    return order


@router.put("/{quote_id}", response_model=SalesQuoteResponse)
def update_quote(quote_id: int, payload: SalesQuoteUpdateRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "edit"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return quote
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", field_keys=set(update_data) - {"custom_fields"})
    update_data = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", payload=update_data)
    before_state = _serialize_quote(quote)
    updated = update_sales_quote(db, quote, update_data)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=updated.quote_id, action="update", description=f"Updated quote {_display_quote_name(updated)}", before_state=before_state, after_state=_serialize_quote(updated))
    if "status" in update_data and before_state.get("status") != updated.status:
        safe_emit_crm_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            event_type="quote.status_changed",
            entity_type="sales_quote",
            entity_id=updated.quote_id,
            payload={
                **actor_payload(current_user),
                "quote_id": updated.quote_id,
                "quote_number": updated.quote_number,
                "customer_name": updated.customer_name,
                "previous_status": before_state.get("status"),
                "status": updated.status,
                "total_amount": str(updated.total_amount),
                "href": f"/dashboard/sales/quotes/{updated.quote_id}",
            },
        )
    return updated


@router.delete("/{quote_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quote(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "delete"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id)
    before_state = _serialize_quote(quote)
    delete_sales_quote(db, quote)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id, action="soft_delete", description=f"Moved quote {_display_quote_name(quote)} to recycle bin", before_state=before_state)


@router.post("/{quote_id}/restore", response_model=SalesQuoteResponse)
def restore_quote(quote_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access("sales_quotes")), require_permission=Depends(require_action_access("sales_quotes", "restore"))):
    quote = get_quote_or_404(db, quote_id, tenant_id=current_user.tenant_id, include_deleted=True)
    restored = restore_sales_quote(db, quote)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id if current_user else None, module_key="sales_quotes", entity_type="sales_quote", entity_id=restored.quote_id, action="restore", description=f"Restored quote {_display_quote_name(restored)} from recycle bin", after_state=_serialize_quote(restored))
    return restored
