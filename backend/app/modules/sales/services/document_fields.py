"""What quotes and orders carry beyond their lines (13b §3.5, 13a C3).

Billing and shipping addresses are snapshots: copied from the account when it is chosen,
editable on the document, and copied onward (quote → order → invoice). A customer PO
reference, terms, a shipping method and a shipping charge travel the same way. The shipping
charge is part of the document's total and reaches the order's first invoice as a line
(13b §5 decision 8).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.platform.services.picklists import PicklistResolver
from app.modules.sales.models import SalesOrganization

ADDRESS_PARTS = ("address", "street2", "city", "state", "postal_code", "country")
ADDRESS_FIELDS = tuple(f"{prefix}_{part}" for prefix in ("billing", "shipping") for part in ADDRESS_PARTS)
TEXT_FIELDS = (*ADDRESS_FIELDS, "customer_po_reference", "terms_and_conditions")
CARRIED_FIELDS = (*TEXT_FIELDS, "shipping_method", "shipping_charge")


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_document_fields(db: Session, data: dict, *, tenant_id: int, module_key: str, existing=None) -> dict:
    """Trims the text fields, checks the shipping charge, and turns picklist and country
    values into keys, in place."""
    for field in TEXT_FIELDS:
        if field in data:
            data[field] = _clean(data[field])
    if "shipping_charge" in data:
        raw = data["shipping_charge"]
        try:
            charge = Decimal(str(raw if raw not in (None, "") else 0))
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=[{"loc": ["body", "shipping_charge"], "msg": "Enter the shipping charge as a number.", "type": "domain"}],
            ) from exc
        if charge < 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=[{"loc": ["body", "shipping_charge"], "msg": "The shipping charge cannot be negative.", "type": "domain"}],
            )
        data["shipping_charge"] = charge.quantize(Decimal("0.01"))
    PicklistResolver(db, tenant_id).normalize(module_key, data, existing=existing)
    return data


def fill_addresses_from_account(db: Session, data: dict, *, tenant_id: int, existing=None) -> dict:
    """Copies the account's addresses onto a document that has none of its own: on create,
    or when the account changes. An address the operator typed is never overwritten."""
    organization_id = data.get("organization_id")
    if organization_id is None or (existing is not None and organization_id == existing.organization_id):
        return data
    account = (
        db.query(SalesOrganization)
        .filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id)
        .first()
    )
    if account is None:
        return data
    for prefix in ("billing", "shipping"):
        typed = any(_clean(data.get(f"{prefix}_{part}")) for part in ADDRESS_PARTS)
        if typed:
            continue
        # An account with no shipping address ships to where it is billed.
        source = prefix if prefix == "billing" or any(getattr(account, f"shipping_{part}") for part in ADDRESS_PARTS) else "billing"
        for part in ADDRESS_PARTS:
            data[f"{prefix}_{part}"] = getattr(account, f"{source}_{part}")
    return data


def carried_fields(source) -> dict:
    """A document's header fields, for the document made from it (quote → order)."""
    return {field: getattr(source, field, None) for field in CARRIED_FIELDS if getattr(source, field, None) is not None}


def format_address(record, prefix: str, *, country_label=None) -> str | None:
    """An address as lines, for an invoice's free-text address and printouts."""
    street = [getattr(record, f"{prefix}_address", None), getattr(record, f"{prefix}_street2", None)]
    city_line = " ".join(
        part for part in (getattr(record, f"{prefix}_city", None), getattr(record, f"{prefix}_state", None), getattr(record, f"{prefix}_postal_code", None))
        if part
    )
    country = getattr(record, f"{prefix}_country", None)
    if country and country_label is not None:
        country = country_label(country)
    lines = [line for line in (*street, city_line, country) if line]
    return "\n".join(lines) or None
