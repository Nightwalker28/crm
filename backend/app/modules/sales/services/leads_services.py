from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
from app.modules.sales.models import SalesContact, SalesLead, SalesLeadScore, SalesOpportunity, SalesOrganization
from app.modules.sales.repositories import leads_repository, organizations_repository
from app.modules.sales.services.opportunities_services import OPPORTUNITY_STAGE_SET
from app.modules.user_management.models import User


LEAD_STATUSES = {"new", "contacted", "qualified", "unqualified", "converted"}
LEAD_SCORE_INACTIVE_STATUSES = {"unqualified", "converted"}
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


def _display_lead_name(lead: SalesLead) -> str:
    full_name = " ".join(part for part in [lead.first_name, lead.last_name] if part).strip()
    return full_name or lead.primary_email or "Lead"


def _ensure_assigned_user(db: Session, user_id: int | None, *, tenant_id: int) -> None:
    if user_id is None:
        return
    if not leads_repository.user_exists(db, user_id=user_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _get_active_organization(db: Session, *, tenant_id: int, organization_id: int) -> SalesOrganization:
    organization = (
        db.query(SalesOrganization)
        .filter(
            SalesOrganization.org_id == organization_id,
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
    if not organization:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account not found")
    return organization


def _get_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact:
    contact = (
        db.query(SalesContact)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    return contact


def _find_contact_by_email(db: Session, *, tenant_id: int, email: str) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
            func.lower(SalesContact.primary_email) == _normalize_email(email),
        )
        .first()
    )


def _validate_status(value: str | None) -> str:
    normalized = (value or "new").strip().lower()
    if normalized not in LEAD_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead status")
    return normalized


def _validate_conversion_deal_stage(value: str | None) -> str:
    normalized = (_coerce_optional(value) or "qualified").strip().lower().replace(" ", "_")
    if normalized not in OPPORTUNITY_STAGE_SET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid deal stage")
    return normalized


def _score_grade(score: int) -> str:
    if score >= 50:
        return "hot"
    if score >= 25:
        return "warm"
    return "cold"


def calculate_lead_score(lead: SalesLead, *, now: datetime | None = None) -> tuple[int, str, list[dict]]:
    status = (lead.status or "new").lower()
    if status in LEAD_SCORE_INACTIVE_STATUSES:
        return 0, "cold", [
            {
                "key": "inactive_status",
                "label": "Inactive status",
                "points": 0,
                "reason": "Converted and unqualified leads do not rank as active hot leads.",
            }
        ]

    factors: list[dict] = []
    score = 0

    def add_factor(key: str, label: str, points: int, reason: str, present: bool) -> None:
        nonlocal score
        if not present:
            return
        score += points
        factors.append({"key": key, "label": label, "points": points, "reason": reason})

    add_factor("has_email", "Has email", 10, "Lead has a reachable email address.", bool(_coerce_optional(lead.primary_email)))
    add_factor("has_phone", "Has phone", 10, "Lead has a phone number for direct follow-up.", bool(_coerce_optional(lead.phone)))
    add_factor("has_company", "Has company", 10, "Lead is attached to a company or account name.", bool(_coerce_optional(lead.company)))
    add_factor("has_source", "Has source", 10, "Lead includes source attribution.", bool(_coerce_optional(lead.source)))
    add_factor("contacted", "Contacted", 10, "Lead has already been contacted.", status in {"contacted", "qualified"})
    add_factor("qualified", "Qualified", 20, "Lead has been qualified by sales.", status == "qualified")

    if lead.last_contacted_at:
        reference = now or datetime.now(timezone.utc)
        contacted_at = lead.last_contacted_at
        if contacted_at.tzinfo is None:
            contacted_at = contacted_at.replace(tzinfo=timezone.utc)
        add_factor(
            "recent_follow_up",
            "Recent follow-up",
            10,
            "Lead has follow-up activity in the last 30 days.",
            contacted_at >= reference - timedelta(days=30),
        )

    normalized_score = max(0, min(score, 100))
    return normalized_score, _score_grade(normalized_score), factors


def recalculate_lead_score(db: Session, lead: SalesLead) -> SalesLeadScore:
    score, grade, factors = calculate_lead_score(lead)
    record = lead.score_record
    if record is None:
        record = SalesLeadScore(tenant_id=lead.tenant_id, lead_id=lead.lead_id)
    record.score = score
    record.grade = grade
    record.factors_json = factors
    record.calculated_at = datetime.now(timezone.utc)
    db.add(record)
    lead.score_record = record
    return record


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
            recalculate_lead_score(db, existing)
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
        db.flush()
        recalculate_lead_score(db, lead)
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
    recalculate_lead_score(db, lead)
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


def convert_sales_lead(db: Session, lead: SalesLead, payload: dict, *, current_user) -> dict:
    tenant_id = current_user.tenant_id
    if lead.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if lead.status == "converted":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead is already converted")

    assigned_to = payload.get("assigned_to") or lead.assigned_to or current_user.id
    _ensure_assigned_user(db, assigned_to, tenant_id=tenant_id)
    deal_stage = _validate_conversion_deal_stage(payload.get("deal_stage")) if payload.get("create_deal") else None

    create_account = bool(payload.get("create_account", True))
    account_id = payload.get("account_id")
    organization: SalesOrganization | None = None
    created_account = False

    if account_id is not None:
        organization = _get_active_organization(db, tenant_id=tenant_id, organization_id=account_id)
    elif create_account:
        org_name = _coerce_optional(lead.company) or _display_lead_name(lead)
        organization = organizations_repository.find_active_by_name(db, tenant_id=tenant_id, org_name=org_name)
        if organization is None:
            organization = SalesOrganization(
                tenant_id=tenant_id,
                org_name=org_name,
                primary_email=lead.primary_email,
                primary_phone=lead.phone,
                assigned_to=assigned_to,
            )
            db.add(organization)
            db.flush()
            created_account = True

    create_contact = bool(payload.get("create_contact", True))
    contact_id = payload.get("contact_id")
    contact: SalesContact | None = None
    created_contact = False

    if contact_id is not None:
        contact = _get_active_contact(db, tenant_id=tenant_id, contact_id=contact_id)
        if organization is not None and contact.organization_id is None:
            contact.organization_id = organization.org_id
    elif create_contact:
        contact = _find_contact_by_email(db, tenant_id=tenant_id, email=lead.primary_email)
        if contact is None:
            contact = SalesContact(
                tenant_id=tenant_id,
                first_name=lead.first_name,
                last_name=lead.last_name,
                contact_telephone=lead.phone,
                primary_email=lead.primary_email,
                current_title=lead.title,
                assigned_to=assigned_to,
                organization_id=organization.org_id if organization else None,
            )
            db.add(contact)
            db.flush()
            created_contact = True
        elif organization is not None and contact.organization_id is None:
            contact.organization_id = organization.org_id

    opportunity: SalesOpportunity | None = None
    created_deal = False
    if payload.get("create_deal"):
        if contact is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A contact is required to create a deal")
        deal_name = _coerce_optional(payload.get("deal_name")) or f"{_display_lead_name(lead)} opportunity"
        opportunity = SalesOpportunity(
            tenant_id=tenant_id,
            opportunity_name=deal_name,
            client=" ".join(part for part in [contact.first_name, contact.last_name] if part).strip() or contact.primary_email,
            sales_stage=deal_stage,
            contact_id=contact.contact_id,
            organization_id=organization.org_id if organization else contact.organization_id,
            assigned_to=assigned_to,
        )
        db.add(opportunity)
        db.flush()
        created_deal = True

    lead.status = "converted"
    if assigned_to and lead.assigned_to is None:
        lead.assigned_to = assigned_to
    db.add(lead)
    recalculate_lead_score(db, lead)
    db.commit()
    db.refresh(lead)
    if organization is not None:
        db.refresh(organization)
    if contact is not None:
        db.refresh(contact)
    if opportunity is not None:
        db.refresh(opportunity)

    return {
        "lead": hydrate_custom_field_record(db, tenant_id=tenant_id, module_key="sales_leads", record=lead, record_id=lead.lead_id),
        "account_id": organization.org_id if organization else None,
        "contact_id": contact.contact_id if contact else None,
        "deal_id": opportunity.opportunity_id if opportunity else None,
        "created_account": created_account,
        "created_contact": created_contact,
        "created_deal": created_deal,
    }


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
            recalculate_lead_score(db, existing)
            continue

        lead = SalesLead(tenant_id=tenant_id, **payload)
        db.add(lead)
        db.flush()
        new_rows += 1
        if current_user:
            lead.assigned_to = lead.assigned_to or current_user.id
        recalculate_lead_score(db, lead)

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
