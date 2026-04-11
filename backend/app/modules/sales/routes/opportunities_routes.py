from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_module_access
from app.core.security import require_user
from app.modules.sales.schema import (
    SalesOpportunityCreate,
    SalesOpportunityListResponse,
    SalesOpportunityResponse,
    SalesOpportunityUpdate,
)
from app.modules.sales.services.opportunities_services import (
    create_opportunity,
    delete_opportunity,
    get_opportunity_or_404,
    list_opportunities,
    OPPORTUNITY_ATTACHMENTS_DIR,
    parse_attachment_paths,
    update_opportunity,
)
from app.modules.sales.services.io_automation_services import create_finance_io_from_opportunity

router = APIRouter(prefix="/opportunities", tags=["Sales"])


@router.get("", response_model=SalesOpportunityListResponse)
def list_sales_opportunities(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    items, total_count = list_opportunities(db, pagination)
    serialized = [SalesOpportunityResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/search", response_model=SalesOpportunityListResponse)
def search_sales_opportunities(
    query: str = Query(..., min_length=1, description="Search by opportunity fields"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    items, total_count = list_opportunities(db, pagination, search=query)
    serialized = [SalesOpportunityResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.post("", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
def create_sales_opportunity(
    payload: SalesOpportunityCreate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    data = payload.model_dump()
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id
    opportunity = create_opportunity(db, data)
    return SalesOpportunityResponse.model_validate(opportunity)


@router.post("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
async def upload_opportunity_attachments(
    opportunity_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)

    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload one or more files.",
        )

    saved_paths: list[str] = []
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
        saved_paths.append(str(destination.relative_to(OPPORTUNITY_ATTACHMENTS_DIR.parent.parent)))

    existing_paths = parse_attachment_paths(opportunity.attachments)
    updated = existing_paths + saved_paths
    updated_opportunity = update_opportunity(db, opportunity, {"attachments": updated})
    return SalesOpportunityResponse.model_validate(updated_opportunity)


@router.delete("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse)
def delete_opportunity_attachments(
    opportunity_id: int,
    attachments: list[str] = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
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
    for path_str in removed_paths:
        try:
            candidate = (OPPORTUNITY_ATTACHMENTS_DIR.parent.parent / path_str).resolve()
            if allowed_root not in candidate.parents and candidate != allowed_root:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid attachment location.",
                )
        except RuntimeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to resolve attachment path.",
            )
        if candidate.is_file():
            candidate.unlink()

    updated_opportunity = update_opportunity(db, opportunity, {"attachments": remaining_paths})
    return SalesOpportunityResponse.model_validate(updated_opportunity)


@router.get("/{opportunity_id}", response_model=SalesOpportunityResponse)
def get_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    return SalesOpportunityResponse.model_validate(opportunity)


@router.put("/{opportunity_id}", response_model=SalesOpportunityResponse)
def update_sales_opportunity(
    opportunity_id: int,
    payload: SalesOpportunityUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return SalesOpportunityResponse.model_validate(opportunity)

    updated = update_opportunity(db, opportunity, update_data)
    return SalesOpportunityResponse.model_validate(updated)


@router.delete("/{opportunity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    delete_opportunity(db, opportunity)


@router.post("/{opportunity_id}/create_finance_io")
def create_finance_io(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    return create_finance_io_from_opportunity(db, opportunity=opportunity, user_id=current_user.id)
