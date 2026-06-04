from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
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


def build_invoice_query(db: Session, current_user, *, search: str | None = None, status_filter: str | None = None):
    scope = get_finance_user_scope(db, current_user)
    query = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == current_user.tenant_id,
        FinancePosInvoice.deleted_at.is_(None),
    )
    if scope.user_id_filter is not None:
        query = query.filter(FinancePosInvoice.user_id == scope.user_id_filter)
    if status_filter and status_filter != "all":
        query = query.filter(func.lower(FinancePosInvoice.status) == status_filter.strip().lower())
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
    sort_by: str | None = None,
    sort_direction: str | None = None,
):
    query = build_invoice_query(db, current_user, search=search, status_filter=status_filter)
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
) -> list[FinancePosInvoice]:
    query = build_invoice_query(db, current_user, search=search, status_filter=status_filter)
    if cursor is not None:
        query = query.filter(FinancePosInvoice.id < cursor)
    return query.order_by(None).order_by(FinancePosInvoice.id.desc()).limit(limit + 1).all()


def get_invoice(db: Session, current_user, *, invoice_id: int) -> FinancePosInvoice | None:
    return build_invoice_query(db, current_user).filter(FinancePosInvoice.id == invoice_id).first()
