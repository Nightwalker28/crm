from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.passwords import hash_password, password_hash_needs_upgrade, verify_password
from app.modules.client_portal.models import ClientAccount, CustomerGroup
from app.modules.sales.models import SalesContact, SalesOrganization


CLIENT_ACCOUNT_STATUSES = {"pending", "active", "inactive"}
DISCOUNT_TYPES = {"none", "percent", "fixed"}
DEFAULT_CUSTOMER_GROUPS = [
    {"group_key": "default", "name": "Default", "discount_type": "none", "discount_value": None, "is_default": 1},
    {"group_key": "wholesale", "name": "Wholesale", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "retailer", "name": "Retailer", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "vip", "name": "VIP", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
    {"group_key": "friends_family", "name": "Friends & Family", "discount_type": "percent", "discount_value": Decimal("0"), "is_default": 0},
]


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


def create_customer_group(db: Session, *, tenant_id: int, payload: dict) -> CustomerGroup:
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
    return group


def get_customer_group_or_404(db: Session, *, tenant_id: int, group_id: int) -> CustomerGroup:
    group = db.query(CustomerGroup).filter(CustomerGroup.tenant_id == tenant_id, CustomerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer group not found")
    return group


def update_customer_group(db: Session, *, group: CustomerGroup, payload: dict) -> CustomerGroup:
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
    return group


def _validate_group_for_tenant(db: Session, *, tenant_id: int, group_id: int | None) -> CustomerGroup | None:
    if group_id is None:
        return None
    group = get_customer_group_or_404(db, tenant_id=tenant_id, group_id=group_id)
    if not group.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer group is inactive")
    return group


def assign_contact_customer_group(db: Session, *, tenant_id: int, contact_id: int, group_id: int | None):
    _validate_group_for_tenant(db, tenant_id=tenant_id, group_id=group_id)
    contact = (
        db.query(SalesContact)
        .filter(SalesContact.tenant_id == tenant_id, SalesContact.contact_id == contact_id, SalesContact.deleted_at.is_(None))
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    contact.customer_group_id = group_id
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


def assign_organization_customer_group(db: Session, *, tenant_id: int, organization_id: int, group_id: int | None):
    _validate_group_for_tenant(db, tenant_id=tenant_id, group_id=group_id)
    organization = (
        db.query(SalesOrganization)
        .filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id, SalesOrganization.deleted_at.is_(None))
        .first()
    )
    if not organization:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    organization.customer_group_id = group_id
    db.add(organization)
    db.commit()
    db.refresh(organization)
    return organization


def _create_setup_token(account: ClientAccount) -> str:
    token = secrets.token_urlsafe(32)
    account.setup_token_hash = _hash_token(token)
    account.setup_token_expires_at = _utcnow() + timedelta(days=7)
    return token


def _setup_link(token: str) -> str:
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}/client/setup?token={token}"


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


def serialize_client_account(account: ClientAccount, *, setup_token: str | None = None) -> dict:
    return {
        "id": account.id,
        "email": account.email,
        "status": account.status,
        "contact_id": account.contact_id,
        "organization_id": account.organization_id,
        "has_password": bool(account.password_hash),
        "setup_link": _setup_link(setup_token) if setup_token else None,
        "setup_token_expires_at": account.setup_token_expires_at,
        "last_login_at": account.last_login_at,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
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
    return account, setup_token


def list_client_accounts(db: Session, *, tenant_id: int) -> list[ClientAccount]:
    return (
        db.query(ClientAccount)
        .filter(ClientAccount.tenant_id == tenant_id)
        .order_by(ClientAccount.created_at.desc(), ClientAccount.id.desc())
        .all()
    )


def get_client_account_or_404(db: Session, *, tenant_id: int, account_id: int) -> ClientAccount:
    account = db.query(ClientAccount).filter(ClientAccount.tenant_id == tenant_id, ClientAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client account not found")
    return account


def regenerate_client_setup_link(db: Session, *, account: ClientAccount, actor_user_id: int | None) -> tuple[ClientAccount, str]:
    token = _create_setup_token(account)
    account.status = "pending" if account.status != "inactive" else account.status
    account.updated_by_user_id = actor_user_id
    db.add(account)
    db.commit()
    db.refresh(account)
    return account, token


def update_client_account_status(db: Session, *, account: ClientAccount, status_value: str, actor_user_id: int | None) -> ClientAccount:
    status_value = status_value.strip().lower()
    if status_value not in CLIENT_ACCOUNT_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported client account status")
    account.status = status_value
    account.updated_by_user_id = actor_user_id
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


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
    account.password_hash = hash_password(password)
    account.status = "active"
    account.setup_token_hash = None
    account.setup_token_expires_at = None
    db.add(account)
    db.commit()
    db.refresh(account)
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
