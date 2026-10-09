from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, detect_duplicates, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers

from app.core.module_export import batched_csv_zip_file, dict_rows_to_csv_bytes
from app.modules.platform.services.module_fields import ImportFieldRules
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesOrganization
from app.modules.platform.services.custom_fields import export_extension
from app.core.amounts import parse_amount
from app.modules.platform.services.picklists import PicklistResolver, picklist_error_reason
from app.modules.sales.repositories import organizations_repository
from app.modules.sales.schema import SalesOrganizationCreate, SalesOrganizationUpdate
from app.modules.sales.services.time_utils import utc_now


def _apply_org_payload(organization: SalesOrganization, payload: SalesOrganizationCreate, current_user) -> None:
    organization.org_name = payload.org_name
    organization.website = payload.website
    organization.primary_email = payload.primary_email
    organization.secondary_email = payload.secondary_email
    organization.primary_phone = payload.primary_phone
    organization.secondary_phone = payload.secondary_phone
    organization.industry = payload.industry
    organization.account_type = payload.account_type
    organization.annual_revenue = payload.annual_revenue
    organization.employee_count = payload.employee_count
    for prefix in ("billing", "shipping"):
        for part in ("address", "street2", "city", "state", "postal_code", "country"):
            setattr(organization, f"{prefix}_{part}", getattr(payload, f"{prefix}_{part}"))
    organization.is_vendor = int(bool(getattr(payload, "is_vendor", False)))
    organization.payment_terms_days = getattr(payload, "payment_terms_days", None)
    organization.tax_exempt = bool(getattr(payload, "tax_exempt", False))
    organization.tax_exempt_reason = (getattr(payload, "tax_exempt_reason", None) or "").strip() or None
    organization.no_reminders = bool(getattr(payload, "no_reminders", False))
    organization.custom_data = payload.custom_fields or None
    organization.assigned_to = payload.assigned_to if payload.assigned_to is not None else current_user.id if current_user else None


def create_organization(
    db: Session,
    payload: SalesOrganizationCreate,
    current_user,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> SalesOrganization:
    """Persist a new organization using the current user as the assignee."""
    if payload.assigned_to is not None and not organizations_repository.user_exists(db, tenant_id=current_user.tenant_id, user_id=payload.assigned_to):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")
    picked = PicklistResolver(db, current_user.tenant_id).normalize(
        "sales_organizations",
        {
            "industry": payload.industry,
            "account_type": payload.account_type,
            "billing_country": payload.billing_country,
            "shipping_country": payload.shipping_country,
        },
    )
    payload = payload.model_copy(
        update={
            "custom_fields": validate_custom_field_payload(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_organizations",
                payload=payload.custom_fields,
            ),
            **picked,
        }
    )
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )

    existing = organizations_repository.find_active_by_name(
        db,
        tenant_id=current_user.tenant_id,
        org_name=payload.org_name,
    )
    if existing and not create_new_records:
        if skip_duplicates:
            return hydrate_custom_field_record(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_organizations",
                record=existing,
                record_id=existing.org_id,
            )
        if replace_duplicates:
            _apply_org_payload(existing, payload, current_user)
            try:
                db.flush()
                save_custom_field_values(
                    db,
                    tenant_id=current_user.tenant_id,
                    module_key="sales_organizations",
                    record_id=existing.org_id,
                    values=payload.custom_fields or {},
                )
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unable to replace organization",
                ) from exc
            db.refresh(existing)
            return hydrate_custom_field_record(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_organizations",
                record=existing,
                record_id=existing.org_id,
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{payload.org_name} already exists. Resend with "
                "replace_duplicates=true to overwrite, "
                "skip_duplicates=true to leave the existing org unchanged, or "
                "create_new_records=true to add a new org with the same name."
            ),
        )

    organization = SalesOrganization(
        tenant_id=current_user.tenant_id,
        assigned_to=current_user.id if current_user else None,
    )
    _apply_org_payload(organization, payload, current_user)

    db.add(organization)
    try:
        db.flush()
        save_custom_field_values(
            db,
            tenant_id=current_user.tenant_id,
            module_key="sales_organizations",
            record_id=organization.org_id,
            values=payload.custom_fields or {},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create organization",
        ) from exc
    db.refresh(organization)
    return hydrate_custom_field_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )

def list_organizations_paginated(
    db: Session,
    tenant_id: int,
    offset: int,
    limit: int,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations and the total count."""
    items, total = organizations_repository.list_paginated(
        db,
        tenant_id=tenant_id,
        offset=offset,
        limit=limit,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        records=items,
        record_id_attr="org_id",
    )
    return items, total

def search_organizations_paginated(
    db: Session,
    tenant_id: int,
    name: str,
    offset: int,
    limit: int,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations matching the name and the total count."""
    items, total = organizations_repository.list_paginated(
        db,
        tenant_id=tenant_id,
        search=name,
        offset=offset,
        limit=limit,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        records=items,
        record_id_attr="org_id",
    )
    return items, total


def list_organizations_cursor(
    db: Session,
    tenant_id: int,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOrganization]:
    items = organizations_repository.list_cursor(
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
        module_key="sales_organizations",
        records=items,
        record_id_attr="org_id",
    )


def get_organization(db: Session, org_id: int, *, tenant_id: int, include_deleted: bool = False) -> SalesOrganization | None:
    """Return one organization by ID."""
    organization = organizations_repository.get_organization(
        db,
        org_id=org_id,
        tenant_id=tenant_id,
        include_deleted=include_deleted,
    )
    if not organization:
        return None
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )


def update_existing_organization(
    db: Session,
    organization: SalesOrganization,
    payload: SalesOrganizationUpdate,
    *,
    tenant_id: int,
) -> SalesOrganization:
    """Update an already-loaded organization."""
    data = payload.model_dump(exclude_unset=True)
    PicklistResolver(db, tenant_id).normalize("sales_organizations", data, existing=organization)
    if "is_vendor" in data:
        data["is_vendor"] = int(bool(data["is_vendor"]))
    if "tax_exempt" in data:
        data["tax_exempt"] = bool(data["tax_exempt"])
    if "tax_exempt_reason" in data:
        data["tax_exempt_reason"] = (data["tax_exempt_reason"] or "").strip() or None
    if "no_reminders" in data:
        data["no_reminders"] = bool(data["no_reminders"])
    if "assigned_to" in data:
        if data["assigned_to"] is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="assigned_to cannot be null")
        if not organizations_repository.user_exists(db, tenant_id=tenant_id, user_id=data["assigned_to"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(
            db,
            tenant_id=tenant_id,
            module_key="sales_organizations",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=tenant_id,
                module_key="sales_organizations",
                record_id=organization.org_id,
                fallback=organization.custom_data,
            ),
        )
        data["custom_data"] = custom_data_to_save

    for field, value in data.items():
        setattr(organization, field, value)

    try:
        db.flush()
        if custom_data_to_save is not None:
            save_custom_field_values(
                db,
                tenant_id=tenant_id,
                module_key="sales_organizations",
                record_id=organization.org_id,
                values=custom_data_to_save,
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to update organization",
        ) from exc
    db.refresh(organization)
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )


def update_organization(db: Session, org_id: int, payload: SalesOrganizationUpdate, *, tenant_id: int) -> SalesOrganization | None:
    """Update an existing organization by ID."""
    organization = get_organization(db=db, org_id=org_id, tenant_id=tenant_id)
    if not organization:
        return None
    return update_existing_organization(db, organization, payload, tenant_id=tenant_id)


def delete_organization(db: Session, org_id: int, *, tenant_id: int) -> bool:
    """Soft delete an organization by ID. Returns True if deleted."""
    organization = get_organization(db=db, org_id=org_id, tenant_id=tenant_id)
    if not organization:
        return False

    organization.deleted_at = utc_now()
    db.add(organization)
    db.commit()
    return True


def list_deleted_organizations_paginated(db: Session, *, tenant_id: int, offset: int, limit: int) -> tuple[list[SalesOrganization], int]:
    items, total = organizations_repository.list_deleted_paginated(
        db,
        tenant_id=tenant_id,
        offset=offset,
        limit=limit,
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        records=items,
        record_id_attr="org_id",
    )
    return items, total


def restore_organization(db: Session, org_id: int, *, tenant_id: int) -> SalesOrganization | None:
    organization = get_organization(db=db, org_id=org_id, tenant_id=tenant_id, include_deleted=True)
    if not organization or organization.deleted_at is None:
        return None

    organization.deleted_at = None
    db.add(organization)
    db.commit()
    db.refresh(organization)
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )


REQUIRED_IMPORT_FIELDS = {"org_name"}


def import_organizations_from_csv(
    db: Session,
    file_bytes: bytes,
    current_user,
    duplicate_mode: str | None = None,
    default_duplicate_mode: str | None = None,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    add_unknown_picklist_values: bool = False,
) -> dict:
    """Bulk import organizations from CSV content."""
    resolver = PicklistResolver(db, current_user.tenant_id, allow_create=add_unknown_picklist_values)
    field_rules = ImportFieldRules(db, tenant_id=current_user.tenant_id, module_key="sales_organizations")
    mode = resolve_duplicate_mode(
        duplicate_mode=duplicate_mode,
        default_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required=REQUIRED_IMPORT_FIELDS)
    imported_fields = {header.strip() for header in headers}

    new_rows = overwritten_rows = merged_rows = skipped_rows = 0
    total_rows = 0
    failures: list[dict[str, str | int | None]] = []
    rows: list[dict[str, str | None]] = []
    org_names: list[str] = []

    for idx, row in enumerate(row_iter, start=2):
        total_rows += 1
        if row is None:
            continue
        data = {k.strip(): (v.strip() if v is not None else None) for k, v in row.items() if k is not None}

        org_name = data.get("org_name")
        primary_email = data.get("primary_email")
        if not org_name:
            failures.append(
                {
                    "row_number": idx,
                    "record_identifier": org_name or primary_email,
                    "reason": "Missing required field 'org_name'.",
                }
            )
            continue

        rows.append(data)
        org_names.append(org_name)

    existing_duplicates = {
        row.org_name
        for row in db.query(SalesOrganization.org_name)
        .filter(
            SalesOrganization.tenant_id == current_user.tenant_id,
            SalesOrganization.org_name.in_(org_names),
            SalesOrganization.deleted_at.is_(None),
        )
        .distinct()
    }
    detection = detect_duplicates(org_names, existing_values=existing_duplicates)
    if existing_duplicates and duplicate_mode is None and not any((replace_duplicates, skip_duplicates, create_new_records)) and default_duplicate_mode is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    "Duplicate organizations detected. Resend with "
                    "replace_duplicates=true to overwrite them, "
                    "skip_duplicates=true to leave the existing orgs untouched, or "
                    "create_new_records=true to add new orgs alongside the existing ones."
                ),
                "duplicate_orgs": detection.duplicate_values,
                "requires_confirmation": True,
            },
        )

    existing_by_name = {
        row.org_name: row
        for row in db.query(SalesOrganization)
        .filter(
            SalesOrganization.tenant_id == current_user.tenant_id,
            SalesOrganization.org_name.in_(org_names),
            SalesOrganization.deleted_at.is_(None),
        )
        .all()
    }

    for row_number, data in enumerate(rows, start=2):
        org_name = data.get("org_name")
        if not org_name:
            continue
        existing = existing_by_name.get(org_name)
        if existing and mode == DuplicateMode.skip:
            skipped_rows += 1
            continue

        payload_data = {
            "org_name": org_name,
            "primary_email": data.get("primary_email"),
            "website": data.get("website"),
            "primary_phone": data.get("primary_phone"),
            "secondary_phone": data.get("secondary_phone"),
            "secondary_email": data.get("secondary_email"),
            "industry": data.get("industry"),
            "annual_revenue": parse_amount(data.get("annual_revenue")),
            "employee_count": data.get("employee_count") or None,
            "account_type": data.get("account_type"),
            "billing_address": data.get("billing_address"),
            "billing_city": data.get("billing_city"),
            "billing_state": data.get("billing_state"),
            "billing_postal_code": data.get("billing_postal_code"),
            "billing_country": data.get("billing_country"),
            "billing_street2": data.get("billing_street2"),
            "shipping_address": data.get("shipping_address"),
            "shipping_street2": data.get("shipping_street2"),
            "shipping_city": data.get("shipping_city"),
            "shipping_state": data.get("shipping_state"),
            "shipping_postal_code": data.get("shipping_postal_code"),
            "shipping_country": data.get("shipping_country"),
        }
        payload_data = {
            field: value
            for field, value in payload_data.items()
            if field in imported_fields or field in {"org_name"}
        }
        try:
            resolver.normalize("sales_organizations", payload_data, existing=existing)
        except HTTPException as exc:
            failures.append({"row_number": row_number, "record_identifier": org_name, "reason": picklist_error_reason(exc)})
            continue
        target = existing if existing and mode in (DuplicateMode.overwrite, DuplicateMode.merge) else None
        rule_failure = field_rules.apply(payload_data, existing=target, overwrite=mode == DuplicateMode.overwrite)
        if rule_failure:
            failures.append({"row_number": row_number, "record_identifier": org_name, "reason": rule_failure})
            continue

        if existing and mode == DuplicateMode.overwrite:
            update_organization(
                db,
                existing.org_id,
                SalesOrganizationUpdate(**payload_data),
                tenant_id=current_user.tenant_id,
            )
            overwritten_rows += 1
            continue

        if existing and mode == DuplicateMode.merge:
            merge_payload = {
                field: value
                for field, value in payload_data.items()
                if should_merge_value(getattr(existing, field, None), value)
            }
            if merge_payload:
                update_organization(
                    db,
                    existing.org_id,
                    SalesOrganizationUpdate(**merge_payload),
                    tenant_id=current_user.tenant_id,
                )
            merged_rows += 1
            continue

        try:
            created = create_organization(
                db=db,
                payload=SalesOrganizationCreate(**payload_data),
                current_user=current_user,
                create_new_records=create_new_records,
            )
            existing_by_name[org_name] = created
            new_rows += 1
        except HTTPException as exc:
            failures.append(
                {
                    "row_number": row_number,
                    "record_identifier": org_name,
                    "reason": str(exc.detail),
                }
            )

    if overwritten_rows or merged_rows:
        db.commit()

    return build_import_summary(
        total_rows=total_rows,
        new_rows=new_rows,
        skipped_rows=skipped_rows,
        overwritten_rows=overwritten_rows,
        merged_rows=merged_rows,
        failures=failures,
    )


EXPORT_BATCH_SIZE = 1000
EXPORT_HEADERS = [
    "org_id",
    "org_name",
    "primary_email",
    "website",
    "primary_phone",
    "secondary_phone",
    "secondary_email",
    "industry",
    "annual_revenue",
    "billing_address",
    "billing_city",
    "billing_state",
    "billing_postal_code",
    "billing_country",
    "account_type",
    "employee_count",
    "shipping_address",
    "shipping_city",
    "shipping_state",
    "shipping_postal_code",
    "shipping_country",
    "assigned_to",
    "created_time",
]


def _serialize_orgs_to_csv(
    rows: list[SalesOrganization], field_keys: list[str] | None = None, labels: PicklistResolver | None = None
) -> bytes:
    headers = [field for field in (field_keys or EXPORT_HEADERS) if field in EXPORT_HEADERS]
    if not headers:
        headers = ["org_id", "org_name", "primary_email"]
    custom_headers, custom_cells = ([], {})
    if labels is not None and rows:
        custom_headers, custom_cells = export_extension(
            labels.db, tenant_id=labels.tenant_id, module_key="sales_organizations", record_ids=[org.org_id for org in rows],
            field_keys=[key for key in field_keys or [] if key.startswith("custom:")] or None,
        )
    return dict_rows_to_csv_bytes(
        headers=[*headers, *custom_headers],
        rows=(
            {
                "org_id": org.org_id,
                "org_name": org.org_name,
                "primary_email": org.primary_email,
                "website": org.website,
                "primary_phone": org.primary_phone,
                "secondary_phone": org.secondary_phone,
                "secondary_email": org.secondary_email,
                "industry": labels.label("industry", org.industry) if labels else org.industry,
                "annual_revenue": org.annual_revenue,
                "billing_address": org.billing_address,
                "billing_city": org.billing_city,
                "billing_state": org.billing_state,
                "billing_postal_code": org.billing_postal_code,
                "billing_country": labels.label("country", org.billing_country) if labels else org.billing_country,
                "account_type": labels.label("account_type", org.account_type) if labels else org.account_type,
                "employee_count": org.employee_count,
                "shipping_address": org.shipping_address,
                "shipping_city": org.shipping_city,
                "shipping_state": org.shipping_state,
                "shipping_postal_code": org.shipping_postal_code,
                "shipping_country": labels.label("country", org.shipping_country) if labels else org.shipping_country,
                "assigned_to": org.assigned_to,
                "created_time": org.created_time.isoformat() if org.created_time else None,
                **custom_cells.get(org.org_id, {}),
            }
            for org in rows
        ),
    )


def export_organizations(
    db: Session,
    *,
    tenant_id: int,
    org_ids: list[int] | None = None,
    field_keys: list[str] | None = None,
) -> tuple[Path, dict]:
    """Export organizations to a ZIP of CSV batches (1k rows per batch)."""
    labels = PicklistResolver(db, tenant_id)
    query = (
        db.query(SalesOrganization)
        .filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .order_by(SalesOrganization.org_id.asc())
    )
    if org_ids:
        query = query.filter(SalesOrganization.org_id.in_(org_ids))

    return batched_csv_zip_file(
        rows=query.yield_per(500),
        batch_size=EXPORT_BATCH_SIZE,
        file_prefix="organizations",
        serialize_row=lambda rows: _serialize_orgs_to_csv(rows, field_keys=field_keys, labels=labels),
    )


def export_organizations_for_view(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    field_keys: list[str] | None = None,
) -> tuple[Path, dict]:
    labels = PicklistResolver(db, tenant_id)
    query = (
        organizations_repository.build_organization_query(
            db,
            tenant_id=tenant_id,
            search=search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesOrganization.org_id.asc())
    )
    return batched_csv_zip_file(
        rows=query.yield_per(500),
        batch_size=EXPORT_BATCH_SIZE,
        file_prefix="organizations",
        serialize_row=lambda rows: _serialize_orgs_to_csv(rows, field_keys=field_keys, labels=labels),
    )
