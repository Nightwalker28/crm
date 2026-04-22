import json
from pathlib import Path
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, detect_duplicates, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, require_csv_headers, rows_from_csv_bytes
from app.core.pagination import Pagination
from app.core.module_filters import apply_filter_conditions
from app.core.module_export import dict_rows_to_csv_bytes
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.platform.services.custom_fields import (
    build_custom_field_filter_map,
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesOpportunity, SalesContact, SalesOrganization
from app.modules.user_management.services.profile import get_company_operating_currencies
from app.modules.user_management.models import User

BACKEND_DIR = Path(__file__).resolve().parents[4]
OPPORTUNITY_ATTACHMENTS_DIR = BACKEND_DIR / "uploads" / "opportunities-attachments"
OPPORTUNITY_ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
OPPORTUNITY_IMPORT_HEADERS = {"opportunity_name", "contact_id"}
OPPORTUNITY_EXPORT_HEADERS = [
    "opportunity_id",
    "opportunity_name",
    "client",
    "contact_id",
    "organization_id",
    "sales_stage",
    "assigned_to",
    "start_date",
    "expected_close_date",
    "campaign_type",
    "total_leads",
    "cpl",
    "total_cost_of_project",
    "currency_type",
    "target_geography",
    "target_audience",
    "domain_cap",
    "tactics",
    "delivery_format",
    "attachments",
    "created_time",
]

OPPORTUNITY_STAGE_ORDER = [
    "lead",
    "qualified",
    "proposal",
    "negotiation",
    "closed_won",
    "closed_lost",
]

OPPORTUNITY_STAGE_LABELS = {
    "lead": "Lead",
    "qualified": "Qualified",
    "proposal": "Proposal",
    "negotiation": "Negotiation",
    "closed_won": "Closed Won",
    "closed_lost": "Closed Lost",
    "unstaged": "Unstaged",
}


def parse_attachment_paths(value: str | list[str] | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed if item]
        except json.JSONDecodeError:
            pass
        if value:
            return [value]
    return []


def _serialize_attachment_paths(value: str | list[str] | None) -> str | None:
    paths = parse_attachment_paths(value)
    if not paths:
        return None
    return json.dumps(paths)


def _ensure_user(db: Session, user_id: int, *, tenant_id: int):
    exists = db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _ensure_contact(db: Session, contact_id: int, *, tenant_id: int):
    exists = (
        db.query(SalesContact.contact_id)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")


def _get_contact_or_404(db: Session, contact_id: int, *, tenant_id: int) -> SalesContact:
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


def _ensure_organization(db: Session, organization_id: int, *, tenant_id: int):
    exists = (
        db.query(SalesOrganization.org_id)
        .filter(
            SalesOrganization.org_id == organization_id,
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")


def _apply_search_filter(query, search: str | None):
    document = searchable_text(
        SalesOpportunity.opportunity_name,
        SalesOpportunity.client,
        SalesOpportunity.sales_stage,
        SalesOpportunity.campaign_type,
        SalesOpportunity.target_geography,
        SalesOpportunity.target_audience,
        SalesOpportunity.tactics,
    )
    return apply_ranked_search(
        query,
        search=search,
        document=document,
        default_order_column=SalesOpportunity.created_time,
    )


def _build_opportunity_query(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_(None),
    )
    filter_field_map = {
        "opportunity_name": {"expression": SalesOpportunity.opportunity_name, "type": "text"},
        "client": {"expression": SalesOpportunity.client, "type": "text"},
        "sales_stage": {"expression": SalesOpportunity.sales_stage, "type": "text"},
        "expected_close_date": {"expression": SalesOpportunity.expected_close_date, "type": "date"},
        "total_cost_of_project": {"expression": SalesOpportunity.total_cost_of_project, "type": "number"},
        "currency_type": {"expression": SalesOpportunity.currency_type, "type": "text"},
        "target_geography": {"expression": SalesOpportunity.target_geography, "type": "text"},
        "created_time": {"expression": SalesOpportunity.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_opportunities",
            record_id_expression=SalesOpportunity.opportunity_id,
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


def list_all_opportunities(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOpportunity]:
    return (
        _build_opportunity_query(
            db,
            tenant_id,
            search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesOpportunity.created_time.desc())
        .all()
    )


def _normalize_stage(stage: str | None) -> str:
    normalized = (stage or "").strip().lower().replace(" ", "_")
    return normalized or "unstaged"


def _parse_numeric_value(raw_value: str | None) -> Decimal:
    if raw_value is None:
        return Decimal("0")
    cleaned = str(raw_value).strip().replace(",", "")
    if not cleaned:
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return Decimal("0")

def _contact_display_name(contact: SalesContact) -> str:
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email or "Unnamed Contact"


def _normalize_currency(db: Session, current_user, currency: str | None) -> str:
    allowed = get_company_operating_currencies(db, current_user)
    normalized = (currency or allowed[0]).strip().upper()
    if normalized not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Currency must be one of: {', '.join(allowed)}",
        )
    return normalized


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_optional_date(value: str | None) -> date | None:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid date value '{value}'. Expected YYYY-MM-DD.",
        )


def list_opportunities(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list[SalesOpportunity], int]:
    query = _build_opportunity_query(
        db,
        tenant_id,
        search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    items = query.offset(pagination.offset).limit(pagination.limit).all()
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )
    return items, total_count


def summarize_opportunity_pipeline(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> dict:
    query = _build_opportunity_query(
        db,
        tenant_id,
        search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    items = query.all()

    summary = {
        stage: {"stage_key": stage, "label": OPPORTUNITY_STAGE_LABELS[stage], "count": 0, "total_value": Decimal("0")}
        for stage in OPPORTUNITY_STAGE_ORDER
    }
    summary["unstaged"] = {
        "stage_key": "unstaged",
        "label": OPPORTUNITY_STAGE_LABELS["unstaged"],
        "count": 0,
        "total_value": Decimal("0"),
    }

    for item in items:
        stage_key = _normalize_stage(item.sales_stage)
        bucket = summary.get(stage_key) or summary["unstaged"]
        bucket["count"] += 1
        bucket["total_value"] += _parse_numeric_value(item.total_cost_of_project)

    ordered_keys = [*OPPORTUNITY_STAGE_ORDER, "unstaged"]
    stages = [
        {
            "stage_key": key,
            "label": summary[key]["label"],
            "count": summary[key]["count"],
            "total_value": float(summary[key]["total_value"]),
        }
        for key in ordered_keys
    ]
    return {
        "total_count": len(items),
        "stages": stages,
    }


def list_deleted_opportunities(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[list[SalesOpportunity], int]:
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_not(None),
    )
    total_count = query.count()
    items = (
        query.order_by(SalesOpportunity.deleted_at.desc(), SalesOpportunity.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )
    return items, total_count


def get_opportunity_or_404(
    db: Session,
    opportunity_id: int,
    *,
    tenant_id: int,
    include_deleted: bool = False,
) -> SalesOpportunity:
    opportunity = (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.opportunity_id == opportunity_id,
            SalesOpportunity.tenant_id == tenant_id,
        )
        .filter(SalesOpportunity.deleted_at.is_not(None) if include_deleted else SalesOpportunity.deleted_at.is_(None))
        .first()
    )
    if not opportunity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def create_opportunity(db: Session, data: dict, *, current_user) -> SalesOpportunity:
    custom_data = validate_custom_field_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_opportunities",
        payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    contact_id = data.get("contact_id")
    if contact_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="contact_id is required")
    contact = _get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id)
    data["client"] = _contact_display_name(contact)
    if not data.get("organization_id") and contact.organization_id is not None:
        data["organization_id"] = contact.organization_id

    organization_id = data.get("organization_id")
    if organization_id is not None:
        _ensure_organization(db, organization_id, tenant_id=current_user.tenant_id)

    assigned_to = data.get("assigned_to")
    if assigned_to is not None:
        _ensure_user(db, assigned_to, tenant_id=current_user.tenant_id)

    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))
    if "currency_type" in data:
        data["currency_type"] = _normalize_currency(db, current_user, data.get("currency_type"))

    data["tenant_id"] = current_user.tenant_id
    opportunity = SalesOpportunity(**data)
    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)
    save_custom_field_values(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_opportunities",
        record_id=opportunity.opportunity_id,
        values=custom_data,
    )
    db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def update_opportunity(db: Session, opportunity: SalesOpportunity, data: dict, *, current_user) -> SalesOpportunity:
    if "custom_fields" in data:
        data["custom_data"] = validate_custom_field_payload(
            db,
            tenant_id=opportunity.tenant_id,
            module_key="sales_opportunities",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=opportunity.tenant_id,
                module_key="sales_opportunities",
                record_id=opportunity.opportunity_id,
                fallback=opportunity.custom_data,
            ),
        )
    if "contact_id" in data:
        if data["contact_id"] is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="contact_id cannot be null")
        contact = _get_contact_or_404(db, data["contact_id"], tenant_id=opportunity.tenant_id)
        data["client"] = _contact_display_name(contact)
        if "organization_id" not in data and contact.organization_id is not None:
            data["organization_id"] = contact.organization_id
    if "organization_id" in data and data["organization_id"] is not None:
        _ensure_organization(db, data["organization_id"], tenant_id=opportunity.tenant_id)
    if "assigned_to" in data and data["assigned_to"] is not None:
        _ensure_user(db, data["assigned_to"], tenant_id=opportunity.tenant_id)
    if "attachments" in data:
        data["attachments"] = _serialize_attachment_paths(data.get("attachments"))
    if "currency_type" in data and data["currency_type"] is not None:
        data["currency_type"] = _normalize_currency(db, current_user, data.get("currency_type"))

    for field, value in data.items():
        setattr(opportunity, field, value)

    db.commit()
    db.refresh(opportunity)
    save_custom_field_values(
        db,
        tenant_id=opportunity.tenant_id,
        module_key="sales_opportunities",
        record_id=opportunity.opportunity_id,
        values=opportunity.custom_data or {},
    )
    db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=opportunity.tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def delete_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    opportunity.deleted_at = func.now()
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db,
        tenant_id=opportunity.tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def restore_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    opportunity.deleted_at = None
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db,
        tenant_id=opportunity.tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def import_opportunities_from_csv(
    db: Session,
    file_bytes: bytes,
    current_user,
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
    headers, parsed_rows = rows_from_csv_bytes(file_bytes)
    require_csv_headers(headers, required=OPPORTUNITY_IMPORT_HEADERS)

    new_rows = overwritten_rows = merged_rows = skipped_rows = 0
    failures: list[dict[str, str | int | None]] = []
    rows: list[tuple[int, dict]] = []
    names: list[str] = []

    for row_number, row in enumerate(parsed_rows, start=2):
        normalized = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        opportunity_name = (normalized.get("opportunity_name") or "").strip()
        contact_id_raw = (normalized.get("contact_id") or "").strip()
        if not opportunity_name or not contact_id_raw:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": opportunity_name or None,
                    "reason": "Missing required fields 'opportunity_name' and/or 'contact_id'.",
                }
            )
            continue

        contact_id = _parse_optional_int(contact_id_raw)
        if contact_id is None:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": opportunity_name,
                    "reason": f"Invalid contact_id '{contact_id_raw}'.",
                }
            )
            continue

        assigned_to = _parse_optional_int((normalized.get("assigned_to") or "").strip()) or (current_user.id if current_user else None)
        organization_id_raw = (normalized.get("organization_id") or "").strip()
        organization_id = _parse_optional_int(organization_id_raw)
        if organization_id_raw and organization_id is None:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": opportunity_name,
                    "reason": f"Invalid organization_id '{organization_id_raw}'.",
                }
            )
            continue

        try:
            payload = {
                "opportunity_name": opportunity_name,
                "contact_id": contact_id,
                "organization_id": organization_id,
                "assigned_to": assigned_to,
                "sales_stage": (normalized.get("sales_stage") or "").strip() or None,
                "start_date": _parse_optional_date((normalized.get("start_date") or "").strip()),
                "expected_close_date": _parse_optional_date((normalized.get("expected_close_date") or "").strip()),
                "campaign_type": (normalized.get("campaign_type") or "").strip() or None,
                "total_leads": (normalized.get("total_leads") or "").strip() or None,
                "cpl": (normalized.get("cpl") or "").strip() or None,
                "total_cost_of_project": (normalized.get("total_cost_of_project") or "").strip() or None,
                "currency_type": (normalized.get("currency_type") or "").strip() or None,
                "target_geography": (normalized.get("target_geography") or "").strip() or None,
                "target_audience": (normalized.get("target_audience") or "").strip() or None,
                "domain_cap": (normalized.get("domain_cap") or "").strip() or None,
                "tactics": (normalized.get("tactics") or "").strip() or None,
                "delivery_format": (normalized.get("delivery_format") or "").strip() or None,
            }
        except HTTPException as exc:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": opportunity_name,
                    "reason": str(exc.detail),
                }
            )
            continue

        rows.append((row_number, payload))
        names.append(opportunity_name)

    existing_duplicates = {
        row.opportunity_name
        for row in db.query(SalesOpportunity.opportunity_name)
        .filter(
            SalesOpportunity.opportunity_name.in_(names),
            SalesOpportunity.deleted_at.is_(None),
        )
        .distinct()
    }
    detection = detect_duplicates(names, existing_values=existing_duplicates)
    if existing_duplicates and duplicate_mode is None and not any((replace_duplicates, skip_duplicates, create_new_records)) and default_duplicate_mode is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    "Duplicate opportunities detected. Resend with "
                    "replace_duplicates=true to overwrite them, "
                    "skip_duplicates=true to leave the existing opportunities untouched, or "
                    "create_new_records=true to add new opportunities alongside the existing ones."
                ),
                "duplicate_opportunities": detection.duplicate_values,
                "requires_confirmation": True,
            },
        )

    existing_by_name = {
        row.opportunity_name: row
        for row in db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.opportunity_name.in_(names),
            SalesOpportunity.deleted_at.is_(None),
        )
        .all()
    }

    for row_number, payload in rows:
        existing = None if create_new_records else existing_by_name.get(payload["opportunity_name"])
        try:
            if existing and mode == DuplicateMode.skip:
                skipped_rows += 1
                continue
            if existing and mode == DuplicateMode.overwrite:
                update_opportunity(db, existing, payload)
                overwritten_rows += 1
                continue
            if existing and mode == DuplicateMode.merge:
                merge_payload = {
                    field: value
                    for field, value in payload.items()
                    if should_merge_value(getattr(existing, field, None), value)
                }
                if merge_payload:
                    update_opportunity(db, existing, merge_payload)
                merged_rows += 1
                continue
            create_opportunity(db, payload)
            new_rows += 1
        except HTTPException as exc:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": payload["opportunity_name"],
                    "reason": str(exc.detail),
                }
            )

    return build_import_summary(
        total_rows=len(parsed_rows),
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


def export_opportunities_to_csv(opportunities: list[SalesOpportunity]) -> bytes:
    return dict_rows_to_csv_bytes(
        headers=OPPORTUNITY_EXPORT_HEADERS,
        rows=(
            {
                "opportunity_id": opportunity.opportunity_id,
                "opportunity_name": opportunity.opportunity_name or "",
                "client": opportunity.client or "",
                "contact_id": opportunity.contact_id or "",
                "organization_id": opportunity.organization_id or "",
                "sales_stage": opportunity.sales_stage or "",
                "assigned_to": opportunity.assigned_to or "",
                "start_date": opportunity.start_date.isoformat() if opportunity.start_date else "",
                "expected_close_date": opportunity.expected_close_date.isoformat() if opportunity.expected_close_date else "",
                "campaign_type": opportunity.campaign_type or "",
                "total_leads": opportunity.total_leads or "",
                "cpl": opportunity.cpl or "",
                "total_cost_of_project": opportunity.total_cost_of_project or "",
                "currency_type": opportunity.currency_type or "",
                "target_geography": opportunity.target_geography or "",
                "target_audience": opportunity.target_audience or "",
                "domain_cap": opportunity.domain_cap or "",
                "tactics": opportunity.tactics or "",
                "delivery_format": opportunity.delivery_format or "",
                "attachments": json.dumps(parse_attachment_paths(opportunity.attachments)),
                "created_time": opportunity.created_time.isoformat() if opportunity.created_time else "",
            }
            for opportunity in opportunities
        ),
    )
