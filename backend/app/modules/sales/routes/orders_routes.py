from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.crm_events import safe_publish_crm_event
from app.modules.sales.schema import SalesOrderCreateRequest, SalesOrderListItem, SalesOrderListResponse, SalesOrderResponse, SalesOrderUpdateRequest
from app.modules.sales.services.orders_services import create_sales_order, get_order_or_404, list_sales_orders, update_sales_order


router = APIRouter(prefix="/orders", tags=["Sales"])

ORDER_LIST_FIELDS = {
    "order_number", "quote_id", "organization_id", "contact_id", "opportunity_id", "status", "currency", "grand_total",
    "owner_id", "created_at", "updated_at",
}


def _parse_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


def _serialize_order(order) -> dict:
    return SalesOrderResponse.model_validate(order).model_dump(mode="json")


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
    query: str = Query(..., min_length=1),
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


@router.post("", response_model=SalesOrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: SalesOrderCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "create")),
):
    created = create_sales_order(db, payload.model_dump(), current_user)
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
    return created


@router.get("/{order_id}", response_model=SalesOrderResponse)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_orders")),
    require_permission=Depends(require_action_access("sales_orders", "view")),
):
    return get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)


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
    before_state = _serialize_order(order)
    updated = update_sales_order(db, order, payload.model_dump(exclude_unset=True))
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
    return updated
