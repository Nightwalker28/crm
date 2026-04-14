from __future__ import annotations

from datetime import date
import random
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from google.oauth2.credentials import Credentials
import google_auth_httplib2
import httplib2
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.finance.models import FinanceIO
from app.modules.finance.services.io_search_services import (
    IO_SEARCH_UPLOAD_DIR,
    create_insertion_order,
    get_finance_module_id,
    sanitize_file_name,
)
from app.modules.sales.models import SalesOpportunity
from app.modules.user_management.models import User
from app.modules.user_management.services.google_tokens import get_valid_google_access_token

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GOOGLE_DOC_URL_TEMPLATE = "https://docs.google.com/document/d/{file_id}/edit"


def _format_date(value: date | None) -> str | None:
    # Normalize optional date values to ISO strings for template placeholders.
    return value.isoformat() if value else None

def _build_replacement_requests(replacements: dict[str, str]) -> list[dict[str, Any]]:
    # Build Google Docs batchUpdate requests for all placeholders in the template.
    requests: list[dict[str, Any]] = []
    for key, value in replacements.items():
        placeholder_full = f"{{{{{key}}}}}"
        placeholder_partial = f"{{{{{key}}}"
        for placeholder in (placeholder_full, placeholder_partial):
            requests.append(
                {
                    "replaceAllText": {
                        "containsText": {"text": placeholder, "matchCase": True},
                        "replaceText": value,
                    }
                }
            )
    return requests


def _build_services(access_token: str):
    # Create Google Docs and Drive clients with a shared authorized HTTP transport.
    creds = Credentials(token=access_token)
    http = google_auth_httplib2.AuthorizedHttp(
        creds,
        http=httplib2.Http(timeout=settings.GOOGLE_API_TIMEOUT_SECONDS),
    )
    docs_service = build("docs", "v1", http=http, cache_discovery=False)
    drive_service = build("drive", "v3", http=http, cache_discovery=False)
    return docs_service, drive_service


def _escape_drive_query_value(value: str) -> str:
    # Escape single quotes for Drive query strings.
    return value.replace("'", "\\'")


def _get_user_folder_name(user: User | None, user_id: int) -> str:
    # Prefer a human-friendly folder name, falling back to a stable user id.
    if user:
        name_parts = [part for part in [user.first_name, user.last_name] if part]
        if name_parts:
            folder_name = sanitize_file_name(" ".join(name_parts))
            if folder_name:
                return folder_name
        if user.email:
            folder_name = sanitize_file_name(user.email)
            if folder_name:
                return folder_name
    return f"user-{user_id}"


def _restrict_folder_permissions(drive_service, *, folder_id: str, owner_email: str) -> None:
    # Ensure only the owner keeps access to the IO folder.
    permissions = _execute_with_retry(
        drive_service.permissions().list(
            fileId=folder_id,
            fields="permissions(id,type,role,emailAddress)",
            supportsAllDrives=True,
        ),
        action="list folder permissions",
    )
    for perm in permissions.get("permissions", []) if permissions else []:
        if perm.get("role") == "owner":
            continue
        perm_type = perm.get("type")
        perm_email = perm.get("emailAddress")
        if perm_type in {"anyone", "group", "domain"}:
            perm_id = perm.get("id")
        elif perm_type == "user" and perm_email and perm_email != owner_email:
            perm_id = perm.get("id")
        else:
            perm_id = None
        if perm_id:
            _execute_with_retry(
                drive_service.permissions().delete(
                    fileId=folder_id,
                    permissionId=perm_id,
                    supportsAllDrives=True,
                ),
                action="remove folder permission",
            )


def _get_or_create_user_folder(
    drive_service,
    *,
    parent_id: str,
    folder_name: str,
    owner_email: str,
) -> str:
    # Reuse an existing per-user folder or create a new one under the IO root.
    escaped_name = _escape_drive_query_value(folder_name)
    query = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{escaped_name}' "
        f"and '{parent_id}' in parents "
        "and trashed=false"
    )

    result = _execute_with_retry(
        drive_service.files().list(
            q=query,
            fields="files(id,name)",
            pageSize=1,
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
        ),
        action="list user IO folders",
    )
    files = result.get("files", []) if result else []
    if files:
        folder_id = files[0]["id"]
        _restrict_folder_permissions(drive_service, folder_id=folder_id, owner_email=owner_email)
        return folder_id

    folder_body = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    created = _execute_with_retry(
        drive_service.files().create(
            body=folder_body,
            fields="id,name",
            supportsAllDrives=True,
        ),
        action="create user IO folder",
    )
    folder_id = created.get("id") if created else None
    if not folder_id:
        raise HTTPException(status_code=500, detail="Failed to create user IO folder")
    _restrict_folder_permissions(drive_service, folder_id=folder_id, owner_email=owner_email)
    return folder_id


def _should_retry_http_error(exc: HttpError) -> bool:
    # Retry only on transient Google API errors.
    status_code = getattr(exc.resp, "status", None)
    return status_code in {429, 500, 503}


def _execute_with_retry(request, *, action: str):
    # Wrap Google API requests with exponential backoff and jitter.
    max_retries = settings.GOOGLE_API_MAX_RETRIES
    base_delay = settings.GOOGLE_API_RETRY_BASE_DELAY_SECONDS
    last_exc: HttpError | None = None
    for attempt in range(max_retries):
        try:
            return request.execute()
        except HttpError as exc:
            if not _should_retry_http_error(exc):
                raise
            last_exc = exc
            if attempt == max_retries - 1:
                break
            # Exponential backoff with jitter.
            sleep_seconds = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
            time.sleep(sleep_seconds)
    raise last_exc if last_exc else HTTPException(status_code=500, detail=f"Failed to {action}")


def create_finance_io_from_opportunity(
    db: Session,
    *,
    opportunity: SalesOpportunity,
    user_id: int,
) -> dict[str, Any]:
    # Create a Google Doc IO from the template, export it, and persist metadata.
    if not settings.GOOGLE_DOCS_TEMPLATE_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_DOCS_TEMPLATE_ID is not configured",
        )

    if not settings.GOOGLE_DRIVE_IO_FOLDER_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_DRIVE_IO_FOLDER_ID is not configured",
        )

    # Build authenticated Google API clients for the current user.
    access_token = get_valid_google_access_token(db, user_id=user_id)
    docs_service, drive_service = _build_services(access_token)

    # Resolve a per-user Drive folder and lock it to the owner.
    user = db.query(User).filter(User.id == user_id).first()
    folder_name = _get_user_folder_name(user, user_id)
    if not user or not user.email:
        raise HTTPException(status_code=500, detail="User email is required to restrict IO folders")

    parent_folder_id = _get_or_create_user_folder(
        drive_service,
        parent_id=settings.GOOGLE_DRIVE_IO_FOLDER_ID,
        folder_name=folder_name,
        owner_email=user.email,
    )

    base_name = f"{opportunity.opportunity_name}-io"
    drive_file_name = sanitize_file_name(f"{base_name}.gdoc")

    # Copy the template to the user's folder before filling placeholders.
    try:
        copy_body = {
            "name": drive_file_name,
            "parents": [parent_folder_id],
        }
        copied = _execute_with_retry(
            drive_service.files().copy(
            fileId=settings.GOOGLE_DOCS_TEMPLATE_ID,
            body=copy_body,
            fields="id,name",
            supportsAllDrives=True,
            ),
            action="copy Google Doc template",
        )
    except HttpError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to copy template: {exc}")

    file_id = copied.get("id")
    if not file_id:
        raise HTTPException(status_code=500, detail="Failed to create Google Doc")

    # Prepare contact and organization details for placeholder replacement.
    account_manager = None
    if opportunity.assigned_user:
        account_manager = " ".join(
            part for part in [opportunity.assigned_user.first_name, opportunity.assigned_user.last_name] if part
        ) or None

    contact_name = None
    contact_email = None
    contact_telephone = None
    if opportunity.contact:
        contact_name = " ".join(
            part for part in [opportunity.contact.first_name, opportunity.contact.last_name] if part
        ) or None
        contact_email = opportunity.contact.primary_email
        contact_telephone = opportunity.contact.contact_telephone

    client_address = None
    if opportunity.organization:
        client_address = opportunity.organization.billing_address

    # Map template placeholders to opportunity fields.
    replacements = {
        "campaign_name": opportunity.opportunity_name or "",
        "client_name": opportunity.client or "",
        "start_date": _format_date(opportunity.start_date) or "",
        "end_date": _format_date(opportunity.expected_close_date) or "",
        "campaign_type": opportunity.campaign_type or "",
        "total_leads": opportunity.total_leads or "",
        "cpl": opportunity.cpl or "",
        "total_cost_of_project": opportunity.total_cost_of_project or "",
        "target_geography": opportunity.target_geography or "",
        "target_persona": opportunity.target_audience or "",
        "domain_cap": opportunity.domain_cap or "",
        "tactics": opportunity.tactics or "",
        "delivery_format": opportunity.delivery_format or "",
        "account_manager": account_manager or "",
        "contact_name": contact_name or "",
        "contact_email": contact_email or "",
        "contact_telephone": contact_telephone or "",
        "client_address": client_address or ""
    }

    # Fill placeholders in the Google Doc template.
    try:
        _execute_with_retry(
            docs_service.documents().batchUpdate(
                documentId=file_id,
                body={"requests": _build_replacement_requests(replacements)},
            ),
            action="update Google Doc",
        )
    except HttpError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update Google Doc: {exc}")

    # Export the filled document as DOCX for storage and ingestion.
    try:
        docx_bytes = _execute_with_retry(
            drive_service.files().export(
                fileId=file_id,
                mimeType=DOCX_MIME,
            ),
            action="export Google Doc",
        )
    except HttpError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to export Google Doc: {exc}")

    file_name = sanitize_file_name(f"{base_name}.docx")
    destination_path = IO_SEARCH_UPLOAD_DIR / file_name
    destination_path.write_bytes(docx_bytes)

    # Persist the IO record so it can be indexed and assigned an IO number.
    module_id = get_finance_module_id(db)
    io_row = create_insertion_order(
        db,
        module_id=module_id,
        current_user=opportunity.assigned_user,
        data={
            "customer_name": opportunity.client or contact_name or "Imported Opportunity",
            "customer_contact_id": opportunity.contact_id,
            "customer_organization_id": opportunity.organization_id,
            "counterparty_reference": opportunity.opportunity_name or None,
            "external_reference": file_name,
            "issue_date": _format_date(opportunity.start_date),
            "due_date": _format_date(opportunity.expected_close_date),
            "start_date": _format_date(opportunity.start_date),
            "end_date": _format_date(opportunity.expected_close_date),
            "status": "issued",
            "currency": opportunity.currency_type or "USD",
            "total_amount": opportunity.total_cost_of_project,
            "notes": "\n".join(
                [
                    line
                    for line in [
                        f"Generated from opportunity: {opportunity.opportunity_name}" if opportunity.opportunity_name else None,
                        f"Campaign type: {opportunity.campaign_type}" if opportunity.campaign_type else None,
                        f"Target geography: {opportunity.target_geography}" if opportunity.target_geography else None,
                        f"Delivery format: {opportunity.delivery_format}" if opportunity.delivery_format else None,
                    ]
                    if line
                ]
            ) or None,
        },
    )
    io_row.file_path = str(destination_path)
    io_row.file_name = file_name
    db.add(io_row)
    db.commit()
    db.refresh(io_row)

    # If an IO number is assigned, update the doc and re-export with the number.
    if io_row and io_row.io_number:
        try:
            _execute_with_retry(
                docs_service.documents().batchUpdate(
                    documentId=file_id,
                    body={"requests": _build_replacement_requests({"io_number": io_row.io_number})},
                ),
                action="update Google Doc IO number",
            )
        except HttpError as exc:
            raise HTTPException(status_code=500, detail=f"Failed to update IO number in Google Doc: {exc}")

        try:
            docx_bytes = _execute_with_retry(
                drive_service.files().export(
                    fileId=file_id,
                    mimeType=DOCX_MIME,
                ),
                action="export Google Doc with IO number",
            )
        except HttpError as exc:
            raise HTTPException(status_code=500, detail=f"Failed to export Google Doc with IO number: {exc}")

        destination_path.write_bytes(docx_bytes)

    return {
        "drive_file_id": file_id,
        "drive_file_url": GOOGLE_DOC_URL_TEMPLATE.format(file_id=file_id),
        "file_name": file_name,
        "file_path": str(destination_path),
        "io_number": io_row.io_number if io_row else None,
    }
