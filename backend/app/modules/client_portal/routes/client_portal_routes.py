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
    ClientPageActionRequest,
    ClientPageActionResponse,
    ClientPageCreateRequest,
    ClientPagePublicResponse,
    ClientPagePublishRequest,
    ClientPageResponse,
    ClientPageUpdateRequest,
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
    create_client_page,
    create_customer_group,
    get_client_account_or_404,
    get_client_page_or_404,
    get_customer_group_or_404,
    get_public_client_page,
    list_client_accounts,
    list_client_pages,
    list_customer_groups,
    publish_client_page_link,
    record_client_page_action,
    regenerate_client_setup_link,
    resolve_client_customer_group,
    serialize_client_account,
    serialize_client_page,
    serialize_customer_group,
    serialize_public_client_page,
    setup_client_password,
    update_client_page,
    update_client_account_status,
    update_customer_group,
)


router = APIRouter(prefix="/client-portal", tags=["Client Portal"])
client_auth_router = APIRouter(prefix="/client-auth", tags=["Client Auth"])
public_client_pages_router = APIRouter(prefix="/client-pages", tags=["Client Pages"])
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


def _optional_client_account(db: Session, credentials: HTTPAuthorizationCredentials | None):
    if not credentials:
        return None
    return client_account_from_token(db, token=credentials.credentials)


def _request_metadata(request: Request) -> dict:
    return {
        "client_host": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


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
    group = create_customer_group(
        db,
        tenant_id=current_user.tenant_id,
        payload=payload.model_dump(),
        actor_user_id=current_user.id,
    )
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
    group = update_customer_group(
        db,
        group=group,
        payload=payload.model_dump(exclude_unset=True),
        actor_user_id=current_user.id,
    )
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
        actor_user_id=current_user.id,
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
        actor_user_id=current_user.id,
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


@router.get("/pages", response_model=list[ClientPageResponse])
def get_client_pages(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    pages = list_client_pages(db, tenant_id=current_user.tenant_id)
    return [ClientPageResponse.model_validate(serialize_client_page(page)) for page in pages]


@router.post("/pages", response_model=ClientPageResponse, status_code=status.HTTP_201_CREATED)
def create_client_page_route(
    payload: ClientPageCreateRequest,
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
    page = create_client_page(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return ClientPageResponse.model_validate(serialize_client_page(page))


@router.put("/pages/{page_id}", response_model=ClientPageResponse)
def update_client_page_route(
    page_id: int,
    payload: ClientPageUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    page = get_client_page_or_404(db, tenant_id=current_user.tenant_id, page_id=page_id)
    _require_linked_customer_access(
        db,
        current_user=current_user,
        contact_id=page.contact_id,
        organization_id=page.organization_id,
        action="edit",
    )
    page = update_client_page(
        db,
        page=page,
        actor_user_id=current_user.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return ClientPageResponse.model_validate(serialize_client_page(page))


@router.post("/pages/{page_id}/publish-link", response_model=ClientPageResponse)
def publish_client_page_link_route(
    page_id: int,
    payload: ClientPagePublishRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    page = get_client_page_or_404(db, tenant_id=current_user.tenant_id, page_id=page_id)
    _require_linked_customer_access(
        db,
        current_user=current_user,
        contact_id=page.contact_id,
        organization_id=page.organization_id,
        action="edit",
    )
    page, public_token = publish_client_page_link(
        db,
        page=page,
        actor_user_id=current_user.id,
        expires_in_days=payload.expires_in_days,
    )
    return ClientPageResponse.model_validate(serialize_client_page(page, public_token=public_token))


@client_auth_router.post("/setup", response_model=ClientAccountResponse)
def setup_client_password_route(
    payload: ClientSetupPasswordRequest,
    db: Session = Depends(get_db),
):
    try:
        account = setup_client_password(db, token=payload.token, password=payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing client token")
    account = client_account_from_token(db, token=credentials.credentials)
    tenant = _tenant_from_request(request)
    if account.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Client token tenant mismatch")
    group = resolve_client_customer_group(db, account=account)
    return {
        "id": account.id,
        "email": account.email,
        "tenant_id": account.tenant_id,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "customer_group": serialize_customer_group(group),
    }


@public_client_pages_router.get("/{token}", response_model=ClientPagePublicResponse)
def get_public_client_page_route(
    token: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    page = get_public_client_page(db, token=token)
    account = _optional_client_account(db, credentials)
    return ClientPagePublicResponse.model_validate(serialize_public_client_page(page, account=account))


@public_client_pages_router.post("/{token}/accept", response_model=ClientPageActionResponse, status_code=status.HTTP_201_CREATED)
def accept_public_client_page_route(
    token: str,
    payload: ClientPageActionRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    page = get_public_client_page(db, token=token)
    account = _optional_client_account(db, credentials)
    action = record_client_page_action(
        db,
        page=page,
        action="accept",
        account=account,
        payload=payload.model_dump(),
        request_metadata=_request_metadata(request),
    )
    return ClientPageActionResponse.model_validate({"id": action.id, "action": action.action, "created_at": action.created_at})


@public_client_pages_router.post("/{token}/request-changes", response_model=ClientPageActionResponse, status_code=status.HTTP_201_CREATED)
def request_changes_public_client_page_route(
    token: str,
    payload: ClientPageActionRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    page = get_public_client_page(db, token=token)
    account = _optional_client_account(db, credentials)
    action = record_client_page_action(
        db,
        page=page,
        action="request_changes",
        account=account,
        payload=payload.model_dump(),
        request_metadata=_request_metadata(request),
    )
    return ClientPageActionResponse.model_validate({"id": action.id, "action": action.action, "created_at": action.created_at})
