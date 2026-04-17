from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.modules.finance.models import FinanceIO
from app.modules.finance.services.io_search_services import create_insertion_order, get_finance_module_id
from app.modules.sales.schema import SalesOpportunityResponse
from app.modules.sales.services.opportunities_services import (
    OPPORTUNITY_ATTACHMENTS_DIR,
    get_opportunity_or_404,
    parse_attachment_paths,
    update_opportunity,
)
from app.modules.user_management.models import User


async def upload_opportunity_attachments(
    db: Session,
    *,
    opportunity_id: int,
    files: list[UploadFile],
) -> SalesOpportunityResponse:
    opportunity = get_opportunity_or_404(db, opportunity_id)

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload one or more files.",
        )

    saved_paths: list[str] = []
    saved_files: list[Path] = []
    for upload in files:
        filename = Path(upload.filename or "upload").name
        content = await upload.read()
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The uploaded file '{upload.filename}' is empty.",
            )

        unique_name = f"{opportunity_id}_{uuid4().hex}_{filename}"
        destination = OPPORTUNITY_ATTACHMENTS_DIR / unique_name
        destination.write_bytes(content)
        saved_files.append(destination)
        saved_paths.append(str(destination.relative_to(OPPORTUNITY_ATTACHMENTS_DIR.parent.parent)))

    existing_paths = parse_attachment_paths(opportunity.attachments)
    updated = existing_paths + saved_paths
    try:
        updated_opportunity = update_opportunity(db, opportunity, {"attachments": updated})
    except Exception:
        for path in saved_files:
            if path.is_file():
                path.unlink()
        raise
    return SalesOpportunityResponse.model_validate(updated_opportunity)


def delete_opportunity_attachments(
    db: Session,
    *,
    opportunity_id: int,
    attachments: list[str],
) -> SalesOpportunityResponse:
    opportunity = get_opportunity_or_404(db, opportunity_id)

    if not attachments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide one or more attachments to delete.",
        )

    existing_paths = parse_attachment_paths(opportunity.attachments)
    remaining_paths = [path for path in existing_paths if path not in attachments]
    removed_paths = [path for path in existing_paths if path in attachments]

    allowed_root = OPPORTUNITY_ATTACHMENTS_DIR.resolve()
    removable_candidates: list[Path] = []
    for path_str in removed_paths:
        try:
            candidate = (OPPORTUNITY_ATTACHMENTS_DIR.parent.parent / path_str).resolve()
            if allowed_root not in candidate.parents and candidate != allowed_root:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid attachment location.",
                )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to resolve attachment path.",
            ) from exc
        removable_candidates.append(candidate)

    updated_opportunity = update_opportunity(db, opportunity, {"attachments": remaining_paths})
    for candidate in removable_candidates:
        if candidate.is_file():
            candidate.unlink()
    return SalesOpportunityResponse.model_validate(updated_opportunity)


def create_finance_io_for_opportunity(
    db: Session,
    *,
    opportunity_id: int,
    user_id: int,
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    current_user = db.query(User).filter(User.id == user_id).first()
    if not current_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    finance_module_id = get_finance_module_id(db)
    record = create_insertion_order(
        db,
        module_id=finance_module_id,
        current_user=current_user,
        data={
            "customer_name": opportunity.client,
            "customer_contact_id": opportunity.contact_id,
            "customer_organization_id": opportunity.organization_id,
            "counterparty_reference": opportunity.opportunity_name,
            "external_reference": f"opportunity-{opportunity.opportunity_id}",
            "issue_date": opportunity.start_date.isoformat() if opportunity.start_date else None,
            "due_date": opportunity.expected_close_date.isoformat() if opportunity.expected_close_date else None,
            "status": "draft",
            "currency": opportunity.currency_type or "USD",
            "notes": f"Created from opportunity: {opportunity.opportunity_name}",
        },
    )
    return {
        "status": "ok",
        "message": "Insertion order created successfully",
        "insertion_order_id": record.id,
        "io_number": record.io_number,
    }
