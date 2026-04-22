from typing import Iterable, Sequence
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, detect_duplicates, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_filters import apply_filter_conditions
from app.core.module_csv import build_import_summary, require_csv_headers, rows_from_csv_bytes
from app.core.module_export import dict_rows_to_csv_bytes
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination
from app.core.postgres_search import searchable_text
from app.modules.platform.services.custom_fields import (
    build_custom_field_filter_map,
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.models import User

EXPORT_COLUMNS = [
    "contact_id",
    "first_name",
    "last_name",
    "contact_telephone",
    "linkedin_url",
    "primary_email",
    "current_title",
    "region",
    "country",
    "email_opt_out",
    "assigned_to",
    "organization_id",
    "created_time",
]


def _normalize_email(value: str | None) -> str:
    if not value:
        return ""
    return value.strip().lower()


def _normalize_name(first_name: str | None, last_name: str | None) -> str:
    if not first_name or not last_name:
        return ""
    return f"{first_name.strip()} {last_name.strip()}".strip().lower()


def _apply_search_filter(query, search: str | None):
    document = searchable_text(
        SalesContact.first_name,
        SalesContact.last_name,
        SalesContact.contact_telephone,
        SalesContact.primary_email,
        SalesContact.current_title,
        SalesContact.region,
        SalesContact.country,
        SalesContact.linkedin_url,
    )
    return apply_ranked_search(
        query,
        search=search,
        document=document,
        default_order_column=SalesContact.created_time,
    )


def _build_contacts_query(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = (
        db.query(SalesContact)
        .outerjoin(SalesOrganization)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
    )
    filter_field_map = {
        "first_name": {"expression": SalesContact.first_name, "type": "text"},
        "last_name": {"expression": SalesContact.last_name, "type": "text"},
        "primary_email": {"expression": SalesContact.primary_email, "type": "text"},
        "current_title": {"expression": SalesContact.current_title, "type": "text"},
        "region": {"expression": SalesContact.region, "type": "text"},
        "country": {"expression": SalesContact.country, "type": "text"},
        "linkedin_url": {"expression": SalesContact.linkedin_url, "type": "text"},
        "organization_name": {"expression": SalesOrganization.org_name, "type": "text"},
        "created_time": {"expression": SalesContact.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_contacts",
            record_id_expression=SalesContact.contact_id,
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
    return _apply_search_filter(query, search)


def _ensure_assigned_user(db: Session, user_id: int, *, tenant_id: int):
    exists = db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assigned user not found",
        )


def list_sales_contacts(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[SalesContact], int]:
    query = _build_contacts_query(
        db,
        tenant_id,
        search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )

    total_count = query.count()
    contacts = query.offset(pagination.offset).limit(pagination.limit).all()
    contacts = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_contacts",
        records=contacts,
        record_id_attr="contact_id",
    )
    return contacts, total_count


def list_all_sales_contacts(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesContact]:
    return (
        _build_contacts_query(
            db,
            tenant_id,
            search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesContact.created_time.desc())
        .all()
    )


def get_contact_or_404(db: Session, contact_id: int, *, tenant_id: int, include_deleted: bool = False) -> SalesContact:
    query = db.query(SalesContact).filter(
        SalesContact.contact_id == contact_id,
        SalesContact.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesContact.deleted_at.is_(None))
    contact = query.first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_contacts",
        record=contact,
        record_id=contact.contact_id,
    )


def _apply_sales_contact_payload(contact: SalesContact, payload: dict) -> None:
    for field, value in payload.items():
        setattr(contact, field, value)


def _merge_sales_contact_payload(contact: SalesContact, payload: dict) -> None:
    for field, value in payload.items():
        if should_merge_value(getattr(contact, field, None), value):
            setattr(contact, field, value)


def create_sales_contact(
    db: Session,
    payload: dict,
    current_user,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> SalesContact:
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )

    data = dict(payload)
    custom_data = validate_custom_field_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_contacts",
        payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id if current_user else None
    if not data.get("assigned_to"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="assigned_to is required",
        )
    _ensure_assigned_user(db, data["assigned_to"], tenant_id=current_user.tenant_id)

    email = data.get("primary_email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="primary_email is required")

    normalized_name = _normalize_name(data.get("first_name"), data.get("last_name"))
    existing = (
        db.query(SalesContact)
        .filter(
            SalesContact.tenant_id == current_user.tenant_id,
            SalesContact.deleted_at.is_(None),
            or_(
                func.lower(SalesContact.primary_email) == _normalize_email(email),
                and_(
                    normalized_name != "",
                    func.lower(SalesContact.first_name) == (data.get("first_name") or "").strip().lower(),
                    func.lower(SalesContact.last_name) == (data.get("last_name") or "").strip().lower(),
                ),
            )
        )
        .first()
    )
    if existing and not create_new_records:
        if skip_duplicates:
            return hydrate_custom_field_record(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_contacts",
                record=existing,
                record_id=existing.contact_id,
            )
        if replace_duplicates:
            _apply_sales_contact_payload(existing, data)
            db.add(existing)
            db.commit()
            db.refresh(existing)
            save_custom_field_values(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_contacts",
                record_id=existing.contact_id,
                values=existing.custom_data or {},
            )
            db.commit()
            return hydrate_custom_field_record(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_contacts",
                record=existing,
                record_id=existing.contact_id,
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{email} or {normalized_name or 'contact name'} already exists. Resend with "
                "replace_duplicates=true to overwrite, "
                "skip_duplicates=true to leave the existing contact unchanged, or "
                "create_new_records=true to add a new contact with the same email."
            ),
        )

    data["tenant_id"] = current_user.tenant_id
    contact = SalesContact(**data)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    save_custom_field_values(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_contacts",
        record_id=contact.contact_id,
        values=custom_data,
    )
    db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_contacts",
        record=contact,
        record_id=contact.contact_id,
    )


def update_sales_contact(db: Session, contact: SalesContact, data: dict) -> SalesContact:
    if "custom_fields" in data:
        data["custom_data"] = validate_custom_field_payload(
            db,
            tenant_id=contact.tenant_id,
            module_key="sales_contacts",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=contact.tenant_id,
                module_key="sales_contacts",
                record_id=contact.contact_id,
                fallback=contact.custom_data,
            ),
        )

    if "assigned_to" in data:
        if data["assigned_to"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="assigned_to cannot be null",
            )
        _ensure_assigned_user(db, data["assigned_to"], tenant_id=contact.tenant_id)

    if "primary_email" in data and data["primary_email"]:
        normalized_email = _normalize_email(data["primary_email"])
        duplicate = (
            db.query(SalesContact)
            .filter(
                SalesContact.deleted_at.is_(None),
                SalesContact.tenant_id == contact.tenant_id,
                func.lower(SalesContact.primary_email) == normalized_email,
                SalesContact.contact_id != contact.contact_id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Another contact already uses this email",
            )

    _apply_sales_contact_payload(contact, data)

    db.add(contact)
    db.commit()
    db.refresh(contact)
    save_custom_field_values(
        db,
        tenant_id=contact.tenant_id,
        module_key="sales_contacts",
        record_id=contact.contact_id,
        values=contact.custom_data or {},
    )
    db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=contact.tenant_id,
        module_key="sales_contacts",
        record=contact,
        record_id=contact.contact_id,
    )


def delete_sales_contact(db: Session, contact: SalesContact) -> None:
    contact.deleted_at = datetime.utcnow()
    db.add(contact)
    db.commit()


def list_deleted_sales_contacts(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[Sequence[SalesContact], int]:
    query = db.query(SalesContact).filter(
        SalesContact.tenant_id == tenant_id,
        SalesContact.deleted_at.is_not(None),
    )
    total_count = query.count()
    contacts = (
        query.order_by(SalesContact.deleted_at.desc(), SalesContact.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return contacts, total_count


def restore_sales_contact(db: Session, contact: SalesContact) -> SalesContact:
    contact.deleted_at = None
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return hydrate_custom_field_record(
        db,
        tenant_id=contact.tenant_id,
        module_key="sales_contacts",
        record=contact,
        record_id=contact.contact_id,
    )


def _coerce_optional(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _parse_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    value = value.strip().lower()
    if value in {"1", "true", "yes", "y"}:
        return True
    if value in {"0", "false", "no", "n"}:
        return False
    return None


def import_contacts_from_csv(
    db: Session,
    file_bytes: bytes,
    tenant_id: int,
    default_assigned_to: int,
    duplicate_mode: str | None = None,
    default_duplicate_mode: str | None = None,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
):
    mode = resolve_duplicate_mode(
        duplicate_mode=duplicate_mode,
        default_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    headers, parsed_rows = rows_from_csv_bytes(file_bytes)
    require_csv_headers(headers, required={"primary_email"})

    new_rows = overwritten_rows = merged_rows = skipped_rows = 0
    failures: list[dict[str, str | int | None]] = []
    user_cache: dict[int, bool] = {}
    rows: list[dict] = []
    emails: list[str] = []
    names: list[str] = []

    for row_number, row in enumerate(parsed_rows, start=2):
        normalized = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}

        email = normalized.get("primary_email")
        if not email:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": None,
                    "reason": "Missing required field 'primary_email'.",
                }
            )
            continue

        assigned_to_str = normalized.get("assigned_to")
        assigned_to = default_assigned_to
        if assigned_to_str:
            try:
                assigned_to = int(assigned_to_str)
            except ValueError:
                failures.append(
                    {
                        "row_number": row_number,
                        "record_identifier": email,
                        "reason": f"Invalid assigned_to '{assigned_to_str}'.",
                    }
                )
                continue

        if assigned_to not in user_cache:
            user_cache[assigned_to] = bool(
                db.query(User.id).filter(User.id == assigned_to, User.tenant_id == tenant_id).first()
            )
        if not user_cache[assigned_to]:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": email,
                    "reason": f"assigned_to '{assigned_to}' does not reference a valid user.",
                }
            )
            continue

        email_opt_out_value = normalized.get("email_opt_out")
        parsed_opt_out = None
        if email_opt_out_value is not None and email_opt_out_value != "":
            parsed_opt_out = _parse_bool(email_opt_out_value)
            if parsed_opt_out is None:
                failures.append(
                    {
                        "row_number": row_number,
                        "record_identifier": email,
                        "reason": f"email_opt_out '{email_opt_out_value}' must be true/false/1/0.",
                    }
                )
                continue

        org_raw = normalized.get("organization_id")
        organization_id = _parse_int_or_none(org_raw)
        if org_raw and organization_id is None:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": email,
                    "reason": f"Invalid organization_id '{org_raw}'.",
                }
            )
            continue

        payload = {
            "first_name": _coerce_optional(normalized.get("first_name")),
            "last_name": _coerce_optional(normalized.get("last_name")),
            "contact_telephone": _coerce_optional(normalized.get("contact_telephone")),
            "linkedin_url": _coerce_optional(normalized.get("linkedin_url")),
            "primary_email": email,
            "current_title": _coerce_optional(normalized.get("current_title")),
            "region": _coerce_optional(normalized.get("region")),
            "country": _coerce_optional(normalized.get("country")),
            "organization_id": organization_id,
            "email_opt_out": parsed_opt_out if parsed_opt_out is not None else False,
            "assigned_to": assigned_to,
        }
        rows.append(payload)
        emails.append(_normalize_email(email))
        names.append(_normalize_name(payload.get("first_name"), payload.get("last_name")))

    normalized_emails = [email for email in emails if email]
    normalized_names = [name for name in names if name]
    existing_duplicates = {
        row.primary_email.lower()
        for row in db.query(SalesContact.primary_email)
        .filter(
            func.lower(SalesContact.primary_email).in_(normalized_emails),
            SalesContact.deleted_at.is_(None),
        )
        .distinct()
    }
    existing_name_duplicates = set()
    first_names = {name.split(" ", 1)[0] for name in normalized_names if " " in name}
    last_names = {name.split(" ", 1)[1] for name in normalized_names if " " in name}
    if first_names and last_names:
        existing_name_duplicates = {
            _normalize_name(row.first_name, row.last_name)
            for row in db.query(SalesContact.first_name, SalesContact.last_name)
            .filter(
                and_(
                    func.lower(SalesContact.first_name).in_(first_names),
                    func.lower(SalesContact.last_name).in_(last_names),
                    SalesContact.deleted_at.is_(None),
                )
            )
            .distinct()
        }

    detection = detect_duplicates(normalized_emails, existing_values=existing_duplicates)
    name_detection = detect_duplicates(normalized_names, existing_values=existing_name_duplicates)
    if (existing_duplicates or existing_name_duplicates) and duplicate_mode is None and not any(
        (replace_duplicates, skip_duplicates, create_new_records)
    ) and default_duplicate_mode is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    "Duplicate contacts detected. Resend with "
                    "replace_duplicates=true to overwrite them, "
                    "skip_duplicates=true to leave the existing contacts untouched, or "
                    "create_new_records=true to add new contacts alongside the existing ones."
                ),
                "duplicate_emails": detection.duplicate_values,
                "duplicate_names": name_detection.duplicate_values,
                "requires_confirmation": True,
            },
        )

    existing_by_email = {
        row.primary_email.lower(): row
        for row in db.query(SalesContact)
        .filter(
            func.lower(SalesContact.primary_email).in_(normalized_emails),
            SalesContact.deleted_at.is_(None),
        )
        .all()
    }
    existing_by_name = {}
    if first_names and last_names:
        existing_by_name = {
            _normalize_name(row.first_name, row.last_name): row
            for row in db.query(SalesContact)
            .filter(
                and_(
                    func.lower(SalesContact.first_name).in_(first_names),
                    func.lower(SalesContact.last_name).in_(last_names),
                    SalesContact.deleted_at.is_(None),
                )
            )
            .all()
        }

    for payload in rows:
        normalized_email = _normalize_email(payload["primary_email"])
        normalized_name = _normalize_name(payload.get("first_name"), payload.get("last_name"))
        existing = None
        if not create_new_records:
            existing = existing_by_email.get(normalized_email)
            if not existing and normalized_name:
                existing = existing_by_name.get(normalized_name)

        if existing and mode == DuplicateMode.skip:
            skipped_rows += 1
            continue

        if existing and mode == DuplicateMode.overwrite:
            _apply_sales_contact_payload(existing, payload)
            db.add(existing)
            overwritten_rows += 1
            continue

        if existing and mode == DuplicateMode.merge:
            _merge_sales_contact_payload(existing, payload)
            db.add(existing)
            merged_rows += 1
            continue

        contact = SalesContact(**payload)
        db.add(contact)
        new_rows += 1

    db.commit()

    return build_import_summary(
        total_rows=len(parsed_rows),
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


def _parse_int_or_none(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def export_contacts_to_csv(contacts: Iterable[SalesContact]) -> bytes:
    return dict_rows_to_csv_bytes(
        headers=EXPORT_COLUMNS,
        rows=(
            {
                "contact_id": contact.contact_id,
                "first_name": contact.first_name or "",
                "last_name": contact.last_name or "",
                "contact_telephone": contact.contact_telephone or "",
                "linkedin_url": contact.linkedin_url or "",
                "primary_email": contact.primary_email or "",
                "current_title": contact.current_title or "",
                "region": contact.region or "",
                "country": contact.country or "",
                "email_opt_out": str(contact.email_opt_out).lower(),
                "assigned_to": contact.assigned_to,
                "organization_id": contact.organization_id or "",
                "created_time": contact.created_time.isoformat() if contact.created_time else "",
            }
            for contact in contacts
        ),
    )


def get_all_contacts(db: Session, *, tenant_id: int, search: str | None = None) -> list[SalesContact]:
    query = _apply_search_filter(
        db.query(SalesContact).filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        ),
        search,
    )
    contacts = query.order_by(SalesContact.created_time.desc()).all()
    return hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_contacts",
        records=contacts,
        record_id_attr="contact_id",
    )
