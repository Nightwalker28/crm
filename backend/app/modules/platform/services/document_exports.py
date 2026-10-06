"""The ERP document lists' exports, built from each list's own query (13a A5, E1, G3).

Each document list keeps one query builder, `list_query` in its service. The list route
paginates it and the export job serializes all of it, so an export holds exactly the rows the
list shows under the same filters. The export-job routes accept the list's own filter
parameters and store them on the job as `payload["filters"]`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class DocumentExport:
    #: `(db, user, filters) -> Query` — the list's own query, unpaginated.
    query: Callable[[Session, Any, dict[str, Any]], Any]
    #: `(db, user, rows) -> list[dict]` — the list's own serializer.
    serialize: Callable[[Session, Any, list], list[dict]]
    #: The filters the list accepts, so a job payload cannot add one the list does not have.
    filter_keys: tuple[str, ...]
    headers: tuple[str, ...]
    #: The column the export is ordered by (the list's id, ascending).
    order_column: Any


def _date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    return value if isinstance(value, date) else date.fromisoformat(str(value))


def _deliveries() -> DocumentExport:
    from app.modules.inventory.models import InventoryDelivery
    from app.modules.inventory.services import delivery_services

    return DocumentExport(
        query=lambda db, user, f: delivery_services.list_query(db, tenant_id=user.tenant_id, **f),
        serialize=lambda db, user, rows: [delivery_services.serialize_delivery(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows],
        filter_keys=("status", "search", "order_id"),
        headers=("number", "status", "order_number", "customer_name", "warehouse_name", "shipped_on", "carrier", "tracking_number",
                 "total_quantity", "posted_at", "cancel_reason"),
        order_column=InventoryDelivery.id,
    )


def _returns() -> DocumentExport:
    from app.modules.inventory.models import InventoryReturn
    from app.modules.inventory.services import return_services

    return DocumentExport(
        query=lambda db, user, f: return_services.list_query(db, tenant_id=user.tenant_id, **f),
        serialize=lambda db, user, rows: [return_services.serialize_return(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows],
        filter_keys=("status", "search", "delivery_id"),
        headers=("number", "status", "reason", "delivery_number", "order_number", "customer_name", "warehouse_name", "total_quantity",
                 "received_at", "cancel_reason"),
        order_column=InventoryReturn.id,
    )


def _purchase_orders() -> DocumentExport:
    from app.modules.purchasing.models import PurchaseOrder
    from app.modules.purchasing.services import purchase_order_services

    return DocumentExport(
        query=lambda db, user, f: purchase_order_services.list_query(db, tenant_id=user.tenant_id, **f),
        serialize=lambda db, user, rows: [purchase_order_services.serialize_order(db, tenant_id=user.tenant_id, order=row, include_lines=False) for row in rows],
        filter_keys=("status", "vendor_id", "search"),
        headers=("number", "status", "receipt_status", "vendor_name", "warehouse_name", "currency", "subtotal", "expected_date",
                 "vendor_reference", "ordered_at", "close_reason", "cancel_reason"),
        order_column=PurchaseOrder.id,
    )


def _receipts() -> DocumentExport:
    from app.modules.purchasing.models import PurchaseReceipt
    from app.modules.purchasing.services import receipt_services

    return DocumentExport(
        query=lambda db, user, f: receipt_services.list_query(db, tenant_id=user.tenant_id, **f),
        serialize=lambda db, user, rows: [receipt_services.serialize_receipt(db, tenant_id=user.tenant_id, receipt=row, include_lines=False) for row in rows],
        filter_keys=("status", "order_id", "search"),
        headers=("number", "status", "order_number", "vendor_name", "warehouse_name", "received_on", "vendor_delivery_ref",
                 "total_quantity", "posted_at", "cancel_reason"),
        order_column=PurchaseReceipt.id,
    )


def _bills() -> DocumentExport:
    from app.modules.purchasing.models import PurchaseBill
    from app.modules.purchasing.services import bill_services

    return DocumentExport(
        query=lambda db, user, f: bill_services.list_query(db, tenant_id=user.tenant_id, **f),
        serialize=lambda db, user, rows: [bill_services.serialize_bill(db, tenant_id=user.tenant_id, bill=row, include_lines=False) for row in rows],
        filter_keys=("status", "vendor_id", "order_id", "search"),
        headers=("number", "status", "vendor_name", "vendor_invoice_number", "order_number", "bill_date", "due_date", "currency",
                 "subtotal", "tax_total", "total", "amount_paid", "balance_due", "payment_status", "match_status", "void_reason"),
        order_column=PurchaseBill.id,
    )


def _invoices() -> DocumentExport:
    from app.modules.finance.models import FinancePosInvoice
    from app.modules.finance.repositories.pos_invoice_repository import build_invoice_query
    from app.modules.finance.services.pos_invoice_services import serialize_invoice

    def query(db: Session, user, f: dict[str, Any]):
        return build_invoice_query(
            db,
            user,
            search=f.get("search"),
            status_filter=f.get("status"),
            payment_status_filter=f.get("payment_status"),
            all_filter_conditions=f.get("filters_all"),
            any_filter_conditions=f.get("filters_any"),
        )

    return DocumentExport(
        query=query,
        serialize=lambda db, user, rows: [serialize_invoice(row, current_user=user, include_lines=False) for row in rows],
        filter_keys=("search", "status", "payment_status", "filters_all", "filters_any"),
        headers=("invoice_number", "status", "payment_status", "is_overdue", "customer_name", "customer_email", "issue_date", "due_date",
                 "currency", "subtotal_amount", "discount_amount", "tax_amount", "total_amount", "amount_paid", "amount_credited",
                 "balance_due", "source", "void_reason"),
        order_column=FinancePosInvoice.id,
    )


def _credit_notes() -> DocumentExport:
    from app.modules.finance.models import FinanceCreditNote
    from app.modules.finance.services import credit_note_services

    return DocumentExport(
        query=lambda db, user, f: credit_note_services.list_query(db, user, **f),
        serialize=lambda db, user, rows: [credit_note_services.serialize(db, row, include_lines=False) for row in rows],
        filter_keys=("status", "search", "invoice_id"),
        headers=("number", "status", "invoice_number", "customer_name", "reason", "issue_date", "currency", "subtotal_amount",
                 "tax_amount", "total_amount", "refund_due", "void_reason"),
        order_column=FinanceCreditNote.id,
    )


def _payments() -> DocumentExport:
    from app.modules.finance.models import FinancePayment
    from app.modules.finance.services import payment_services

    def serialize(db: Session, user, rows: list) -> list[dict]:
        serialized = payment_services.serialize_payments(db, rows)
        for row in serialized:
            row["documents"] = "; ".join(allocation["document_label"] or "" for allocation in row["allocations"])
        return serialized

    def query(db: Session, user, f: dict[str, Any]):
        return payment_services.list_query(db, user, **{**f, "date_from": _date(f.get("date_from")), "date_to": _date(f.get("date_to"))})

    return DocumentExport(
        query=query,
        serialize=serialize,
        filter_keys=("search", "direction", "status", "method", "date_from", "date_to"),
        headers=("number", "status", "direction", "kind", "paid_on", "party_name", "documents", "method", "reference", "currency",
                 "amount", "void_reason"),
        order_column=FinancePayment.id,
    )


_EXPORTS: dict[str, Callable[[], DocumentExport]] = {
    "inventory_deliveries": _deliveries,
    "inventory_returns": _returns,
    "purchase_orders": _purchase_orders,
    "purchase_receipts": _receipts,
    "purchase_bills": _bills,
    "finance_pos": _invoices,
    "finance_credit_notes": _credit_notes,
    "finance_payments": _payments,
}
DOCUMENT_EXPORT_MODULES = frozenset(_EXPORTS)


def document_export(module_key: str) -> DocumentExport:
    return _EXPORTS[module_key]()


def export_filters(module_key: str, filters: dict[str, Any] | None) -> dict[str, Any]:
    """The list filters a job may carry: the list's own, without empty values."""
    allowed = document_export(module_key).filter_keys
    return {key: value for key, value in (filters or {}).items() if key in allowed and value not in (None, "", [])}


def document_export_rows(db: Session, user, *, module_key: str, filters: dict[str, Any] | None = None) -> tuple[list[dict], tuple[str, ...]]:
    """Every row the module's list shows under `filters`, serialized as the list serializes them."""
    from app.core.field_types import FieldContext
    from app.modules.platform.services import custom_fields

    spec = document_export(module_key)
    query = spec.query(db, user, export_filters(module_key, filters))
    rows = query.order_by(None).order_by(spec.order_column).all()
    serialized = spec.serialize(db, user, rows)
    # Picklist keys export as labels, and every custom field is a column (13b §3.3–3.4).
    ctx = FieldContext(db, user.tenant_id)
    definitions = custom_fields.export_columns(db, tenant_id=user.tenant_id, module_key=module_key)
    values = custom_fields.load_custom_field_values_bulk(
        db, tenant_id=user.tenant_id, module_key=module_key, record_ids=[row.id for row in rows]
    ) if definitions else {}
    for row, item in zip(rows, serialized):
        ctx.picklists.labels_for_row(module_key, item)
        item.update(custom_fields.export_cells(definitions, values.get(row.id), ctx))
    headers = (*spec.headers, *[f"{custom_fields.CUSTOM_FIELD_FILTER_PREFIX}{definition.field_key}" for definition in definitions])
    return serialized, headers



def start_document_export(db: Session, user, *, module_key: str, filters: dict[str, Any]) -> dict[str, int]:
    """Queue an export of the list as the user filtered it."""
    from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job

    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key=module_key, operation_type="export",
        payload={"filters": jsonable_encoder(export_filters(module_key, filters))})
    enqueue_export_job(job.id)
    return {"job_id": job.id}
