from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, count_csv_rows_bytes, parse_mapping_json, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.core.list_conditions import ListConditions, list_conditions
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import can_access, require_access, require_action_access, require_module_access
from app.core.unit_of_work import unit_of_work
from app.core.security import require_user
from app.modules.platform.services.write_rules import apply_user_write_rules
from app.modules.platform.services.document_exports import start_document_export
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_import_job, persist_job_upload, should_background_data_transfer_with_size
from app.modules.sales.services.orders_import import ORDER_IMPORT_ALIASES, ORDER_IMPORT_FIELDS, ORDER_IMPORT_REQUIRED, import_orders_from_csv
from app.modules.platform.services.custom_fields import load_custom_field_values
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.crm_events import safe_publish_crm_event
from app.modules.sales.schema import SalesOrderCreateRequest, SalesOrderListItem, SalesOrderListResponse, SalesOrderResponse, SalesOrderUpdateRequest
from app.modules.catalog.services.line_links import catalog_links_of, require_catalog_line_link_access
from app.modules.sales.services.orders_services import create_sales_order, get_order_or_404, list_sales_orders, order_needs_delivery, update_sales_order
from app.modules.inventory.services.delivery_services import close_remaining
from app.modules.inventory.services.reservation_services import order_fulfilment
from app.modules.inventory.services.stock_ledger import reserve_for_order


router = APIRouter(prefix="/orders", tags=["Sales"])

ORDER_LIST_FIELDS = {
    "order_number", "quote_id", "organization_id", "contact_id", "opportunity_id", "status", "currency", "grand_total",
    "owner_id", "created_at", "updated_at", "delivery_status", "priority", "invoice_status",
}


def _parse_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


def _require_delivery_access(db: Session, current_user) -> None:
    """Marking an order with stocked lines fulfilled posts a delivery, so it needs delivery access."""
    require_access(db, current_user, "inventory_deliveries", "create", "edit",
        detail="Marking this order fulfilled ships its stock, which needs access to create and post deliveries")


def _serialize_order(order) -> dict:
    return SalesOrderResponse.model_validate(order).model_dump(mode="json")


def _with_currency(db: Session, order):
    """The base currency and a suggested rate ride on the response, so the form knows whether
    to ask for an exchange rate (12d §3.5). Not persisted."""
    from app.modules.inventory.services.costing import base_currency, default_exchange_rate

    order.base_currency = base_currency(db, tenant_id=order.tenant_id)
    order.suggested_exchange_rate = (default_exchange_rate(db, tenant_id=order.tenant_id, currency=order.currency)
                                     if order.exchange_rate is None else None)
    order.custom_fields = load_custom_field_values(db, tenant_id=order.tenant_id, module_key="sales_orders", record_id=order.id) or None
    return order


@router.get("", response_model=SalesOrderListResponse)
def list_orders(
    sort_by: str | None = Query(default=None),
    sort_direction: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    orders, total_count = list_sales_orders(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([SalesOrderListItem.model_validate(order) for order in orders], total_count, pagination)


@router.get("/search", response_model=SalesOrderListResponse)
def search_orders(
    query: str = Query(..., min_length=1, max_length=100),
    sort_by: str | None = Query(default=None),
    sort_direction: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    orders, total_count = list_sales_orders(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([SalesOrderListItem.model_validate(order) for order in orders], total_count, pagination)


@router.post("/export-job", status_code=status.HTTP_202_ACCEPTED)
def export_orders(
    search: str | None = Query(default=None, max_length=100),
    conditions: ListConditions = Depends(list_conditions),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "export")),
):
    """Exports what the list shows under the same filters (13c §3.3)."""
    return start_document_export(db, current_user, module_key="sales_orders", filters={"search": search, **conditions.as_filters()})


@router.post("/import/preview")
async def preview_order_import(file: UploadFile = File(...), db: Session = Depends(get_db), current_user=Depends(require_user),
                               require_module=Depends(require_module_access("sales_orders")),
                               require_permission=Depends(require_action_access("sales_orders", "create"))):
    """One row per order line; rows sharing an order reference become one draft order (13c §3.3)."""
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(file_bytes)
    return {"source_headers": source_headers, "target_headers": ORDER_IMPORT_FIELDS, "required_headers": ORDER_IMPORT_REQUIRED,
            "suggested_mapping": suggest_header_mapping(source_headers=source_headers, target_headers=ORDER_IMPORT_FIELDS, aliases=ORDER_IMPORT_ALIASES)}


@router.post("/import", response_model=ImportExecutionResponse)
async def import_orders(file: UploadFile = File(...), mapping_json: str | None = Form(default=None), db: Session = Depends(get_db),
                        current_user=Depends(require_user), require_module=Depends(require_module_access("sales_orders")),
                        require_permission=Depends(require_action_access("sales_orders", "create"))):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    mapping = parse_mapping_json(mapping_json, target_headers=ORDER_IMPORT_FIELDS)
    remapped = remap_csv_bytes(file_bytes, target_headers=ORDER_IMPORT_FIELDS, mapping=mapping)
    row_count = count_csv_rows_bytes(remapped)
    if should_background_data_transfer_with_size(row_count=row_count, file_size_bytes=len(remapped)):
        job = create_data_transfer_job(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key="sales_orders",
                                       operation_type="import", payload={"filename": file.filename, "row_count": row_count})
        job.payload = {**(job.payload or {}), "source_file_path": persist_job_upload(job_id=job.id, filename="orders-import.csv", file_bytes=remapped)}
        db.add(job)
        db.commit()
        db.refresh(job)
        enqueue_import_job(job.id)
        return ImportExecutionResponse(mode="background", message=f"Import queued in background as job #{job.id}.", job_id=job.id, job_status=job.status)
    summary = import_orders_from_csv(db, remapped, current_user=current_user)
    return ImportExecutionResponse(mode="inline", message=summary["message"], summary=StandardImportSummary(**summary))


@router.post("", response_model=SalesOrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: SalesOrderCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "create")),
):
    order_payload = apply_user_write_rules(
        db, tenant_id=current_user.tenant_id, module_key="sales_orders", payload=payload.model_dump()
    )
    require_catalog_line_link_access(db, user=current_user, lines=order_payload.get("items"))
    if order_payload.get("status") == "fulfilled" and any(item.get("catalog_product_id") for item in order_payload.get("items") or []):
        _require_delivery_access(db, current_user)
    with unit_of_work(db):
        created = create_sales_order(db, order_payload, current_user)
        safe_log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key="sales_orders",
            entity_type="sales_order",
            entity_id=created.id,
            action="create",
            description=f"Created order {created.order_number}",
            after_state=_serialize_order(created),
        )
        safe_publish_crm_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            event_type="order.created",
            entity_type="sales_order",
            entity_id=created.id,
            payload={"order_number": created.order_number, "status": created.status, "quote_id": created.quote_id},
        )
    return _with_currency(db, created)


@router.get("/{order_id}", response_model=SalesOrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    return _with_currency(db, get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id))


@router.patch("/{order_id}", response_model=SalesOrderResponse)
def update_order(
    order_id: int,
    payload: SalesOrderUpdateRequest = Body(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "edit")),
):
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    update_payload = apply_user_write_rules(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_orders",
        payload=payload.model_dump(exclude_unset=True),
        existing=order,
        record_id=order.id,
    )
    require_catalog_line_link_access(db, user=current_user, lines=update_payload.get("items"), existing_links=catalog_links_of(order.items))
    if update_payload.get("status") == "fulfilled" and order.status != "fulfilled" and order_needs_delivery(db, order):
        _require_delivery_access(db, current_user)
    before_state = _serialize_order(order)
    with unit_of_work(db):
        updated = update_sales_order(db, order, update_payload, actor_user_id=current_user.id)
        safe_log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key="sales_orders",
            entity_type="sales_order",
            entity_id=updated.id,
            action="update",
            description=f"Updated order {updated.order_number}",
            before_state=before_state,
            after_state=_serialize_order(updated),
        )
        if before_state.get("status") != updated.status:
            safe_publish_crm_event(
                db,
                tenant_id=current_user.tenant_id,
                actor_user_id=current_user.id,
                event_type="order.status_changed",
                entity_type="sales_order",
                entity_id=updated.id,
                payload={
                    "order_number": updated.order_number,
                    "previous_status": before_state.get("status"),
                    "status": updated.status,
                    "field_changes": {"status": {"from": before_state.get("status"), "to": updated.status}},
                },
            )
    return _with_currency(db, updated)


def _fulfilment(db: Session, current_user, order) -> dict:
    data = order_fulfilment(db, tenant_id=current_user.tenant_id, order=order)
    # Free stock in the warehouse is inventory data; the order's own holds are not.
    if not can_access(db, current_user, "inventory_stock"):
        for line in data["lines"]:
            line["available"] = None
    return data


@router.get("/{order_id}/fulfilment")
def get_order_fulfilment(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    return jsonable_encoder(_fulfilment(db, current_user, order))


@router.get("/{order_id}/margin")
def get_order_margin(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
    require_valuation=Depends(require_module_access("inventory_valuation")),
    require_valuation_view=Depends(require_action_access("inventory_valuation", "view")),
):
    """Revenue, cost of goods and margin per line in the base currency (12d §3.3)."""
    from app.modules.inventory.services.valuation_services import order_margin

    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    return jsonable_encoder(order_margin(db, tenant_id=current_user.tenant_id, order=order))


@router.get("/{order_id}/invoicing")
def get_order_invoicing(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    """The order's Invoicing tab (12c §3.5): invoiced and to invoice per line, and its invoices."""
    from app.modules.finance.services.invoicing_services import order_invoicing_summary

    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    data = order_invoicing_summary(db, order=order)
    if not can_access(db, current_user, "finance_pos"):
        data["invoices"] = []
    return jsonable_encoder(data)


@router.post("/{order_id}/reserve")
def reserve_order_stock(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "edit")),
):
    """Check availability: hold whatever is free now for the order's waiting lines."""
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    if order.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only confirmed orders hold stock")
    reserve_for_order(db, tenant_id=current_user.tenant_id, order=order, actor_user_id=current_user.id)
    db.commit()
    return jsonable_encoder(_fulfilment(db, current_user, get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)))


class CloseRemainingPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.post("/{order_id}/close-remaining")
def close_order_remaining(
    order_id: int,
    payload: CloseRemainingPayload,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "edit")),
):
    """Finish a partly delivered order without shipping the rest."""
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    before_status = order.status
    close_remaining(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, order=order, reason=payload.reason)
    db.commit()
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    safe_publish_crm_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        event_type="order.status_changed",
        entity_type="sales_order",
        entity_id=order.id,
        payload={
            "order_number": order.order_number,
            "previous_status": before_status,
            "status": order.status,
            "field_changes": {"status": {"from": before_status, "to": order.status}},
        },
    )
    return jsonable_encoder(_fulfilment(db, current_user, order))
