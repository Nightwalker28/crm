from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.security import require_admin
from app.modules.platform.schema import (
    AutomationActionRegistryResponse,
    AutomationConditionFieldListResponse,
    AutomationRuleCreateRequest,
    AutomationRuleListResponse,
    AutomationRulePreviewRequest,
    AutomationRulePreviewResponse,
    AutomationRuleResponse,
    AutomationRuleRunListResponse,
    AutomationRuleRunResponse,
    AutomationTriggerRegistryResponse,
    AutomationRuleTriggerResponse,
    AutomationRuleUpdateRequest,
)
from app.modules.platform.services.automation_registry import (
    actions_for_module,
    actions_for_trigger,
    condition_fields_for_module,
    condition_fields_for_trigger,
    grouped_trigger_registry,
    serialize_action,
    serialize_condition_field,
)
from app.modules.platform.services.automation_rules import (
    SUPPORTED_AUTOMATION_TRIGGERS,
    create_automation_rule,
    delete_automation_rule,
    get_automation_rule_or_404,
    list_automation_rule_runs,
    list_automation_rules,
    preview_automation_rule,
    serialize_automation_rule,
    update_automation_rule,
)


router = APIRouter(prefix="/admin/automation-rules", tags=["Automation Rules"])


@router.get("/triggers", response_model=AutomationRuleTriggerResponse)
def get_automation_triggers(admin=Depends(require_admin)):
    return {"results": sorted(SUPPORTED_AUTOMATION_TRIGGERS)}


@router.get("/trigger-registry", response_model=AutomationTriggerRegistryResponse)
def get_automation_trigger_registry(admin=Depends(require_admin)):
    return {"results": grouped_trigger_registry()}


@router.get("/condition-fields", response_model=AutomationConditionFieldListResponse)
def get_automation_condition_fields(
    trigger_event: str | None = Query(default=None, max_length=100),
    module_key: str | None = Query(default=None, max_length=100),
    admin=Depends(require_admin),
):
    fields = condition_fields_for_trigger(trigger_event) if trigger_event else condition_fields_for_module(module_key or "")
    return {"results": [serialize_condition_field(field) for field in fields]}


@router.get("/action-registry", response_model=AutomationActionRegistryResponse)
def get_automation_action_registry(
    trigger_event: str | None = Query(default=None, max_length=100),
    module_key: str | None = Query(default=None, max_length=100),
    admin=Depends(require_admin),
):
    actions = actions_for_trigger(trigger_event) if trigger_event else actions_for_module(module_key)
    return {"results": [serialize_action(action) for action in actions]}


@router.get("", response_model=AutomationRuleListResponse)
def get_automation_rules(
    module_key: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    rules = list_automation_rules(db, tenant_id=admin.tenant_id, module_key=module_key)
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


@router.post("/preview", response_model=AutomationRulePreviewResponse)
def preview_rule(payload: AutomationRulePreviewRequest, admin=Depends(require_admin)):
    return preview_automation_rule(payload.model_dump())


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
    module_key: str | None = Query(default=None, max_length=100),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    runs = list_automation_rule_runs(db, tenant_id=admin.tenant_id, rule_id=rule_id, module_key=module_key, pagination=pagination)
    return {"results": [AutomationRuleRunResponse.model_validate(run) for run in runs]}
