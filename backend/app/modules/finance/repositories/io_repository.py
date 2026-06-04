from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.finance.models import FinanceIO
from app.modules.platform.services.custom_fields import (
    build_custom_field_filter_map,
    hydrate_custom_field_record,
    hydrate_custom_field_records,
)

FINANCE_IO_MODULE_KEY = "finance_io"

INSERTION_ORDER_SORT_FIELDS = {
    "io_number": FinanceIO.io_number,
    "customer_name": FinanceIO.customer_name,
    "status": FinanceIO.status,
    "currency": FinanceIO.currency,
    "subtotal_amount": FinanceIO.subtotal_amount,
    "tax_amount": FinanceIO.tax_amount,
    "total_amount": FinanceIO.total_amount,
    "issue_date": FinanceIO.issue_date,
    "effective_date": FinanceIO.effective_date,
    "due_date": FinanceIO.due_date,
    "start_date": FinanceIO.start_date,
    "end_date": FinanceIO.end_date,
    "external_reference": FinanceIO.external_reference,
    "counterparty_reference": FinanceIO.counterparty_reference,
    "updated_at": FinanceIO.updated_at,
}


def apply_insertion_order_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = INSERTION_ORDER_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query
    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), FinanceIO.id.desc())


def build_insertion_orders_query(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    user_id: int | None,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(FinanceIO).filter(
        FinanceIO.tenant_id == tenant_id,
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )

    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    if status_filter:
        query = query.filter(func.lower(FinanceIO.status) == status_filter.strip().lower())

    filter_field_map = {
        "io_number": {"expression": FinanceIO.io_number, "type": "text"},
        "customer_name": {"expression": FinanceIO.customer_name, "type": "text"},
        "status": {"expression": FinanceIO.status, "type": "text"},
        "currency": {"expression": FinanceIO.currency, "type": "text"},
        "total_amount": {"expression": FinanceIO.total_amount, "type": "number"},
        "issue_date": {"expression": FinanceIO.issue_date, "type": "date"},
        "due_date": {"expression": FinanceIO.due_date, "type": "date"},
        "external_reference": {"expression": FinanceIO.external_reference, "type": "text"},
        "counterparty_reference": {"expression": FinanceIO.counterparty_reference, "type": "text"},
        "updated_at": {"expression": FinanceIO.updated_at, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key=FINANCE_IO_MODULE_KEY,
            record_id_expression=FinanceIO.id,
        ),
    }
    query = apply_filter_conditions(
        query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=filter_field_map,
    )
    query = apply_filter_conditions(
        query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=filter_field_map,
    )

    return apply_ranked_search(
        query,
        search=search,
        document=searchable_text(
            FinanceIO.io_number,
            FinanceIO.customer_name,
            FinanceIO.counterparty_reference,
            FinanceIO.external_reference,
            FinanceIO.status,
            FinanceIO.currency,
            FinanceIO.file_name,
            FinanceIO.notes,
        ),
        default_order_column=FinanceIO.updated_at,
    )


def list_insertion_orders(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    user_id: int | None,
    pagination,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[FinanceIO], int]:
    query = build_insertion_orders_query(
        db,
        tenant_id=tenant_id,
        module_id=module_id,
        user_id=user_id,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    records = (
        apply_insertion_order_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return (
        hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key=FINANCE_IO_MODULE_KEY,
            records=records,
            record_id_attr="id",
        ),
        total_count,
    )


def list_insertion_orders_cursor(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    user_id: int | None,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[FinanceIO]:
    query = build_insertion_orders_query(
        db,
        tenant_id=tenant_id,
        module_id=module_id,
        user_id=user_id,
        search=search,
        status_filter=status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    if cursor is not None:
        query = query.filter(FinanceIO.id < cursor)
    records = query.order_by(None).order_by(FinanceIO.id.desc()).limit(limit + 1).all()
    return hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key=FINANCE_IO_MODULE_KEY,
        records=records,
        record_id_attr="id",
    )


def get_insertion_order(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    io_id: int,
    user_id: int | None,
) -> FinanceIO | None:
    query = db.query(FinanceIO).filter(
        FinanceIO.id == io_id,
        FinanceIO.tenant_id == tenant_id,
        FinanceIO.module_id == module_id,
        FinanceIO.deleted_at.is_(None),
    )
    if user_id is not None:
        query = query.filter(FinanceIO.user_id == user_id)

    record = query.first()
    if not record:
        return None
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key=FINANCE_IO_MODULE_KEY,
        record=record,
        record_id=record.id,
    )


def list_deleted_insertion_orders(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    pagination,
) -> tuple[list[FinanceIO], int]:
    query = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.module_id == module_id,
            FinanceIO.tenant_id == tenant_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .order_by(FinanceIO.deleted_at.desc(), FinanceIO.updated_at.desc())
    )
    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    return (
        hydrate_custom_field_records(
            db,
            tenant_id=tenant_id,
            module_key=FINANCE_IO_MODULE_KEY,
            records=records,
            record_id_attr="id",
        ),
        total_count,
    )


def get_deleted_insertion_order(
    db: Session,
    *,
    tenant_id: int,
    module_id: int,
    io_id: int,
) -> FinanceIO | None:
    record = (
        db.query(FinanceIO)
        .filter(
            FinanceIO.id == io_id,
            FinanceIO.tenant_id == tenant_id,
            FinanceIO.module_id == module_id,
            FinanceIO.deleted_at.is_not(None),
        )
        .first()
    )
    if not record:
        return None
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key=FINANCE_IO_MODULE_KEY,
        record=record,
        record_id=record.id,
    )
