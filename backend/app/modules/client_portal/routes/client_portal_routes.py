from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.client_portal.schema import (
    ClientAccountCreateRequest,
    ClientAccountResponse,
    ClientAccountStatusRequest,
    ClientLoginRequest,
    ClientLoginResponse,
    ClientMeResponse,
    ClientSetupPasswordRequest,
    CustomerGroupAssignmentRequest,
    CustomerGroupCreateRequest,
    CustomerGroupResponse,
    CustomerGroupUpdateRequest,
)
from app.modules.client_portal.services.client_portal_services import (
    assign_contact_customer_group,
    assign_organization_customer_group,
    authenticate_client_account,
    client_account_from_token,
    create_client_account,
    create_customer_group,
    get_client_account_or_404,
    get_customer_group_or_404,
    list_client_accounts,
    list_customer_groups,
    regenerate_client_setup_link,
    resolve_client_customer_group,
    serialize_client_account,
    serialize_customer_group,
    setup_client_password,
    update_client_account_status,
    update_customer_group,
)


router = APIRouter(prefix="/client-portal", tags=["Client Portal"])
client_auth_router = APIRouter(prefix="/client-auth", tags=["Client Auth"])
client_bearer = HTTPBearer(auto_error=False)


def _tenant_from_request(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return tenant


def _require_linked_customer_access(db: Session, *, current_user, contact_id: int | None, organization_id: int | None, action: str) -> None:
    module_key = "sales_contacts" if contact_id else "sales_organizations"
    try:
        require_department_module_access(db, user=current_user, module_key=module_key)
        require_role_module_action_access(db, user=current_user, module_key=module_key, action=action)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/customer-groups", response_model=list[CustomerGroupResponse])
def get_customer_groups(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    groups = list_customer_groups(db, tenant_id=current_user.tenant_id)
    return [CustomerGroupResponse.model_validate(serialize_customer_group(group)) for group in groups]


@router.post("/customer-groups", response_model=CustomerGroupResponse, status_code=status.HTTP_201_CREATED)
def create_customer_group_route(
    payload: CustomerGroupCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "edit")),
):
    group = create_customer_group(db, tenant_id=current_user.tenant_id, payload=payload.model_dump())
    return CustomerGroupResponse.model_validate(serialize_customer_group(group))


@router.put("/customer-groups/{group_id}", response_model=CustomerGroupResponse)
def update_customer_group_route(
    group_id: int,
    payload: CustomerGroupUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "edit")),
):
    group = get_customer_group_or_404(db, tenant_id=current_user.tenant_id, group_id=group_id)
    group = update_customer_group(db, group=group, payload=payload.model_dump(exclude_unset=True))
    return CustomerGroupResponse.model_validate(serialize_customer_group(group))


@router.put("/contacts/{contact_id}/customer-group")
def assign_contact_group_route(
    contact_id: int,
    payload: CustomerGroupAssignmentRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "edit")),
):
    contact = assign_contact_customer_group(
        db,
        tenant_id=current_user.tenant_id,
        contact_id=contact_id,
        group_id=payload.customer_group_id,
    )
    return {"contact_id": contact.contact_id, "customer_group_id": contact.customer_group_id}


@router.put("/organizations/{organization_id}/customer-group")
def assign_organization_group_route(
    organization_id: int,
    payload: CustomerGroupAssignmentRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_organizations")),
    require_permission=Depends(require_action_access("sales_organizations", "edit")),
):
    organization = assign_organization_customer_group(
        db,
        tenant_id=current_user.tenant_id,
        organization_id=organization_id,
        group_id=payload.customer_group_id,
    )
    return {"organization_id": organization.org_id, "customer_group_id": organization.customer_group_id}


@router.get("/accounts", response_model=list[ClientAccountResponse])
def get_client_accounts(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    accounts = list_client_accounts(db, tenant_id=current_user.tenant_id)
    return [ClientAccountResponse.model_validate(serialize_client_account(account)) for account in accounts]


@router.post("/accounts", response_model=ClientAccountResponse, status_code=status.HTTP_201_CREATED)
def create_client_account_route(
    payload: ClientAccountCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    _require_linked_customer_access(
        db,
        current_user=current_user,
        contact_id=payload.contact_id,
        organization_id=payload.organization_id,
        action="edit",
    )
    account, setup_token = create_client_account(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return ClientAccountResponse.model_validate(serialize_client_account(account, setup_token=setup_token))


@router.post("/accounts/{account_id}/setup-link", response_model=ClientAccountResponse)
def regenerate_client_setup_link_route(
    account_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    account = get_client_account_or_404(db, tenant_id=current_user.tenant_id, account_id=account_id)
    _require_linked_customer_access(
        db,
        current_user=current_user,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        action="edit",
    )
    account, setup_token = regenerate_client_setup_link(db, account=account, actor_user_id=current_user.id)
    return ClientAccountResponse.model_validate(serialize_client_account(account, setup_token=setup_token))


@router.put("/accounts/{account_id}/status", response_model=ClientAccountResponse)
def update_client_account_status_route(
    account_id: int,
    payload: ClientAccountStatusRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    account = get_client_account_or_404(db, tenant_id=current_user.tenant_id, account_id=account_id)
    _require_linked_customer_access(
        db,
        current_user=current_user,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        action="edit",
    )
    account = update_client_account_status(
        db,
        account=account,
        status_value=payload.status,
        actor_user_id=current_user.id,
    )
    return ClientAccountResponse.model_validate(serialize_client_account(account))


@client_auth_router.post("/setup", response_model=ClientAccountResponse)
def setup_client_password_route(
    payload: ClientSetupPasswordRequest,
    db: Session = Depends(get_db),
):
    account = setup_client_password(db, token=payload.token, password=payload.password)
    return ClientAccountResponse.model_validate(serialize_client_account(account))


@client_auth_router.post("/login", response_model=ClientLoginResponse)
def login_client_route(
    payload: ClientLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant = _tenant_from_request(request)
    account, token = authenticate_client_account(
        db,
        tenant_id=tenant.id,
        email=str(payload.email),
        password=payload.password,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "account": serialize_client_account(account),
    }


@client_auth_router.get("/me", response_model=ClientMeResponse)
def get_client_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing client token")
    account = client_account_from_token(db, token=credentials.credentials)
    group = resolve_client_customer_group(db, account=account)
    return {
        "id": account.id,
        "email": account.email,
        "tenant_id": account.tenant_id,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "customer_group": serialize_customer_group(group),
    }
