from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import secrets
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers
from app.core.module_export import dict_rows_to_csv_bytes
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesQuote, SalesQuoteDocument, SalesQuoteOpenEvent
from app.modules.sales.repositories import quotes_repository
from app.modules.sales.services.time_utils import as_utc, utc_now
from app.modules.user_management.models import User


QUOTE_STATUSES = {"draft", "sent", "accepted", "declined", "expired"}
EXPORT_COLUMNS = [
    "quote_id",
    "quote_number",
    "title",
    "customer_name",
    "contact_id",
    "organization_id",
    "opportunity_id",
    "status",
    "issue_date",
    "expiry_date",
    "currency",
    "subtotal_amount",
    "discount_amount",
    "tax_amount",
    "total_amount",
    "notes",
    "assigned_to",
    "created_time",
    "updated_at",
]
PROPOSAL_TOKEN_BYTES = 32
PROPOSAL_LINK_TTL_DAYS = 30
PROPOSAL_SENT_EVENT_TYPE = "sent"
INTERNAL_PROPOSAL_EVENT_TYPES = {PROPOSAL_SENT_EVENT_TYPE}
PUBLIC_PROPOSAL_EVENT_TYPES = {"opened", "viewed", "downloaded"}
CLIENT_QUOTE_RESPONDABLE_STATUSES = {PROPOSAL_SENT_EVENT_TYPE}


def _coerce_optional(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _coerce_required(value, field_name: str) -> str:
    cleaned = _coerce_optional(value)
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
    return cleaned


def _coerce_currency(value) -> str:
    return (_coerce_optional(value) or "USD").upper()[:10]


def _coerce_decimal(value) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid amount") from exc


def _parse_optional_int(value, field_name: str) -> int | None:
    cleaned = _coerce_optional(value)
    if cleaned is None:
        return None
    try:
        return int(cleaned)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} '{cleaned}' must be an integer.") from exc


def _validate_status(value: str | None) -> str:
    normalized = (value or "draft").strip().lower()
    if normalized not in QUOTE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quote status")
    return normalized


def _ensure_assigned_user(db: Session, user_id: int | None, *, tenant_id: int) -> None:
    if user_id is None:
        return
    if not quotes_repository.user_exists(db, user_id=user_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _ensure_linked_records(db: Session, data: dict, *, tenant_id: int) -> None:
    opportunity = None
    opportunity_id = data.get("opportunity_id")
    if opportunity_id is not None:
        opportunity = quotes_repository.get_opportunity(db, tenant_id=tenant_id, opportunity_id=opportunity_id)
        if not opportunity:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity not found")
    contact_id = data.get("contact_id")
    if contact_id is not None and not quotes_repository.contact_exists(db, tenant_id=tenant_id, contact_id=contact_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    organization_id = data.get("organization_id")
    if organization_id is not None and not quotes_repository.organization_exists(db, tenant_id=tenant_id, organization_id=organization_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")
    if opportunity is not None:
        if contact_id is not None and opportunity.contact_id is not None and contact_id != opportunity.contact_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quote contact must match the linked opportunity")
        if organization_id is not None and opportunity.organization_id is not None and organization_id != opportunity.organization_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quote organization must match the linked opportunity")
        if data.get("contact_id") is None and opportunity.contact_id is not None:
            data["contact_id"] = opportunity.contact_id
        if data.get("organization_id") is None and opportunity.organization_id is not None:
            data["organization_id"] = opportunity.organization_id


def _normalize_quote_payload(data: dict, *, partial: bool = False) -> dict:
    normalized = dict(data)
    if "quote_number" in normalized and normalized["quote_number"] is not None:
        normalized["quote_number"] = _coerce_required(normalized["quote_number"], "quote_number")
    if "customer_name" in normalized and normalized["customer_name"] is not None:
        normalized["customer_name"] = _coerce_required(normalized["customer_name"], "customer_name")
    elif not partial:
        normalized["customer_name"] = _coerce_required(normalized.get("customer_name"), "customer_name")
    for field in {"title", "notes"}:
        if field in normalized:
            normalized[field] = _coerce_optional(normalized[field])
    for field in {"contact_id", "organization_id", "opportunity_id", "assigned_to"}:
        if field in normalized and normalized[field] == "":
            normalized[field] = None
    if "status" in normalized and normalized["status"] is not None:
        normalized["status"] = _validate_status(normalized["status"])
    elif not partial:
        normalized["status"] = _validate_status(None)
    if "currency" in normalized and normalized["currency"] is not None:
        normalized["currency"] = _coerce_currency(normalized["currency"])
    elif not partial:
        normalized["currency"] = "USD"
    for field in {"subtotal_amount", "discount_amount", "tax_amount", "total_amount"}:
        if field in normalized and normalized[field] is not None:
            normalized[field] = _coerce_decimal(normalized[field])
        elif not partial:
            normalized[field] = Decimal("0")
    return normalized


def _generate_quote_number(db: Session, *, tenant_id: int) -> str:
    return allocate_business_number(db, tenant_id=tenant_id, scope="sales_quotes", prefix="Q")


def _hash_value(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _build_proposal_content(quote: SalesQuote) -> str:
    lines = [
        f"Proposal for {quote.customer_name}",
        f"Quote: {quote.quote_number}",
    ]
    if quote.title:
        lines.append(f"Title: {quote.title}")
    lines.extend(
        [
            f"Status: {quote.status}",
            f"Total: {quote.currency or 'USD'} {quote.total_amount or Decimal('0')}",
        ]
    )
    if quote.expiry_date:
        lines.append(f"Valid until: {quote.expiry_date.isoformat()}")
    if quote.notes:
        lines.extend(["", quote.notes])
    return "\n".join(lines)


def _client_quote_conditions(*, contact_id: int | None, organization_id: int | None):
    conditions = []
    if contact_id is not None:
        conditions.append(SalesQuote.contact_id == contact_id)
    if organization_id is not None:
        conditions.append(SalesQuote.organization_id == organization_id)
    return conditions


def _ensure_client_quote_scope(*, contact_id: int | None, organization_id: int | None) -> None:
    if contact_id is None and organization_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account is not linked to a quote profile.")


def serialize_client_quote(db: Session, quote: SalesQuote) -> dict:
    proposal = get_latest_quote_proposal(db, quote)
    return {
        "quote_id": quote.quote_id,
        "quote_number": quote.quote_number,
        "title": quote.title,
        "customer_name": quote.customer_name,
        "status": quote.status,
        "issue_date": quote.issue_date,
        "expiry_date": quote.expiry_date,
        "currency": quote.currency,
        "subtotal_amount": quote.subtotal_amount,
        "discount_amount": quote.discount_amount,
        "tax_amount": quote.tax_amount,
        "total_amount": quote.total_amount,
        "notes": quote.notes,
        "contact_id": quote.contact_id,
        "organization_id": quote.organization_id,
        "proposal_document_id": proposal.id if proposal else None,
        "proposal_title": proposal.title if proposal else None,
        "proposal_content_text": proposal.content_text if proposal else None,
        "proposal_generated_at": proposal.generated_at if proposal else None,
        "can_respond": quote.status in CLIENT_QUOTE_RESPONDABLE_STATUSES,
        "created_time": quote.created_time,
        "updated_at": quote.updated_at,
    }


def _proposal_public_url_path(raw_token: str) -> str:
    return f"/public/quotes/proposal/{raw_token}"


def _apply_quote_payload(quote: SalesQuote, payload: dict) -> None:
    for field, value in payload.items():
        setattr(quote, field, value)


def _merge_quote_payload(quote: SalesQuote, payload: dict) -> None:
    for field, value in payload.items():
        if should_merge_value(getattr(quote, field, None), value):
            setattr(quote, field, value)


def list_sales_quotes(
    db: Session,
    tenant_id: int,
    pagination,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[Sequence[SalesQuote], int]:
    quotes, total_count = quotes_repository.list_quotes(
        db,
        tenant_id=tenant_id,
        pagination=pagination,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    quotes = hydrate_custom_field_records(db, tenant_id=tenant_id, module_key="sales_quotes", records=quotes, record_id_attr="quote_id")
    return quotes, total_count


def list_sales_quotes_cursor(db: Session, tenant_id: int, *, limit: int, cursor: int | None = None, search: str | None = None, all_filter_conditions: list[dict] | None = None, any_filter_conditions: list[dict] | None = None) -> Sequence[SalesQuote]:
    quotes = quotes_repository.list_quotes_cursor(db, tenant_id=tenant_id, limit=limit, cursor=cursor, search=search, all_filter_conditions=all_filter_conditions, any_filter_conditions=any_filter_conditions)
    return hydrate_custom_field_records(db, tenant_id=tenant_id, module_key="sales_quotes", records=quotes, record_id_attr="quote_id")


def list_all_sales_quotes(db: Session, tenant_id: int, search: str | None = None, *, all_filter_conditions: list[dict] | None = None, any_filter_conditions: list[dict] | None = None) -> Sequence[SalesQuote]:
    quotes = quotes_repository.list_all_quotes(db, tenant_id=tenant_id, search=search, all_filter_conditions=all_filter_conditions, any_filter_conditions=any_filter_conditions)
    return hydrate_custom_field_records(db, tenant_id=tenant_id, module_key="sales_quotes", records=quotes, record_id_attr="quote_id")


def get_quote_or_404(db: Session, quote_id: int, *, tenant_id: int, include_deleted: bool = False) -> SalesQuote:
    quote = quotes_repository.get_quote(db, tenant_id=tenant_id, quote_id=quote_id, include_deleted=include_deleted)
    if not quote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
    return hydrate_custom_field_record(db, tenant_id=tenant_id, module_key="sales_quotes", record=quote, record_id=quote.quote_id)


def list_client_quotes(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int | None,
    organization_id: int | None,
) -> Sequence[SalesQuote]:
    _ensure_client_quote_scope(contact_id=contact_id, organization_id=organization_id)
    return (
        db.query(SalesQuote)
        .filter(
            SalesQuote.tenant_id == tenant_id,
            SalesQuote.deleted_at.is_(None),
            or_(*_client_quote_conditions(contact_id=contact_id, organization_id=organization_id)),
        )
        .order_by(SalesQuote.updated_at.desc(), SalesQuote.quote_id.desc())
        .all()
    )


def get_client_quote_or_404(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int | None,
    organization_id: int | None,
    quote_id: int,
) -> SalesQuote:
    _ensure_client_quote_scope(contact_id=contact_id, organization_id=organization_id)
    quote = (
        db.query(SalesQuote)
        .filter(
            SalesQuote.tenant_id == tenant_id,
            SalesQuote.quote_id == quote_id,
            SalesQuote.deleted_at.is_(None),
            or_(*_client_quote_conditions(contact_id=contact_id, organization_id=organization_id)),
        )
        .first()
    )
    if not quote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found.")
    return quote


def respond_to_client_quote(db: Session, *, quote: SalesQuote, action: str, client_account_id: int, message: str | None = None) -> SalesQuote:
    action = action.strip().lower()
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported quote action.")
    if quote.status not in CLIENT_QUOTE_RESPONDABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quote is not open for portal response.")
    before_status = quote.status
    quote.status = "accepted" if action == "approve" else "declined"
    db.add(quote)
    action_label = "approved" if action == "approve" else "rejected"
    audit_action = "portal.quote.approved" if action == "approve" else "portal.quote.rejected"
    try:
        log_activity(
            db,
            tenant_id=quote.tenant_id,
            actor_user_id=None,
            module_key="sales_quotes",
            entity_type="sales_quote",
            entity_id=quote.quote_id,
            action=audit_action,
            description=f"Client {action_label} quote {quote.quote_number}",
            before_state={"status": before_status},
            after_state={
                "status": quote.status,
                "client_account_id": client_account_id,
                "message": (message or "").strip() or None,
            },
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(quote)
    return quote


def create_sales_quote(db: Session, payload: dict, current_user, replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False) -> SalesQuote:
    ensure_single_duplicate_action(replace_duplicates=replace_duplicates, skip_duplicates=skip_duplicates, create_new_records=create_new_records)
    data = dict(payload)
    explicit_assigned_to = "assigned_to" in data and data.get("assigned_to") is not None
    custom_data = validate_custom_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", payload=data.pop("custom_fields", None))
    data = _normalize_quote_payload(data)
    data["custom_data"] = custom_data
    if not data.get("quote_number"):
        data["quote_number"] = _generate_quote_number(db, tenant_id=current_user.tenant_id)
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id if current_user else None
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=current_user.tenant_id)
    _ensure_linked_records(db, data, tenant_id=current_user.tenant_id)
    if quotes_repository.quote_number_exists(db, tenant_id=current_user.tenant_id, quote_number=data["quote_number"]) and not create_new_records:
        existing = (
            db.query(SalesQuote)
            .filter(SalesQuote.tenant_id == current_user.tenant_id, SalesQuote.deleted_at.is_(None), SalesQuote.quote_number == data["quote_number"])
            .first()
        )
        if skip_duplicates and existing:
            return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", record=existing, record_id=existing.quote_id)
        if replace_duplicates and existing:
            if not explicit_assigned_to:
                data.pop("assigned_to", None)
            _apply_quote_payload(existing, data)
            db.add(existing)
            try:
                db.flush()
                save_custom_field_values(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", record_id=existing.quote_id, values=custom_data)
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to replace quote") from exc
            db.refresh(existing)
            return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", record=existing, record_id=existing.quote_id)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Quote number already exists")

    quote = SalesQuote(tenant_id=current_user.tenant_id, **data)
    db.add(quote)
    try:
        db.flush()
        save_custom_field_values(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", record_id=quote.quote_id, values=custom_data)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create quote") from exc
    db.refresh(quote)
    return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", record=quote, record_id=quote.quote_id)


def update_sales_quote(db: Session, quote: SalesQuote, data: dict) -> SalesQuote:
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(db, tenant_id=quote.tenant_id, module_key="sales_quotes", payload=data.pop("custom_fields"), existing=load_custom_field_values_with_fallback(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record_id=quote.quote_id, fallback=quote.custom_data))
        data["custom_data"] = custom_data_to_save
    data = _normalize_quote_payload(data, partial=True)
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=quote.tenant_id)
    _ensure_linked_records(db, data, tenant_id=quote.tenant_id)
    if data.get("quote_number") and quotes_repository.quote_number_exists(db, tenant_id=quote.tenant_id, quote_number=data["quote_number"], exclude_quote_id=quote.quote_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Another quote already uses this number")
    _apply_quote_payload(quote, data)
    db.add(quote)
    try:
        db.flush()
        if custom_data_to_save is not None:
            save_custom_field_values(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record_id=quote.quote_id, values=custom_data_to_save)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to update quote") from exc
    db.refresh(quote)
    return hydrate_custom_field_record(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record=quote, record_id=quote.quote_id)


def delete_sales_quote(db: Session, quote: SalesQuote) -> None:
    quote.deleted_at = utc_now()
    db.add(quote)
    db.commit()


def list_deleted_sales_quotes(db: Session, tenant_id: int, pagination) -> tuple[Sequence[SalesQuote], int]:
    return quotes_repository.list_deleted_quotes(db, tenant_id=tenant_id, pagination=pagination)


def restore_sales_quote(db: Session, quote: SalesQuote) -> SalesQuote:
    quote.deleted_at = None
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return hydrate_custom_field_record(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record=quote, record_id=quote.quote_id)


def get_latest_quote_proposal(db: Session, quote: SalesQuote) -> SalesQuoteDocument | None:
    return (
        db.query(SalesQuoteDocument)
        .filter(SalesQuoteDocument.tenant_id == quote.tenant_id, SalesQuoteDocument.quote_id == quote.quote_id)
        .order_by(SalesQuoteDocument.generated_at.desc(), SalesQuoteDocument.id.desc())
        .first()
    )


def list_quote_proposal_events(db: Session, quote: SalesQuote, *, limit: int = 25) -> list[SalesQuoteOpenEvent]:
    return (
        db.query(SalesQuoteOpenEvent)
        .filter(SalesQuoteOpenEvent.tenant_id == quote.tenant_id, SalesQuoteOpenEvent.quote_id == quote.quote_id)
        .order_by(SalesQuoteOpenEvent.occurred_at.desc(), SalesQuoteOpenEvent.id.desc())
        .limit(limit)
        .all()
    )


def generate_quote_proposal(db: Session, quote: SalesQuote, current_user) -> SalesQuoteDocument:
    proposal = SalesQuoteDocument(
        tenant_id=quote.tenant_id,
        quote_id=quote.quote_id,
        template_name="default_quote_proposal",
        status="generated",
        title=f"Proposal {quote.quote_number}",
        content_text=_build_proposal_content(quote),
        created_by_id=current_user.id if current_user else None,
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal


def send_quote_proposal(db: Session, quote: SalesQuote, *, sent_to: str | None, current_user) -> tuple[SalesQuoteDocument, str, datetime]:
    proposal = get_latest_quote_proposal(db, quote) or generate_quote_proposal(db, quote, current_user)
    raw_token = secrets.token_urlsafe(PROPOSAL_TOKEN_BYTES)
    expires_at = utc_now() + timedelta(days=PROPOSAL_LINK_TTL_DAYS)
    proposal.status = "sent"
    proposal.sent_at = utc_now()
    proposal.sent_to = sent_to
    proposal.public_token_hash = _hash_value(raw_token)
    proposal.public_expires_at = expires_at
    event = SalesQuoteOpenEvent(
        tenant_id=quote.tenant_id,
        quote_id=quote.quote_id,
        quote_document_id=proposal.id,
        event_type=PROPOSAL_SENT_EVENT_TYPE,
        recipient_email=sent_to,
    )
    db.add_all([proposal, event])
    db.commit()
    db.refresh(proposal)
    return proposal, _proposal_public_url_path(raw_token), expires_at


def get_public_quote_proposal_or_404(db: Session, token: str) -> tuple[SalesQuoteDocument, SalesQuote]:
    token_hash = _hash_value(token)
    proposal = (
        db.query(SalesQuoteDocument)
        .join(SalesQuote, SalesQuote.quote_id == SalesQuoteDocument.quote_id)
        .filter(
            SalesQuoteDocument.public_token_hash == token_hash,
            SalesQuoteDocument.status == "sent",
            SalesQuote.deleted_at.is_(None),
        )
        .first()
    )
    if not proposal or not proposal.public_expires_at or as_utc(proposal.public_expires_at) < utc_now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal link not found")
    quote = proposal.quote
    if not quote or quote.tenant_id != proposal.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal link not found")
    return proposal, quote


def record_quote_proposal_event(
    db: Session,
    *,
    proposal: SalesQuoteDocument,
    event_type: str,
    recipient_email: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> SalesQuoteOpenEvent:
    if event_type not in PUBLIC_PROPOSAL_EVENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid proposal event type")
    event = SalesQuoteOpenEvent(
        tenant_id=proposal.tenant_id,
        quote_id=proposal.quote_id,
        quote_document_id=proposal.id,
        event_type=event_type,
        recipient_email=recipient_email or proposal.sent_to,
        ip_hash=_hash_value(ip_address),
        user_agent_hash=_hash_value(user_agent),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def import_quotes_from_csv(db: Session, file_bytes: bytes, *, tenant_id: int, default_assigned_to: int | None, duplicate_mode: str | None = None, default_duplicate_mode: str | None = None, replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False) -> dict:
    mode = resolve_duplicate_mode(duplicate_mode=duplicate_mode, default_mode=default_duplicate_mode, replace_duplicates=replace_duplicates, skip_duplicates=skip_duplicates, create_new_records=create_new_records)
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required={"customer_name"})
    new_rows = overwritten_rows = merged_rows = skipped_rows = total_rows = 0
    failures: list[dict[str, str | int | None]] = []
    user_cache: dict[int, bool] = {}
    for row_number, row in enumerate(row_iter, start=2):
        total_rows += 1
        normalized = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        identifier = normalized.get("quote_number") or normalized.get("customer_name")
        try:
            assigned_to = default_assigned_to
            if normalized.get("assigned_to"):
                assigned_to = int(normalized["assigned_to"])
            if assigned_to:
                if assigned_to not in user_cache:
                    user_cache[assigned_to] = quotes_repository.user_exists(db, tenant_id=tenant_id, user_id=assigned_to)
                if not user_cache[assigned_to]:
                    raise ValueError(f"assigned_to '{assigned_to}' does not reference a valid user.")
            payload = _normalize_quote_payload({
                "quote_number": _coerce_optional(normalized.get("quote_number")),
                "title": _coerce_optional(normalized.get("title")),
                "customer_name": normalized.get("customer_name"),
                "contact_id": _parse_optional_int(normalized.get("contact_id"), "contact_id"),
                "organization_id": _parse_optional_int(normalized.get("organization_id"), "organization_id"),
                "opportunity_id": _parse_optional_int(normalized.get("opportunity_id"), "opportunity_id"),
                "status": normalized.get("status"),
                "currency": normalized.get("currency"),
                "subtotal_amount": normalized.get("subtotal_amount"),
                "discount_amount": normalized.get("discount_amount"),
                "tax_amount": normalized.get("tax_amount"),
                "total_amount": normalized.get("total_amount"),
                "notes": _coerce_optional(normalized.get("notes")),
                "assigned_to": assigned_to,
            })
            _ensure_linked_records(db, payload, tenant_id=tenant_id)
        except HTTPException as exc:
            failures.append({"row_number": row_number, "record_identifier": identifier, "reason": str(exc.detail)})
            continue
        except Exception as exc:
            failures.append({"row_number": row_number, "record_identifier": identifier, "reason": str(exc)})
            continue
        if not payload.get("quote_number"):
            payload["quote_number"] = _generate_quote_number(db, tenant_id=tenant_id)
        existing = (
            db.query(SalesQuote)
            .filter(SalesQuote.tenant_id == tenant_id, SalesQuote.deleted_at.is_(None), SalesQuote.quote_number == payload["quote_number"])
            .first()
        )
        if existing and not create_new_records:
            if mode == DuplicateMode.skip:
                skipped_rows += 1
                continue
            if mode == DuplicateMode.overwrite:
                _apply_quote_payload(existing, payload)
                overwritten_rows += 1
            else:
                _merge_quote_payload(existing, payload)
                merged_rows += 1
            db.add(existing)
            continue
        db.add(SalesQuote(tenant_id=tenant_id, **payload))
        new_rows += 1
    db.commit()
    return build_import_summary(total_rows=total_rows, new_rows=new_rows, skipped_rows=skipped_rows, overwritten_rows=overwritten_rows, merged_rows=merged_rows, failures=failures)


def export_quotes_to_csv(records: Sequence[SalesQuote], *, field_keys: list[str] | None = None) -> bytes:
    columns = [field for field in (field_keys or EXPORT_COLUMNS) if field in EXPORT_COLUMNS] or EXPORT_COLUMNS
    rows = []
    for quote in records:
        row = {}
        for column in columns:
            value = getattr(quote, column, None)
            row[column] = value.isoformat() if hasattr(value, "isoformat") else value
        rows.append(row)
    return dict_rows_to_csv_bytes(headers=columns, rows=rows)
