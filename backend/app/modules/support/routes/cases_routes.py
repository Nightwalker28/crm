from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.crm_events import safe_publish_crm_event
from app.modules.platform.services.module_fields import (
    enabled_module_fields,
    reject_disabled_field_writes,
    sanitize_disabled_field_payload,
    sanitize_disabled_filter_conditions,
)
from app.modules.support.schema import (
    SupportCaseCommentCreateRequest,
    SupportCaseCommentResponse,
    SupportCaseCreateRequest,
    SupportCaseListItem,
    SupportCaseListResponse,
    SupportCaseResponse,
    SupportCaseSummaryResponse,
    SupportCaseUpdateRequest,
)
from app.modules.support.services.cases_services import (
    add_case_comment,
    create_support_case,
    get_case_or_404,
    get_case_summary,
    list_support_cases,
    update_support_case,
)


router = APIRouter(prefix="/support/cases", tags=["Support"])

SUPPORT_CASES_MODULE_KEY = "support_cases"
CASE_LIST_FIELDS = {
    "case_number", "subject", "status", "priority", "source", "contact_id", "organization_id",
    "opportunity_id", "quote_id", "order_id", "assigned_to_id", "sla_due_at", "first_response_at",
    "resolved_at", "closed_at", "created_at", "updated_at",
}


def _parse_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


def _serialize_case(case) -> dict:
    return SupportCaseResponse.model_validate(case).model_dump(mode="json")


@router.get("/fields")
def list_case_fields(db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)), require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "view"))):
    return sorted(enabled_module_fields(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, field_keys=CASE_LIST_FIELDS))


@router.get("/summary", response_model=SupportCaseSummaryResponse)
def case_summary(db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)), require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "view"))):
    return get_case_summary(db, tenant_id=current_user.tenant_id)


@router.get("", response_model=SupportCaseListResponse)
def list_cases(
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    sort_by: str | None = Query(default=None, max_length=80),
    sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)),
    require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, conditions=any_conditions)
    cases, total_count = list_support_cases(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([SupportCaseListItem.model_validate(case) for case in cases], total_count, pagination)


@router.get("/search", response_model=SupportCaseListResponse)
def search_cases(
    query: str = Query(..., min_length=1),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    sort_by: str | None = Query(default=None, max_length=80),
    sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)),
    require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, conditions=any_conditions)
    cases, total_count = list_support_cases(
        db,
        tenant_id=current_user.tenant_id,
        pagination=pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([SupportCaseListItem.model_validate(case) for case in cases], total_count, pagination)


@router.post("", response_model=SupportCaseResponse, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: SupportCaseCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)),
    require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "create")),
):
    submitted_fields = set(payload.model_fields_set)
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, field_keys=submitted_fields)
    sanitized_payload = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, payload=payload.model_dump())
    created = create_support_case(db, sanitized_payload, current_user)
    safe_log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=SUPPORT_CASES_MODULE_KEY,
        entity_type="support_case",
        entity_id=created.id,
        action="create",
        description=f"Created support case {created.case_number}",
        after_state=_serialize_case(created),
    )
    safe_publish_crm_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        event_type="case.created",
        entity_type="support_case",
        entity_id=created.id,
        payload={"case_number": created.case_number, "subject": created.subject, "status": created.status},
    )
    return created


@router.get("/{case_id}", response_model=SupportCaseResponse)
def get_case(case_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)), require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "view"))):
    return get_case_or_404(db, tenant_id=current_user.tenant_id, case_id=case_id)


@router.patch("/{case_id}", response_model=SupportCaseResponse)
def update_case(
    case_id: int,
    payload: SupportCaseUpdateRequest = Body(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)),
    require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "edit")),
):
    case = get_case_or_404(db, tenant_id=current_user.tenant_id, case_id=case_id)
    before_state = _serialize_case(case)
    update_data = payload.model_dump(exclude_unset=True)
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, field_keys=set(update_data))
    update_data = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key=SUPPORT_CASES_MODULE_KEY, payload=update_data)
    updated = update_support_case(db, case, update_data, current_user)
    safe_log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=SUPPORT_CASES_MODULE_KEY,
        entity_type="support_case",
        entity_id=updated.id,
        action="update",
        description=f"Updated support case {updated.case_number}",
        before_state=before_state,
        after_state=_serialize_case(updated),
    )
    if before_state["status"] != updated.status:
        safe_publish_crm_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            event_type="case.status_changed",
            entity_type="support_case",
            entity_id=updated.id,
            payload={"case_number": updated.case_number, "subject": updated.subject, "from": before_state["status"], "to": updated.status},
        )
    return updated


@router.post("/{case_id}/comments", response_model=SupportCaseCommentResponse, status_code=status.HTTP_201_CREATED)
def create_case_comment(
    case_id: int,
    payload: SupportCaseCommentCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(SUPPORT_CASES_MODULE_KEY)),
    require_permission=Depends(require_action_access(SUPPORT_CASES_MODULE_KEY, "edit")),
):
    case = get_case_or_404(db, tenant_id=current_user.tenant_id, case_id=case_id)
    comment = add_case_comment(db, case, payload.model_dump(), current_user)
    safe_log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=SUPPORT_CASES_MODULE_KEY,
        entity_type="support_case",
        entity_id=case.id,
        action="comment",
        description=f"Commented on support case {case.case_number}",
    )
    return comment
