from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.finance.models import FinancePosInvoice


POS_INVOICE_SORT_FIELDS = {
    "invoice_number": FinancePosInvoice.invoice_number,
    "customer_name": FinancePosInvoice.customer_name,
    "status": FinancePosInvoice.status,
    "payment_status": FinancePosInvoice.payment_status,
    "total_amount": FinancePosInvoice.total_amount,
    "amount_paid": FinancePosInvoice.amount_paid,
    "issue_date": FinancePosInvoice.issue_date,
    "due_date": FinancePosInvoice.due_date,
    "template_id": FinancePosInvoice.template_id,
    "updated_at": FinancePosInvoice.updated_at,
}


def apply_invoice_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = POS_INVOICE_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query
    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), FinancePosInvoice.id.desc())


def build_invoice_query(
    db: Session,
    current_user,
    *,
    search: str | None = None,
    status_filter: str | None = None,
    payment_status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    scope = get_finance_user_scope(db, current_user)
    query = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == current_user.tenant_id,
        FinancePosInvoice.deleted_at.is_(None),
    )
    if scope.user_id_filter is not None:
        query = query.filter(FinancePosInvoice.user_id == scope.user_id_filter)
    if status_filter and status_filter != "all":
        query = query.filter(func.lower(FinancePosInvoice.status) == status_filter.strip().lower())
    if payment_status_filter and payment_status_filter != "all":
        query = query.filter(func.lower(FinancePosInvoice.payment_status) == payment_status_filter.strip().lower())
    field_map = {
        "invoice_number": {"expression": FinancePosInvoice.invoice_number, "type": "text"},
        "customer_name": {"expression": FinancePosInvoice.customer_name, "type": "text"},
        "status": {"expression": FinancePosInvoice.status, "type": "text"},
        "payment_status": {"expression": FinancePosInvoice.payment_status, "type": "text"},
        "payment_method": {"expression": FinancePosInvoice.payment_method, "type": "text"},
        "currency": {"expression": FinancePosInvoice.currency, "type": "text"},
        "total_amount": {"expression": FinancePosInvoice.total_amount, "type": "number"},
        "amount_paid": {"expression": FinancePosInvoice.amount_paid, "type": "number"},
        "issue_date": {"expression": FinancePosInvoice.issue_date, "type": "date"},
        "due_date": {"expression": FinancePosInvoice.due_date, "type": "date"},
        "updated_at": {"expression": FinancePosInvoice.updated_at, "type": "date"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return apply_ranked_search(
        query,
        search=search,
        document=searchable_text(
            FinancePosInvoice.invoice_number,
            FinancePosInvoice.customer_name,
            FinancePosInvoice.customer_email,
            FinancePosInvoice.status,
            FinancePosInvoice.payment_status,
            FinancePosInvoice.payment_method,
            FinancePosInvoice.notes,
        ),
        default_order_column=FinancePosInvoice.updated_at,
    )


def list_invoices(
    db: Session,
    current_user,
    *,
    pagination,
    search: str | None = None,
    status_filter: str | None = None,
    payment_status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
):
    query = build_invoice_query(
        db,
        current_user,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    records = (
        apply_invoice_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return records, total_count


def list_invoices_cursor(
    db: Session,
    current_user,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    status_filter: str | None = None,
    payment_status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[FinancePosInvoice]:
    query = build_invoice_query(
        db,
        current_user,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    if cursor is not None:
        query = query.filter(FinancePosInvoice.id < cursor)
    return query.order_by(None).order_by(FinancePosInvoice.id.desc()).limit(limit + 1).all()


def get_invoice(db: Session, current_user, *, invoice_id: int) -> FinancePosInvoice | None:
    return build_invoice_query(db, current_user).filter(FinancePosInvoice.id == invoice_id).first()


def get_invoice_for_update(db: Session, current_user, *, invoice_id: int) -> FinancePosInvoice | None:
    return (
        build_invoice_query(db, current_user)
        .filter(FinancePosInvoice.id == invoice_id)
        .with_for_update()
        .first()
    )
