from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.contracts.schema import (
    ContractCreateRequest,
    ContractListItem,
    ContractListResponse,
    ContractPartyCreateRequest,
    ContractPartyResponse,
    ContractResponse,
    ContractSignerCreateRequest,
    ContractSignerResponse,
    ContractSignerUpdateRequest,
    ContractUpdateRequest,
)
from app.modules.contracts.services.contracts_services import (
    add_contract_party,
    add_contract_signer,
    create_contract,
    get_contract_or_404,
    list_contracts,
    update_contract,
    update_contract_signer,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.module_fields import enabled_module_fields, reject_disabled_field_writes, sanitize_disabled_field_payload, sanitize_disabled_filter_conditions


router = APIRouter(prefix="/contracts", tags=["Contracts"])
CONTRACTS_MODULE_KEY = "contracts"
CONTRACT_LIST_FIELDS = {
    "contract_number", "title", "status", "organization_id", "contact_id", "opportunity_id", "quote_id", "order_id",
    "document_id", "effective_date", "expiration_date", "renewal_date", "value_amount", "currency", "owner_id", "created_at", "updated_at",
}


def _parse_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


def _serialize_contract(contract) -> dict:
    return ContractResponse.model_validate(contract).model_dump(mode="json")


@router.get("/fields")
def list_contract_fields(db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "view"))):
    return sorted(enabled_module_fields(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, field_keys=CONTRACT_LIST_FIELDS))


@router.get("", response_model=ContractListResponse)
def list_contract_records(
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)),
    require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, conditions=any_conditions)
    items, total_count = list_contracts(db, tenant_id=current_user.tenant_id, pagination=pagination, all_filter_conditions=all_conditions, any_filter_conditions=any_conditions)
    return build_paged_response([ContractListItem.model_validate(item) for item in items], total_count, pagination)


@router.get("/search", response_model=ContractListResponse)
def search_contract_records(
    query: str = Query(..., min_length=1),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)),
    require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, conditions=any_conditions)
    items, total_count = list_contracts(db, tenant_id=current_user.tenant_id, pagination=pagination, search=query, all_filter_conditions=all_conditions, any_filter_conditions=any_conditions)
    return build_paged_response([ContractListItem.model_validate(item) for item in items], total_count, pagination)


@router.post("", response_model=ContractResponse, status_code=status.HTTP_201_CREATED)
def create_contract_record(payload: ContractCreateRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "create"))):
    submitted_fields = set(payload.model_fields_set)
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, field_keys=submitted_fields)
    sanitized_payload = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, payload=payload.model_dump())
    created = create_contract(db, sanitized_payload, current_user)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=CONTRACTS_MODULE_KEY, entity_type="contract", entity_id=created.id, action="create", description=f"Created contract {created.contract_number}", after_state=_serialize_contract(created))
    return created


@router.get("/{contract_id}", response_model=ContractResponse)
def get_contract_record(contract_id: int, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "view"))):
    return get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)


@router.patch("/{contract_id}", response_model=ContractResponse)
def update_contract_record(contract_id: int, payload: ContractUpdateRequest = Body(...), db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "edit"))):
    contract = get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)
    before_state = _serialize_contract(contract)
    data = payload.model_dump(exclude_unset=True)
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, field_keys=set(data))
    data = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key=CONTRACTS_MODULE_KEY, payload=data)
    updated = update_contract(db, contract, data, current_user)
    log_activity(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=CONTRACTS_MODULE_KEY, entity_type="contract", entity_id=updated.id, action="update", description=f"Updated contract {updated.contract_number}", before_state=before_state, after_state=_serialize_contract(updated))
    return updated


@router.post("/{contract_id}/parties", response_model=ContractPartyResponse, status_code=status.HTTP_201_CREATED)
def create_contract_party(contract_id: int, payload: ContractPartyCreateRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "edit"))):
    contract = get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)
    return add_contract_party(db, contract, payload.model_dump(), current_user)


@router.post("/{contract_id}/signers", response_model=ContractSignerResponse, status_code=status.HTTP_201_CREATED)
def create_contract_signer(contract_id: int, payload: ContractSignerCreateRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "edit"))):
    contract = get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)
    return add_contract_signer(db, contract, payload.model_dump(), current_user)


@router.patch("/{contract_id}/signers/{signer_id}", response_model=ContractSignerResponse)
def patch_contract_signer(contract_id: int, signer_id: int, payload: ContractSignerUpdateRequest, db: Session = Depends(get_db), current_user=Depends(require_user), require_module=Depends(require_module_access(CONTRACTS_MODULE_KEY)), require_permission=Depends(require_action_access(CONTRACTS_MODULE_KEY, "edit"))):
    contract = get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)
    return update_contract_signer(db, contract, signer_id, payload.model_dump(exclude_unset=True), current_user)
