import csv
import io
import zipfile
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.duplicates import detect_duplicates, ensure_single_duplicate_action
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
    if current_user:
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
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )

    existing = db.query(SalesOrganization).filter(SalesOrganization.org_name == payload.org_name).first()
    if existing and not create_new_records:
        if skip_duplicates:
            return existing
        if replace_duplicates:
            _apply_org_payload(existing, payload, current_user)
            db.commit()
            db.refresh(existing)
            return existing
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
        assigned_to=current_user.id if current_user else None,
    )
    _apply_org_payload(organization, payload, current_user)

    db.add(organization)
    try:
        db.commit()
        db.refresh(organization)
        return organization
    except Exception as e:
        # If DB commit fails undo all the changes made in the transaction and restore the state 
        db.rollback()
        raise 

def list_organizations(db: Session) -> list[SalesOrganization]:
    """Return all organizations sorted by creation time (newest first)."""
    return (
        # SELECT * FROM sales_organizations ORDER BY created_time DESC
        db.query(SalesOrganization) 
        .order_by(SalesOrganization.created_time.desc())
        .all()
    )

def list_organizations_paginated(db: Session, offset: int, limit: int) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations and the total count."""
    base_query = db.query(SalesOrganization)
    total = base_query.count()
    items = (
        base_query
        .order_by(SalesOrganization.created_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total

def search_organizations_pagianted(db: Session, name: str, offset: int, limit: int) -> tuple[list[SalesOrganization], int]:
    """Return a page of organizations matching the name and the total count."""
    base_query = db.query(SalesOrganization).filter(SalesOrganization.org_name.ilike(f"%{name}%"))
    total = base_query.count()
    items = (
        base_query
        .order_by(SalesOrganization.created_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total


def get_organization(db: Session, org_id: int) -> SalesOrganization | None:
    """Return one organization by ID."""
    return db.query(SalesOrganization).filter(SalesOrganization.org_id == org_id).first()


def update_organization(db: Session, org_id: int, payload: SalesOrganizationUpdate) -> SalesOrganization | None:
    """Update an existing organization by ID."""
    organization = db.query(SalesOrganization).filter(SalesOrganization.org_id == org_id).first()
    if not organization:
        return None

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(organization, field, value)

    db.commit()
    db.refresh(organization)
    return organization


def delete_organization(db: Session, org_id: int) -> bool:
    """Delete an organization by ID. Returns True if deleted."""
    organization = db.query(SalesOrganization).filter(SalesOrganization.org_id == org_id).first()
    if not organization:
        return False

    db.delete(organization)
    db.commit()
    return True


REQUIRED_IMPORT_FIELDS = {
    "org_name",
    "primary_email",
    "website",
}


def import_organizations_from_csv(
    db: Session,
    file_bytes: bytes,
    current_user,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> dict:
    """Bulk import organizations from CSV content."""
    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("Unable to decode file as UTF-8")

    # Detect delimiter if possible, otherwise default to comma
    try:
        dialect = csv.Sniffer().sniff(text[:1024])
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("CSV is missing headers")

    normalized_headers = [h.strip() for h in reader.fieldnames if h is not None]
    missing_headers = REQUIRED_IMPORT_FIELDS - set(normalized_headers)
    if missing_headers:
        raise ValueError(f"Missing required column(s): {', '.join(sorted(missing_headers))}")

    inserted = 0
    updated = 0
    skipped_duplicates: list[str] = []
    errors: list[str] = []
    rows: list[dict[str, str | None]] = []
    org_names: list[str] = []

    for idx, row in enumerate(reader, start=2):  # start=2 to account for header line
        if row is None:
            continue
        data = {k.strip(): (v.strip() if v is not None else None) for k, v in row.items() if k is not None}

        org_name = data.get("org_name")
        primary_email = data.get("primary_email")
        website = data.get("website")

        if not org_name or not primary_email or not website:
            errors.append(f"Row {idx}: missing required fields")
            continue

        rows.append(data)
        org_names.append(org_name)

    existing_duplicates = {
        row.org_name
        for row in db.query(SalesOrganization.org_name)
        .filter(SalesOrganization.org_name.in_(org_names))
        .distinct()
    }
    detection = detect_duplicates(org_names, existing_values=existing_duplicates)
    if existing_duplicates and not any((replace_duplicates, skip_duplicates, create_new_records)):
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

    rows_by_org_name: dict[str, dict[str, str | None]] = {}
    for data in rows:
        org_name = data.get("org_name")
        if not org_name:
            continue
        rows_by_org_name[org_name] = data

    existing_by_name = {
        row.org_name: row
        for row in db.query(SalesOrganization)
        .filter(SalesOrganization.org_name.in_(rows_by_org_name.keys()))
        .all()
    }

    for org_name, data in rows_by_org_name.items():
        existing = existing_by_name.get(org_name)
        if existing and skip_duplicates:
            skipped_duplicates.append(org_name)
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

        if existing and replace_duplicates:
            _apply_org_payload(existing, payload, current_user)
            db.add(existing)
            updated += 1
            continue

        create_organization(
            db=db,
            payload=payload,
            current_user=current_user,
            create_new_records=create_new_records,
        )
        inserted += 1

    if updated:
        db.commit()

    return {
        "inserted": inserted,
        "updated": updated,
        "skipped_duplicates": skipped_duplicates,
        "errors": errors,
        "duplicate_orgs": detection.duplicate_values or None,
    }


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
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(EXPORT_HEADERS)
    for org in rows:
        writer.writerow([
            org.org_id,
            org.org_name,
            org.primary_email,
            org.website,
            org.primary_phone,
            org.secondary_phone,
            org.secondary_email,
            org.industry,
            org.annual_revenue,
            org.billing_address,
            org.billing_city,
            org.billing_state,
            org.billing_postal_code,
            org.billing_country,
            org.assigned_to,
            org.created_time.isoformat() if org.created_time else None,
        ])
    return output.getvalue().encode("utf-8")


def export_organizations(db: Session, org_ids: list[int] | None = None) -> tuple[bytes, dict]:
    """Export organizations to a ZIP of CSV batches (1k rows per batch)."""
    query = db.query(SalesOrganization).order_by(SalesOrganization.org_id.asc())
    if org_ids:
        query = query.filter(SalesOrganization.org_id.in_(org_ids))

    buffer = io.BytesIO()
    total_rows = 0
    batch_no = 1
    batch: list[SalesOrganization] = []

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zipf:
        for org in query.yield_per(500):
            batch.append(org)
            if len(batch) >= EXPORT_BATCH_SIZE:
                zipf.writestr(f"organizations_batch_{batch_no}.csv", _serialize_orgs_to_csv(batch))
                total_rows += len(batch)
                batch_no += 1
                batch = []

        if batch:
            zipf.writestr(f"organizations_batch_{batch_no}.csv", _serialize_orgs_to_csv(batch))
            total_rows += len(batch)

    return buffer.getvalue(), {"batches": batch_no if total_rows else 0, "rows": total_rows}
