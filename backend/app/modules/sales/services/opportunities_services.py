from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, detect_duplicates, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers
from app.core.pagination import Pagination
from app.core.module_export import dict_rows_to_csv_bytes
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.inventory.services.costing import BaseCurrencyTotals, base_currency
from app.modules.platform.services.custom_fields import export_extension
from app.modules.platform.services.picklists import PicklistResolver
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.sales.repositories import opportunities_repository, pipelines_repository
from app.modules.sales.services import pipelines_services
from app.modules.sales.services.opportunity_contacts_services import sync_primary_contact_association
from app.modules.sales.services.time_utils import utc_now
from app.modules.user_management.services.profile import get_company_operating_currencies

OPPORTUNITY_IMPORT_HEADERS = {"opportunity_name"}
OPPORTUNITY_EXPORT_HEADERS = [
    "opportunity_id",
    "opportunity_name",
    "contact_id",
    "organization_id",
    "sales_stage",
    "assigned_to",
    "start_date",
    "expected_close_date",
    "probability_percent",
    "amount",
    "currency_type",
    "deal_type",
    "source",
    "next_step",
    "lost_reason",
    "created_time",
]

def _ensure_user(db: Session, user_id: int, *, tenant_id: int):
    if not opportunities_repository.user_exists(db, user_id=user_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _get_contact_or_404(db: Session, contact_id: int, *, tenant_id: int) -> SalesContact:
    contact = opportunities_repository.get_contact(db, contact_id=contact_id, tenant_id=tenant_id)
    if not contact:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    return contact


def _ensure_organization(db: Session, organization_id: int, *, tenant_id: int):
    if not opportunities_repository.organization_exists(db, organization_id=organization_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")


def list_all_opportunities(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOpportunity]:
    return opportunities_repository.list_all(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )


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

def _get_allowed_currencies(db: Session, current_user) -> tuple[str, ...]:
    session_info = getattr(db, "info", None)
    if session_info is None:
        return tuple(get_company_operating_currencies(db, current_user))

    tenant_id = getattr(current_user, "tenant_id", None)
    cache = session_info.setdefault("sales_opportunity_operating_currencies", {})
    if tenant_id not in cache:
        cache[tenant_id] = tuple(get_company_operating_currencies(db, current_user))
    return cache[tenant_id]


def normalize_opportunity_currency(db: Session, current_user, currency: str | None) -> str:
    """A deal's currency: one the company operates in, its first (base) when none is given."""
    allowed = _get_allowed_currencies(db, current_user)
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
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[SalesOpportunity], int]:
    items, total_count = opportunities_repository.list_paginated(
        db,
        tenant_id=tenant_id,
        pagination=pagination,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )
    return items, total_count


def list_opportunities_cursor(
    db: Session,
    tenant_id: int,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOpportunity]:
    items = opportunities_repository.list_cursor(
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
        module_key="sales_opportunities",
        records=items,
        record_id_attr="opportunity_id",
    )


def summarize_opportunity_pipeline(
    db: Session,
    tenant_id: int,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> dict:
    """Counts and value per stage of the tenant's pipeline, over the filtered deals.

    Values are in the base currency (`currency`); deals in a currency with no known rate are
    counted but left out of the value (`unconverted_count`).

    Columns come from the pipeline, not a hardcoded list: every active stage in
    board order, an inactive stage only while deals still sit in it, then
    Unstaged. Buckets are keyed by stage row, so a renamed label moves nothing.
    """

    pipeline = pipelines_services.ensure_default_opportunity_pipeline(db, tenant_id)
    buckets: dict[str, dict] = {}
    for stage in sorted(pipeline.stages, key=lambda item: (item.position, item.id)):
        buckets[stage.key] = {"facts": pipelines_services.stage_facts(stage), "is_active": bool(stage.is_active), "count": 0, "total_value": Decimal("0")}
    unstaged = pipelines_services.UNSTAGED_FACTS
    buckets[unstaged.key] = {"facts": unstaged, "is_active": True, "count": 0, "total_value": Decimal("0")}

    rows = opportunities_repository.summarize_pipeline(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    foreign_stage_ids = {row[0] for row in rows if row[0] is not None and not any(b["facts"].stage_id == row[0] for b in buckets.values())}
    foreign_stages = {
        stage.id: stage
        for stage in pipelines_repository.list_stages_by_ids(db, tenant_id=tenant_id, stage_ids=foreign_stage_ids)
    }
    stage_keys_by_id = {bucket["facts"].stage_id: key for key, bucket in buckets.items() if bucket["facts"].stage_id is not None}

    totals = BaseCurrencyTotals(db, tenant_id=tenant_id)
    total_count = 0
    for stage_id, sales_stage, count, total_value, currency in rows:
        if stage_id in stage_keys_by_id:
            key = stage_keys_by_id[stage_id]
        elif stage_id in foreign_stages:
            # A stage of a non-default pipeline: shown as its own column after the board.
            facts = pipelines_services.stage_facts(foreign_stages[stage_id])
            key = f"{facts.key}#{facts.stage_id}"
            buckets.setdefault(key, {"facts": facts, "is_active": bool(foreign_stages[stage_id].is_active), "count": 0, "total_value": Decimal("0")})
        else:
            key = pipelines_services.legacy_stage_facts(sales_stage).key
            if key not in buckets:
                key = unstaged.key
        buckets[key]["count"] += int(count or 0)
        converted = totals.convert(total_value, currency, count=int(count or 0))
        if converted is None:
            buckets[key]["unconverted_count"] = buckets[key].get("unconverted_count", 0) + int(count or 0)
        else:
            buckets[key]["total_value"] += converted
        total_count += int(count or 0)

    stages = [
        {
            "stage_key": bucket["facts"].key,
            "stage_id": bucket["facts"].stage_id,
            "label": bucket["facts"].label,
            "semantic_type": bucket["facts"].semantic_type,
            "probability": float(bucket["facts"].probability),
            "is_active": bucket["is_active"],
            "count": bucket["count"],
            "total_value": float(bucket["total_value"]),
            "unconverted_count": bucket.get("unconverted_count", 0),
        }
        for bucket in buckets.values()
        if bucket["is_active"] or bucket["count"]
    ]
    return {
        "total_count": total_count,
        "stages": stages,
        **totals.summary(),
    }


def list_deleted_opportunities(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[list[SalesOpportunity], int]:
    items, total_count = opportunities_repository.list_deleted(db, tenant_id=tenant_id, pagination=pagination)
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
    opportunity = opportunities_repository.get_opportunity(
        db,
        tenant_id=tenant_id,
        opportunity_id=opportunity_id,
        include_deleted=include_deleted,
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


def get_deleted_opportunity_or_404(
    db: Session,
    opportunity_id: int,
    *,
    tenant_id: int,
) -> SalesOpportunity:
    opportunity = opportunities_repository.get_deleted_opportunity(
        db,
        tenant_id=tenant_id,
        opportunity_id=opportunity_id,
    )
    if not opportunity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found in recycle bin")
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def _party_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=[{"loc": ["body", "organization_id"], "msg": "Choose an account or a contact.", "type": "domain"}],
    )


def _normalize_amount(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        amount = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", "amount"], "msg": "Enter the amount as a number.", "type": "domain"}],
        ) from exc
    if amount < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", "amount"], "msg": "The amount cannot be negative.", "type": "domain"}],
        )
    return amount.quantize(Decimal("0.01"))


def _normalize_deal_fields(db: Session, data: dict, *, tenant_id: int, existing: SalesOpportunity | None = None) -> None:
    """Amount, picklist fields (type, source, lost reason) and the account behind a contact."""
    if "amount" in data:
        data["amount"] = _normalize_amount(data["amount"])
    PicklistResolver(db, tenant_id).normalize("sales_opportunities", data, existing=existing)
    if data.get("contact_id") is not None:
        contact = _get_contact_or_404(db, data["contact_id"], tenant_id=tenant_id)
        if not data.get("organization_id") and contact.organization_id is not None and (
            existing is None or "organization_id" not in data and existing.organization_id is None
        ):
            data["organization_id"] = contact.organization_id
    if data.get("organization_id") is not None:
        _ensure_organization(db, data["organization_id"], tenant_id=tenant_id)
    if data.get("assigned_to") is not None:
        _ensure_user(db, data["assigned_to"], tenant_id=tenant_id)


def create_opportunity(db: Session, data: dict, *, current_user) -> SalesOpportunity:
    """A deal belongs to an account, a contact or both (13a H13). Its currency starts as the
    company's base currency. An empty probability follows the stage (13b §3.5): it is read
    from the stage until someone types their own, so an administrator's change to a stage's
    probability reaches every deal that has not."""
    tenant_id = current_user.tenant_id
    custom_data = validate_custom_field_payload(
        db, tenant_id=tenant_id, module_key="sales_opportunities", payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    _normalize_deal_fields(db, data, tenant_id=tenant_id)
    if data.get("organization_id") is None and data.get("contact_id") is None:
        raise _party_error()
    if data.get("currency_type"):
        data["currency_type"] = normalize_opportunity_currency(db, current_user, data.get("currency_type"))
    else:
        data["currency_type"] = base_currency(db, tenant_id=tenant_id)

    sales_stage = data.pop("sales_stage", None)
    pipeline_stage_id = data.pop("pipeline_stage_id", None)
    data["tenant_id"] = tenant_id
    opportunity = SalesOpportunity(**data)
    pipelines_services.assign_opportunity_stage(
        db, opportunity, sales_stage=sales_stage, pipeline_stage_id=pipeline_stage_id
    )
    db.add(opportunity)
    db.flush()
    if opportunity.contact_id is not None:
        sync_primary_contact_association(db, opportunity=opportunity, actor_user_id=getattr(current_user, "id", None))
    save_custom_field_values(
        db, tenant_id=tenant_id, module_key="sales_opportunities", record_id=opportunity.opportunity_id, values=custom_data,
    )
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db, tenant_id=tenant_id, module_key="sales_opportunities", record=opportunity, record_id=opportunity.opportunity_id,
    )


def _apply_lost_reason_rule(opportunity: SalesOpportunity, *, was_lost: bool) -> None:
    """A deal that moves into a lost stage records why, from the `lost_reason` list; one that
    is reopened drops the reason (13a H13). Whatever moves it — the record's stage, the board,
    the form — goes through here, so the reason is asked for everywhere."""
    is_lost = pipelines_services.opportunity_stage_facts(opportunity).is_lost
    if is_lost and not was_lost and not opportunity.lost_reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", "lost_reason"], "msg": "Choose why the deal was lost.", "type": "domain"}],
        )
    if was_lost and not is_lost:
        opportunity.lost_reason = None


def update_opportunity(db: Session, opportunity: SalesOpportunity, data: dict, *, current_user) -> SalesOpportunity:
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(
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
        data["custom_data"] = custom_data_to_save
    _normalize_deal_fields(db, data, tenant_id=opportunity.tenant_id, existing=opportunity)
    organization_id = data["organization_id"] if "organization_id" in data else opportunity.organization_id
    contact_id = data["contact_id"] if "contact_id" in data else opportunity.contact_id
    if organization_id is None and contact_id is None:
        raise _party_error()
    if "currency_type" in data:
        data["currency_type"] = (
            normalize_opportunity_currency(db, current_user, data["currency_type"]) if data["currency_type"]
            else base_currency(db, tenant_id=opportunity.tenant_id)
        )

    stage_changes = {key: data.pop(key) for key in ("sales_stage", "pipeline_stage_id") if key in data}
    for field, value in data.items():
        setattr(opportunity, field, value)
    if stage_changes:
        was_lost = pipelines_services.opportunity_stage_facts(opportunity).is_lost
        pipelines_services.assign_opportunity_stage(db, opportunity, **stage_changes)
        db.flush()
        db.refresh(opportunity, ["pipeline_stage"])
        _apply_lost_reason_rule(opportunity, was_lost=was_lost)

    if "contact_id" in data:
        db.flush()
        sync_primary_contact_association(
            db,
            opportunity=opportunity,
            actor_user_id=getattr(current_user, "id", None),
        )

    db.flush()
    if custom_data_to_save is not None:
        save_custom_field_values(
            db,
            tenant_id=opportunity.tenant_id,
            module_key="sales_opportunities",
            record_id=opportunity.opportunity_id,
            values=custom_data_to_save,
        )
    db.commit()
    db.refresh(opportunity)
    return hydrate_custom_field_record(
        db,
        tenant_id=opportunity.tenant_id,
        module_key="sales_opportunities",
        record=opportunity,
        record_id=opportunity.opportunity_id,
    )


def update_opportunity_stage(
    db: Session,
    opportunity: SalesOpportunity,
    *,
    sales_stage: str | None = None,
    pipeline_stage_id: int | None = None,
    lost_reason: str | None = None,
) -> SalesOpportunity:
    if sales_stage is None and pipeline_stage_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A stage is required")
    changes: dict = {key: value for key, value in (("sales_stage", sales_stage), ("pipeline_stage_id", pipeline_stage_id)) if value is not None}
    if lost_reason is not None:
        changes["lost_reason"] = lost_reason
    return update_opportunity(db, opportunity, changes, current_user=None)


def delete_opportunity(db: Session, opportunity: SalesOpportunity) -> SalesOpportunity:
    opportunity.deleted_at = utc_now()
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
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required=OPPORTUNITY_IMPORT_HEADERS)
    imported_fields = {header.strip().lower() for header in headers}

    new_rows = overwritten_rows = merged_rows = skipped_rows = 0
    total_rows = 0
    failures: list[dict[str, str | int | None]] = []
    rows: list[tuple[int, dict]] = []
    names: list[str] = []

    for row_number, row in enumerate(row_iter, start=2):
        total_rows += 1
        normalized = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        opportunity_name = (normalized.get("opportunity_name") or "").strip()
        contact_id_raw = (normalized.get("contact_id") or "").strip()
        if not opportunity_name:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": None,
                    "reason": "Missing required field 'opportunity_name'.",
                }
            )
            continue

        contact_id = _parse_optional_int(contact_id_raw)
        if contact_id_raw and contact_id is None:
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
                "probability_percent": _parse_numeric_value((normalized.get("probability_percent") or "").strip()) if normalized.get("probability_percent") else None,
                "amount": (normalized.get("amount") or "").strip() or None,
                "currency_type": (normalized.get("currency_type") or "").strip() or None,
                "deal_type": (normalized.get("deal_type") or "").strip() or None,
                "source": (normalized.get("source") or "").strip() or None,
                "next_step": (normalized.get("next_step") or "").strip() or None,
                "lost_reason": (normalized.get("lost_reason") or "").strip() or None,
            }
            payload = {
                field: value
                for field, value in payload.items()
                if field in imported_fields or field in {"opportunity_name", "assigned_to"}
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

    existing_duplicates = opportunities_repository.existing_names(
        db,
        tenant_id=current_user.tenant_id,
        names=names,
    )
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

    existing_by_name = opportunities_repository.active_by_name(
        db,
        tenant_id=current_user.tenant_id,
        names=names,
    )

    for row_number, payload in rows:
        existing = None if create_new_records else existing_by_name.get(payload["opportunity_name"])
        try:
            if existing and mode == DuplicateMode.skip:
                skipped_rows += 1
                continue
            if existing and mode == DuplicateMode.overwrite:
                update_opportunity(db, existing, payload, current_user=current_user)
                overwritten_rows += 1
                continue
            if existing and mode == DuplicateMode.merge:
                merge_payload = {
                    field: value
                    for field, value in payload.items()
                    if should_merge_value(getattr(existing, field, None), value)
                }
                if merge_payload:
                    update_opportunity(db, existing, merge_payload, current_user=current_user)
                merged_rows += 1
                continue
            create_opportunity(db, payload, current_user=current_user)
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
        total_rows=total_rows,
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


def export_opportunities_to_csv(
    opportunities: list[SalesOpportunity], field_keys: list[str] | None = None, labels: PicklistResolver | None = None,
) -> bytes:
    headers = [field for field in (field_keys or OPPORTUNITY_EXPORT_HEADERS) if field in OPPORTUNITY_EXPORT_HEADERS]
    if not headers:
        headers = ["opportunity_id", "opportunity_name", "contact_id"]
    custom_headers, custom_cells = ([], {})
    if labels is not None and opportunities:
        custom_headers, custom_cells = export_extension(
            labels.db, tenant_id=labels.tenant_id, module_key="sales_opportunities",
            record_ids=[item.opportunity_id for item in opportunities],
            field_keys=[key for key in field_keys or [] if key.startswith("custom:")] or None,
        )
    rows = []
    for opportunity in opportunities:
        row = {
            "opportunity_id": opportunity.opportunity_id,
            "opportunity_name": opportunity.opportunity_name or "",
            "contact_id": opportunity.contact_id or "",
            "organization_id": opportunity.organization_id or "",
            "sales_stage": opportunity.sales_stage or "",
            "assigned_to": opportunity.assigned_to or "",
            "start_date": opportunity.start_date.isoformat() if opportunity.start_date else "",
            "expected_close_date": opportunity.expected_close_date.isoformat() if opportunity.expected_close_date else "",
            "probability_percent": opportunity.probability_percent or "",
            "amount": opportunity.amount if opportunity.amount is not None else "",
            "currency_type": opportunity.currency_type or "",
            "deal_type": opportunity.deal_type or "",
            "source": opportunity.source or "",
            "next_step": opportunity.next_step or "",
            "lost_reason": opportunity.lost_reason or "",
            "created_time": opportunity.created_time.isoformat() if opportunity.created_time else "",
        }
        if labels is not None:
            labels.labels_for_row("sales_opportunities", row)
        row.update(custom_cells.get(opportunity.opportunity_id, {}))
        rows.append(row)
    return dict_rows_to_csv_bytes(headers=[*headers, *custom_headers], rows=rows)
