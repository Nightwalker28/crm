from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.security import require_admin
from app.modules.platform.schema import (
    AutomationRuleCreateRequest,
    AutomationRuleListResponse,
    AutomationRuleResponse,
    AutomationRuleRunListResponse,
    AutomationRuleRunResponse,
    AutomationRuleTriggerResponse,
    AutomationRuleUpdateRequest,
)
from app.modules.platform.services.automation_rules import (
    SUPPORTED_AUTOMATION_TRIGGERS,
    create_automation_rule,
    delete_automation_rule,
    get_automation_rule_or_404,
    list_automation_rule_runs,
    list_automation_rules,
    serialize_automation_rule,
    update_automation_rule,
)


router = APIRouter(prefix="/admin/automation-rules", tags=["Automation Rules"])


@router.get("/triggers", response_model=AutomationRuleTriggerResponse)
def get_automation_triggers(admin=Depends(require_admin)):
    return {"results": sorted(SUPPORTED_AUTOMATION_TRIGGERS)}


@router.get("", response_model=AutomationRuleListResponse)
def get_automation_rules(db: Session = Depends(get_db), admin=Depends(require_admin)):
    rules = list_automation_rules(db, tenant_id=admin.tenant_id)
    return {"results": [AutomationRuleResponse.model_validate(serialize_automation_rule(rule)) for rule in rules]}


@router.post("", response_model=AutomationRuleResponse, status_code=status.HTTP_201_CREATED)
def create_rule(payload: AutomationRuleCreateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rule = create_automation_rule(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        payload=payload.model_dump(),
    )
    return AutomationRuleResponse.model_validate(serialize_automation_rule(rule))


@router.put("/{rule_id}", response_model=AutomationRuleResponse)
def update_rule(rule_id: int, payload: AutomationRuleUpdateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rule = get_automation_rule_or_404(db, tenant_id=admin.tenant_id, rule_id=rule_id)
    updated = update_automation_rule(
        db,
        rule=rule,
        actor_user_id=admin.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return AutomationRuleResponse.model_validate(serialize_automation_rule(updated))


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    rule = get_automation_rule_or_404(db, tenant_id=admin.tenant_id, rule_id=rule_id)
    delete_automation_rule(db, rule=rule)


@router.get("/runs", response_model=AutomationRuleRunListResponse)
def get_automation_runs(
    rule_id: int | None = None,
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    runs = list_automation_rule_runs(db, tenant_id=admin.tenant_id, rule_id=rule_id, pagination=pagination)
    return {"results": [AutomationRuleRunResponse.model_validate(run) for run in runs]}
