import ipaddress
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.calendar.schema import ClientMeetingBookingListResponse, ClientMeetingBookingResponse
from app.modules.calendar.services.booking_services import (
    get_client_booking_or_404,
    list_client_bookings,
    serialize_client_booking,
)
from app.modules.client_portal.schema import (
    ClientAccountCreateRequest,
    ClientAccountResponse,
    ClientAccountStatusRequest,
    ClientCatalogItemResponse,
    ClientCatalogListResponse,
    ClientCatalogRequestCreate,
    ClientSupportCaseCommentCreate,
    ClientSupportCaseCommentResponse,
    ClientSupportCaseCreate,
    ClientSupportCaseListResponse,
    ClientSupportCaseResponse,
    ClientPageActionRequest,
    ClientPageActionResponse,
    ClientPageCreateRequest,
    ClientPagePublicResponse,
    ClientPagePublishRequest,
    ClientPageResponse,
    ClientPageUpdateRequest,
    ClientPortalOrderListResponse,
    ClientPortalOrderResponse,
    ClientQuickQuestionCreate,
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
    check_client_login_rate_limit,
    check_public_client_page_action_rate_limit,
    client_account_from_token,
    clear_failed_client_login_attempts,
    create_client_account,
    create_client_catalog_order,
    create_client_page,
    create_customer_group,
    get_client_account_or_404,
    get_client_catalog_item_or_404,
    get_client_order_or_404,
    get_client_page_document_or_404,
    get_client_page_or_404,
    get_customer_group_or_404,
    get_public_client_page,
    list_client_accounts,
    list_client_accounts_cursor,
    list_client_catalog_items,
    list_client_orders,
    list_client_pages,
    list_client_pages_cursor,
    list_customer_groups,
    publish_client_page_link,
    record_failed_client_login_attempt,
    record_public_client_page_action_attempt,
    record_client_page_action,
    regenerate_client_setup_link,
    require_client_account_matches_page,
    resolve_client_customer_group,
    serialize_client_account,
    serialize_client_catalog_item,
    serialize_client_order,
    serialize_client_page,
    serialize_customer_group,
    serialize_public_client_page,
    setup_client_password,
    update_client_page,
    update_client_account_status,
    update_customer_group,
)
from app.modules.documents.schema import ClientDocumentListResponse, ClientDocumentResponse
from app.modules.documents.services.document_services import (
    get_client_document_share_or_404,
    list_client_documents,
    log_client_document_download,
    log_client_document_view,
    resolve_document_download,
    serialize_client_document_share,
)
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.crm_events import safe_publish_crm_event
from app.modules.sales.schema import ClientQuoteActionRequest, ClientQuoteListResponse, ClientQuoteResponse
from app.modules.sales.services.quotes_services import (
    get_client_quote_or_404,
    list_client_quotes,
    respond_to_client_quote,
    serialize_client_quote,
)
from app.modules.support.services.cases_services import (
    add_client_support_case_comment,
    create_client_support_case,
    get_client_support_case_or_404,
    list_client_support_cases,
    serialize_client_support_case,
    update_client_support_case_status,
)
from app.modules.user_management.models import Tenant


router = APIRouter(prefix="/client-portal", tags=["Client Portal"])
client_auth_router = APIRouter(prefix="/client-auth", tags=["Client Auth"])
public_client_pages_router = APIRouter(prefix="/client-pages", tags=["Client Pages"])
client_catalog_router = APIRouter(prefix="/client-catalog", tags=["Client Catalog"])
client_orders_router = APIRouter(prefix="/client-orders", tags=["Client Orders"])
client_support_router = APIRouter(prefix="/client-support", tags=["Client Support"])
client_messages_router = APIRouter(prefix="/client-messages", tags=["Client Messages"])
client_documents_router = APIRouter(prefix="/client-documents", tags=["Client Documents"])
client_quotes_router = APIRouter(prefix="/client-quotes", tags=["Client Quotes"])
client_bookings_router = APIRouter(prefix="/client-bookings", tags=["Client Bookings"])
client_bearer = HTTPBearer(auto_error=False)


def _tenant_from_request(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return tenant


def _optional_tenant_from_request(request: Request):
    return getattr(request.state, "tenant", None)


def _tenant_by_id_or_400(db: Session, tenant_id: int):
    tenant = (
        db.query(Tenant)
        .filter(Tenant.id == tenant_id, Tenant.is_active == 1)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return tenant


def _tenant_by_slug_or_400(db: Session, tenant_slug: str | None):
    slug = (tenant_slug or "").strip()
    if not slug:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    tenant = (
        db.query(Tenant)
        .filter(Tenant.slug == slug, Tenant.is_active == 1)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return tenant


def _resolve_client_auth_tenant(
    db: Session,
    request: Request,
    *,
    page_token: str | None = None,
    tenant_slug: str | None = None,
):
    tenant = _optional_tenant_from_request(request)
    if tenant:
        return tenant
    if page_token and page_token.strip():
        page = get_public_client_page(db, token=page_token.strip())
        return _tenant_by_id_or_400(db, int(page.tenant_id))
    if tenant_slug and tenant_slug.strip():
        return _tenant_by_slug_or_400(db, tenant_slug)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")


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
    try:
        return client_account_from_token(db, token=credentials.credentials)
    except HTTPException as exc:
        if exc.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            return None
        raise


def _require_client_account(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing client token")
    account = client_account_from_token(db, token=credentials.credentials)
    tenant = _optional_tenant_from_request(request)
    if tenant and account.tenant_id != tenant.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Client token tenant mismatch")
    return account


def _request_metadata(request: Request) -> dict:
    client_host = request.client.host if request.client else None
    normalized_client_host = None
    if client_host:
        try:
            normalized_client_host = ipaddress.ip_address(client_host.strip()).compressed
        except ValueError:
            normalized_client_host = None
    return {
        "client_host": normalized_client_host,
        "user_agent": (request.headers.get("user-agent") or "")[:500] or None,
    }


def _client_ip_for_rate_limit(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    raw_host = forwarded_for.split(",", 1)[0].strip() if forwarded_for else None
    if not raw_host and request.client:
        raw_host = request.client.host
    if not raw_host:
        return None
    try:
        return ipaddress.ip_address(raw_host.strip()).compressed
    except ValueError:
        return None


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
    sort_by: str | None = Query(default=None, max_length=80),
    sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    accounts = list_client_accounts(db, tenant_id=current_user.tenant_id, sort_by=sort_by, sort_direction=sort_direction)
    return [ClientAccountResponse.model_validate(serialize_client_account(account)) for account in accounts]


@router.get("/accounts/cursor", response_model=dict)
def get_client_accounts_cursor(
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    accounts = list_client_accounts_cursor(
        db,
        tenant_id=current_user.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
    )
    return build_cursor_response(
        [ClientAccountResponse.model_validate(serialize_client_account(account)).model_dump(mode="json") for account in accounts],
        limit=pagination.limit,
        id_attr="id",
    )


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
    sort_by: str | None = Query(default=None, max_length=80),
    sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    pages = list_client_pages(db, tenant_id=current_user.tenant_id, sort_by=sort_by, sort_direction=sort_direction)
    return [ClientPageResponse.model_validate(serialize_client_page(page, db=db)) for page in pages]


@router.get("/pages/cursor", response_model=dict)
def get_client_pages_cursor(
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_contacts")),
    require_permission=Depends(require_action_access("sales_contacts", "view")),
):
    pages = list_client_pages_cursor(
        db,
        tenant_id=current_user.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
    )
    return build_cursor_response(
        [ClientPageResponse.model_validate(serialize_client_page(page, db=db)).model_dump(mode="json") for page in pages],
        limit=pagination.limit,
        id_attr="id",
    )


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
    return ClientPageResponse.model_validate(serialize_client_page(page, db=db))


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
    return ClientPageResponse.model_validate(serialize_client_page(page, db=db))


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
    return ClientPageResponse.model_validate(serialize_client_page(page, public_token=public_token, db=db))


@client_auth_router.post("/setup", response_model=ClientAccountResponse)
def setup_client_password_route(
    payload: ClientSetupPasswordRequest,
    db: Session = Depends(get_db),
):
    expected_tenant_id = None
    if payload.tenant_slug:
        expected_tenant_id = int(_tenant_by_slug_or_400(db, payload.tenant_slug).id)
    try:
        account = setup_client_password(
            db,
            token=payload.token,
            password=payload.password,
            expected_tenant_id=expected_tenant_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ClientAccountResponse.model_validate(serialize_client_account(account))


@client_auth_router.post("/login", response_model=ClientLoginResponse)
def login_client_route(
    payload: ClientLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant = _resolve_client_auth_tenant(
        db,
        request,
        page_token=payload.page_token,
        tenant_slug=payload.tenant_slug,
    )
    email = str(payload.email)
    client_host = _client_ip_for_rate_limit(request)
    check_client_login_rate_limit(tenant_id=tenant.id, email=email, client_host=client_host)
    try:
        account, token = authenticate_client_account(
            db,
            tenant_id=tenant.id,
            email=email,
            password=payload.password,
        )
    except HTTPException as exc:
        if exc.status_code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            record_failed_client_login_attempt(tenant_id=tenant.id, email=email, client_host=client_host)
        raise
    clear_failed_client_login_attempts(tenant_id=tenant.id, email=email, client_host=client_host)
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="client_portal",
        entity_type="client_account",
        entity_id=account.id,
        action="portal.login",
        description=f"Client portal login for {account.email}",
        after_state={
            "client_account_id": account.id,
            "contact_id": account.contact_id,
            "organization_id": account.organization_id,
            "request": _request_metadata(request),
        },
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
    account = _require_client_account(request, credentials, db)
    group = resolve_client_customer_group(db, account=account)
    serialized_account = serialize_client_account(account)
    return {
        "id": account.id,
        "email": account.email,
        "tenant_id": account.tenant_id,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "contact_name": serialized_account["contact_name"],
        "organization_name": serialized_account["organization_name"],
        "customer_group": serialize_customer_group(group),
    }


@client_catalog_router.get("", response_model=ClientCatalogListResponse)
def list_client_catalog_route(
    request: Request,
    kind: str | None = Query(default=None, pattern="^(product|service|all)$"),
    search: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    group = resolve_client_customer_group(db, account=account)
    items = list_client_catalog_items(db, account=account, kind=kind, search=search, limit=limit)
    return {
        "results": [
            ClientCatalogItemResponse.model_validate(serialize_client_catalog_item(item, group=group))
            for item in items
        ]
    }


@client_catalog_router.get("/{kind}/{item_id}", response_model=ClientCatalogItemResponse)
def get_client_catalog_item_route(
    kind: str,
    item_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    group = resolve_client_customer_group(db, account=account)
    item = get_client_catalog_item_or_404(db, account=account, kind=kind, item_id=item_id)
    return ClientCatalogItemResponse.model_validate(serialize_client_catalog_item(item, group=group))


@client_catalog_router.post("/{kind}/{item_id}/request", response_model=ClientPortalOrderResponse, status_code=status.HTTP_201_CREATED)
def request_client_catalog_item_route(
    kind: str,
    item_id: int,
    payload: ClientCatalogRequestCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    item = get_client_catalog_item_or_404(db, account=account, kind=kind, item_id=item_id)
    order = create_client_catalog_order(db, account=account, item=item, payload=payload.model_dump())
    return ClientPortalOrderResponse.model_validate(serialize_client_order(order))


@client_orders_router.get("", response_model=ClientPortalOrderListResponse)
def list_client_orders_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    orders = list_client_orders(db, account=account)
    return {"results": [ClientPortalOrderResponse.model_validate(serialize_client_order(order)) for order in orders]}


@client_orders_router.get("/{order_id}", response_model=ClientPortalOrderResponse)
def get_client_order_route(
    order_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    order = get_client_order_or_404(db, account=account, order_id=order_id)
    return ClientPortalOrderResponse.model_validate(serialize_client_order(order))


@client_support_router.get("/cases", response_model=ClientSupportCaseListResponse)
def list_client_support_cases_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    cases = list_client_support_cases(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
    )
    return {"results": [ClientSupportCaseResponse.model_validate(serialize_client_support_case(case)) for case in cases]}


@client_support_router.post("/cases", response_model=ClientSupportCaseResponse, status_code=status.HTTP_201_CREATED)
def create_client_support_case_route(
    payload: ClientSupportCaseCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    case = create_client_support_case(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        payload=payload.model_dump(),
    )
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=case.id,
        action="portal.ticket.created",
        description=f"Client created support case {case.case_number}",
        after_state=serialize_client_support_case(case),
    )
    return ClientSupportCaseResponse.model_validate(serialize_client_support_case(case))


@client_support_router.get("/cases/{case_id}", response_model=ClientSupportCaseResponse)
def get_client_support_case_route(
    case_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    case = get_client_support_case_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        case_id=case_id,
    )
    return ClientSupportCaseResponse.model_validate(serialize_client_support_case(case))


@client_support_router.post("/cases/{case_id}/comments", response_model=ClientSupportCaseCommentResponse, status_code=status.HTTP_201_CREATED)
def create_client_support_case_comment_route(
    case_id: int,
    payload: ClientSupportCaseCommentCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    case = get_client_support_case_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        case_id=case_id,
    )
    comment = add_client_support_case_comment(db, case=case, payload=payload.model_dump())
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=case.id,
        action="portal.ticket.replied",
        description=f"Client replied to support case {case.case_number}",
    )
    return ClientSupportCaseCommentResponse.model_validate(
        {
            "id": comment.id,
            "case_id": comment.case_id,
            "body": comment.body,
            "is_internal": comment.is_internal,
            "author_type": "client",
            "created_at": comment.created_at,
        }
    )


@client_support_router.post("/cases/{case_id}/{action}", response_model=ClientSupportCaseResponse)
def update_client_support_case_status_route(
    case_id: int,
    action: str,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    case = get_client_support_case_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        case_id=case_id,
    )
    updated = update_client_support_case_status(db, case=case, action=action)
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=case.id,
        action=f"client_{action}",
        description=f"Client updated support case {case.case_number}",
        after_state=serialize_client_support_case(updated),
    )
    return ClientSupportCaseResponse.model_validate(serialize_client_support_case(updated))


@client_messages_router.get("", response_model=ClientSupportCaseListResponse)
def list_client_messages_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    messages = list_client_support_cases(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        source="client_portal_message",
    )
    return {"results": [ClientSupportCaseResponse.model_validate(serialize_client_support_case(message)) for message in messages]}


@client_messages_router.post("", response_model=ClientSupportCaseResponse, status_code=status.HTTP_201_CREATED)
def create_client_message_route(
    payload: ClientQuickQuestionCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    message = create_client_support_case(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        payload={
            "subject": payload.subject,
            "description": payload.message,
            "category": "question",
            "priority": "medium",
        },
        source="client_portal_message",
        event_type="client_message_created",
    )
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=message.id,
        action="portal.message.sent",
        description=f"Client asked quick question {message.case_number}",
        after_state=serialize_client_support_case(message),
    )
    return ClientSupportCaseResponse.model_validate(serialize_client_support_case(message))


@client_messages_router.get("/{message_id}", response_model=ClientSupportCaseResponse)
def get_client_message_route(
    message_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    message = get_client_support_case_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        case_id=message_id,
        source="client_portal_message",
    )
    return ClientSupportCaseResponse.model_validate(serialize_client_support_case(message))


@client_messages_router.post("/{message_id}/comments", response_model=ClientSupportCaseCommentResponse, status_code=status.HTTP_201_CREATED)
def create_client_message_comment_route(
    message_id: int,
    payload: ClientSupportCaseCommentCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    message = get_client_support_case_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        case_id=message_id,
        source="client_portal_message",
    )
    comment = add_client_support_case_comment(db, case=message, payload=payload.model_dump())
    safe_log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=message.id,
        action="portal.message.sent",
        description=f"Client replied to quick question {message.case_number}",
    )
    return ClientSupportCaseCommentResponse.model_validate(
        {
            "id": comment.id,
            "case_id": comment.case_id,
            "body": comment.body,
            "is_internal": comment.is_internal,
            "author_type": "client",
            "created_at": comment.created_at,
        }
    )


@client_documents_router.get("", response_model=ClientDocumentListResponse)
def list_client_documents_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    shares = list_client_documents(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
    )
    return {"results": [ClientDocumentResponse.model_validate(serialize_client_document_share(share)) for share in shares]}


@client_documents_router.get("/{document_id}/download")
def download_client_document_route(
    document_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    share = get_client_document_share_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        document_id=document_id,
    )
    document = share.document
    storage_user = SimpleNamespace(id=document.uploaded_by_user_id or 0, tenant_id=document.tenant_id)
    download = resolve_document_download(db, document=document, current_user=storage_user)
    log_client_document_view(db, share=share, client_account_id=account.id)
    log_client_document_download(db, share=share, client_account_id=account.id)
    if download["kind"] == "bytes":
        return Response(
            content=download["content"],
            media_type=document.content_type,
            headers={"Content-Disposition": f'inline; filename="{document.original_filename}"'},
        )
    return FileResponse(
        download["path"],
        media_type=document.content_type,
        filename=document.original_filename,
        content_disposition_type="inline",
    )


@client_quotes_router.get("", response_model=ClientQuoteListResponse)
def list_client_quotes_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    quotes = list_client_quotes(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
    )
    return {"results": [ClientQuoteResponse.model_validate(serialize_client_quote(db, quote)) for quote in quotes]}


@client_quotes_router.get("/{quote_id}", response_model=ClientQuoteResponse)
def get_client_quote_route(
    quote_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    quote = get_client_quote_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        quote_id=quote_id,
    )
    return ClientQuoteResponse.model_validate(serialize_client_quote(db, quote))


@client_quotes_router.get("/{quote_id}/proposal/download")
def download_client_quote_proposal_route(
    quote_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    quote = get_client_quote_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        quote_id=quote_id,
    )
    payload = serialize_client_quote(db, quote)
    content = (payload.get("proposal_content_text") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote proposal not found.")
    safe_log_activity(
        db,
        tenant_id=quote.tenant_id,
        actor_user_id=None,
        module_key="sales_quotes",
        entity_type="sales_quote",
        entity_id=quote.quote_id,
        action="portal.quote.download",
        description=f"Client downloaded quote proposal {quote.quote_number}",
        after_state={"client_account_id": account.id, "quote_id": quote.quote_id},
    )
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{quote.quote_number}-proposal.txt"'},
    )


@client_quotes_router.post("/{quote_id}/{action}", response_model=ClientQuoteResponse)
def respond_to_client_quote_route(
    quote_id: int,
    action: str,
    payload: ClientQuoteActionRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote action not found.")
    quote = get_client_quote_or_404(
        db,
        tenant_id=account.tenant_id,
        contact_id=account.contact_id,
        organization_id=account.organization_id,
        quote_id=quote_id,
    )
    previous_status = quote.status
    updated = respond_to_client_quote(
        db,
        quote=quote,
        action=action,
        client_account_id=account.id,
        message=payload.message,
    )
    safe_publish_crm_event(
        db,
        tenant_id=updated.tenant_id,
        actor_user_id=None,
        event_type="quote.status_changed",
        entity_type="sales_quote",
        entity_id=updated.quote_id,
        payload={
            "quote_id": updated.quote_id,
            "quote_number": updated.quote_number,
            "client_account_id": account.id,
            "previous_status": previous_status,
            "status": updated.status,
            "message": (payload.message or "").strip() or None,
            "href": f"/dashboard/sales/quotes/{updated.quote_id}",
        },
    )
    return ClientQuoteResponse.model_validate(serialize_client_quote(db, updated))


@client_bookings_router.get("", response_model=ClientMeetingBookingListResponse)
def list_client_bookings_route(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    bookings = list_client_bookings(db, tenant_id=account.tenant_id, email=account.email)
    return {"results": [ClientMeetingBookingResponse.model_validate(serialize_client_booking(booking)) for booking in bookings]}


@client_bookings_router.get("/{booking_id}", response_model=ClientMeetingBookingResponse)
def get_client_booking_route(
    booking_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    account = _require_client_account(request, credentials, db)
    booking = get_client_booking_or_404(db, tenant_id=account.tenant_id, email=account.email, booking_id=booking_id)
    return ClientMeetingBookingResponse.model_validate(serialize_client_booking(booking))


@public_client_pages_router.get("/{token}", response_model=ClientPagePublicResponse)
def get_public_client_page_route(
    token: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    page = get_public_client_page(db, token=token)
    account = _optional_client_account(db, credentials)
    return ClientPagePublicResponse.model_validate(serialize_public_client_page(page, account=account, db=db))


@public_client_pages_router.get("/{token}/documents/{document_id}/download")
def download_public_client_page_document(
    token: str,
    document_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing client token")
    page = get_public_client_page(db, token=token)
    account = client_account_from_token(db, token=credentials.credentials)
    require_client_account_matches_page(account, page)
    document = get_client_page_document_or_404(db, page=page, document_id=document_id)
    current_user = SimpleNamespace(id=page.created_by_user_id)
    download = resolve_document_download(db, document=document, current_user=current_user)
    if download["kind"] == "bytes":
        return Response(
            content=download["content"],
            media_type=document.content_type,
            headers={"Content-Disposition": f'inline; filename="{document.original_filename}"'},
        )
    return FileResponse(
        download["path"],
        media_type=document.content_type,
        filename=document.original_filename,
        content_disposition_type="inline",
    )


@public_client_pages_router.post("/{token}/accept", response_model=ClientPageActionResponse, status_code=status.HTTP_201_CREATED)
def accept_public_client_page_route(
    token: str,
    payload: ClientPageActionRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    client_host = _client_ip_for_rate_limit(request)
    check_public_client_page_action_rate_limit(token=token, client_host=client_host)
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
    record_public_client_page_action_attempt(token=token, client_host=client_host)
    return ClientPageActionResponse.model_validate({"id": action.id, "action": action.action, "created_at": action.created_at})


@public_client_pages_router.post("/{token}/request-changes", response_model=ClientPageActionResponse, status_code=status.HTTP_201_CREATED)
def request_changes_public_client_page_route(
    token: str,
    payload: ClientPageActionRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(client_bearer),
    db: Session = Depends(get_db),
):
    client_host = _client_ip_for_rate_limit(request)
    check_public_client_page_action_rate_limit(token=token, client_host=client_host)
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
    record_public_client_page_action_attempt(token=token, client_host=client_host)
    return ClientPageActionResponse.model_validate({"id": action.id, "action": action.action, "created_at": action.created_at})
