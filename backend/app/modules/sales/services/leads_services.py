from __future__ import annotations

from datetime import datetime
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers
from app.core.module_export import dict_rows_to_csv_bytes
from app.core.pagination import Pagination
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesLead
from app.modules.sales.repositories import leads_repository
from app.modules.user_management.models import User


LEAD_STATUSES = {"new", "contacted", "qualified", "unqualified", "converted"}
EXPORT_COLUMNS = [
    "lead_id",
    "first_name",
    "last_name",
    "company",
    "primary_email",
    "phone",
    "title",
    "source",
    "status",
    "notes",
    "assigned_to",
    "created_time",
]


def _normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _coerce_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _ensure_assigned_user(db: Session, user_id: int | None, *, tenant_id: int) -> None:
    if user_id is None:
        return
    if not leads_repository.user_exists(db, user_id=user_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _validate_status(value: str | None) -> str:
    normalized = (value or "new").strip().lower()
    if normalized not in LEAD_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead status")
    return normalized


def _apply_lead_payload(lead: SalesLead, payload: dict) -> None:
    for field, value in payload.items():
        setattr(lead, field, value)


def _merge_lead_payload(lead: SalesLead, payload: dict) -> None:
    for field, value in payload.items():
        if should_merge_value(getattr(lead, field, None), value):
            setattr(lead, field, value)


def list_sales_leads(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[SalesLead], int]:
    leads, total_count = leads_repository.list_leads(
        db,
        tenant_id=tenant_id,
        pagination=pagination,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    leads = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_leads",
        records=leads,
        record_id_attr="lead_id",
    )
    return leads, total_count


def list_sales_leads_cursor(
    db: Session,
    tenant_id: int,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesLead]:
    leads = leads_repository.list_leads_cursor(
        db,
        tenant_id=tenant_id,
        limit=limit,
        cursor=cursor,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_leads",
        records=leads,
        record_id_attr="lead_id",
    )


def list_all_sales_leads(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesLead]:
    leads = leads_repository.list_all_leads(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_leads",
        records=leads,
        record_id_attr="lead_id",
    )


def get_lead_or_404(db: Session, lead_id: int, *, tenant_id: int, include_deleted: bool = False) -> SalesLead:
    lead = leads_repository.get_lead(db, tenant_id=tenant_id, lead_id=lead_id, include_deleted=include_deleted)
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_leads",
        record=lead,
        record_id=lead.lead_id,
    )


def create_sales_lead(
    db: Session,
    payload: dict,
    current_user,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> SalesLead:
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    data = dict(payload)
    custom_data = validate_custom_field_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_leads",
        payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    data["status"] = _validate_status(data.get("status"))
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id if current_user else None
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=current_user.tenant_id)

    email = data.get("primary_email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="primary_email is required")

    existing = (
        db.query(SalesLead)
        .filter(
            SalesLead.tenant_id == current_user.tenant_id,
            SalesLead.deleted_at.is_(None),
            func.lower(SalesLead.primary_email) == _normalize_email(email),
        )
        .first()
    )
    if existing and not create_new_records:
        if skip_duplicates:
            return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_leads", record=existing, record_id=existing.lead_id)
        if replace_duplicates:
            _apply_lead_payload(existing, data)
            db.add(existing)
            db.commit()
            db.refresh(existing)
            save_custom_field_values(db, tenant_id=current_user.tenant_id, module_key="sales_leads", record_id=existing.lead_id, values=custom_data)
            db.commit()
            return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_leads", record=existing, record_id=existing.lead_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{email} already exists. Resend with replace_duplicates=true to overwrite, "
                "skip_duplicates=true to leave the existing lead unchanged, or "
                "create_new_records=true to add a new lead with the same email."
            ),
        )

    data["tenant_id"] = current_user.tenant_id
    lead = SalesLead(**data)
    db.add(lead)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create lead") from exc
    db.refresh(lead)
    save_custom_field_values(db, tenant_id=current_user.tenant_id, module_key="sales_leads", record_id=lead.lead_id, values=custom_data)
    db.commit()
    return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_leads", record=lead, record_id=lead.lead_id)


def update_sales_lead(db: Session, lead: SalesLead, data: dict) -> SalesLead:
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(
            db,
            tenant_id=lead.tenant_id,
            module_key="sales_leads",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=lead.tenant_id,
                module_key="sales_leads",
                record_id=lead.lead_id,
                fallback=lead.custom_data,
            ),
        )
        data["custom_data"] = custom_data_to_save
    if "status" in data and data["status"] is not None:
        data["status"] = _validate_status(data["status"])
    if "assigned_to" in data:
        _ensure_assigned_user(db, data["assigned_to"], tenant_id=lead.tenant_id)
    if "primary_email" in data and data["primary_email"]:
        duplicate = (
            db.query(SalesLead)
            .filter(
                SalesLead.deleted_at.is_(None),
                SalesLead.tenant_id == lead.tenant_id,
                func.lower(SalesLead.primary_email) == _normalize_email(data["primary_email"]),
                SalesLead.lead_id != lead.lead_id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Another lead already uses this email")
    _apply_lead_payload(lead, data)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    if custom_data_to_save is not None:
        save_custom_field_values(db, tenant_id=lead.tenant_id, module_key="sales_leads", record_id=lead.lead_id, values=custom_data_to_save)
        db.commit()
    return hydrate_custom_field_record(db, tenant_id=lead.tenant_id, module_key="sales_leads", record=lead, record_id=lead.lead_id)


def delete_sales_lead(db: Session, lead: SalesLead) -> None:
    lead.deleted_at = datetime.utcnow()
    db.add(lead)
    db.commit()


def list_deleted_sales_leads(db: Session, tenant_id: int, pagination: Pagination) -> tuple[Sequence[SalesLead], int]:
    return leads_repository.list_deleted_leads(db, tenant_id=tenant_id, pagination=pagination)


def restore_sales_lead(db: Session, lead: SalesLead) -> SalesLead:
    lead.deleted_at = None
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return hydrate_custom_field_record(db, tenant_id=lead.tenant_id, module_key="sales_leads", record=lead, record_id=lead.lead_id)


def import_leads_from_csv(
    db: Session,
    file_bytes: bytes,
    *,
    tenant_id: int,
    default_assigned_to: int | None,
    duplicate_mode: str | None = None,
    default_duplicate_mode: str | None = None,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> dict:
    mode = resolve_duplicate_mode(
        duplicate_mode=duplicate_mode,
        default_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required={"primary_email"})
    new_rows = overwritten_rows = merged_rows = skipped_rows = total_rows = 0
    failures: list[dict[str, str | int | None]] = []
    user_cache: dict[int, bool] = {}

    current_user = db.query(User).filter(User.id == default_assigned_to, User.tenant_id == tenant_id).first() if default_assigned_to else None
    for row_number, row in enumerate(row_iter, start=2):
        total_rows += 1
        normalized = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        email = normalized.get("primary_email")
        if not email:
            failures.append({"row_number": row_number, "record_identifier": None, "reason": "Missing required field 'primary_email'."})
            continue
        assigned_to = default_assigned_to
        if normalized.get("assigned_to"):
            try:
                assigned_to = int(normalized["assigned_to"])
            except (TypeError, ValueError):
                failures.append({"row_number": row_number, "record_identifier": email, "reason": f"Invalid assigned_to '{normalized.get('assigned_to')}'."})
                continue
        if assigned_to:
            if assigned_to not in user_cache:
                user_cache[assigned_to] = leads_repository.user_exists(db, tenant_id=tenant_id, user_id=assigned_to)
            if not user_cache[assigned_to]:
                failures.append({"row_number": row_number, "record_identifier": email, "reason": f"assigned_to '{assigned_to}' does not reference a valid user."})
                continue

        payload = {
            "first_name": _coerce_optional(normalized.get("first_name")),
            "last_name": _coerce_optional(normalized.get("last_name")),
            "company": _coerce_optional(normalized.get("company")),
            "primary_email": email,
            "phone": _coerce_optional(normalized.get("phone")),
            "title": _coerce_optional(normalized.get("title")),
            "source": _coerce_optional(normalized.get("source")),
            "status": _validate_status(normalized.get("status")),
            "notes": _coerce_optional(normalized.get("notes")),
            "assigned_to": assigned_to,
        }
        existing = (
            db.query(SalesLead)
            .filter(
                SalesLead.tenant_id == tenant_id,
                SalesLead.deleted_at.is_(None),
                func.lower(SalesLead.primary_email) == _normalize_email(email),
            )
            .first()
        )
        if existing and not create_new_records:
            if mode == DuplicateMode.skip:
                skipped_rows += 1
                continue
            if mode == DuplicateMode.overwrite:
                _apply_lead_payload(existing, payload)
                overwritten_rows += 1
            else:
                _merge_lead_payload(existing, payload)
                merged_rows += 1
            db.add(existing)
            continue

        lead = SalesLead(tenant_id=tenant_id, **payload)
        db.add(lead)
        new_rows += 1
        if current_user:
            lead.assigned_to = lead.assigned_to or current_user.id

    db.commit()
    return build_import_summary(
        total_rows=total_rows,
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


def export_leads_to_csv(records: Sequence[SalesLead], *, field_keys: list[str] | None = None) -> bytes:
    columns = [field for field in (field_keys or EXPORT_COLUMNS) if field in EXPORT_COLUMNS]
    if not columns:
        columns = EXPORT_COLUMNS
    rows = []
    for lead in records:
        row = {}
        for column in columns:
            value = getattr(lead, column, None)
            row[column] = value.isoformat() if hasattr(value, "isoformat") else value
        rows.append(row)
    return dict_rows_to_csv_bytes(headers=columns, rows=rows)
