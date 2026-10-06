"""Purchasing routes (12b-erp-purchasing.md §3.3). Every route clears the three access layers."""

from datetime import date
from decimal import Decimal

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import can_access, require_action_access, require_any_access, require_module_access
from app.core.security import require_user
from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt
from app.modules.purchasing.services import purchase_order_services as orders
from app.modules.purchasing.services import receipt_services as receipts
from app.modules.purchasing.services import reorder_services as reorder
from app.modules.sales.models import SalesOrganization
from app.modules.platform.services.document_exports import start_document_export

router = APIRouter(prefix="/purchasing", tags=["Purchasing"])

ORDERS = "purchase_orders"
RECEIPTS = "purchase_receipts"


class OrderLinePayload(BaseModel):
    product_id: int = Field(gt=0)
    description: str | None = None
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)


class OrderPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    vendor_id: int = Field(gt=0)
    warehouse_id: int | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, max_length=10)
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    expected_date: date | None = None
    vendor_reference: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    lines: list[OrderLinePayload] = Field(min_length=1)


class ReasonPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ReceiptLinePayload(BaseModel):
    order_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)


class ReceiptPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    received_on: date | None = None
    vendor_delivery_ref: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    # Omitted on create: everything still to receive on the purchase order.
    lines: list[ReceiptLinePayload] | None = Field(default=None, min_length=1)


class ReceiptCreatePayload(ReceiptPayload):
    order_id: int = Field(gt=0)


class ReorderRow(BaseModel):
    product_id: int = Field(gt=0)
    warehouse_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)


class ReorderPayload(BaseModel):
    rows: list[ReorderRow] = Field(min_length=1, max_length=500)


def _order(db: Session, tenant_id: int, order_id: int) -> dict:
    return jsonable_encoder(orders.serialize_order(db, tenant_id=tenant_id, order=orders.order_or_404(db, tenant_id=tenant_id, order_id=order_id)))


def _receipt(db: Session, tenant_id: int, receipt_id: int) -> dict:
    receipt = receipts.get_receipt(db, tenant_id=tenant_id, receipt_id=receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return jsonable_encoder(receipts.serialize_receipt(db, tenant_id=tenant_id, receipt=receipt))




# Vendors -------------------------------------------------------------------------------

@router.get("/vendors/search")
def search_vendors(query: str = Query(default="", max_length=100), limit: int = Query(default=10, ge=1, le=25),
                   db: Session = Depends(get_db), user=Depends(require_user)):
    """Vendor-flagged Accounts, for the product form and the purchase order form."""
    require_any_access(db, user, ((ORDERS, "view"), ("sales_organizations", "view"), ("catalog_products", "edit")), detail="Vendor access required")
    rows = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == user.tenant_id, SalesOrganization.deleted_at.is_(None),
        SalesOrganization.is_vendor == 1)
    if query.strip():
        rows = rows.filter(SalesOrganization.org_name.ilike(f"%{query.strip()}%"))
    return {"results": [{"id": row.org_id, "label": row.org_name, "email": row.primary_email}
                        for row in rows.order_by(SalesOrganization.org_name, SalesOrganization.org_id).limit(limit)]}


# Purchase orders -----------------------------------------------------------------------

@router.get("/orders")
def list_orders(status: str | None = Query(default=None, pattern="^(draft|ordered|received|closed|cancelled|open)$"),
                vendor_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100),
                pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(ORDERS)), _view=Depends(require_action_access(ORDERS, "view"))):
    query = orders.list_query(db, tenant_id=user.tenant_id, status=status, vendor_id=vendor_id, search=search)
    total = query.count()
    rows = query.order_by(PurchaseOrder.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([orders.serialize_order(db, tenant_id=user.tenant_id, order=row, include_lines=False) for row in rows]), total, pagination)


@router.post("/orders", status_code=201)
def create_order(payload: OrderPayload, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(ORDERS)), _create=Depends(require_action_access(ORDERS, "create"))):
    order = orders.save_order(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump())
    db.commit()
    return _order(db, user.tenant_id, order.id)


@router.post("/orders/export-job", status_code=202)
def export_orders(status: str | None = Query(default=None, pattern="^(draft|ordered|received|closed|cancelled|open)$"),
        vendor_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100), db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(ORDERS)), _export=Depends(require_action_access(ORDERS, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=ORDERS, filters={"status": status, "vendor_id": vendor_id, "search": search})


@router.get("/orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), user=Depends(require_user),
              _module=Depends(require_module_access(ORDERS)), _view=Depends(require_action_access(ORDERS, "view"))):
    return _order(db, user.tenant_id, order_id)


@router.patch("/orders/{order_id}")
def update_order(order_id: int, payload: OrderPayload, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(ORDERS)), _edit=Depends(require_action_access(ORDERS, "edit"))):
    orders.save_order(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), order_id=order_id)
    db.commit()
    return _order(db, user.tenant_id, order_id)


@router.post("/orders/{order_id}/order")
def place_order(order_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(ORDERS)), _edit=Depends(require_action_access(ORDERS, "edit"))):
    orders.mark_ordered(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id)
    db.commit()
    return _order(db, user.tenant_id, order_id)


class ExchangeRatePayload(BaseModel):
    exchange_rate: Decimal = Field(gt=0)


@router.put("/orders/{order_id}/exchange-rate")
def set_order_exchange_rate(order_id: int, payload: ExchangeRatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                            _module=Depends(require_module_access(ORDERS)), _edit=Depends(require_action_access(ORDERS, "edit"))):
    orders.set_exchange_rate(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id, exchange_rate=payload.exchange_rate)
    db.commit()
    return _order(db, user.tenant_id, order_id)


@router.post("/orders/{order_id}/close")
def close_order(order_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(ORDERS)), _edit=Depends(require_action_access(ORDERS, "edit"))):
    orders.close_remaining(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id, reason=payload.reason)
    db.commit()
    return _order(db, user.tenant_id, order_id)


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(ORDERS)), _edit=Depends(require_action_access(ORDERS, "edit"))):
    orders.cancel_order(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id, reason=payload.reason)
    db.commit()
    return _order(db, user.tenant_id, order_id)


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(ORDERS)), _delete=Depends(require_action_access(ORDERS, "delete"))):
    orders.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id)
    db.commit()
    return Response(status_code=204)


@router.post("/orders/{order_id}/restore")
def restore_order(order_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(ORDERS)), _restore=Depends(require_action_access(ORDERS, "restore"))):
    orders.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, order_id=order_id)
    db.commit()
    return _order(db, user.tenant_id, order_id)


# Receipts ------------------------------------------------------------------------------

@router.get("/receipts")
def list_receipts(status: str | None = Query(default=None, pattern="^(draft|posted|cancelled)$"), order_id: int | None = Query(default=None, gt=0),
                  search: str | None = Query(default=None, max_length=100), pagination: Pagination = Depends(get_pagination),
                  db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RECEIPTS)), _view=Depends(require_action_access(RECEIPTS, "view"))):
    query = receipts.list_query(db, tenant_id=user.tenant_id, status=status, order_id=order_id, search=search)
    total = query.count()
    rows = query.order_by(PurchaseReceipt.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([receipts.serialize_receipt(db, tenant_id=user.tenant_id, receipt=row, include_lines=False) for row in rows]), total, pagination)


@router.post("/receipts", status_code=201)
def create_receipt(payload: ReceiptCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RECEIPTS)), _create=Depends(require_action_access(RECEIPTS, "create"))):
    if not can_access(db, user, ORDERS, "view"):
        raise HTTPException(status_code=403, detail="Purchase order access required")
    receipt = receipts.save_receipt(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump())
    db.commit()
    return _receipt(db, user.tenant_id, receipt.id)


@router.post("/receipts/export-job", status_code=202)
def export_receipts(status: str | None = Query(default=None, pattern="^(draft|posted|cancelled)$"), order_id: int | None = Query(default=None, gt=0),
        search: str | None = Query(default=None, max_length=100), db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(RECEIPTS)), _export=Depends(require_action_access(RECEIPTS, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=RECEIPTS, filters={"status": status, "order_id": order_id, "search": search})


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(RECEIPTS)), _view=Depends(require_action_access(RECEIPTS, "view"))):
    return _receipt(db, user.tenant_id, receipt_id)


@router.patch("/receipts/{receipt_id}")
def update_receipt(receipt_id: int, payload: ReceiptPayload, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RECEIPTS)), _edit=Depends(require_action_access(RECEIPTS, "edit"))):
    receipts.save_receipt(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), receipt_id=receipt_id)
    db.commit()
    return _receipt(db, user.tenant_id, receipt_id)


@router.post("/receipts/{receipt_id}/post")
def post_receipt(receipt_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(RECEIPTS)), _edit=Depends(require_action_access(RECEIPTS, "edit"))):
    receipts.post_receipt(db, tenant_id=user.tenant_id, actor_user_id=user.id, receipt_id=receipt_id)
    db.commit()
    return _receipt(db, user.tenant_id, receipt_id)


@router.post("/receipts/{receipt_id}/cancel")
def cancel_receipt(receipt_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RECEIPTS)), _edit=Depends(require_action_access(RECEIPTS, "edit"))):
    receipts.cancel_receipt(db, tenant_id=user.tenant_id, actor_user_id=user.id, receipt_id=receipt_id, reason=payload.reason[:120])
    db.commit()
    return _receipt(db, user.tenant_id, receipt_id)


@router.delete("/receipts/{receipt_id}", status_code=204)
def delete_receipt(receipt_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RECEIPTS)), _delete=Depends(require_action_access(RECEIPTS, "delete"))):
    receipts.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, receipt_id=receipt_id)
    db.commit()
    return Response(status_code=204)


@router.post("/receipts/{receipt_id}/restore")
def restore_receipt(receipt_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(RECEIPTS)), _restore=Depends(require_action_access(RECEIPTS, "restore"))):
    receipts.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, receipt_id=receipt_id)
    db.commit()
    return _receipt(db, user.tenant_id, receipt_id)


# Reorder -------------------------------------------------------------------------------

@router.get("/reorder")
def reorder_suggestions(warehouse_id: int | None = Query(default=None, gt=0), vendor_id: int | None = Query(default=None, gt=0),
                        db: Session = Depends(get_db), user=Depends(require_user),
                        _module=Depends(require_module_access(ORDERS)), _view=Depends(require_action_access(ORDERS, "view")),
                        _stock=Depends(require_module_access("inventory_stock")), _stock_view=Depends(require_action_access("inventory_stock", "view"))):
    return {"results": jsonable_encoder(reorder.suggestions(db, tenant_id=user.tenant_id, warehouse_id=warehouse_id, vendor_id=vendor_id))}


@router.post("/reorder/orders", status_code=201)
def reorder_create_orders(payload: ReorderPayload, db: Session = Depends(get_db), user=Depends(require_user),
                          _module=Depends(require_module_access(ORDERS)), _create=Depends(require_action_access(ORDERS, "create")),
                          _stock=Depends(require_module_access("inventory_stock")), _stock_view=Depends(require_action_access("inventory_stock", "view"))):
    created = reorder.create_draft_orders(db, tenant_id=user.tenant_id, actor_user_id=user.id, rows=[row.model_dump() for row in payload.rows])
    db.commit()
    return {"results": [_order(db, user.tenant_id, order.id) for order in created]}
