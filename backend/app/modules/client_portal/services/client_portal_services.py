from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.passwords import hash_password, password_hash_needs_upgrade, verify_password
from app.modules.client_portal.models import ClientAccount, ClientPage, ClientPageAction, CustomerGroup
from app.modules.documents.models import Document
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesContact, SalesOrganization


CLIENT_ACCOUNT_STATUSES = {"pending", "active", "inactive"}
CLIENT_PAGE_STATUSES = {"draft", "published", "archived"}
DISCOUNT_TYPES = {"none", "percent", "fixed"}
DEFAULT_CUSTOMER_GROUPS = [
    {"group_key": "default", "name": "Default", "discount_type": "none", "discount_value": None, "is_default": 1},
    {"group_key": "wholesale", "name": "Wholesale", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "retailer", "name": "Retailer", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "vip", "name": "VIP", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "friends_family", "name": "Friends & Family", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
]
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_key(value: str) -> str:
    key = value.strip().lower().replace(" ", "_")
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group key is required")
    if not all(char.isalnum() or char == "_" for char in key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group key can use letters, numbers, and underscores only")
    return key


def _normalize_discount_type(value: str | None) -> str:
    discount_type = (value or "none").strip().lower()
    if discount_type not in DISCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount type must be none, percent, or fixed")
    return discount_type


def _validate_discount(discount_type: str, discount_value) -> Decimal | None:
    if discount_type == "none":
        return None
    if discount_value is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount value is required")
    value = Decimal(discount_value)
    if value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount value cannot be negative")
    if discount_type == "percent" and value > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Percent discount cannot exceed 100")
    return value


def _customer_group_state(group: CustomerGroup) -> dict:
    return {
        "id": group.id,
        "group_key": group.group_key,
        "name": group.name,
        "discount_type": group.discount_type,
        "discount_value": group.discount_value,
        "is_default": bool(group.is_default),
        "is_active": bool(group.is_active),
    }


def _client_account_state(account: ClientAccount) -> dict:
    return {
        "id": account.id,
        "email": account.email,
        "status": account.status,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "has_password": bool(account.password_hash),
        "setup_token_expires_at": account.setup_token_expires_at,
        "last_login_at": account.last_login_at,
    }


def _client_page_state(page: ClientPage) -> dict:
    return {
        "id": page.id,
        "title": page.title,
        "status": page.status,
        "contact_id": page.contact_id,
        "organization_id": page.organization_id,
        "source_module_key": page.source_module_key,
        "source_entity_id": page.source_entity_id,
        "proposal_sections": page.proposal_sections or [],
        "brand_settings": page.brand_settings or None,
        "public_token_expires_at": page.public_token_expires_at,
        "published_at": page.published_at,
    }


def _money(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _normalize_pricing_items(items: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for item in items or []:
        quantity = Decimal(str(item.get("quantity", "1")))
        public_unit_price = Decimal(str(item.get("public_unit_price", "0")))
        if quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pricing item quantity must be greater than zero")
        if public_unit_price < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pricing item public price cannot be negative")
        currency = str(item.get("currency") or "USD").strip().upper()
        if len(currency) != 3:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pricing item currency must be a 3-letter code")
        normalized.append(
            {
                "sku": (item.get("sku") or "").strip() or None,
                "name": str(item["name"]).strip(),
                "description": (item.get("description") or "").strip() or None,
                "quantity": str(quantity),
                "currency": currency,
                "public_unit_price": str(public_unit_price),
            }
        )
    return normalized


def _normalize_document_ids(document_ids: list[int] | None) -> list[int]:
    values = []
    for document_id in document_ids or []:
        if int(document_id) <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document IDs must be positive")
        values.append(int(document_id))
    return sorted(set(values))


def _normalize_proposal_sections(sections: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for index, section in enumerate(sections or []):
        title = str(section.get("title") or "").strip()
        body = str(section.get("body") or "").strip()
        if not title and not body:
            continue
        if not title or not body:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Proposal sections require title and body")
        normalized.append(
            {
                "title": title,
                "body": body,
                "sort_order": int(section.get("sort_order") if section.get("sort_order") is not None else index),
            }
        )
    return sorted(normalized, key=lambda item: (item["sort_order"], item["title"].lower()))


def _normalize_brand_settings(settings_payload: dict | None) -> dict | None:
    if not settings_payload:
        return None
    company_name = str(settings_payload.get("company_name") or "").strip() or None
    logo_url = str(settings_payload.get("logo_url") or "").strip() or None
    accent_color = str(settings_payload.get("accent_color") or "").strip() or None
    if accent_color and not HEX_COLOR_RE.match(accent_color):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brand accent color must be a 6-digit hex color")
    normalized = {
        "company_name": company_name,
        "logo_url": logo_url,
        "accent_color": accent_color,
    }
    return normalized if any(normalized.values()) else None


def _serialize_proposal_sections(sections: list[dict] | None) -> list[dict]:
    return _normalize_proposal_sections(sections or [])


def _serialize_brand_settings(settings_payload: dict | None) -> dict | None:
    return _normalize_brand_settings(settings_payload)


def _resolved_unit_price(public_unit_price: Decimal, group: CustomerGroup | None) -> tuple[Decimal, str, Decimal | None]:
    if not group or group.discount_type == "none":
        return _money(public_unit_price), "none", None
    discount_value = Decimal(str(group.discount_value or "0"))
    if group.discount_type == "percent":
        resolved = public_unit_price * (Decimal("100") - discount_value) / Decimal("100")
    elif group.discount_type == "fixed":
        resolved = public_unit_price - discount_value
    else:
        resolved = public_unit_price
    if resolved < 0:
        resolved = Decimal("0")
    return _money(resolved), group.discount_type, discount_value


def _serialize_pricing_items(items: list[dict], group: CustomerGroup | None = None) -> list[dict]:
    serialized: list[dict] = []
    for item in items or []:
        public_unit_price = _money(item.get("public_unit_price"))
        quantity = Decimal(str(item.get("quantity") or "1"))
        resolved_unit_price, discount_type, discount_value = _resolved_unit_price(public_unit_price, group)
        serialized.append(
            {
                "sku": item.get("sku"),
                "name": item.get("name"),
                "description": item.get("description"),
                "quantity": quantity,
                "currency": item.get("currency") or "USD",
                "public_unit_price": public_unit_price,
                "resolved_unit_price": resolved_unit_price,
                "public_total": _money(public_unit_price * quantity),
                "resolved_total": _money(resolved_unit_price * quantity),
                "discount_type": discount_type,
                "discount_value": discount_value,
            }
        )
    return serialized


def _list_client_page_documents(db: Session | None, page: ClientPage) -> list[dict]:
    document_ids = [int(document_id) for document_id in page.document_ids or [] if int(document_id) > 0]
    if not db or not document_ids:
        return []
    documents = (
        db.query(Document)
        .filter(
            Document.tenant_id == page.tenant_id,
            Document.id.in_(document_ids),
            Document.deleted_at.is_(None),
        )
        .order_by(Document.created_at.desc(), Document.id.desc())
        .all()
    )
    document_map = {document.id: document for document in documents}
    ordered = [document_map[document_id] for document_id in document_ids if document_id in document_map]
    return [
        {
            "id": document.id,
            "title": document.title,
            "original_filename": document.original_filename,
            "content_type": document.content_type,
            "extension": document.extension,
            "file_size_bytes": document.file_size_bytes,
        }
        for document in ordered
    ]


def _serialize_client_page_action(action: ClientPageAction) -> dict:
    return {
        "id": action.id,
        "action": action.action,
        "message": action.message,
        "actor_name": action.actor_name,
        "actor_email": action.actor_email,
        "client_account_id": action.client_account_id,
        "created_at": action.created_at,
    }


def _client_page_action_summary(db: Session | None, page: ClientPage) -> dict:
    if not db:
        return {"action_count": 0, "latest_action": None, "recent_actions": []}
    query = db.query(ClientPageAction).filter(
        ClientPageAction.tenant_id == page.tenant_id,
        ClientPageAction.client_page_id == page.id,
    )
    recent = query.order_by(ClientPageAction.created_at.desc(), ClientPageAction.id.desc()).limit(3).all()
    return {
        "action_count": query.count(),
        "latest_action": _serialize_client_page_action(recent[0]) if recent else None,
        "recent_actions": [_serialize_client_page_action(action) for action in recent],
    }


def ensure_default_customer_groups(db: Session, *, tenant_id: int) -> None:
    existing_keys = {
        key
        for (key,) in db.query(CustomerGroup.group_key)
        .filter(CustomerGroup.tenant_id == tenant_id)
        .all()
    }
    for item in DEFAULT_CUSTOMER_GROUPS:
        if item["group_key"] in existing_keys:
            continue
        db.add(
            CustomerGroup(
                tenant_id=tenant_id,
                group_key=item["group_key"],
                name=item["name"],
                discount_type=item["discount_type"],
                discount_value=item["discount_value"],
                is_default=item["is_default"],
                is_active=1,
            )
        )
    db.commit()


def serialize_customer_group(group: CustomerGroup | None) -> dict | None:
    if not group:
        return None
    return {
        "id": group.id,
        "group_key": group.group_key,
        "name": group.name,
        "description": group.description,
        "discount_type": group.discount_type,
        "discount_value": group.discount_value,
        "is_default": bool(group.is_default),
        "is_active": bool(group.is_active),
        "created_at": group.created_at,
        "updated_at": group.updated_at,
    }


def list_customer_groups(db: Session, *, tenant_id: int) -> list[CustomerGroup]:
    ensure_default_customer_groups(db, tenant_id=tenant_id)
    return (
        db.query(CustomerGroup)
        .filter(CustomerGroup.tenant_id == tenant_id)
        .order_by(CustomerGroup.is_default.desc(), CustomerGroup.name.asc(), CustomerGroup.id.asc())
        .all()
    )


def create_customer_group(db: Session, *, tenant_id: int, payload: dict, actor_user_id: int | None = None) -> CustomerGroup:
    ensure_default_customer_groups(db, tenant_id=tenant_id)
    group_key = _normalize_key(payload["group_key"])
    if db.query(CustomerGroup.id).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.group_key == group_key).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer group key already exists")
    discount_type = _normalize_discount_type(payload.get("discount_type"))
    group = CustomerGroup(
        tenant_id=tenant_id,
        group_key=group_key,
        name=payload["name"].strip(),
        description=(payload.get("description") or "").strip() or None,
        discount_type=discount_type,
        discount_value=_validate_discount(discount_type, payload.get("discount_value")),
        is_default=1 if payload.get("is_default") else 0,
        is_active=1 if payload.get("is_active", True) else 0,
    )
    if group.is_default:
        db.query(CustomerGroup).filter(CustomerGroup.tenant_id == tenant_id).update({CustomerGroup.is_default: 0})
    db.add(group)
    db.commit()
    db.refresh(group)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="customer_group",
        entity_id=group.id,
        action="customer_group.create",
        description=f"Created customer group {group.name}",
        after_state=_customer_group_state(group),
    )
    return group


def get_customer_group_or_404(db: Session, *, tenant_id: int, group_id: int) -> CustomerGroup:
    group = db.query(CustomerGroup).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer group not found")
    return group


def update_customer_group(db: Session, *, group: CustomerGroup, payload: dict, actor_user_id: int | None = None) -> CustomerGroup:
    before_state = _customer_group_state(group)
    if "name" in payload and payload["name"] is not None:
        group.name = payload["name"].strip()
    if "description" in payload:
        group.description = (payload.get("description") or "").strip() or None
    discount_type = group.discount_type
    if "discount_type" in payload and payload["discount_type"] is not None:
        discount_type = _normalize_discount_type(payload["discount_type"])
        group.discount_type = discount_type
    if "discount_value" in payload or "discount_type" in payload:
        group.discount_value = _validate_discount(discount_type, payload.get("discount_value", group.discount_value))
    if "is_active" in payload and payload["is_active"] is not None:
        group.is_active = 1 if payload["is_active"] else 0
    if "is_default" in payload and payload["is_default"] is not None:
        group.is_default = 1 if payload["is_default"] else 0
        if group.is_default:
            db.query(CustomerGroup).filter(
                CustomerGroup.tenant_id == group.tenant_id,
                CustomerGroup.id != group.id,
            ).update({CustomerGroup.is_default: 0})
    db.add(group)
    db.commit()
    db.refresh(group)
    log_activity(
        db,
        tenant_id=group.tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="customer_group",
        entity_id=group.id,
        action="customer_group.update",
        description=f"Updated customer group {group.name}",
        before_state=before_state,
        after_state=_customer_group_state(group),
    )
    return group


def _validate_group_for_tenant(db: Session, *, tenant_id: int, group_id: int | None) -> CustomerGroup | None:
    if group_id is None:
        return None
    group = get_customer_group_or_404(db, tenant_id=tenant_id, group_id=group_id)
    if not group.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer group is inactive")
    return group


def assign_contact_customer_group(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int,
    group_id: int | None,
    actor_user_id: int | None = None,
):
    _validate_group_for_tenant(db, tenant_id=tenant_id, group_id=group_id)
    contact = (
        db.query(SalesContact)
        .filter(SalesContact.tenant_id == tenant_id, SalesContact.contact_id == contact_id, SalesContact.deleted_at.is_(None))
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    previous_group_id = contact.customer_group_id
    contact.customer_group_id = group_id
    db.add(contact)
    db.commit()
    db.refresh(contact)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=contact.contact_id,
        action="customer_group.assign",
        description="Updated contact customer group",
        before_state={"customer_group_id": previous_group_id},
        after_state={"customer_group_id": contact.customer_group_id},
    )
    return contact


def assign_organization_customer_group(
    db: Session,
    *,
    tenant_id: int,
    organization_id: int,
    group_id: int | None,
    actor_user_id: int | None = None,
):
    _validate_group_for_tenant(db, tenant_id=tenant_id, group_id=group_id)
    organization = (
        db.query(SalesOrganization)
        .filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id, SalesOrganization.deleted_at.is_(None))
        .first()
    )
    if not organization:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    previous_group_id = organization.customer_group_id
    organization.customer_group_id = group_id
    db.add(organization)
    db.commit()
    db.refresh(organization)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="sales_organizations",
        entity_type="sales_organization",
        entity_id=organization.org_id,
        action="customer_group.assign",
        description="Updated organization customer group",
        before_state={"customer_group_id": previous_group_id},
        after_state={"customer_group_id": organization.customer_group_id},
    )
    return organization


def _create_setup_token(account: ClientAccount) -> str:
    token = secrets.token_urlsafe(32)
    account.setup_token_hash = _hash_token(token)
    account.setup_token_expires_at = _utcnow() + timedelta(days=7)
    return token


def _setup_link(token: str) -> str:
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}/client/setup?token={token}"


def _client_page_link(token: str) -> str:
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}/client/pages/{token}"


def _validate_client_link(db: Session, *, tenant_id: int, contact_id: int | None, organization_id: int | None) -> None:
    if bool(contact_id) == bool(organization_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Link exactly one contact or organization")
    if contact_id:
        exists = db.query(SalesContact.contact_id).filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.contact_id == contact_id,
            SalesContact.deleted_at.is_(None),
        ).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    if organization_id:
        exists = db.query(SalesOrganization.org_id).filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.org_id == organization_id,
            SalesOrganization.deleted_at.is_(None),
        ).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")


def _validate_unique_client_link(db: Session, *, tenant_id: int, contact_id: int | None, organization_id: int | None) -> None:
    query = db.query(ClientAccount.id).filter(ClientAccount.tenant_id == tenant_id)
    if contact_id:
        query = query.filter(ClientAccount.contact_id == contact_id)
    else:
        query = query.filter(ClientAccount.organization_id == organization_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client access already exists for this customer")


def _validate_client_account_matches_page(account: ClientAccount | None, page: ClientPage) -> bool:
    if not account or account.tenant_id != page.tenant_id:
        return False
    if page.contact_id:
        return account.contact_id == page.contact_id
    return account.organization_id == page.organization_id


def _contact_display_name(contact: SalesContact | None) -> str | None:
    if not contact:
        return None
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email or None


def _organization_display_name(organization: SalesOrganization | None) -> str | None:
    return organization.org_name if organization else None


def serialize_client_account(account: ClientAccount, *, setup_token: str | None = None) -> dict:
    return {
        "id": account.id,
        "email": account.email,
        "status": account.status,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "contact_name": _contact_display_name(account.contact),
        "organization_name": _organization_display_name(account.organization),
        "has_password": bool(account.password_hash),
        "setup_link": _setup_link(setup_token) if setup_token else None,
        "setup_token_expires_at": account.setup_token_expires_at,
        "last_login_at": account.last_login_at,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


def serialize_client_page(page: ClientPage, *, group: CustomerGroup | None = None, public_token: str | None = None, db: Session | None = None) -> dict:
    personalized = group is not None
    action_summary = _client_page_action_summary(db, page)
    return {
        "id": page.id,
        "title": page.title,
        "summary": page.summary,
        "status": page.status,
        "contact_id": page.contact_id,
        "organization_id": page.organization_id,
        "contact_name": _contact_display_name(page.contact),
        "organization_name": _organization_display_name(page.organization),
        "source_module_key": page.source_module_key,
        "source_entity_id": page.source_entity_id,
        "document_ids": page.document_ids or [],
        "documents": _list_client_page_documents(db, page),
        "proposal_sections": _serialize_proposal_sections(page.proposal_sections),
        "brand_settings": _serialize_brand_settings(page.brand_settings),
        "pricing_items": _serialize_pricing_items(page.pricing_items or [], group),
        "customer_group": serialize_customer_group(group),
        "pricing_mode": "personalized" if personalized else "public",
        "action_count": action_summary["action_count"],
        "latest_action": action_summary["latest_action"],
        "recent_actions": action_summary["recent_actions"],
        "public_link": _client_page_link(public_token) if public_token else None,
        "public_token_expires_at": page.public_token_expires_at,
        "published_at": page.published_at,
        "created_at": page.created_at,
        "updated_at": page.updated_at,
    }


def create_client_account(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> tuple[ClientAccount, str]:
    email = str(payload["email"]).strip().lower()
    contact_id = payload.get("contact_id")
    organization_id = payload.get("organization_id")
    _validate_client_link(db, tenant_id=tenant_id, contact_id=contact_id, organization_id=organization_id)
    if payload.get("status", "pending") not in CLIENT_ACCOUNT_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client account status")
    if db.query(ClientAccount.id).filter(ClientAccount.tenant_id == tenant_id, ClientAccount.email == email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account email already exists")
    _validate_unique_client_link(db, tenant_id=tenant_id, contact_id=contact_id, organization_id=organization_id)

    account = ClientAccount(
        tenant_id=tenant_id,
        contact_id=contact_id,
        organization_id=organization_id,
        email=email,
        status=payload.get("status", "pending"),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    setup_token = _create_setup_token(account)
    db.add(account)
    db.commit()
    db.refresh(account)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_account",
        entity_id=account.id,
        action="client_account.create",
        description=f"Created client account for {account.email}",
        after_state=_client_account_state(account),
    )
    return account, setup_token


def list_client_accounts(db: Session, *, tenant_id: int) -> list[ClientAccount]:
    return (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.tenant_id == tenant_id)
        .order_by(ClientAccount.created_at.desc(), ClientAccount.id.desc())
        .all()
    )


def get_client_account_or_404(db: Session, *, tenant_id: int, account_id: int) -> ClientAccount:
    account = (
        db.query(ClientAccount)
        .options(joinedload(ClientAccount.contact), joinedload(ClientAccount.organization))
        .filter(ClientAccount.tenant_id == tenant_id, ClientAccount.id == account_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found")
    return account


def regenerate_client_setup_link(db: Session, *, account: ClientAccount, actor_user_id: int | None) -> tuple[ClientAccount, str]:
    if account.status == "inactive":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client account is inactive")
    before_state = _client_account_state(account)
    token = _create_setup_token(account)
    account.status = "pending"
    account.updated_by_user_id = actor_user_id
    db.add(account)
    db.commit()
    db.refresh(account)
    log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_account",
        entity_id=account.id,
        action="client_account.setup_link_regenerate",
        description=f"Regenerated setup link for {account.email}",
        before_state=before_state,
        after_state=_client_account_state(account),
    )
    return account, token


def update_client_account_status(db: Session, *, account: ClientAccount, status_value: str, actor_user_id: int | None) -> ClientAccount:
    status_value = status_value.strip().lower()
    if status_value not in CLIENT_ACCOUNT_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client account status")
    before_state = _client_account_state(account)
    account.status = status_value
    account.updated_by_user_id = actor_user_id
    db.add(account)
    db.commit()
    db.refresh(account)
    log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_account",
        entity_id=account.id,
        action="client_account.status_update",
        description=f"Updated client account status to {account.status}",
        before_state=before_state,
        after_state=_client_account_state(account),
    )
    return account


def list_client_pages(db: Session, *, tenant_id: int) -> list[ClientPage]:
    return (
        db.query(ClientPage)
        .options(joinedload(ClientPage.contact), joinedload(ClientPage.organization))
        .filter(ClientPage.tenant_id == tenant_id)
        .order_by(ClientPage.created_at.desc(), ClientPage.id.desc())
        .all()
    )


def get_client_page_or_404(db: Session, *, tenant_id: int, page_id: int) -> ClientPage:
    page = (
        db.query(ClientPage)
        .options(joinedload(ClientPage.contact), joinedload(ClientPage.organization))
        .filter(ClientPage.tenant_id == tenant_id, ClientPage.id == page_id)
        .first()
    )
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client page not found")
    return page


def create_client_page(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> ClientPage:
    contact_id = payload.get("contact_id")
    organization_id = payload.get("organization_id")
    _validate_client_link(db, tenant_id=tenant_id, contact_id=contact_id, organization_id=organization_id)
    status_value = str(payload.get("status") or "draft").strip().lower()
    if status_value not in CLIENT_PAGE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client page status")
    page = ClientPage(
        tenant_id=tenant_id,
        contact_id=contact_id,
        organization_id=organization_id,
        title=str(payload["title"]).strip(),
        summary=(payload.get("summary") or "").strip() or None,
        status=status_value,
        pricing_items=_normalize_pricing_items(payload.get("pricing_items")),
        document_ids=_normalize_document_ids(payload.get("document_ids")),
        proposal_sections=_normalize_proposal_sections(payload.get("proposal_sections")),
        brand_settings=_normalize_brand_settings(payload.get("brand_settings")),
        source_module_key=(payload.get("source_module_key") or "").strip() or None,
        source_entity_id=(payload.get("source_entity_id") or "").strip() or None,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    if page.status == "published":
        page.published_at = _utcnow()
    db.add(page)
    db.commit()
    db.refresh(page)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_page",
        entity_id=page.id,
        action="client_page.create",
        description=f"Created client page {page.title}",
        after_state=_client_page_state(page),
    )
    return page


def update_client_page(db: Session, *, page: ClientPage, actor_user_id: int | None, payload: dict) -> ClientPage:
    before_state = _client_page_state(page)
    if "title" in payload and payload["title"] is not None:
        page.title = str(payload["title"]).strip()
    if "summary" in payload:
        page.summary = (payload.get("summary") or "").strip() or None
    if "pricing_items" in payload and payload["pricing_items"] is not None:
        page.pricing_items = _normalize_pricing_items(payload.get("pricing_items"))
    if "document_ids" in payload and payload["document_ids"] is not None:
        page.document_ids = _normalize_document_ids(payload.get("document_ids"))
    if "proposal_sections" in payload and payload["proposal_sections"] is not None:
        page.proposal_sections = _normalize_proposal_sections(payload.get("proposal_sections"))
    if "brand_settings" in payload:
        page.brand_settings = _normalize_brand_settings(payload.get("brand_settings"))
    if "source_module_key" in payload:
        page.source_module_key = (payload.get("source_module_key") or "").strip() or None
    if "source_entity_id" in payload:
        page.source_entity_id = (payload.get("source_entity_id") or "").strip() or None
    if "status" in payload and payload["status"] is not None:
        status_value = str(payload["status"]).strip().lower()
        if status_value not in CLIENT_PAGE_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client page status")
        if page.status != "published" and status_value == "published":
            page.published_at = _utcnow()
        page.status = status_value
    page.updated_by_user_id = actor_user_id
    db.add(page)
    db.commit()
    db.refresh(page)
    log_activity(
        db,
        tenant_id=page.tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_page",
        entity_id=page.id,
        action="client_page.update",
        description=f"Updated client page {page.title}",
        before_state=before_state,
        after_state=_client_page_state(page),
    )
    return page


def publish_client_page_link(
    db: Session,
    *,
    page: ClientPage,
    actor_user_id: int | None,
    expires_in_days: int,
) -> tuple[ClientPage, str]:
    before_state = _client_page_state(page)
    token = secrets.token_urlsafe(32)
    page.public_token_hash = _hash_token(token)
    page.public_token_expires_at = _utcnow() + timedelta(days=expires_in_days)
    page.status = "published"
    page.published_at = page.published_at or _utcnow()
    page.updated_by_user_id = actor_user_id
    db.add(page)
    db.commit()
    db.refresh(page)
    log_activity(
        db,
        tenant_id=page.tenant_id,
        actor_user_id=actor_user_id,
        module_key="client_portal",
        entity_type="client_page",
        entity_id=page.id,
        action="client_page.publish_link",
        description=f"Published signed link for client page {page.title}",
        before_state=before_state,
        after_state=_client_page_state(page),
    )
    return page, token


def get_public_client_page(db: Session, *, token: str) -> ClientPage:
    token_hash = _hash_token(token)
    page = db.query(ClientPage).filter(ClientPage.public_token_hash == token_hash).first()
    if not page or page.status != "published" or not page.public_token_expires_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client page not found")
    expires_at = page.public_token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Client page link has expired")
    return page


def serialize_public_client_page(page: ClientPage, *, account: ClientAccount | None = None, db: Session | None = None) -> dict:
    group = resolve_client_customer_group(db=None, account=account) if _validate_client_account_matches_page(account, page) else None
    return {
        "title": page.title,
        "summary": page.summary,
        "pricing_items": _serialize_pricing_items(page.pricing_items or [], group),
        "customer_group": serialize_customer_group(group),
        "pricing_mode": "personalized" if group else "public",
        "document_ids": page.document_ids or [],
        "documents": _list_client_page_documents(db, page),
        "proposal_sections": _serialize_proposal_sections(page.proposal_sections),
        "brand_settings": _serialize_brand_settings(page.brand_settings),
    }


def get_client_page_document_or_404(db: Session, *, page: ClientPage, document_id: int) -> Document:
    allowed_ids = {int(item) for item in page.document_ids or []}
    if document_id not in allowed_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    document = (
        db.query(Document)
        .filter(
            Document.tenant_id == page.tenant_id,
            Document.id == document_id,
            Document.deleted_at.is_(None),
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


def record_client_page_action(
    db: Session,
    *,
    page: ClientPage,
    action: str,
    account: ClientAccount | None = None,
    payload: dict | None = None,
    request_metadata: dict | None = None,
) -> ClientPageAction:
    action = action.strip().lower()
    if action not in {"accept", "request_changes"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client page action")
    if account and not _validate_client_account_matches_page(account, page):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client account cannot act on this page")
    data = payload or {}
    record = ClientPageAction(
        tenant_id=page.tenant_id,
        client_page_id=page.id,
        client_account_id=account.id if account else None,
        action=action,
        message=(data.get("message") or "").strip() or None,
        actor_name=(data.get("actor_name") or "").strip() or None,
        actor_email=str(data.get("actor_email")).strip().lower() if data.get("actor_email") else None,
        request_metadata=request_metadata,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    log_activity(
        db,
        tenant_id=page.tenant_id,
        actor_user_id=None,
        module_key="client_portal",
        entity_type="client_page",
        entity_id=page.id,
        action=f"client_page.{action}",
        description=f"Client page action recorded: {action}",
        after_state={
            "client_page_action_id": record.id,
            "client_account_id": record.client_account_id,
            "actor_email": record.actor_email,
        },
    )
    return record


def setup_client_password(db: Session, *, token: str, password: str) -> ClientAccount:
    token_hash = _hash_token(token)
    account = db.query(ClientAccount).filter(ClientAccount.setup_token_hash == token_hash).first()
    if not account or not account.setup_token_expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup link is invalid")
    expires_at = account.setup_token_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= _utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup link has expired")
    if account.status == "inactive":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client account is inactive")
    before_state = _client_account_state(account)
    account.password_hash = hash_password(password)
    account.status = "active"
    account.setup_token_hash = None
    account.setup_token_expires_at = None
    db.add(account)
    db.commit()
    db.refresh(account)
    log_activity(
        db,
        tenant_id=account.tenant_id,
        actor_user_id=None,
        module_key="client_portal",
        entity_type="client_account",
        entity_id=account.id,
        action="client_account.password_setup",
        description=f"Client account password was set for {account.email}",
        before_state=before_state,
        after_state=_client_account_state(account),
    )
    return account


def _client_access_token(account: ClientAccount) -> str:
    now = _utcnow()
    payload = {
        "sub": str(account.id),
        "tenant_id": account.tenant_id,
        "type": "client_access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.CLIENT_ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def authenticate_client_account(db: Session, *, tenant_id: int, email: str, password: str) -> tuple[ClientAccount, str]:
    normalized_email = email.strip().lower()
    account = (
        db.query(ClientAccount)
        .filter(ClientAccount.tenant_id == tenant_id, ClientAccount.email == normalized_email)
        .first()
    )
    if not account or not verify_password(password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if account.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client account is not active")
    if password_hash_needs_upgrade(account.password_hash):
        account.password_hash = hash_password(password)
    account.last_login_at = _utcnow()
    db.add(account)
    db.commit()
    db.refresh(account)
    return account, _client_access_token(account)


def decode_client_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid client token")
    if payload.get("type") != "client_access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid client token type")
    return payload


def client_account_from_token(db: Session, *, token: str) -> ClientAccount:
    payload = decode_client_access_token(token)
    account = (
        db.query(ClientAccount)
        .filter(
            ClientAccount.id == int(payload["sub"]),
            ClientAccount.tenant_id == int(payload["tenant_id"]),
        )
        .first()
    )
    if not account or account.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Client account is not active")
    return account


def resolve_client_customer_group(db: Session, *, account: ClientAccount) -> CustomerGroup | None:
    if account.contact_id and account.contact:
        return account.contact.customer_group
    if account.organization_id and account.organization:
        return account.organization.customer_group
    return None
