"""Seed a couple of sample records for the modules the demo seed does not cover.

`seed_demo_crm.py` populates organizations, contacts, opportunities, catalog, finance
and tasks, but leaves leads, quotes, orders, contracts and support cases empty. That is
fine for a demo walkthrough, but it means every `[id]` detail route for those modules is
unreachable — so UI audits and browser tests silently skip them.

This adds the minimum needed to make those routes reachable. It is additive and
idempotent: records are keyed by their reference number, so re-running changes nothing.

    docker compose exec -T backend python -m scripts.seed_module_samples --tenant-slug default
"""

from __future__ import annotations

import argparse
import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.database import SessionLocal

# Contract carries a foreign key to documents; the model must be registered on the
# shared metadata before any mapper is configured, even though nothing here uses it.
from app.modules.documents import models as _documents_models  # noqa: F401
from app.modules.contracts.models import Contract
from app.modules.sales.models import SalesLead, SalesOrder, SalesQuote, SalesQuoteDocument
from app.modules.support.models import SupportCase
from app.modules.user_management.models import Tenant, User

SAMPLE_COUNT = 3


def get_or_create(db: Session, model, defaults: dict | None = None, **filters):
    obj = db.query(model).filter_by(**filters).one_or_none()
    if obj:
        return obj, False
    payload = dict(filters)
    if defaults:
        payload.update(defaults)
    obj = model(**payload)
    db.add(obj)
    db.flush()
    return obj, True


def seed(db: Session, tenant: Tenant, owner: User) -> dict[str, int]:
    created: dict[str, int] = {}

    def bump(key: str, made: bool) -> None:
        created[key] = created.get(key, 0) + (1 if made else 0)

    for i in range(1, SAMPLE_COUNT + 1):
        _, made = get_or_create(
            db,
            SalesLead,
            tenant_id=tenant.id,
            primary_email=f"sample.lead{i}@sample.lynk.dev",
            defaults={
                "first_name": "Sample",
                "last_name": f"Lead {i}",
                "company": f"Sample Prospect {i}",
                "status": ["new", "contacted", "qualified"][i % 3],
                "assigned_to": owner.id,
            },
        )
        bump("sales_leads", made)

        quote, made = get_or_create(
            db,
            SalesQuote,
            tenant_id=tenant.id,
            quote_number=f"SAMPLE-QT-{i:04d}",
            defaults={
                "customer_name": f"Sample Customer {i}",
                "status": ["draft", "sent", "accepted"][i % 3],
                "currency": "USD",
                "subtotal_amount": Decimal("1000.00"),
                "total_amount": Decimal("1100.00"),
                "tax_amount": Decimal("100.00"),
                "title": f"Sample Quote {i}",
                "assigned_to": owner.id,
            },
        )
        bump("sales_quotes", made)

        # A shareable proposal, so /public/quotes/proposal/[token] is reachable.
        # The service hashes the raw token with plain sha256, so the usable link is
        #   /public/quotes/proposal/sample-proposal-<tenant>-<n>
        raw_token = f"sample-proposal-{tenant.id}-{i}"
        _, made = get_or_create(
            db,
            SalesQuoteDocument,
            tenant_id=tenant.id,
            quote_id=quote.quote_id,
            defaults={
                "title": f"Proposal for Sample Customer {i}",
                "content_text": (
                    "This sample proposal exists so the public proposal route can be "
                    "opened in tests and design audits."
                ),
                "status": "sent",
                "public_token_hash": hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                "public_expires_at": datetime.now(timezone.utc) + timedelta(days=3650),
                "created_by_id": owner.id,
            },
        )
        bump("sales_quote_documents", made)

        _, made = get_or_create(
            db,
            SalesOrder,
            tenant_id=tenant.id,
            order_number=f"SAMPLE-SO-{i:04d}",
            defaults={
                "status": ["draft", "confirmed", "fulfilled"][i % 3],
                "currency": "USD",
                "subtotal": Decimal("1000.00"),
                "grand_total": Decimal("1100.00"),
                "tax_total": Decimal("100.00"),
                "owner_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("sales_orders", made)

        _, made = get_or_create(
            db,
            Contract,
            tenant_id=tenant.id,
            contract_number=f"SAMPLE-CT-{i:04d}",
            defaults={
                "title": f"Sample Service Agreement {i}",
                "status": ["draft", "review", "sent"][i % 3],
                "owner_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("contracts", made)

        _, made = get_or_create(
            db,
            SupportCase,
            tenant_id=tenant.id,
            case_number=f"SAMPLE-CASE-{i:04d}",
            defaults={
                "subject": f"Sample support request {i}",
                "status": ["new", "open", "resolved"][i % 3],
                "priority": ["low", "medium", "high"][i % 3],
                "description": f"Sample case body {i}.",
                "assigned_to_id": owner.id,
                "created_by_id": owner.id,
            },
        )
        bump("support_cases", made)

    return created


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-slug", default="default", help="Slug of the tenant to seed.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter_by(slug=args.tenant_slug).one_or_none()
        if not tenant:
            raise SystemExit(f"No tenant with slug '{args.tenant_slug}'.")

        owner = db.query(User).filter_by(tenant_id=tenant.id).order_by(User.id.asc()).first()
        if not owner:
            raise SystemExit(f"Tenant '{args.tenant_slug}' has no users to own the records.")

        created = seed(db, tenant, owner)
        db.commit()

        print(f"Sample records for {tenant.name} ({tenant.slug}):")
        for table, count in sorted(created.items()):
            print(f"  {table:20} +{count}")
        print("Re-running is a no-op; records are keyed by reference number.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
