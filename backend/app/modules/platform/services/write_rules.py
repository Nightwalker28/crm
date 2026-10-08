"""An administrator's rules on a user write, for every module that takes them (13b Phase 4).

Field rules (required, read-only: `module_fields.enforce_field_rules`) and dependent picklists
(`picklist_dependencies.enforce_picklist_dependencies`) in one call, for the routes of sales
orders, products and services, and the ERP documents. The CRM routes (leads, contacts,
accounts, deals, quotes) call the two directly, after dropping disabled fields, which only
their forms know to leave out.

Routes are the user writes (13b §5 decision 9): system writes — portal and website orders,
invoicing an order, reorder purchase orders — call the services and skip these rules.
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

from sqlalchemy.orm import Session

from app.modules.platform.services.module_fields import enforce_field_rules
from app.modules.platform.services.picklist_dependencies import enforce_picklist_dependencies


# module key → the header model, loaded on update so a rule can compare with the record.
_RECORD_MODELS: dict[str, str] = {
    "sales_orders": "app.modules.sales.models:SalesOrder",
    "catalog_products": "app.modules.catalog.models:CatalogProduct",
    "catalog_services": "app.modules.catalog.models:CatalogService",
    "finance_pos": "app.modules.finance.models:FinancePosInvoice",
    "finance_credit_notes": "app.modules.finance.models:FinanceCreditNote",
    "finance_payments": "app.modules.finance.models:FinancePayment",
    "purchase_orders": "app.modules.purchasing.models:PurchaseOrder",
    "purchase_receipts": "app.modules.purchasing.models:PurchaseReceipt",
    "purchase_bills": "app.modules.purchasing.models:PurchaseBill",
    "inventory_deliveries": "app.modules.inventory.models:InventoryDelivery",
    "inventory_returns": "app.modules.inventory.models:InventoryReturn",
    "inventory_adjustments": "app.modules.inventory.models:InventoryAdjustment",
    "inventory_transfers": "app.modules.inventory.models:InventoryTransfer",
    "purchase_vendor_returns": "app.modules.purchasing.models:PurchaseVendorReturn",
    "purchase_vendor_credits": "app.modules.purchasing.models:PurchaseVendorCredit",
}


def _load_existing(db: Session, *, tenant_id: int, module_key: str, record_id: int) -> Any | None:
    path = _RECORD_MODELS.get(module_key)
    if path is None:
        return None
    module_path, name = path.split(":")
    model = getattr(import_module(module_path), name)
    # Tenant-scoped: a record id from another tenant loads nothing, and the service's own
    # lookup then answers 404 as it always has.
    return db.query(model).filter(model.id == record_id, model.tenant_id == tenant_id).first()


def apply_user_write_rules(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict,
    existing: Any | None = None,
    record_id: int | None = None,
    submitted_keys: set[str] | None = None,
) -> dict:
    """The payload to save after the admin's rules: read-only fields dropped or refused,
    required fields checked, dependent picklist pairs checked.

    Pass `record_id` on an update; the record is loaded unless `existing` is given. An update
    route that dumps its whole request model (defaults included) passes the keys the client
    actually sent as `submitted_keys`, so a field left out is not taken for one emptied or
    changed. A create always checks the full payload: defaults count as values there.
    """

    if record_id is not None and existing is None:
        existing = _load_existing(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id)
        if existing is None:
            return payload  # not found here; the service answers 404
    unsent: dict = {}
    if existing is not None and submitted_keys is not None:
        sent = {key: value for key, value in payload.items() if key in submitted_keys or key == "custom_fields"}
        unsent = {key: value for key, value in payload.items() if key not in sent}
        payload = sent
    payload = enforce_field_rules(db, tenant_id=tenant_id, module_key=module_key, payload=payload, existing=existing)
    payload = enforce_picklist_dependencies(
        db, tenant_id=tenant_id, module_key=module_key, payload=payload, existing=existing, record_id=record_id
    )
    return {**unsent, **payload}
