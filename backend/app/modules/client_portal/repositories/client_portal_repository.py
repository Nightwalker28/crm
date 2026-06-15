from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, object_session, selectinload

from app.modules.client_portal.models import ClientAccount, ClientPage, ClientPageAction, CustomerGroup
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents.models import Document
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.models import Tenant
from app.modules.website_integrations.models import WebsiteIntegrationOrder


CLIENT_ACCOUNT_SORT_FIELDS = {
    "email": ClientAccount.email,
    "status": ClientAccount.status,
    "contact_id": ClientAccount.contact_id,
    "organization_id": ClientAccount.organization_id,
    "setup_token_expires_at": ClientAccount.setup_token_expires_at,
    "last_login_at": ClientAccount.last_login_at,
    "created_at": ClientAccount.created_at,
    "updated_at": ClientAccount.updated_at,
}

CLIENT_PAGE_SORT_FIELDS = {
    "title": ClientPage.title,
    "status": ClientPage.status,
    "contact_id": ClientPage.contact_id,
    "organization_id": ClientPage.organization_id,
    "source_module_key": ClientPage.source_module_key,
    "source_entity_id": ClientPage.source_entity_id,
    "public_token_expires_at": ClientPage.public_token_expires_at,
    "published_at": ClientPage.published_at,
    "created_at": ClientPage.created_at,
    "updated_at": ClientPage.updated_at,
}


def apply_client_account_sort(query, sort_by: str | None = None, sort_direction: str | None = None):
    column = CLIENT_ACCOUNT_SORT_FIELDS.get((sort_by or "").strip())
    if column is None:
        return query.order_by(ClientAccount.created_at.desc(), ClientAccount.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = ClientAccount.id.desc() if direction == "desc" else ClientAccount.id.asc()
    return query.order_by(primary, secondary)


def apply_client_page_sort(query, sort_by: str | None = None, sort_direction: str | None = None):
    column = CLIENT_PAGE_SORT_FIELDS.get((sort_by or "").strip())
    if column is None:
        return query.order_by(ClientPage.created_at.desc(), ClientPage.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = ClientPage.id.desc() if direction == "desc" else ClientPage.id.asc()
    return query.order_by(primary, secondary)


def list_page_documents(db: Session, *, tenant_id: int, document_ids: list[int]) -> list[Document]:
    if not document_ids:
        return []
    return (
        db.query(Document)
        .filter(
            Document.tenant_id == tenant_id,
            Document.id.in_(document_ids),
            Document.deleted_at.is_(None),
        )
        .order_by(Document.created_at.desc(), Document.id.desc())
        .all()
    )


def action_summary(db: Session, *, tenant_id: int, page_id: int) -> tuple[list[ClientPageAction], int]:
    query = db.query(ClientPageAction).filter(
        ClientPageAction.tenant_id == tenant_id,
        ClientPageAction.client_page_id == page_id,
    )
    recent = query.order_by(ClientPageAction.created_at.desc(), ClientPageAction.id.desc()).limit(3).all()
    return recent, query.count()


def action_summaries(db: Session, *, tenant_id: int, page_ids: list[int]) -> tuple[dict[int, int], list[ClientPageAction]]:
    if not page_ids:
        return {}, []
    counts = {
        page_id: count
        for page_id, count in db.query(ClientPageAction.client_page_id, func.count(ClientPageAction.id))
        .filter(ClientPageAction.tenant_id == tenant_id, ClientPageAction.client_page_id.in_(page_ids))
        .group_by(ClientPageAction.client_page_id)
        .all()
    }
    recent_actions = (
        db.query(ClientPageAction)
        .filter(ClientPageAction.tenant_id == tenant_id, ClientPageAction.client_page_id.in_(page_ids))
        .order_by(ClientPageAction.client_page_id.asc(), ClientPageAction.created_at.desc(), ClientPageAction.id.desc())
        .all()
    )
    return counts, recent_actions


def find_matching_page_action(
    db: Session,
    *,
    tenant_id: int,
    page_id: int,
    action: str,
    client_account_id: int | None,
    message: str | None,
    actor_name: str | None,
    actor_email: str | None,
) -> ClientPageAction | None:
    return (
        db.query(ClientPageAction)
        .filter(
            ClientPageAction.tenant_id == tenant_id,
            ClientPageAction.client_page_id == page_id,
            ClientPageAction.action == action,
            ClientPageAction.client_account_id.is_(None)
            if client_account_id is None
            else ClientPageAction.client_account_id == client_account_id,
            ClientPageAction.message.is_(None) if message is None else ClientPageAction.message == message,
            ClientPageAction.actor_name.is_(None) if actor_name is None else ClientPageAction.actor_name == actor_name,
            ClientPageAction.actor_email.is_(None) if actor_email is None else ClientPageAction.actor_email == actor_email,
        )
        .order_by(ClientPageAction.created_at.desc(), ClientPageAction.id.desc())
        .first()
    )


def has_default_customer_group(db: Session, *, tenant_id: int) -> bool:
    return bool(db.query(CustomerGroup.id).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.group_key == "default").first())


def customer_group_keys(db: Session, *, tenant_id: int) -> set[str]:
    return {
        key
        for (key,) in db.query(CustomerGroup.group_key)
        .filter(CustomerGroup.tenant_id == tenant_id)
        .all()
    }


def list_customer_groups(db: Session, *, tenant_id: int) -> list[CustomerGroup]:
    return (
        db.query(CustomerGroup)
        .filter(CustomerGroup.tenant_id == tenant_id)
        .order_by(CustomerGroup.is_default.desc(), CustomerGroup.name.asc(), CustomerGroup.id.asc())
        .all()
    )


def customer_group_exists(db: Session, *, tenant_id: int, group_key: str) -> bool:
    return bool(db.query(CustomerGroup.id).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.group_key == group_key).first())


def get_customer_group(db: Session, *, tenant_id: int, group_id: int) -> CustomerGroup | None:
    return db.query(CustomerGroup).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.id == group_id).first()


def clear_default_customer_groups(db: Session, *, tenant_id: int, except_group_id: int | None = None) -> None:
    query = db.query(CustomerGroup).filter(CustomerGroup.tenant_id == tenant_id)
    if except_group_id is not None:
        query = query.filter(CustomerGroup.id != except_group_id)
    query.update({CustomerGroup.is_default: 0})


def get_active_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(SalesContact.tenant_id == tenant_id, SalesContact.contact_id == contact_id, SalesContact.deleted_at.is_(None))
        .first()
    )


def get_active_organization(db: Session, *, tenant_id: int, organization_id: int) -> SalesOrganization | None:
    return (
        db.query(SalesOrganization)
        .filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id, SalesOrganization.deleted_at.is_(None))
        .first()
    )


def client_link_exists(db: Session, *, tenant_id: int, contact_id: int | None, organization_id: int | None) -> bool:
    query = db.query(ClientAccount.id).filter(ClientAccount.tenant_id == tenant_id)
    if contact_id:
        query = query.filter(ClientAccount.contact_id == contact_id)
    else:
        query = query.filter(ClientAccount.organization_id == organization_id)
    return bool(query.first())


def client_email_exists(db: Session, *, tenant_id: int, email: str) -> bool:
    return bool(db.query(ClientAccount.id).filter(ClientAccount.tenant_id == tenant_id, ClientAccount.email == email).first())


def list_client_accounts(db: Session, *, tenant_id: int, sort_by: str | None = None, sort_direction: str | None = None) -> list[ClientAccount]:
    query = (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.tenant_id == tenant_id)
    )
    return apply_client_account_sort(query, sort_by=sort_by, sort_direction=sort_direction).all()


def list_client_accounts_cursor(db: Session, *, tenant_id: int, limit: int, cursor: int | None = None) -> list[ClientAccount]:
    query = (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.tenant_id == tenant_id)
    )
    if cursor is not None:
        query = query.filter(ClientAccount.id < cursor)
    return query.order_by(None).order_by(ClientAccount.id.desc()).limit(limit + 1).all()


def get_client_account(db: Session, *, tenant_id: int, account_id: int) -> ClientAccount | None:
    return (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.tenant_id == tenant_id, ClientAccount.id == account_id)
        .first()
    )


def list_client_pages(db: Session, *, tenant_id: int, sort_by: str | None = None, sort_direction: str | None = None) -> list[ClientPage]:
    query = (
        db.query(ClientPage)
        .options(joinedload(ClientPage.contact), joinedload(ClientPage.organization))
        .filter(ClientPage.tenant_id == tenant_id)
    )
    return apply_client_page_sort(query, sort_by=sort_by, sort_direction=sort_direction).all()


def list_client_pages_cursor(db: Session, *, tenant_id: int, limit: int, cursor: int | None = None) -> list[ClientPage]:
    query = (
        db.query(ClientPage)
        .options(joinedload(ClientPage.contact), joinedload(ClientPage.organization))
        .filter(ClientPage.tenant_id == tenant_id)
    )
    if cursor is not None:
        query = query.filter(ClientPage.id < cursor)
    return query.order_by(None).order_by(ClientPage.id.desc()).limit(limit + 1).all()


def get_client_page(db: Session, *, tenant_id: int, page_id: int) -> ClientPage | None:
    return (
        db.query(ClientPage)
        .options(joinedload(ClientPage.contact), joinedload(ClientPage.organization))
        .filter(ClientPage.tenant_id == tenant_id, ClientPage.id == page_id)
        .first()
    )


def get_public_client_page_by_token_hash(db: Session, *, token_hash: str) -> ClientPage | None:
    return db.query(ClientPage).filter(ClientPage.public_token_hash == token_hash).first()


def get_page_document(db: Session, *, tenant_id: int, document_id: int) -> Document | None:
    return (
        db.query(Document)
        .filter(
            Document.tenant_id == tenant_id,
            Document.id == document_id,
            Document.deleted_at.is_(None),
        )
        .first()
    )


def _apply_catalog_search(query, model, search: str | None):
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(model.name.ilike(pattern), model.description.ilike(pattern)))
    return query


def _catalog_sort_kind(item: CatalogProduct | CatalogService) -> str:
    return "product" if isinstance(item, CatalogProduct) else "service"


def list_client_catalog_items(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    search: str | None = None,
    limit: int = 100,
) -> list[CatalogProduct | CatalogService]:
    clamped_limit = max(1, min(limit, 100))
    items: list[CatalogProduct | CatalogService] = []
    if kind in {"all", "product"}:
        product_query = db.query(CatalogProduct).filter(
            CatalogProduct.tenant_id == tenant_id,
            CatalogProduct.deleted_at.is_(None),
            CatalogProduct.is_active == 1,
            CatalogProduct.is_public == 1,
        )
        items.extend(
            _apply_catalog_search(product_query, CatalogProduct, search)
            .order_by(CatalogProduct.name.asc(), CatalogProduct.id.asc())
            .limit(clamped_limit)
            .all()
        )
    if kind in {"all", "service"}:
        service_query = db.query(CatalogService).filter(
            CatalogService.tenant_id == tenant_id,
            CatalogService.deleted_at.is_(None),
            CatalogService.is_active == 1,
            CatalogService.is_public == 1,
        )
        items.extend(
            _apply_catalog_search(service_query, CatalogService, search)
            .order_by(CatalogService.name.asc(), CatalogService.id.asc())
            .limit(clamped_limit)
            .all()
        )
    return sorted(items, key=lambda item: (item.name.lower(), _catalog_sort_kind(item), int(item.id)))[:clamped_limit]


def get_client_catalog_item(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    item_id: int,
) -> CatalogProduct | CatalogService | None:
    model = CatalogProduct if kind == "product" else CatalogService
    return (
        db.query(model)
        .filter(
            model.tenant_id == tenant_id,
            model.id == item_id,
            model.deleted_at.is_(None),
            model.is_active == 1,
            model.is_public == 1,
        )
        .first()
    )


def list_client_orders(db: Session, *, tenant_id: int, client_email: str) -> list[WebsiteIntegrationOrder]:
    return (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(
            WebsiteIntegrationOrder.tenant_id == tenant_id,
            WebsiteIntegrationOrder.source_platform == "client_portal",
            WebsiteIntegrationOrder.customer_email == client_email.strip().lower(),
        )
        .order_by(WebsiteIntegrationOrder.created_at.desc(), WebsiteIntegrationOrder.id.desc())
        .all()
    )


def get_client_order(db: Session, *, tenant_id: int, client_email: str, order_id: int) -> WebsiteIntegrationOrder | None:
    return (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(
            WebsiteIntegrationOrder.tenant_id == tenant_id,
            WebsiteIntegrationOrder.id == order_id,
            WebsiteIntegrationOrder.source_platform == "client_portal",
            WebsiteIntegrationOrder.customer_email == client_email.strip().lower(),
        )
        .first()
    )


def get_client_account_by_setup_hash(db: Session, *, token_hash: str) -> ClientAccount | None:
    return db.query(ClientAccount).filter(ClientAccount.setup_token_hash == token_hash).first()


def get_client_account_by_email(db: Session, *, tenant_id: int, email: str) -> ClientAccount | None:
    return db.query(ClientAccount).filter(ClientAccount.tenant_id == tenant_id, ClientAccount.email == email).first()


def list_active_client_accounts_by_email(db: Session, *, email: str) -> list[ClientAccount]:
    normalized_email = email.strip().lower()
    return (
        db.query(ClientAccount)
        .join(Tenant, Tenant.id == ClientAccount.tenant_id)
        .options(joinedload(ClientAccount.tenant))
        .filter(
            ClientAccount.email == normalized_email,
            ClientAccount.status == "active",
            Tenant.is_active == 1,
        )
        .order_by(ClientAccount.tenant_id.asc(), ClientAccount.id.asc())
        .all()
    )


def get_client_account_by_token_payload(db: Session, *, tenant_id: int, account_id: int) -> ClientAccount | None:
    return (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.id == account_id, ClientAccount.tenant_id == tenant_id)
        .first()
    )


def get_object_session(obj) -> Session | None:
    return object_session(obj)


def get_contact_with_customer_group(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .options(joinedload(SalesContact.customer_group))
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.contact_id == contact_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )


def get_organization_with_customer_group(db: Session, *, tenant_id: int, organization_id: int) -> SalesOrganization | None:
    return (
        db.query(SalesOrganization)
        .options(joinedload(SalesOrganization.customer_group))
        .filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.org_id == organization_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
