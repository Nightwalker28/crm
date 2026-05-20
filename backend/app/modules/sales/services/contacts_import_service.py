from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.sales.services import contacts_services


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
    return contacts_services.import_contacts_from_csv(
        db,
        file_bytes,
        tenant_id=tenant_id,
        default_assigned_to=default_assigned_to,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=default_duplicate_mode,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )

