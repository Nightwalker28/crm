from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, detect_duplicates, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_filters import apply_filter_conditions
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers

from app.core.module_export import batched_csv_zip_file, dict_rows_to_csv_bytes
from app.core.module_search import apply_ranked_search
from app.modules.platform.services.custom_fields import (
    build_custom_field_filter_map,
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.sales.models import SalesOrganization
from app.modules.sales.schema import SalesOrganizationCreate, SalesOrganizationUpdate


def _apply_org_payload(organization: SalesOrganization, payload: SalesOrganizationCreate, current_user) -> None:
    organization.org_name = payload.org_name
    organization.website = payload.website
    organization.primary_email = payload.primary_email
    organization.secondary_email = payload.secondary_email
    organization.primary_phone = payload.primary_phone
    organization.secondary_phone = payload.secondary_phone
    organization.industry = payload.industry
    organization.annual_revenue = payload.annual_revenue
    organization.billing_address = payload.billing_address
    organization.billing_city = payload.billing_city
    organization.billing_state = payload.billing_state
    organization.billing_postal_code = payload.billing_postal_code
    organization.billing_country = payload.billing_country
    organization.custom_data = payload.custom_fields or None
    if current_user:
        organization.assigned_to = current_user.id


def _merge_org_payload(organization: SalesOrganization, payload: SalesOrganizationCreate, current_user) -> None:
    for field, value in payload.model_dump().items():
        if field == "custom_fields":
            continue
        if should_merge_value(getattr(organization, field, None), value):
            setattr(organization, field, value)
    if current_user and organization.assigned_to is None:
        organization.assigned_to = current_user.id


def create_organization(
    db: Session,
    payload: SalesOrganizationCreate,
    current_user,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> SalesOrganization:
    """Persist a new organization using the current user as the assignee."""
    payload = payload.model_copy(
        update={
            "custom_fields": validate_custom_field_payload(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_organizations",
                payload=payload.custom_fields,
            ),
        }
    )
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )

    existing = (
        db.query(SalesOrganization)
        .filter(
            SalesOrganization.org_name == payload.org_name,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
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
            db.commit()
            db.refresh(existing)
            save_custom_field_values(
                db,
                tenant_id=current_user.tenant_id,
                module_key="sales_organizations",
                record_id=existing.org_id,
                values=payload.custom_fields or {},
            )
            db.commit()
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
    db.flush()
    save_custom_field_values(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_organizations",
        record_id=organization.org_id,
        values=payload.custom_fields or {},
    )
    db.commit()
    db.refresh(organization)
    return hydrate_custom_field_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )

def list_organizations(db: Session) -> list[SalesOrganization]:
    """Return all organizations sorted by creation time (newest first)."""
    organizations = (
        # SELECT * FROM sales_organizations ORDER BY created_time DESC
        db.query(SalesOrganization)
        .filter(SalesOrganization.deleted_at.is_(None))
        .order_by(SalesOrganization.created_time.desc())
        .all()
    )
    return hydrate_custom_field_records(
        db,
        module_key="sales_organizations",
        records=organizations,
        record_id_attr="org_id",
    )


def _build_organization_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    base_query = db.query(SalesOrganization).filter(
        SalesOrganization.tenant_id == tenant_id,
        SalesOrganization.deleted_at.is_(None),
    )
    base_query = apply_ranked_search(
        base_query,
        search=search,
        document=SalesOrganization.search_doc,
        default_order_column=SalesOrganization.created_time,
    )

    field_map = {
        "org_name": {"expression": SalesOrganization.org_name, "type": "text"},
        "primary_email": {"expression": SalesOrganization.primary_email, "type": "text"},
        "website": {"expression": SalesOrganization.website, "type": "text"},
        "industry": {"expression": SalesOrganization.industry, "type": "text"},
        "annual_revenue": {"expression": SalesOrganization.annual_revenue, "type": "text"},
        "primary_phone": {"expression": SalesOrganization.primary_phone, "type": "text"},
        "billing_country": {"expression": SalesOrganization.billing_country, "type": "text"},
        "created_time": {"expression": SalesOrganization.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_organizations",
            record_id_expression=SalesOrganization.org_id,
        ),
    }
    base_query = apply_filter_conditions(
        base_query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=field_map,
    )
    base_query = apply_filter_conditions(
        base_query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=field_map,
    )
    return base_query

def list_organizations_paginated(
    db: Session,
    tenant_id: int,
    offset: int,
    limit: int,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations and the total count."""
    base_query = _build_organization_query(
        db,
        tenant_id=tenant_id,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total = base_query.count()
    items = (
        base_query
        .order_by(SalesOrganization.created_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
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
) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations matching the name and the total count."""
    base_query = _build_organization_query(
        db,
        tenant_id=tenant_id,
        search=name,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total = base_query.count()
    items = (
        base_query
        .offset(offset)
        .limit(limit)
        .all()
    )
    items = hydrate_custom_field_records(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        records=items,
        record_id_attr="org_id",
    )
    return items, total


def get_organization(db: Session, org_id: int, *, tenant_id: int, include_deleted: bool = False) -> SalesOrganization | None:
    """Return one organization by ID."""
    query = db.query(SalesOrganization).filter(
        SalesOrganization.org_id == org_id,
        SalesOrganization.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesOrganization.deleted_at.is_(None))
    organization = query.first()
    if not organization:
        return None
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

    data = payload.model_dump(exclude_unset=True)
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

    db.commit()
    db.refresh(organization)
    if custom_data_to_save is not None:
        save_custom_field_values(
            db,
            tenant_id=tenant_id,
            module_key="sales_organizations",
            record_id=organization.org_id,
            values=custom_data_to_save,
        )
        db.commit()
    return hydrate_custom_field_record(
        db,
        tenant_id=tenant_id,
        module_key="sales_organizations",
        record=organization,
        record_id=organization.org_id,
    )


def delete_organization(db: Session, org_id: int, *, tenant_id: int) -> bool:
    """Soft delete an organization by ID. Returns True if deleted."""
    organization = get_organization(db=db, org_id=org_id, tenant_id=tenant_id)
    if not organization:
        return False

    organization.deleted_at = datetime.utcnow()
    db.add(organization)
    db.commit()
    return True


def list_deleted_organizations_paginated(db: Session, *, tenant_id: int, offset: int, limit: int) -> tuple[list[SalesOrganization], int]:
    base_query = db.query(SalesOrganization).filter(
        SalesOrganization.tenant_id == tenant_id,
        SalesOrganization.deleted_at.is_not(None),
    )
    total = base_query.count()
    items = (
        base_query
        .order_by(SalesOrganization.deleted_at.desc(), SalesOrganization.created_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
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


REQUIRED_IMPORT_FIELDS = {
    "org_name",
    "primary_email",
}


def import_organizations_from_csv(
    db: Session,
    file_bytes: bytes,
    current_user,
    duplicate_mode: str | None = None,
    default_duplicate_mode: str | None = None,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> dict:
    """Bulk import organizations from CSV content."""
    mode = resolve_duplicate_mode(
        duplicate_mode=duplicate_mode,
        default_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required=REQUIRED_IMPORT_FIELDS)

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
        if not org_name or not primary_email:
            failures.append(
                {
                    "row_number": idx,
                    "record_identifier": org_name or primary_email,
                    "reason": "Missing required fields 'org_name' and/or 'primary_email'.",
                }
            )
            continue

        rows.append(data)
        org_names.append(org_name)

    existing_duplicates = {
        row.org_name
        for row in db.query(SalesOrganization.org_name)
        .filter(
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

        payload = SalesOrganizationCreate(
            org_name=org_name,
            primary_email=data.get("primary_email"),
            website=data.get("website"),
            primary_phone=data.get("primary_phone"),
            secondary_phone=data.get("secondary_phone"),
            secondary_email=data.get("secondary_email"),
            industry=data.get("industry"),
            annual_revenue=data.get("annual_revenue"),
            billing_address=data.get("billing_address"),
            billing_city=data.get("billing_city"),
            billing_state=data.get("billing_state"),
            billing_postal_code=data.get("billing_postal_code"),
            billing_country=data.get("billing_country"),
        )

        if existing and mode == DuplicateMode.overwrite:
            _apply_org_payload(existing, payload, current_user)
            db.add(existing)
            overwritten_rows += 1
            continue

        if existing and mode == DuplicateMode.merge:
            _merge_org_payload(existing, payload, current_user)
            db.add(existing)
            merged_rows += 1
            continue

        try:
            created = create_organization(
                db=db,
                payload=payload,
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
    "assigned_to",
    "created_time",
]


def _serialize_orgs_to_csv(rows: list[SalesOrganization]) -> bytes:
    return dict_rows_to_csv_bytes(
        headers=EXPORT_HEADERS,
        rows=(
            {
                "org_id": org.org_id,
                "org_name": org.org_name,
                "primary_email": org.primary_email,
                "website": org.website,
                "primary_phone": org.primary_phone,
                "secondary_phone": org.secondary_phone,
                "secondary_email": org.secondary_email,
                "industry": org.industry,
                "annual_revenue": org.annual_revenue,
                "billing_address": org.billing_address,
                "billing_city": org.billing_city,
                "billing_state": org.billing_state,
                "billing_postal_code": org.billing_postal_code,
                "billing_country": org.billing_country,
                "assigned_to": org.assigned_to,
                "created_time": org.created_time.isoformat() if org.created_time else None,
            }
            for org in rows
        ),
    )


def export_organizations(db: Session, *, tenant_id: int, org_ids: list[int] | None = None) -> tuple[Path, dict]:
    """Export organizations to a ZIP of CSV batches (1k rows per batch)."""
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
        serialize_row=_serialize_orgs_to_csv,
    )


def export_organizations_for_view(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Path, dict]:
    query = (
        _build_organization_query(
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
        serialize_row=_serialize_orgs_to_csv,
    )
