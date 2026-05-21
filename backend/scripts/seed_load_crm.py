"""Seed large deterministic CRM datasets for backend performance checks.

Run from the backend container:

    LOAD_CRM_SEED_ALLOW=1 python -m scripts.seed_load_crm --tenants 3 --contacts-per-tenant 100000

The script is additive by default. Use --reset-load-tenants to delete tenants
with the load-test slug prefix before recreating them. Set
LOAD_CRM_SEED_PASSWORD to control the load admin password; otherwise the script
generates one and prints it once.
"""

from __future__ import annotations

import argparse
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.passwords import hash_password
from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.finance.models import FinanceIO, FinancePosInvoice, FinancePosInvoiceLine
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.user_management.models import Module, Role, RoleModulePermission, Tenant, TenantDomain, User, UserStatus


LOAD_TENANT_PREFIX = "load-crm"
LOAD_SEED_ALLOW_ENV = "LOAD_CRM_SEED_ALLOW"
LOAD_SEED_PASSWORD_ENV = "LOAD_CRM_SEED_PASSWORD"
MODULE_KEYS = (
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
    "finance_io",
    "finance_pos",
    "tasks",
    "calendar",
    "catalog_products",
    "catalog_services",
)
MODULE_ROUTES = {
    "sales_contacts": "/dashboard/sales/contacts",
    "sales_organizations": "/dashboard/sales/organizations",
    "sales_opportunities": "/dashboard/sales/opportunities",
    "finance_io": "/dashboard/finance/insertion-orders",
    "finance_pos": "/dashboard/finance/pos",
    "tasks": "/dashboard/tasks",
    "calendar": "/dashboard/calendar",
    "catalog_products": "/dashboard/catalog/products",
    "catalog_services": "/dashboard/catalog/services",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _chunks(items, size: int):
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _ensure_module(db: Session, key: str) -> Module:
    module = db.query(Module).filter(Module.name == key).first()
    if module:
        return module
    module = Module(name=key, base_route=MODULE_ROUTES[key], description=f"Load test {key}", is_enabled=1)
    db.add(module)
    db.flush()
    return module


def _create_tenant(db: Session, index: int, *, password: str) -> tuple[Tenant, User]:
    slug = f"{LOAD_TENANT_PREFIX}-{index}"
    existing = db.query(Tenant).filter(Tenant.slug == slug).first()
    if existing:
        user = db.query(User).filter(User.tenant_id == existing.id).order_by(User.id.asc()).first()
        if user:
            user.password_hash = hash_password(password)
            db.flush()
            return existing, user

    tenant = existing or Tenant(name=f"Load CRM {index}", slug=slug, is_active=1)
    db.add(tenant)
    db.flush()
    if not existing:
        db.add(TenantDomain(tenant_id=tenant.id, hostname=f"{slug}.lynk.local", is_primary=1))

    role = Role(tenant_id=tenant.id, name="Load Admin", description="Load test admin", level=100)
    db.add(role)
    db.flush()
    for module_key in MODULE_KEYS:
        module = _ensure_module(db, module_key)
        db.add(
            RoleModulePermission(
                role_id=role.id,
                module_id=module.id,
                can_view=1,
                can_create=1,
                can_edit=1,
                can_delete=1,
                can_restore=1,
                can_export=1,
                can_configure=1,
            )
        )
    user = User(
        tenant_id=tenant.id,
        email=f"load-admin-{index}@lynk.local",
        password_hash=hash_password(password),
        first_name="Load",
        last_name=f"Admin {index}",
        role_id=role.id,
        is_active=UserStatus.active,
    )
    db.add(user)
    db.flush()
    return tenant, user


def _seed_organizations(db: Session, *, tenant: Tenant, user: User, count: int, batch_size: int) -> None:
    start = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == tenant.id).count()
    rows = (
        SalesOrganization(
            tenant_id=tenant.id,
            org_name=f"Load Account {tenant.id}-{index}",
            primary_email=f"account-{tenant.id}-{index}@load.local",
            website=f"https://account-{tenant.id}-{index}.load.local",
            industry="Load Test",
            billing_country="US",
            assigned_to=user.id,
        )
        for index in range(start + 1, count + 1)
    )
    for batch in _chunks(rows, batch_size):
        db.bulk_save_objects(batch)
        db.commit()


def _seed_contacts(db: Session, *, tenant: Tenant, user: User, count: int, batch_size: int) -> None:
    start = db.query(SalesContact).filter(SalesContact.tenant_id == tenant.id).count()
    rows = (
        SalesContact(
            tenant_id=tenant.id,
            first_name="Load",
            last_name=f"Contact {index}",
            primary_email=f"contact-{tenant.id}-{index}@load.local",
            contact_telephone=f"+1555{index:07d}"[:20],
            country="US",
            assigned_to=user.id,
        )
        for index in range(start + 1, count + 1)
    )
    for batch in _chunks(rows, batch_size):
        db.bulk_save_objects(batch)
        db.commit()


def _seed_opportunities(db: Session, *, tenant: Tenant, user: User, count: int, batch_size: int) -> None:
    start = db.query(SalesOpportunity).filter(SalesOpportunity.tenant_id == tenant.id).count()
    rows = (
        SalesOpportunity(
            tenant_id=tenant.id,
            opportunity_name=f"Load Deal {tenant.id}-{index}",
            client=f"Load Account {tenant.id}-{index}",
            sales_stage=["lead", "qualified", "proposal", "closed_won"][index % 4],
            total_cost_of_project=str(index % 10000),
            currency_type="USD",
            assigned_to=user.id,
        )
        for index in range(start + 1, count + 1)
    )
    for batch in _chunks(rows, batch_size):
        db.bulk_save_objects(batch)
        db.commit()


def _seed_finance(db: Session, *, tenant: Tenant, user: User, io_count: int, invoice_count: int, batch_size: int) -> None:
    finance_io_module = _ensure_module(db, "finance_io")
    io_start = db.query(FinanceIO).filter(FinanceIO.tenant_id == tenant.id).count()
    io_rows = (
        FinanceIO(
            tenant_id=tenant.id,
            module_id=finance_io_module.id,
            user_id=user.id,
            io_number=f"LOAD-IO-{tenant.id}-{index}",
            file_name=f"load-io-{index}.manual",
            customer_name=f"Load Customer {index}",
            status="draft",
            currency="USD",
            total_amount=Decimal(index % 5000),
        )
        for index in range(io_start + 1, io_count + 1)
    )
    for batch in _chunks(io_rows, batch_size):
        db.bulk_save_objects(batch)
        db.commit()

    invoice_start = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == tenant.id).count()
    for batch_indexes in _chunks(range(invoice_start + 1, invoice_count + 1), batch_size):
        invoices = []
        lines = []
        for index in batch_indexes:
            invoice = FinancePosInvoice(
                tenant_id=tenant.id,
                user_id=user.id,
                invoice_number=f"LOAD-POS-{tenant.id}-{index}",
                status="issued",
                payment_status="unpaid",
                customer_name=f"Load Customer {index}",
                currency="USD",
                subtotal_amount=Decimal("10.00"),
                discount_amount=Decimal("0.00"),
                tax_rate=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("10.00"),
                amount_paid=Decimal("0.00"),
            )
            invoices.append(invoice)
        db.add_all(invoices)
        db.flush()
        for invoice in invoices:
            lines.append(
                FinancePosInvoiceLine(
                    invoice_id=invoice.id,
                    description="Load item",
                    quantity=Decimal("1"),
                    unit_price=Decimal("10.00"),
                    line_total=Decimal("10.00"),
                    sort_order=0,
                )
            )
        db.bulk_save_objects(lines)
        db.commit()


def _seed_tasks_calendar(db: Session, *, tenant: Tenant, user: User, task_count: int, calendar_count: int, batch_size: int) -> None:
    task_start = db.query(Task).filter(Task.tenant_id == tenant.id).count()
    for batch_indexes in _chunks(range(task_start + 1, task_count + 1), batch_size):
        tasks = [
            Task(
                tenant_id=tenant.id,
                title=f"Load Task {tenant.id}-{index}",
                status="todo",
                priority="medium",
                created_by_user_id=user.id,
                assigned_by_user_id=user.id,
                due_at=_now() + timedelta(days=index % 30),
            )
            for index in batch_indexes
        ]
        db.add_all(tasks)
        db.flush()
        db.bulk_save_objects(
            [
                TaskAssignee(
                    tenant_id=tenant.id,
                    task_id=task.id,
                    assignee_type="user",
                    assignee_key=f"user:{user.id}",
                    user_id=user.id,
                )
                for task in tasks
            ]
        )
        db.commit()

    event_start = db.query(CalendarEvent).filter(CalendarEvent.tenant_id == tenant.id).count()
    for batch_indexes in _chunks(range(event_start + 1, calendar_count + 1), batch_size):
        events = [
            CalendarEvent(
                tenant_id=tenant.id,
                owner_user_id=user.id,
                title=f"Load Event {tenant.id}-{index}",
                start_at=_now() + timedelta(hours=index),
                end_at=_now() + timedelta(hours=index + 1),
                status="confirmed",
            )
            for index in batch_indexes
        ]
        db.add_all(events)
        db.flush()
        db.bulk_save_objects(
            [
                CalendarEventParticipant(
                    tenant_id=tenant.id,
                    event_id=event.id,
                    participant_type="user",
                    participant_key=f"user:{user.id}",
                    user_id=user.id,
                    response_status="accepted",
                    is_owner=True,
                )
                for event in events
            ]
        )
        db.commit()


def _seed_catalog(db: Session, *, tenant: Tenant, product_count: int, service_count: int, batch_size: int) -> None:
    product_start = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant.id).count()
    products = (
        CatalogProduct(
            tenant_id=tenant.id,
            slug=f"load-product-{tenant.id}-{index}",
            sku=f"LOAD-SKU-{tenant.id}-{index}",
            name=f"Load Product {index}",
            description="Load test product",
            currency="USD",
            public_unit_price=Decimal(index % 1000),
            stock_status="in_stock",
            stock_quantity=Decimal("100"),
            is_public=1,
            is_active=1,
        )
        for index in range(product_start + 1, product_count + 1)
    )
    for batch in _chunks(products, batch_size):
        db.bulk_save_objects(batch)
        db.commit()

    service_start = db.query(CatalogService).filter(CatalogService.tenant_id == tenant.id).count()
    services = (
        CatalogService(
            tenant_id=tenant.id,
            slug=f"load-service-{tenant.id}-{index}",
            name=f"Load Service {index}",
            description="Load test service",
            currency="USD",
            public_unit_price=Decimal(index % 1000),
            is_public=1,
            is_active=1,
        )
        for index in range(service_start + 1, service_count + 1)
    )
    for batch in _chunks(services, batch_size):
        db.bulk_save_objects(batch)
        db.commit()


def _reset_load_tenants(db: Session, *, confirm_prefix: str | None) -> None:
    if confirm_prefix != LOAD_TENANT_PREFIX:
        raise SystemExit(f"--reset-load-tenants requires --confirm-reset-load-tenants {LOAD_TENANT_PREFIX}")
    tenant_ids = [row[0] for row in db.query(Tenant.id).filter(Tenant.slug.like(f"{LOAD_TENANT_PREFIX}-%")).all()]
    if not tenant_ids:
        return
    db.execute(delete(Tenant).where(Tenant.id.in_(tenant_ids)))
    db.commit()


def seed(args: argparse.Namespace) -> None:
    if os.getenv(LOAD_SEED_ALLOW_ENV) != "1":
        raise SystemExit(f"Refusing to seed load data unless {LOAD_SEED_ALLOW_ENV}=1 is set.")

    password = os.getenv(LOAD_SEED_PASSWORD_ENV)
    generated_password = False
    if not password:
        password = secrets.token_urlsafe(24)
        generated_password = True

    db = SessionLocal()
    try:
        if args.reset_load_tenants:
            _reset_load_tenants(db, confirm_prefix=args.confirm_reset_load_tenants)
        for tenant_index in range(1, args.tenants + 1):
            tenant, user = _create_tenant(db, tenant_index, password=password)
            db.commit()
            _seed_organizations(db, tenant=tenant, user=user, count=args.organizations_per_tenant, batch_size=args.batch_size)
            _seed_contacts(db, tenant=tenant, user=user, count=args.contacts_per_tenant, batch_size=args.batch_size)
            _seed_opportunities(db, tenant=tenant, user=user, count=args.opportunities_per_tenant, batch_size=args.batch_size)
            _seed_finance(
                db,
                tenant=tenant,
                user=user,
                io_count=args.insertion_orders_per_tenant,
                invoice_count=args.invoices_per_tenant,
                batch_size=args.batch_size,
            )
            _seed_tasks_calendar(
                db,
                tenant=tenant,
                user=user,
                task_count=args.tasks_per_tenant,
                calendar_count=args.calendar_events_per_tenant,
                batch_size=args.batch_size,
            )
            _seed_catalog(
                db,
                tenant=tenant,
                product_count=args.products_per_tenant,
                service_count=args.services_per_tenant,
                batch_size=args.batch_size,
            )
            print(f"seeded tenant={tenant.slug}")
        if generated_password:
            print(f"generated load admin password: {password}")
    finally:
        db.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed deterministic CRM load-test records.")
    parser.add_argument("--tenants", type=int, default=1)
    parser.add_argument("--contacts-per-tenant", type=int, default=0)
    parser.add_argument("--organizations-per-tenant", type=int, default=0)
    parser.add_argument("--opportunities-per-tenant", type=int, default=0)
    parser.add_argument("--invoices-per-tenant", type=int, default=0)
    parser.add_argument("--insertion-orders-per-tenant", type=int, default=0)
    parser.add_argument("--tasks-per-tenant", type=int, default=0)
    parser.add_argument("--calendar-events-per-tenant", type=int, default=0)
    parser.add_argument("--products-per-tenant", type=int, default=0)
    parser.add_argument("--services-per-tenant", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--reset-load-tenants", action="store_true")
    parser.add_argument("--confirm-reset-load-tenants", default=None)
    return parser.parse_args()


if __name__ == "__main__":
    seed(parse_args())
