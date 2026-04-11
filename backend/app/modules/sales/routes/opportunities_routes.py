from fastapi import APIRouter, Body, Depends, File, Query, UploadFile, status
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
    update_opportunity,
)
from app.modules.sales.services import opportunities_api

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
    return await opportunities_api.upload_opportunity_attachments(
        db,
        opportunity_id=opportunity_id,
        files=files,
    )


@router.delete("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse)
def delete_opportunity_attachments(
    opportunity_id: int,
    attachments: list[str] = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
):
    return opportunities_api.delete_opportunity_attachments(
        db,
        opportunity_id=opportunity_id,
        attachments=attachments,
    )


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
    return opportunities_api.create_finance_io_for_opportunity(
        db,
        opportunity_id=opportunity_id,
        user_id=current_user.id,
    )
