from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.schema import (
    SalesOpportunityCreate,
    SalesOpportunityListResponse,
    SalesOpportunityResponse,
    SalesOpportunityUpdate,
)
from app.modules.sales.services import opportunities_api
from app.modules.sales.services.opportunities_services import (
    create_opportunity,
    delete_opportunity,
    get_opportunity_or_404,
    list_deleted_opportunities,
    list_opportunities,
    restore_opportunity,
    update_opportunity,
)

router = APIRouter(prefix="/opportunities", tags=["Sales"])


def _serialize_opportunity(opportunity) -> dict:
    return SalesOpportunityResponse.model_validate(opportunity).model_dump(mode="json")


@router.get("", response_model=SalesOpportunityListResponse)
def list_sales_opportunities(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
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
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    items, total_count = list_opportunities(db, pagination, search=query)
    serialized = [SalesOpportunityResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/recycle", response_model=SalesOpportunityListResponse)
def list_deleted_sales_opportunities(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "restore")),
):
    items, total_count = list_deleted_opportunities(db, pagination)
    serialized = [SalesOpportunityResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.post("", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
def create_sales_opportunity(
    payload: SalesOpportunityCreate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    data = payload.model_dump()
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id
    opportunity = create_opportunity(db, data)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=opportunity.opportunity_id,
        action="create",
        description=f"Created opportunity {opportunity.opportunity_name}",
        after_state=_serialize_opportunity(opportunity),
    )
    return SalesOpportunityResponse.model_validate(opportunity)


@router.post("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
async def upload_opportunity_attachments(
    opportunity_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
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
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
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
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
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
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return SalesOpportunityResponse.model_validate(opportunity)

    before_state = _serialize_opportunity(opportunity)
    updated = update_opportunity(db, opportunity, update_data)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=updated.opportunity_id,
        action="update",
        description=f"Updated opportunity {updated.opportunity_name}",
        before_state=before_state,
        after_state=_serialize_opportunity(updated),
    )
    return SalesOpportunityResponse.model_validate(updated)


@router.delete("/{opportunity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "delete")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id)
    before_state = _serialize_opportunity(opportunity)
    delete_opportunity(db, opportunity)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=opportunity.opportunity_id,
        action="soft_delete",
        description=f"Moved opportunity {opportunity.opportunity_name} to recycle bin",
        before_state=before_state,
    )


@router.post("/{opportunity_id}/restore", response_model=SalesOpportunityResponse)
def restore_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "restore")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, include_deleted=True)
    if opportunity.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity is not in recycle bin")
    restored = restore_opportunity(db, opportunity)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=restored.opportunity_id,
        action="restore",
        description=f"Restored opportunity {restored.opportunity_name} from recycle bin",
        after_state=_serialize_opportunity(restored),
    )
    return SalesOpportunityResponse.model_validate(restored)


@router.post("/{opportunity_id}/create_finance_io")
def create_finance_io(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    return opportunities_api.create_finance_io_for_opportunity(
        db,
        opportunity_id=opportunity_id,
        user_id=current_user.id,
    )
