from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import re
import secrets
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.duplicates import DuplicateMode, ensure_single_duplicate_action, resolve_duplicate_mode, should_merge_value
from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers
from app.core.module_export import dict_rows_to_csv_bytes
from app.modules.sales.services.document_fields import fill_addresses_from_account, normalize_document_fields
from app.modules.platform.services.module_fields import ImportFieldRules
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.catalog.services.line_links import normalize_catalog_line_links
from app.modules.finance.services import tax_rates
from app.modules.finance.services.document_amounts import document_totals, money
from app.modules.sales.models import SalesQuote, SalesQuoteDocument, SalesQuoteItem, SalesQuoteOpenEvent
from app.modules.sales.repositories import quotes_repository
from app.modules.sales.services.opportunity_contacts_services import ensure_contact_on_opportunity
from app.modules.sales.services.time_utils import as_utc, utc_now
from app.modules.user_management.models import User


QUOTE_STATUSES = {"draft", "sent", "accepted", "declined", "expired", "superseded", "converted"}
# Set by the lifecycle (a revision, a conversion), never typed into the form (13d §3.5).
SYSTEM_QUOTE_STATUSES = {"superseded", "converted"}
LOCKED_QUOTE_STATUSES = {"superseded", "converted"}
REVISABLE_QUOTE_STATUSES = {"sent", "expired", "declined"}
SIGNATURE_MAX_CHARS = 300_000
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
PUBLIC_PROPOSAL_EVENT_DEDUPE_WINDOW = timedelta(minutes=5)
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
    if normalized not in QUOTE_STATUSES or normalized in SYSTEM_QUOTE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quote status")
    return normalized


def _today():
    from datetime import date

    return date.today()


def quote_is_past_expiry(quote: SalesQuote) -> bool:
    return quote.status == "expired" or bool(quote.expiry_date and quote.expiry_date < _today())


def _validity_days(db: Session, tenant_id: int) -> int:
    from app.modules.user_management.models import CompanyProfile

    days = db.query(CompanyProfile.quote_validity_days).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).scalar()
    return int(days or 30)


def _apply_dates(db: Session, data: dict, *, tenant_id: int, quote: SalesQuote | None = None) -> None:
    """A new quote is issued today and valid for the company's period; expiry never before
    issue (H14, 13d §3.5)."""
    for field in ("issue_date", "expiry_date"):
        if isinstance(data.get(field), str):
            try:
                from datetime import date

                data[field] = date.fromisoformat(data[field].strip()) if data[field].strip() else None
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field.replace('_', ' ').capitalize()} must be a date") from exc
    if quote is None:
        data["issue_date"] = data.get("issue_date") or _today()
        if not data.get("expiry_date"):
            data["expiry_date"] = data["issue_date"] + timedelta(days=_validity_days(db, tenant_id))
    issue = data["issue_date"] if "issue_date" in data else (quote.issue_date if quote else None)
    expiry = data["expiry_date"] if "expiry_date" in data else (quote.expiry_date if quote else None)
    if issue and expiry and expiry < issue:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The expiry date cannot be before the issue date")


def _customer_name_from_account(db: Session, data: dict, *, tenant_id: int) -> None:
    """The account's name, not the contact's, when the quote is for an account (H14)."""
    if (data.get("customer_name") or "").strip() or not data.get("organization_id"):
        return
    from app.modules.sales.models import SalesOrganization

    name = db.query(SalesOrganization.org_name).filter(SalesOrganization.org_id == data["organization_id"], SalesOrganization.tenant_id == tenant_id).scalar()
    if name:
        data["customer_name"] = name


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
        ensure_contact_on_opportunity(db, opportunity=opportunity, contact_id=contact_id, record_label="Quote")
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


def _normalize_quote_items(db: Session, items: list[dict], *, tenant_id: int, organization_id: int | None = None,
                           tax_mode: str = "exclusive", allowed_inactive=()) -> tuple[list[SalesQuoteItem], dict[str, Decimal]]:
    resolver = tax_rates.TaxResolver(db, tenant_id=tenant_id, side="sales", allowed_inactive=allowed_inactive,
                                     exempt=tax_rates.account_is_exempt(db, tenant_id=tenant_id, organization_id=organization_id))
    normalized_items: list[SalesQuoteItem] = []
    amounts = []
    catalog_links = normalize_catalog_line_links(db, tenant_id=tenant_id, lines=items)
    for index, item in enumerate(items):
        name = _coerce_required(item.get("name"), "Quote item name")
        quantity = _coerce_decimal(item.get("quantity", "1"))
        unit_price = _coerce_decimal(item.get("unit_price"))
        discount = _coerce_decimal(item.get("discount_amount"))
        is_item = (item.get("line_type") or "item") == "item"
        if is_item and quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quote item quantity must be greater than zero")
        if is_item and min(unit_price, discount, _coerce_decimal(item.get("tax_amount"))) < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quote item amounts cannot be negative")
        line = tax_rates.compute_sales_line(resolver, item, catalog_links[index], quantity=quantity, unit_price=unit_price,
                                            discount=discount, inclusive=tax_mode == "inclusive", label=name)
        optional = bool(item.get("is_optional")) and line.line_type == "item"
        # An optional line is offered, not sold: it stays out of the total (13d §3.2).
        if not optional:
            amounts.append(line.amounts)
        links = catalog_links[index] if line.line_type == "item" else {key: None for key in catalog_links[index]}
        normalized_items.append(
            SalesQuoteItem(
                tenant_id=tenant_id,
                **links,
                name=name,
                description=_coerce_optional(item.get("description")) if line.line_type == "item" else None,
                **tax_rates.sales_line_fields(line),
                is_optional=optional,
                sort_order=index,
            )
        )
    totals = document_totals(amounts)
    return normalized_items, {
        "subtotal_amount": totals["subtotal"],
        "discount_amount": totals["discount"],
        "tax_amount": totals["tax"],
        "total_amount": totals["total"],
    }


def _apply_default_texts(db: Session, data: dict, *, tenant_id: int, kind: str) -> None:
    """A new document starts with its type's default terms and notes (13d §3.3)."""
    from app.modules.platform.services.document_pdfs import default_texts

    texts = default_texts(db, tenant_id=tenant_id, kind=kind)
    if texts["terms"] and not (data.get("terms_and_conditions") or "").strip():
        data["terms_and_conditions"] = texts["terms"]
    if texts["notes"] and not (data.get("notes") or "").strip():
        data["notes"] = texts["notes"]


def _items_for(db: Session, data: dict, item_payloads: list[dict] | None, *, tenant_id: int, quote: SalesQuote | None = None):
    """The quote's lines and totals from the submitted lines, or its current lines recomputed
    when only the tax mode changed; (None, None) when neither applies."""
    if item_payloads is None and quote is not None and "tax_mode" in data and data["tax_mode"] != quote.tax_mode and quote.items:
        item_payloads = [_existing_item_payload(item) for item in quote.items]
    if item_payloads is None:
        return None, None
    organization_id = data["organization_id"] if "organization_id" in data else (quote.organization_id if quote else None)
    tax_mode = data.get("tax_mode") or (quote.tax_mode if quote else None) or tax_rates.default_tax_mode(db, tenant_id=tenant_id)
    allowed = tax_rates.used_rate_ids(quote.items) if quote is not None else ()
    return _normalize_quote_items(db, item_payloads, tenant_id=tenant_id, organization_id=organization_id, tax_mode=tax_mode, allowed_inactive=allowed)


def _existing_item_payload(item: SalesQuoteItem) -> dict:
    return {"catalog_product_id": item.catalog_product_id, "catalog_service_id": item.catalog_service_id, "name": item.name,
            "description": item.description, "quantity": item.quantity, "unit_price": item.unit_price,
            "discount_amount": item.discount_amount, **tax_rates.line_payload(item)}


def _refresh_total(quote: SalesQuote) -> None:
    """Lines plus the shipping charge (13b §5 decision 8); subtotal − discount + tax is the
    lines' total in either tax mode (13d §3.1)."""
    quote.total_amount = (
        money(quote.subtotal_amount) - money(quote.discount_amount) + money(quote.tax_amount) + money(quote.shipping_charge)
    )


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
    if quote.items:
        lines.extend(["", "Items:"])
        for item in quote.items:
            lines.append(
                f"- {item.name}: {item.quantity} x {quote.currency or 'USD'} {item.unit_price} = "
                f"{quote.currency or 'USD'} {item.line_total}"
            )
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


def client_quote_state(quote: SalesQuote) -> str:
    """What the customer can do with the quote: answer it, or read how it ended (13d §3.5)."""
    if quote.status in LOCKED_QUOTE_STATUSES:
        return "replaced" if quote.status == "superseded" else "accepted"
    if quote.status in {"accepted", "declined"}:
        return quote.status
    if quote_is_past_expiry(quote) or quote.status == "expired":
        return "expired"
    return "open" if quote.status in CLIENT_QUOTE_RESPONDABLE_STATUSES else "pending"


def serialize_client_quote(db: Session, quote: SalesQuote) -> dict:
    state = client_quote_state(quote)
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
        "state": state,
        "can_respond": state == "open",
        "accepted_by_name": quote.accepted_by_name if state == "accepted" else None,
        "accepted_at": quote.accepted_at if state == "accepted" else None,
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
            # A draft is the team's work in progress; the client sees a quote once it is sent.
            SalesQuote.status != "draft",
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
            # A draft is the team's work in progress; the client sees a quote once it is sent.
            SalesQuote.status != "draft",
            or_(*_client_quote_conditions(contact_id=contact_id, organization_id=organization_id)),
        )
        .first()
    )
    if not quote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found.")
    return quote



def create_sales_quote(db: Session, payload: dict, current_user, replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False) -> SalesQuote:
    ensure_single_duplicate_action(replace_duplicates=replace_duplicates, skip_duplicates=skip_duplicates, create_new_records=create_new_records)
    data = dict(payload)
    item_payloads = data.pop("items", None)
    explicit_assigned_to = "assigned_to" in data and data.get("assigned_to") is not None
    custom_data = validate_custom_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_quotes", payload=data.pop("custom_fields", None))
    _customer_name_from_account(db, data, tenant_id=current_user.tenant_id)
    data = _normalize_quote_payload(data)
    _apply_dates(db, data, tenant_id=current_user.tenant_id)
    data["tax_mode"] = tax_rates.normalize_tax_mode(data.get("tax_mode"), default=tax_rates.default_tax_mode(db, tenant_id=current_user.tenant_id))
    _apply_default_texts(db, data, tenant_id=current_user.tenant_id, kind="quote")
    normalize_document_fields(db, data, tenant_id=current_user.tenant_id, module_key="sales_quotes")
    normalized_items, item_totals = _items_for(db, data, item_payloads, tenant_id=current_user.tenant_id)
    if item_totals is not None:
        data.update(item_totals)
    data["custom_data"] = custom_data
    if not data.get("quote_number"):
        data["quote_number"] = _generate_quote_number(db, tenant_id=current_user.tenant_id)
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id if current_user else None
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=current_user.tenant_id)
    _ensure_linked_records(db, data, tenant_id=current_user.tenant_id)
    fill_addresses_from_account(db, data, tenant_id=current_user.tenant_id)
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
            if normalized_items is not None:
                existing.items = normalized_items
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
    if normalized_items is not None:
        quote.items = normalized_items
    _refresh_total(quote)
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
    if quote.status in LOCKED_QUOTE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"This quote is {quote.status} and can no longer change; revise it to make a new version")
    if data.get("status") == "accepted" and quote.status != "accepted":
        expiry = data.get("expiry_date", quote.expiry_date)
        if quote.status == "expired" or (expiry and str(expiry) < _today().isoformat()):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An expired quote cannot be accepted; revise it first")
    item_payloads = data.pop("items", None)
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(db, tenant_id=quote.tenant_id, module_key="sales_quotes", payload=data.pop("custom_fields"), existing=load_custom_field_values_with_fallback(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record_id=quote.quote_id, fallback=quote.custom_data))
        data["custom_data"] = custom_data_to_save
    data = _normalize_quote_payload(data, partial=True)
    _apply_dates(db, data, tenant_id=quote.tenant_id, quote=quote)
    if "tax_mode" in data:
        data["tax_mode"] = tax_rates.normalize_tax_mode(data["tax_mode"], default=quote.tax_mode)
    normalize_document_fields(db, data, tenant_id=quote.tenant_id, module_key="sales_quotes", existing=quote)
    normalized_items, item_totals = _items_for(db, data, item_payloads, tenant_id=quote.tenant_id, quote=quote)
    if item_totals is not None:
        data.update(item_totals)
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=quote.tenant_id)
    _ensure_linked_records(db, data, tenant_id=quote.tenant_id)
    fill_addresses_from_account(db, data, tenant_id=quote.tenant_id, existing=quote)
    if data.get("quote_number") and quotes_repository.quote_number_exists(db, tenant_id=quote.tenant_id, quote_number=data["quote_number"], exclude_quote_id=quote.quote_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Another quote already uses this number")
    _apply_quote_payload(quote, data)
    if normalized_items is not None:
        quote.items = normalized_items
    _refresh_total(quote)
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
    resolved_recipient = recipient_email or proposal.sent_to
    ip_hash = _hash_value(ip_address)
    user_agent_hash = _hash_value(user_agent)
    replay_query = db.query(SalesQuoteOpenEvent).filter(
        SalesQuoteOpenEvent.tenant_id == proposal.tenant_id,
        SalesQuoteOpenEvent.quote_id == proposal.quote_id,
        SalesQuoteOpenEvent.quote_document_id == proposal.id,
        SalesQuoteOpenEvent.event_type == event_type,
        SalesQuoteOpenEvent.occurred_at >= utc_now() - PUBLIC_PROPOSAL_EVENT_DEDUPE_WINDOW,
    )
    replay_query = replay_query.filter(
        SalesQuoteOpenEvent.recipient_email == resolved_recipient
        if resolved_recipient
        else SalesQuoteOpenEvent.recipient_email.is_(None),
        SalesQuoteOpenEvent.ip_hash == ip_hash
        if ip_hash
        else SalesQuoteOpenEvent.ip_hash.is_(None),
        SalesQuoteOpenEvent.user_agent_hash == user_agent_hash
        if user_agent_hash
        else SalesQuoteOpenEvent.user_agent_hash.is_(None),
    )
    replay = replay_query.order_by(SalesQuoteOpenEvent.occurred_at.desc(), SalesQuoteOpenEvent.id.desc()).first()
    if replay:
        return replay
    event = SalesQuoteOpenEvent(
        tenant_id=proposal.tenant_id,
        quote_id=proposal.quote_id,
        quote_document_id=proposal.id,
        event_type=event_type,
        recipient_email=resolved_recipient,
        ip_hash=ip_hash,
        user_agent_hash=user_agent_hash,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def import_quotes_from_csv(db: Session, file_bytes: bytes, *, tenant_id: int, default_assigned_to: int | None, duplicate_mode: str | None = None, default_duplicate_mode: str | None = None, replace_duplicates: bool = False, skip_duplicates: bool = False, create_new_records: bool = False) -> dict:
    mode = resolve_duplicate_mode(duplicate_mode=duplicate_mode, default_mode=default_duplicate_mode, replace_duplicates=replace_duplicates, skip_duplicates=skip_duplicates, create_new_records=create_new_records)
    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required={"customer_name"})
    field_rules = ImportFieldRules(db, tenant_id=tenant_id, module_key="sales_quotes")
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
        target = existing if existing and not create_new_records else None
        if not (target is not None and mode == DuplicateMode.skip):
            rule_failure = field_rules.apply(payload, existing=target, overwrite=mode == DuplicateMode.overwrite)
            if rule_failure:
                failures.append({"row_number": row_number, "record_identifier": identifier, "reason": rule_failure})
                continue
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


# Lifecycle (13d §3.5) -----------------------------------------------------------------------

def announce_status_change(db: Session, quote: SalesQuote, previous_status: str | None, *, actor=None) -> None:
    """`quote.status_changed`, from which `quote.sent`, `quote.accepted`, `quote.rejected` and
    `quote.expired` are derived, whatever changed the status: the form, *Send*, the customer's
    page, the portal or the expiry scan."""
    if previous_status == quote.status:
        return
    from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event

    safe_emit_crm_event(
        db,
        tenant_id=quote.tenant_id,
        actor_user_id=getattr(actor, "id", None),
        event_type="quote.status_changed",
        entity_type="sales_quote",
        entity_id=quote.quote_id,
        payload={
            **(actor_payload(actor) if actor is not None else {"actor_user_id": None, "actor_name": None}),
            "quote_id": quote.quote_id,
            "quote_number": quote.quote_number,
            "customer_name": quote.customer_name,
            "previous_status": previous_status,
            "status": quote.status,
            "field_changes": {"status": {"from": previous_status, "to": quote.status}},
            "total_amount": str(quote.total_amount),
            "href": f"/dashboard/sales/quotes/{quote.quote_id}",
        },
    )


def _notify_owner(db: Session, quote: SalesQuote, *, title: str, message: str) -> None:
    if not quote.assigned_to:
        return
    from app.modules.platform.services.notifications import create_notification

    create_notification(db, tenant_id=quote.tenant_id, user_id=quote.assigned_to, category="sales_quotes", title=title, message=message,
                        link_url=f"/dashboard/sales/quotes/{quote.quote_id}", commit=False)


def _respondable(quote: SalesQuote) -> None:
    if quote.status in LOCKED_QUOTE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This quote has been replaced or converted; it can no longer be answered")
    if quote_is_past_expiry(quote):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This quote has expired; ask for a new one")
    if quote.status not in CLIENT_QUOTE_RESPONDABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This quote is not open for an answer")


def _take_optional_lines(db: Session, quote: SalesQuote, item_ids) -> list[str]:
    """The optional lines the customer chose become ordinary lines, and the totals follow."""
    wanted = {int(value) for value in item_ids or []}
    optional = {item.id: item for item in quote.items if item.is_optional}
    if wanted - set(optional):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only this quote's optional items can be chosen")
    if not wanted:
        return []
    payloads = [{**_existing_item_payload(item), "is_optional": item.is_optional and item.id not in wanted, "tax_manual": True}
                for item in quote.items]
    items, totals = _normalize_quote_items(db, payloads, tenant_id=quote.tenant_id, organization_id=quote.organization_id,
                                           tax_mode=quote.tax_mode, allowed_inactive=tax_rates.used_rate_ids(quote.items))
    quote.items = items
    for field, value in totals.items():
        setattr(quote, field, value)
    _refresh_total(quote)
    return [optional[item_id].name for item_id in sorted(wanted)]


def accept_quote(db: Session, quote: SalesQuote, *, signer_name: str, signature: str | None = None, optional_item_ids=(),
                 via: str = "proposal page", client_account_id: int | None = None, signer_ip: str | None = None) -> SalesQuote:
    """The customer accepts: their name, an optional drawn signature and the optional items
    they chose are kept; the owner is told. The order is made by the owner (decision 8)."""
    _respondable(quote)
    name = " ".join(str(signer_name or "").split())[:200]
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter your name to accept")
    if signature and (not signature.startswith("data:image/png;base64,") or len(signature) > SIGNATURE_MAX_CHARS):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The signature could not be read; draw it again")
    chosen = _take_optional_lines(db, quote, optional_item_ids)
    previous = quote.status
    quote.status, quote.accepted_by_name, quote.accepted_at, quote.signature_data = "accepted", name, utc_now(), signature or None
    db.add(quote)
    db.flush()
    description = f"{name} accepted quote {quote.quote_number} on the {via}" + (f", adding {', '.join(chosen)}" if chosen else "")
    log_activity(db, tenant_id=quote.tenant_id, actor_user_id=None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id,
                 action="quote.accepted", description=description, before_state={"status": previous},
                 after_state={"status": quote.status, "accepted_by_name": name, "optional_items": chosen, "client_account_id": client_account_id,
                              "ip_hash": _hash_value(signer_ip)},
                 commit=False)
    _notify_owner(db, quote, title=f"Quote {quote.quote_number} accepted", message=description)
    announce_status_change(db, quote, previous)
    return quote


def decline_quote(db: Session, quote: SalesQuote, *, reason: str | None = None, note: str | None = None, via: str = "proposal page",
                  client_account_id: int | None = None, signer_ip: str | None = None) -> SalesQuote:
    """The customer declines, with a reason from the `lost_reason` picklist and a note."""
    _respondable(quote)
    if reason:
        from app.modules.platform.services.picklists import PicklistResolver

        reason = PicklistResolver(db, quote.tenant_id).resolve("lost_reason", reason, current=quote.lost_reason, field_key="lost_reason",
                                                                field_label="Reason")
    previous = quote.status
    quote.status, quote.lost_reason = "declined", reason or quote.lost_reason
    quote.decline_note = (note or "").strip()[:2000] or None
    db.add(quote)
    db.flush()
    description = f"The customer declined quote {quote.quote_number} on the {via}" + (f": {quote.decline_note}" if quote.decline_note else "")
    log_activity(db, tenant_id=quote.tenant_id, actor_user_id=None, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id,
                 action="quote.declined", description=description, before_state={"status": previous},
                 after_state={"status": quote.status, "lost_reason": quote.lost_reason, "client_account_id": client_account_id,
                              "ip_hash": _hash_value(signer_ip)}, commit=False)
    _notify_owner(db, quote, title=f"Quote {quote.quote_number} declined", message=description)
    announce_status_change(db, quote, previous)
    return quote


def revise_quote(db: Session, quote: SalesQuote, current_user) -> SalesQuote:
    """*Revise*: a new draft with the same number and the next `-R` suffix; the old one is
    superseded and stays readable (decision 7)."""
    if quote.status not in REVISABLE_QUOTE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a sent, expired or declined quote can be revised")
    base = re.sub(r"-R\d+$", "", quote.quote_number)
    revision = (quote.revision or 1) + 1
    copied = {column: getattr(quote, column) for column in (
        "title", "customer_name", "contact_id", "organization_id", "opportunity_id", "currency", "tax_mode", "notes", "customer_po_reference",
        "terms_and_conditions", "shipping_method", "shipping_charge", "assigned_to", "custom_data",
        *(f"{prefix}_{part}" for prefix in ("billing", "shipping") for part in ("address", "street2", "city", "state", "postal_code", "country")),
    )}
    new = SalesQuote(tenant_id=quote.tenant_id, quote_number=f"{base}-R{revision}", revision=revision, revised_from_id=quote.quote_id,
                     status="draft", **copied)
    dates = {}
    _apply_dates(db, dates, tenant_id=quote.tenant_id)
    new.issue_date, new.expiry_date = dates["issue_date"], dates["expiry_date"]
    items, totals = _normalize_quote_items(db, [_existing_item_payload(item) for item in quote.items], tenant_id=quote.tenant_id,
                                           organization_id=quote.organization_id, tax_mode=quote.tax_mode,
                                           allowed_inactive=tax_rates.used_rate_ids(quote.items))
    new.items = items
    for field, value in totals.items():
        setattr(new, field, value)
    _refresh_total(new)
    previous = quote.status
    quote.status = "superseded"
    db.add_all([new, quote])
    db.flush()
    save_custom_field_values(db, tenant_id=quote.tenant_id, module_key="sales_quotes", record_id=new.quote_id, values=quote.custom_data or {})
    actor_id = getattr(current_user, "id", None)
    log_activity(db, tenant_id=quote.tenant_id, actor_user_id=actor_id, module_key="sales_quotes", entity_type="sales_quote", entity_id=quote.quote_id,
                 action="quote.revised", description=f"Revised as {new.quote_number}", after_state={"revision_id": new.quote_id}, commit=False)
    log_activity(db, tenant_id=quote.tenant_id, actor_user_id=actor_id, module_key="sales_quotes", entity_type="sales_quote", entity_id=new.quote_id,
                 action="create", description=f"Revision {revision} of {quote.quote_number}", commit=False)
    announce_status_change(db, quote, previous, actor=current_user)
    return new


def mark_converted(db: Session, quote: SalesQuote, *, actor=None) -> None:
    """A quote made into an order is locked (H14)."""
    previous = quote.status
    quote.status = "converted"
    db.add(quote)
    db.flush()
    announce_status_change(db, quote, previous, actor=actor)


def scan_expired_quotes(db: Session, *, today=None) -> int:
    """The daily scan (A7): a draft or sent quote past its expiry date becomes *Expired*, once."""
    today = today or _today()
    quotes = db.query(SalesQuote).filter(SalesQuote.deleted_at.is_(None), SalesQuote.status.in_(["draft", "sent"]),
                                         SalesQuote.expiry_date.isnot(None), SalesQuote.expiry_date < today).all()
    for quote in quotes:
        previous = quote.status
        quote.status = "expired"
        db.add(quote)
        db.flush()
        log_activity(db, tenant_id=quote.tenant_id, actor_user_id=None, module_key="sales_quotes", entity_type="sales_quote",
                     entity_id=quote.quote_id, action="quote.expired", description=f"Quote {quote.quote_number} expired on {quote.expiry_date.isoformat()}",
                     before_state={"status": previous}, after_state={"status": "expired"}, commit=False)
        announce_status_change(db, quote, previous)
    db.commit()
    return len(quotes)


def public_proposal_view(db: Session, proposal: SalesQuoteDocument, quote: SalesQuote) -> dict:
    """What the customer's quote page shows (H7): the branded document, its optional items,
    and whether it can still be answered. No internal status, owner or notes."""
    from types import SimpleNamespace

    from app.core.document_pdf import render_html
    from app.modules.platform.services.document_pdfs import build_context
    from app.modules.platform.services.picklists import PicklistResolver

    _kind, _record, context = build_context(db, SimpleNamespace(id=None, tenant_id=quote.tenant_id), "sales_quotes", quote.quote_id, as_issued=True)
    if quote.status in LOCKED_QUOTE_STATUSES:
        state = "replaced" if quote.status == "superseded" else "accepted"
    elif quote.status in {"accepted", "declined"}:
        state = quote.status
    elif quote_is_past_expiry(quote):
        state = "expired"
    else:
        state = "open"
    reasons = []
    if state == "open":
        from app.modules.platform.models import PicklistValue

        picklist = PicklistResolver(db, quote.tenant_id).picklist("lost_reason")
        reasons = [{"key": value.key, "label": value.label} for value in db.query(PicklistValue).filter(
            PicklistValue.picklist_id == picklist.id, PicklistValue.is_active.is_(True)).order_by(PicklistValue.sort_order)]
    return {
        "quote_number": quote.quote_number,
        "title": quote.title,
        "company_name": context["company"]["name"],
        "brand_color": context["company"]["brand_color"],
        "customer_name": quote.customer_name,
        "currency": quote.currency,
        "total_amount": quote.total_amount,
        "expiry_date": quote.expiry_date,
        "state": state,
        "can_respond": state == "open",
        "accepted_by_name": quote.accepted_by_name if state == "accepted" else None,
        "accepted_at": quote.accepted_at if state == "accepted" else None,
        "html": render_html("document.html", context),
        "optional_items": [
            {"id": item.id, "name": item.name, "description": item.description, "quantity": item.quantity, "unit": item.unit,
             "line_total": item.line_total}
            for item in quote.items if item.is_optional and item.line_type == "item"
        ] if state == "open" else [],
        "decline_reasons": reasons,
    }
