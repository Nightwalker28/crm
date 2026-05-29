from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.module_filters import apply_filter_conditions
from app.modules.contracts.models import Contract, ContractEvent, ContractParty, ContractSigner
from app.modules.documents.models import Document
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.user_management.models import User


CONTRACT_STATUSES = {"draft", "review", "sent", "partially_signed", "signed", "active", "expired", "cancelled"}
SIGNER_STATUSES = {"pending", "sent", "viewed", "signed", "declined", "voided"}


def _clean_text(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _validate_choice(value: str | None, allowed: set[str], *, default: str, detail: str) -> str:
    normalized = (value or default).strip().lower()
    if normalized not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    return normalized


def _coerce_decimal(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid contract value") from exc


def _linked_exists(db: Session, model, id_attr: str, *, tenant_id: int, record_id: int) -> bool:
    return (
        db.query(getattr(model, id_attr))
        .filter(getattr(model, id_attr) == record_id, model.tenant_id == tenant_id)
        .first()
        is not None
    )


def _ensure_user(db: Session, *, tenant_id: int, user_id: int | None) -> None:
    if user_id is None:
        return
    exists = db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner not found")


def _ensure_linked_records(db: Session, data: dict, *, tenant_id: int) -> None:
    linked_checks = (
        ("contact_id", SalesContact, "contact_id", "Contact not found"),
        ("organization_id", SalesOrganization, "org_id", "Organization not found"),
        ("opportunity_id", SalesOpportunity, "opportunity_id", "Opportunity not found"),
        ("quote_id", SalesQuote, "quote_id", "Quote not found"),
        ("order_id", SalesOrder, "id", "Order not found"),
        ("document_id", Document, "id", "Document not found"),
    )
    for field, model, id_attr, detail in linked_checks:
        record_id = data.get(field)
        if record_id is not None and not _linked_exists(db, model, id_attr, tenant_id=tenant_id, record_id=record_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    _ensure_user(db, tenant_id=tenant_id, user_id=data.get("owner_id"))


def _generate_contract_number(db: Session, *, tenant_id: int) -> str:
    prefix = f"CTR-{datetime.now(timezone.utc):%Y%m%d}"
    count = (
        db.query(Contract.id)
        .filter(Contract.tenant_id == tenant_id, Contract.contract_number.like(f"{prefix}-%"))
        .count()
    )
    return f"{prefix}-{count + 1:04d}"


def _normalize_contract_payload(db: Session, payload: dict, *, tenant_id: int, current_user, partial: bool = False) -> dict:
    data = dict(payload)
    for field in {"contact_id", "organization_id", "opportunity_id", "quote_id", "order_id", "document_id", "owner_id"}:
        if data.get(field) == "":
            data[field] = None
    if "title" in data:
        data["title"] = _clean_text(data["title"])
        if not data["title"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    elif not partial:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    if "status" in data:
        data["status"] = _validate_choice(data["status"], CONTRACT_STATUSES, default="draft", detail="Invalid contract status")
    elif not partial:
        data["status"] = "draft"
    if "currency" in data:
        data["currency"] = (_clean_text(data["currency"]) or None)
        if data["currency"]:
            data["currency"] = data["currency"].upper()[:10]
    if "value_amount" in data:
        data["value_amount"] = _coerce_decimal(data["value_amount"])
    if not partial:
        data["contract_number"] = _clean_text(data.get("contract_number")) or _generate_contract_number(db, tenant_id=tenant_id)
        data["owner_id"] = data.get("owner_id") or (current_user.id if current_user else None)
        data["created_by_id"] = current_user.id if current_user else None
    _ensure_linked_records(db, data, tenant_id=tenant_id)
    return data


def _record_event(db: Session, contract: Contract, *, event_type: str, current_user, payload: dict | None = None) -> ContractEvent:
    event = ContractEvent(
        tenant_id=contract.tenant_id,
        contract_id=contract.id,
        event_type=event_type,
        payload_json=payload or {},
        created_by_id=current_user.id if current_user else None,
    )
    db.add(event)
    return event


def build_contracts_query(db: Session, *, tenant_id: int, search: str | None = None, all_filter_conditions: list[dict] | None = None, any_filter_conditions: list[dict] | None = None):
    query = db.query(Contract).filter(Contract.tenant_id == tenant_id)
    field_map = {
        "contract_number": {"expression": Contract.contract_number, "type": "text"},
        "title": {"expression": Contract.title, "type": "text"},
        "status": {"expression": Contract.status, "type": "text"},
        "organization_id": {"expression": Contract.organization_id, "type": "number"},
        "contact_id": {"expression": Contract.contact_id, "type": "number"},
        "opportunity_id": {"expression": Contract.opportunity_id, "type": "number"},
        "quote_id": {"expression": Contract.quote_id, "type": "number"},
        "order_id": {"expression": Contract.order_id, "type": "number"},
        "document_id": {"expression": Contract.document_id, "type": "number"},
        "effective_date": {"expression": Contract.effective_date, "type": "date"},
        "expiration_date": {"expression": Contract.expiration_date, "type": "date"},
        "renewal_date": {"expression": Contract.renewal_date, "type": "date"},
        "value_amount": {"expression": Contract.value_amount, "type": "number"},
        "currency": {"expression": Contract.currency, "type": "text"},
        "owner_id": {"expression": Contract.owner_id, "type": "number"},
        "created_at": {"expression": Contract.created_at, "type": "date"},
        "updated_at": {"expression": Contract.updated_at, "type": "date"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.filter(or_(func.lower(Contract.contract_number).like(pattern), func.lower(Contract.title).like(pattern), func.lower(Contract.status).like(pattern)))
    return query


def list_contracts(db: Session, *, tenant_id: int, pagination, search: str | None = None, all_filter_conditions: list[dict] | None = None, any_filter_conditions: list[dict] | None = None) -> tuple[Sequence[Contract], int]:
    query = build_contracts_query(db, tenant_id=tenant_id, search=search, all_filter_conditions=all_filter_conditions, any_filter_conditions=any_filter_conditions)
    total_count = query.count()
    items = query.order_by(Contract.updated_at.desc(), Contract.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return items, total_count


def get_contract_or_404(db: Session, *, tenant_id: int, contract_id: int) -> Contract:
    item = (
        db.query(Contract)
        .options(selectinload(Contract.parties), selectinload(Contract.signers), selectinload(Contract.events))
        .filter(Contract.id == contract_id, Contract.tenant_id == tenant_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    return item


def create_contract(db: Session, payload: dict, current_user) -> Contract:
    data = _normalize_contract_payload(db, payload, tenant_id=current_user.tenant_id, current_user=current_user)
    item = Contract(tenant_id=current_user.tenant_id, **data)
    db.add(item)
    db.flush()
    contract_id = item.id
    _record_event(db, item, event_type="created", current_user=current_user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract could not be created") from exc
    return get_contract_or_404(db, tenant_id=current_user.tenant_id, contract_id=contract_id)


def update_contract(db: Session, contract: Contract, payload: dict, current_user) -> Contract:
    data = _normalize_contract_payload(db, payload, tenant_id=contract.tenant_id, current_user=current_user, partial=True)
    before_status = contract.status
    for key, value in data.items():
        setattr(contract, key, value)
    if "status" in data and data["status"] != before_status:
        _record_event(db, contract, event_type="status_changed", current_user=current_user, payload={"from": before_status, "to": data["status"]})
    else:
        _record_event(db, contract, event_type="updated", current_user=current_user, payload={"fields": sorted(data)})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract could not be updated") from exc
    return get_contract_or_404(db, tenant_id=contract.tenant_id, contract_id=contract.id)


def add_contract_party(db: Session, contract: Contract, payload: dict, current_user) -> ContractParty:
    name = _clean_text(payload.get("name"))
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Party name is required")
    party = ContractParty(tenant_id=contract.tenant_id, contract_id=contract.id, name=name, email=_clean_text(payload.get("email")), role=_clean_text(payload.get("role")) or "counterparty")
    db.add(party)
    _record_event(db, contract, event_type="party_added", current_user=current_user, payload={"name": name, "role": party.role})
    db.commit()
    db.refresh(party)
    return party


def add_contract_signer(db: Session, contract: Contract, payload: dict, current_user) -> ContractSigner:
    name = _clean_text(payload.get("name"))
    email = _clean_text(payload.get("email"))
    if not name or not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Signer name and email are required")
    party_id = payload.get("party_id")
    if party_id is not None:
        exists = db.query(ContractParty.id).filter(ContractParty.id == party_id, ContractParty.tenant_id == contract.tenant_id, ContractParty.contract_id == contract.id).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contract party not found")
    signer = ContractSigner(tenant_id=contract.tenant_id, contract_id=contract.id, party_id=party_id, name=name, email=email, signing_order=int(payload.get("signing_order") or 1), status=_validate_choice(payload.get("status"), SIGNER_STATUSES, default="pending", detail="Invalid signer status"))
    db.add(signer)
    _record_event(db, contract, event_type="signer_added", current_user=current_user, payload={"name": name, "email": email})
    db.commit()
    db.refresh(signer)
    return signer


def update_contract_signer(db: Session, contract: Contract, signer_id: int, payload: dict, current_user) -> ContractSigner:
    signer = db.query(ContractSigner).filter(ContractSigner.id == signer_id, ContractSigner.tenant_id == contract.tenant_id, ContractSigner.contract_id == contract.id).first()
    if not signer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract signer not found")
    if "status" in payload and payload["status"] is not None:
        signer.status = _validate_choice(payload["status"], SIGNER_STATUSES, default="pending", detail="Invalid signer status")
        if signer.status == "signed" and signer.signed_at is None:
            signer.signed_at = datetime.now(timezone.utc)
    if "signed_at" in payload:
        signer.signed_at = payload["signed_at"]
    _record_event(db, contract, event_type="signer_updated", current_user=current_user, payload={"signer_id": signer.id, "status": signer.status})
    db.commit()
    db.refresh(signer)
    return signer
