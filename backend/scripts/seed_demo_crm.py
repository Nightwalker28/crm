"""
Seed full linked CRM demo data.

Run from backend folder:

    python -m scripts.seed_demo_crm

Reset only the demo tenant and recreate:

    python -m scripts.seed_demo_crm --reset-demo

This script is intentionally deterministic and does not require Faker or extra packages.
"""

from __future__ import annotations

import argparse
import hashlib
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.database import SessionLocal

# User / platform models
from app.modules.user_management.models import (
    CompanyProfile,
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    Tenant,
    TenantDomain,
    TenantModuleConfig,
    User,
    UserAuthMode,
    UserSavedView,
    UserStatus,
    UserTablePreference,
)

# CRM module models
from app.modules.client_portal.models import (
    ClientAccount,
    ClientPage,
    ClientPageAction,
    CustomerGroup,
)
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOrganization,
)
from app.modules.catalog.models import (
    CatalogProduct,
    CatalogService,
)
from app.modules.finance.models import (
    FinanceIO,
    FinancePosInvoice,
    FinancePosInvoiceLine,
)
from app.modules.tasks.models import (
    Task,
    TaskAssignee,
)
from app.modules.calendar.models import (
    CalendarEvent,
    CalendarEventParticipant,
    UserCalendarConnection,
)


DEMO_TENANT_SLUG = "demo-crm"
DEMO_DOMAIN = "demo.lynk.local"
NOW = datetime.now(timezone.utc)


MODULES = [
    ("catalog_products", "/dashboard/catalog/products", "Product catalog"),
    ("catalog_services", "/dashboard/catalog/services", "Service catalog"),
    ("finance_io", "/dashboard/finance/insertion-orders", "Finance insertion orders"),
    ("finance_pos", "/dashboard/finance/pos", "POS mode invoices and walk-in sales"),
    ("sales_contacts", "/dashboard/sales/contacts", "Sales contacts"),
    ("sales_organizations", "/dashboard/sales/organizations", "Sales organizations"),
    ("sales_opportunities", "/dashboard/sales/opportunities", "Sales opportunities"),
    ("tasks", "/dashboard/tasks", "Task management"),
    ("calendar", "/dashboard/calendar", "Calendar and meetings"),
    ("mail", "/dashboard/mail", "Mail module"),
    ("documents", "/dashboard/documents", "Documents module"),
    ("client_portal", "/dashboard/client-portal", "Client portal pages/accounts"),
    ("website_integrations", None, "Website integration leads/orders"),
]


ROLE_PERMISSION_PRESETS = {
    "Super Admin": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=1,
        can_restore=1,
        can_export=1,
        can_configure=1,
    ),
    "Admin": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=1,
        can_restore=1,
        can_export=1,
        can_configure=1,
    ),
    "Sales Manager": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=0,
        can_restore=0,
        can_export=1,
        can_configure=0,
    ),
    "Sales Rep": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=0,
        can_restore=0,
        can_export=0,
        can_configure=0,
    ),
    "Finance": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=0,
        can_restore=0,
        can_export=1,
        can_configure=0,
    ),
    "Support": dict(
        can_view=1,
        can_create=1,
        can_edit=1,
        can_delete=0,
        can_restore=0,
        can_export=0,
        can_configure=0,
    ),
    "Viewer": dict(
        can_view=1,
        can_create=0,
        can_edit=0,
        can_delete=0,
        can_restore=0,
        can_export=0,
        can_configure=0,
    ),
}


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")


def demo_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def get_one(db: Session, model, **filters):
    return db.query(model).filter_by(**filters).one_or_none()


def get_or_create(db: Session, model, defaults: dict | None = None, **filters):
    obj = get_one(db, model, **filters)
    if obj:
        return obj

    payload = dict(filters)
    if defaults:
        payload.update(defaults)

    obj = model(**payload)
    db.add(obj)
    db.flush()
    return obj


def reset_demo_tenant(db: Session) -> None:
    tenant = get_one(db, Tenant, slug=DEMO_TENANT_SLUG)
    if tenant:
        print(f"Deleting existing demo tenant: {tenant.name} ({tenant.id})")
        db.delete(tenant)
        db.commit()


def seed_modules(db: Session) -> dict[str, Module]:
    modules: dict[str, Module] = {}

    for name, route, description in MODULES:
        module = get_or_create(
            db,
            Module,
            name=name,
            defaults={
                "base_route": route,
                "description": description,
                "is_enabled": 1,
                "import_duplicate_mode": "skip",
            },
        )
        modules[name] = module

    db.commit()
    return modules


def seed_tenant(db: Session) -> Tenant:
    tenant = get_or_create(
        db,
        Tenant,
        slug=DEMO_TENANT_SLUG,
        defaults={
            "name": "Lynk Demo CRM",
            "is_active": 1,
        },
    )

    get_or_create(
        db,
        TenantDomain,
        hostname=DEMO_DOMAIN,
        defaults={
            "tenant_id": tenant.id,
            "is_primary": 1,
        },
    )

    db.commit()
    return tenant


def seed_roles_departments_teams(
    db: Session,
    tenant: Tenant,
    modules: dict[str, Module],
):
    roles = {}
    for idx, role_name in enumerate(ROLE_PERMISSION_PRESETS.keys(), start=1):
        roles[role_name] = get_or_create(
            db,
            Role,
            tenant_id=tenant.id,
            name=role_name,
            defaults={
                "level": idx,
                "description": f"Demo {role_name} role with linked CRM permissions.",
            },
        )

    departments = {}
    department_specs = [
        ("Leadership", "Executive and admin users"),
        ("Sales", "Sales pipeline, accounts, contacts, and deals"),
        ("Finance", "Invoices, payments, and finance operations"),
        ("Operations", "Tasks, support, client work, and delivery"),
    ]

    for name, description in department_specs:
        departments[name] = get_or_create(
            db,
            Department,
            tenant_id=tenant.id,
            name=name,
            defaults={"description": description},
        )

    teams = {}
    team_specs = [
        ("Executive Team", "Leadership"),
        ("Inbound Sales", "Sales"),
        ("Enterprise Sales", "Sales"),
        ("Finance Ops", "Finance"),
        ("Customer Success", "Operations"),
    ]

    for team_name, dept_name in team_specs:
        teams[team_name] = get_or_create(
            db,
            Team,
            tenant_id=tenant.id,
            name=team_name,
            defaults={
                "department_id": departments[dept_name].id,
                "description": f"{team_name} demo team.",
            },
        )

    # Enable every module for this tenant
    for module in modules.values():
        get_or_create(
            db,
            TenantModuleConfig,
            tenant_id=tenant.id,
            module_id=module.id,
            defaults={
                "is_enabled": 1,
                "import_duplicate_mode": "skip",
            },
        )

    # Role permissions
    for role_name, role in roles.items():
        preset = ROLE_PERMISSION_PRESETS[role_name]

        for module_key, module in modules.items():
            final_preset = dict(preset)

            # Make viewer and support more realistic
            if role_name == "Viewer":
                final_preset.update(
                    can_create=0,
                    can_edit=0,
                    can_delete=0,
                    can_restore=0,
                    can_export=0,
                    can_configure=0,
                )

            if role_name == "Support" and module_key in {
                "finance_io",
                "finance_pos",
            }:
                final_preset.update(
                    can_create=0,
                    can_edit=0,
                    can_delete=0,
                    can_export=0,
                    can_configure=0,
                )

            if role_name == "Finance" and module_key not in {
                "sales_contacts",
                "sales_organizations",
                "sales_opportunities",
                "catalog_products",
                "catalog_services",
                "finance_io",
                "finance_pos",
                "tasks",
                "calendar",
                "documents",
                "client_portal",
            }:
                final_preset.update(
                    can_create=0,
                    can_edit=0,
                    can_delete=0,
                    can_export=0,
                    can_configure=0,
                )

            perm = get_or_create(
                db,
                RoleModulePermission,
                role_id=role.id,
                module_id=module.id,
                defaults=final_preset,
            )

            for key, value in final_preset.items():
                setattr(perm, key, value)

    # Department/team module permissions
    for dept in departments.values():
        for module in modules.values():
            get_or_create(
                db,
                DepartmentModulePermission,
                department_id=dept.id,
                module_id=module.id,
            )

    for team in teams.values():
        for module in modules.values():
            get_or_create(
                db,
                TeamModulePermission,
                team_id=team.id,
                module_id=module.id,
            )

    db.commit()
    return roles, departments, teams


def seed_users(db: Session, tenant: Tenant, roles, departments, teams) -> dict[str, User]:
    user_specs = [
        ("Amaan", "Perera", "amaan.admin@demo.lynk.local", "Super Admin", "Leadership", "Executive Team", "Founder / Admin"),
        ("Nadine", "Fernando", "nadine.ops@demo.lynk.local", "Admin", "Operations", "Customer Success", "Operations Manager"),
        ("Ravi", "Silva", "ravi.sales@demo.lynk.local", "Sales Manager", "Sales", "Enterprise Sales", "Head of Sales"),
        ("Ishara", "Jayawardena", "ishara.rep@demo.lynk.local", "Sales Rep", "Sales", "Inbound Sales", "Sales Executive"),
        ("Kavindu", "Dias", "kavindu.rep@demo.lynk.local", "Sales Rep", "Sales", "Enterprise Sales", "Account Executive"),
        ("Maya", "Senanayake", "maya.finance@demo.lynk.local", "Finance", "Finance", "Finance Ops", "Finance Officer"),
        ("Tharindu", "Mendis", "tharindu.support@demo.lynk.local", "Support", "Operations", "Customer Success", "Support Specialist"),
        ("Guest", "Viewer", "viewer@demo.lynk.local", "Viewer", "Operations", "Customer Success", "Read Only User"),
    ]

    users: dict[str, User] = {}

    for first, last, email, role_name, dept_name, team_name, title in user_specs:
        user = get_or_create(
            db,
            User,
            tenant_id=tenant.id,
            email=email,
            defaults={
                "first_name": first,
                "last_name": last,
                "password_hash": "pbkdf2_sha256$310000$jxpN6x6JODqO9p/x5+fO2w==$9XTRfiiH59ucRPvvBuiHPd3eruSevFQOufBXWflQzxQ=",
                "phone_number": "+94770000000",
                "job_title": title,
                "timezone": "Asia/Colombo",
                "bio": f"{title} in the demo CRM tenant.",
                "auth_mode": UserAuthMode.manual_or_google,
                "last_login_provider": "manual",
                "is_active": UserStatus.active,
                "role_id": roles[role_name].id,
                "department_id": departments[dept_name].id,
                "team_id": teams[team_name].id,
                "photo_url": f"https://api.dicebear.com/9.x/initials/svg?seed={first}%20{last}",
            },
        )

        user.first_name = first
        user.last_name = last
        user.role_id = roles[role_name].id
        user.department_id = departments[dept_name].id
        user.team_id = teams[team_name].id
        user.is_active = UserStatus.active
        users[email] = user

    db.commit()

    # Company profile after users exist
    admin = users["amaan.admin@demo.lynk.local"]
    profile = get_or_create(
        db,
        CompanyProfile,
        tenant_id=tenant.id,
        defaults={
            "name": "Lynk Demo Pvt Ltd",
            "primary_email": "hello@demo.lynk.local",
            "website": "https://demo.lynk.local",
            "primary_phone": "+94112345678",
            "industry": "CRM / B2B Services",
            "country": "Sri Lanka",
            "operating_currencies": ["LKR", "USD"],
            "billing_address": "Level 08, Demo Business Tower, Colombo",
            "logo_url": None,
            "updated_by": admin.id,
        },
    )
    profile.updated_by = admin.id

    # Useful UI preferences/views
    for user in users.values():
        for module_key in ["sales_opportunities", "finance_pos", "tasks"]:
            get_or_create(
                db,
                UserTablePreference,
                user_id=user.id,
                module_key=module_key,
                defaults={
                    "visible_columns": [
                        "name",
                        "status",
                        "assigned_to",
                        "created_at",
                        "updated_at",
                    ],
                },
            )

        get_or_create(
            db,
            UserSavedView,
            user_id=user.id,
            module_key="sales_opportunities",
            name="My active pipeline",
            defaults={
                "config": {
                    "filters": {"deleted": False},
                    "sort": {"field": "created_time", "direction": "desc"},
                },
                "is_default": 1,
            },
        )

    db.commit()
    return users


def seed_customer_groups(db: Session, tenant: Tenant) -> dict[str, CustomerGroup]:
    specs = [
        ("standard", "Standard Clients", "Default client group", "none", None, 1),
        ("vip", "VIP Clients", "Priority clients with 10% discount", "percent", Decimal("10"), 0),
        ("enterprise", "Enterprise Clients", "Enterprise accounts with fixed discount", "fixed", Decimal("5000"), 0),
    ]

    groups = {}
    for key, name, desc, dtype, dvalue, is_default in specs:
        groups[key] = get_or_create(
            db,
            CustomerGroup,
            tenant_id=tenant.id,
            group_key=key,
            defaults={
                "name": name,
                "description": desc,
                "discount_type": dtype,
                "discount_value": dvalue,
                "is_default": is_default,
                "is_active": 1,
            },
        )

    db.commit()
    return groups


def seed_sales_data(db: Session, tenant: Tenant, users, groups):
    sales_users = [
        users["ravi.sales@demo.lynk.local"],
        users["ishara.rep@demo.lynk.local"],
        users["kavindu.rep@demo.lynk.local"],
    ]

    org_specs = [
        ("Ceylon Retail Holdings", "https://ceylonretail.example", "retail", "Colombo", "Sri Lanka", "vip"),
        ("BlueWave Logistics", "https://bluewave.example", "logistics", "Katunayake", "Sri Lanka", "enterprise"),
        ("GreenLeaf Foods", "https://greenleaf.example", "food manufacturing", "Kandy", "Sri Lanka", "standard"),
        ("Northstar Exports", "https://northstar.example", "exports", "Galle", "Sri Lanka", "enterprise"),
        ("UrbanEdge Properties", "https://urbanedge.example", "real estate", "Colombo", "Sri Lanka", "vip"),
        ("Medix Care Network", "https://medix.example", "healthcare", "Nugegoda", "Sri Lanka", "standard"),
    ]

    organizations: list[SalesOrganization] = []

    for idx, (name, website, industry, city, country, group_key) in enumerate(org_specs):
        org = get_or_create(
            db,
            SalesOrganization,
            tenant_id=tenant.id,
            org_name=name,
            defaults={
                "website": website,
                "primary_phone": f"+94112{idx + 100000}",
                "primary_email": f"hello@{slugify(name)}.example",
                "industry": industry,
                "annual_revenue": f"LKR {(idx + 2) * 25}M",
                "assigned_to": sales_users[idx % len(sales_users)].id,
                "customer_group_id": groups[group_key].id,
                "billing_address": f"{idx + 10}, Demo Road",
                "billing_city": city,
                "billing_state": "Western",
                "billing_postal_code": f"10{idx}00",
                "billing_country": country,
            },
        )
        organizations.append(org)

    db.commit()

    contact_specs = [
        ("Dilshan", "Perera", "CEO", 0),
        ("Anika", "Fernando", "Procurement Manager", 0),
        ("Malith", "Silva", "Operations Director", 1),
        ("Shenali", "Dias", "Finance Manager", 1),
        ("Hiruni", "Wijesinghe", "Marketing Lead", 2),
        ("Oshan", "Karunaratne", "Founder", 3),
        ("Dinuka", "Gunasekara", "Property Manager", 4),
        ("Sarah", "Jayasinghe", "Admin Manager", 5),
        ("Yasiru", "Bandara", "IT Manager", 5),
        ("Pavithra", "Nanayakkara", "Business Development", 2),
    ]

    contacts: list[SalesContact] = []

    for idx, (first, last, title, org_idx) in enumerate(contact_specs):
        org = organizations[org_idx]
        email = f"{first.lower()}.{last.lower()}@{slugify(org.org_name)}.example"
        contact = get_or_create(
            db,
            SalesContact,
            tenant_id=tenant.id,
            primary_email=email,
            defaults={
                "first_name": first,
                "last_name": last,
                "contact_telephone": f"+9477{idx:07d}",
                "linkedin_url": f"https://linkedin.com/in/{first.lower()}-{last.lower()}",
                "current_title": title,
                "region": "Western Province",
                "country": "Sri Lanka",
                "email_opt_out": False,
                "assigned_to": sales_users[idx % len(sales_users)].id,
                "organization_id": org.org_id,
                "customer_group_id": org.customer_group_id,
                "last_contacted_at": NOW - timedelta(days=idx + 1),
                "last_contacted_channel": ["email", "call", "whatsapp"][idx % 3],
                "last_contacted_by_user_id": sales_users[idx % len(sales_users)].id,
                "whatsapp_last_contacted_at": NOW - timedelta(days=idx + 2),
            },
        )
        contacts.append(contact)

    db.commit()

    stage_cycle = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]
    opportunities: list[SalesOpportunity] = []

    for idx, contact in enumerate(contacts[:9]):
        org = contact.organization
        stage = stage_cycle[idx % len(stage_cycle)]

        opp = get_or_create(
            db,
            SalesOpportunity,
            tenant_id=tenant.id,
            opportunity_name=f"{org.org_name} - {['CRM Setup', 'Automation Package', 'Retainer', 'Website Integration'][idx % 4]}",
            defaults={
                "client": org.org_name,
                "sales_stage": stage,
                "contact_id": contact.contact_id,
                "organization_id": org.org_id,
                "assigned_to": contact.assigned_to,
                "start_date": date.today() - timedelta(days=20 - idx),
                "expected_close_date": date.today() + timedelta(days=10 + idx * 3),
                "campaign_type": ["Inbound", "Referral", "Outbound", "Website"][idx % 4],
                "total_leads": str(50 + idx * 15),
                "cpl": str(250 + idx * 20),
                "total_cost_of_project": str(150000 + idx * 35000),
                "currency_type": "LKR",
                "target_geography": "Sri Lanka",
                "target_audience": "SMB / Mid-market",
                "domain_cap": "Business decision makers",
                "tactics": "Email, WhatsApp, landing page, demo call",
                "delivery_format": "Monthly service package",
                "attachments": None,
                "last_contacted_at": NOW - timedelta(days=idx),
                "last_contacted_channel": ["email", "call", "meeting"][idx % 3],
                "last_contacted_by_user_id": contact.assigned_to,
            },
        )
        opportunities.append(opp)

    db.commit()
    return organizations, contacts, opportunities


def seed_catalog(db: Session, tenant: Tenant, users):
    admin = users["amaan.admin@demo.lynk.local"]
    finance = users["maya.finance@demo.lynk.local"]

    product_specs = [
        ("CRM Starter License", "CRM-ST-001", "Starter CRM user license", "LKR", Decimal("15000"), "in_stock", 120),
        ("CRM Pro License", "CRM-PRO-001", "Advanced CRM user license", "LKR", Decimal("35000"), "in_stock", 80),
        ("WhatsApp Integration Add-on", "WA-INT-001", "WhatsApp messaging add-on", "LKR", Decimal("25000"), "in_stock", 50),
        ("Website Lead Capture Widget", "WEB-LD-001", "Embeddable website lead form", "LKR", Decimal("18000"), "in_stock", 35),
        ("Document Storage Pack", "DOC-ST-001", "Extra document storage pack", "LKR", Decimal("9000"), "preorder", 20),
        ("POS Invoice Pack", "POS-INV-001", "POS invoice feature bundle", "LKR", Decimal("22000"), "in_stock", 40),
    ]

    products = []
    for name, sku, desc, currency, price, stock_status, qty in product_specs:
        product = get_or_create(
            db,
            CatalogProduct,
            tenant_id=tenant.id,
            sku=sku,
            defaults={
                "name": name,
                "slug": slugify(name),
                "description": desc,
                "currency": currency,
                "public_unit_price": price,
                "stock_status": stock_status,
                "stock_quantity": Decimal(qty),
                "is_public": 1,
                "is_active": 1,
                "created_by_user_id": admin.id,
                "updated_by_user_id": finance.id,
            },
        )
        products.append(product)

    service_specs = [
        ("CRM Implementation", "Full CRM implementation and migration", "LKR", Decimal("250000")),
        ("Sales Pipeline Consulting", "Pipeline setup, workflow cleanup, and staff training", "LKR", Decimal("180000")),
        ("Monthly Support Retainer", "Monthly support and admin retainer", "LKR", Decimal("95000")),
        ("Website CRM Integration", "Website forms, lead capture, and CRM sync", "LKR", Decimal("145000")),
        ("Invoice Template Design", "Custom branded invoice template setup", "LKR", Decimal("65000")),
        ("Client Portal Setup", "Client portal onboarding and page templates", "LKR", Decimal("125000")),
    ]

    services = []
    for name, desc, currency, price in service_specs:
        service = get_or_create(
            db,
            CatalogService,
            tenant_id=tenant.id,
            slug=slugify(name),
            defaults={
                "name": name,
                "description": desc,
                "currency": currency,
                "public_unit_price": price,
                "is_public": 1,
                "is_active": 1,
                "created_by_user_id": admin.id,
                "updated_by_user_id": finance.id,
            },
        )
        services.append(service)

    db.commit()
    return products, services


def seed_finance(db: Session, tenant: Tenant, users, contacts, organizations, products, services, modules):
    finance_user = users["maya.finance@demo.lynk.local"]
    sales_user = users["ravi.sales@demo.lynk.local"]

    invoices = []

    for idx in range(10):
        contact = contacts[idx % len(contacts)]
        org = contact.organization
        invoice_number = f"INV-DEMO-{idx + 1:04d}"

        line_items = [
            ("product", products[idx % len(products)], Decimal("1"), products[idx % len(products)].public_unit_price),
            ("service", services[idx % len(services)], Decimal("1"), services[idx % len(services)].public_unit_price),
        ]

        subtotal = sum(quantity * price for _, _, quantity, price in line_items)
        discount = Decimal("0") if idx % 3 else Decimal("5000")
        tax_rate = Decimal("0.15")
        tax_amount = (subtotal - discount) * tax_rate
        total = subtotal - discount + tax_amount
        paid = total if idx % 4 in (0, 1) else (total / Decimal("2") if idx % 4 == 2 else Decimal("0"))

        if paid == total:
            payment_status = "paid"
            status = "paid"
        elif paid > 0:
            payment_status = "partial"
            status = "issued"
        else:
            payment_status = "unpaid"
            status = "issued"

        invoice = get_or_create(
            db,
            FinancePosInvoice,
            tenant_id=tenant.id,
            invoice_number=invoice_number,
            defaults={
                "user_id": finance_user.id,
                "customer_contact_id": contact.contact_id,
                "customer_organization_id": org.org_id if org else None,
                "mode": "pos",
                "status": status,
                "payment_status": payment_status,
                "payment_method": ["bank_transfer", "cash", "card", None][idx % 4],
                "template_id": ["modern", "classic", "compact"][idx % 3],
                "accent_color": ["#14b8a6", "#2563eb", "#7c3aed"][idx % 3],
                "customer_name": f"{contact.first_name} {contact.last_name}",
                "customer_email": contact.primary_email,
                "customer_address": org.billing_address if org else None,
                "issue_date": date.today() - timedelta(days=idx * 3),
                "due_date": date.today() + timedelta(days=14 - idx),
                "currency": "LKR",
                "subtotal_amount": subtotal,
                "discount_amount": discount,
                "tax_rate": tax_rate,
                "tax_amount": tax_amount,
                "total_amount": total,
                "amount_paid": paid,
                "payment_terms": "Due within 14 days",
                "notes": "Demo generated invoice linked to customer, products, and services.",
            },
        )

        # remove/recreate invoice lines for deterministic totals
        db.query(FinancePosInvoiceLine).filter_by(invoice_id=invoice.id).delete()
        db.flush()

        for order, (item_type, item, quantity, price) in enumerate(line_items, start=1):
            db.add(
                FinancePosInvoiceLine(
                    invoice_id=invoice.id,
                    catalog_product_id=item.id if item_type == "product" else None,
                    catalog_service_id=item.id if item_type == "service" else None,
                    description=item.name,
                    quantity=quantity,
                    unit_price=price,
                    line_total=quantity * price,
                    sort_order=order,
                )
            )

        invoices.append(invoice)

    finance_module_id = modules["finance_io"].id

    for idx, org in enumerate(organizations[:6]):
        get_or_create(
            db,
            FinanceIO,
            tenant_id=tenant.id,
            io_number=f"IO-DEMO-{idx + 1:04d}",
            defaults={
                "module_id": finance_module_id,
                "user_id": sales_user.id,
                "external_reference": f"PO-{2026}-{idx + 100}",
                "file_name": f"io-demo-{idx + 1}.pdf",
                "file_path": f"/demo/finance/io-demo-{idx + 1}.pdf",
                "customer_organization_id": org.org_id,
                "customer_name": org.org_name,
                "counterparty_reference": f"CP-{idx + 500}",
                "issue_date": date.today() - timedelta(days=idx * 5),
                "effective_date": date.today() - timedelta(days=idx * 4),
                "due_date": date.today() + timedelta(days=20 + idx),
                "status": ["draft", "issued", "active", "completed", "cancelled", "imported"][idx % 6],
                "currency": "LKR",
                "subtotal_amount": Decimal("125000") + Decimal(idx * 20000),
                "tax_amount": Decimal("18750") + Decimal(idx * 3000),
                "total_amount": Decimal("143750") + Decimal(idx * 23000),
                "notes": "Demo finance IO linked to organization.",
                "start_date": date.today() - timedelta(days=idx * 2),
                "end_date": date.today() + timedelta(days=30 + idx),
            },
        )

    db.commit()
    return invoices


def seed_client_portal(db: Session, tenant: Tenant, users, contacts, organizations, products, services):
    admin = users["amaan.admin@demo.lynk.local"]

    accounts = []
    for idx, contact in enumerate(contacts[:5]):
        account = get_or_create(
            db,
            ClientAccount,
            tenant_id=tenant.id,
            contact_id=contact.contact_id,
            defaults={
                "organization_id": None,
                "email": contact.primary_email,
                "password_hash": demo_hash("Client@123456"),
                "status": "active" if idx % 2 == 0 else "pending",
                "setup_token_hash": demo_hash(f"setup-{contact.primary_email}"),
                "setup_token_expires_at": NOW + timedelta(days=7),
                "last_login_at": NOW - timedelta(days=idx) if idx % 2 == 0 else None,
                "created_by_user_id": admin.id,
                "updated_by_user_id": admin.id,
            },
        )
        accounts.append(account)

    for idx, org in enumerate(organizations[:3]):
        email = org.primary_email or f"portal-{slugify(org.org_name)}@example.com"
        accounts.append(
            get_or_create(
                db,
                ClientAccount,
                tenant_id=tenant.id,
                organization_id=org.org_id,
                defaults={
                    "contact_id": None,
                    "email": email,
                    "password_hash": demo_hash("Client@123456"),
                    "status": "active",
                    "setup_token_hash": demo_hash(f"setup-{email}"),
                    "setup_token_expires_at": NOW + timedelta(days=10),
                    "last_login_at": NOW - timedelta(days=idx + 1),
                    "created_by_user_id": admin.id,
                    "updated_by_user_id": admin.id,
                },
            )
        )

    pages = []
    for idx, contact in enumerate(contacts[:5]):
        pricing_items = [
            {
                "type": "product",
                "id": products[idx % len(products)].id,
                "name": products[idx % len(products)].name,
                "quantity": 1,
                "unit_price": str(products[idx % len(products)].public_unit_price),
            },
            {
                "type": "service",
                "id": services[idx % len(services)].id,
                "name": services[idx % len(services)].name,
                "quantity": 1,
                "unit_price": str(services[idx % len(services)].public_unit_price),
            },
        ]

        page = get_or_create(
            db,
            ClientPage,
            tenant_id=tenant.id,
            contact_id=contact.contact_id,
            defaults={
                "organization_id": None,
                "title": f"Proposal for {contact.first_name} {contact.last_name}",
                "summary": "Demo client portal proposal linked to sales contact and catalog items.",
                "status": ["draft", "published", "published", "archived"][idx % 4],
                "pricing_items": pricing_items,
                "document_ids": [],
                "proposal_sections": [
                    {"title": "Scope", "body": "CRM setup, catalog, invoices, and onboarding."},
                    {"title": "Timeline", "body": "Estimated delivery within 2 to 4 weeks."},
                ],
                "brand_settings": {
                    "accentColor": "#14b8a6",
                    "logoUrl": None,
                },
                "source_module_key": "sales_contacts",
                "source_entity_id": str(contact.contact_id),
                "public_token_hash": demo_hash(f"public-page-{contact.contact_id}"),
                "public_token_expires_at": NOW + timedelta(days=30),
                "published_at": NOW - timedelta(days=idx) if idx % 4 in (1, 2) else None,
                "created_by_user_id": admin.id,
                "updated_by_user_id": admin.id,
            },
        )
        pages.append(page)

    db.commit()

    for idx, page in enumerate(pages[:3]):
        get_or_create(
            db,
            ClientPageAction,
            tenant_id=tenant.id,
            client_page_id=page.id,
            action="accept" if idx % 2 == 0 else "request_changes",
            defaults={
                "client_account_id": accounts[idx].id if idx < len(accounts) else None,
                "message": "Looks good, please proceed." if idx % 2 == 0 else "Please revise the pricing section.",
                "actor_name": f"{contacts[idx].first_name} {contacts[idx].last_name}",
                "actor_email": contacts[idx].primary_email,
                "request_metadata": {
                    "ip": f"192.168.1.{100 + idx}",
                    "source": "demo_seed",
                },
            },
        )

    db.commit()
    return accounts, pages


def seed_tasks_and_calendar(db: Session, tenant: Tenant, users, teams, contacts, opportunities, invoices):
    admin = users["amaan.admin@demo.lynk.local"]
    sales_manager = users["ravi.sales@demo.lynk.local"]
    sales_rep = users["ishara.rep@demo.lynk.local"]
    finance = users["maya.finance@demo.lynk.local"]
    support = users["tharindu.support@demo.lynk.local"]

    task_specs = [
        ("Follow up with Ceylon Retail", "Call client and confirm next demo date.", "todo", "high", "sales_opportunities", opportunities[0].opportunity_id, "Ceylon Retail opportunity", sales_manager, sales_rep),
        ("Prepare proposal PDF", "Prepare proposal for BlueWave Logistics.", "in_progress", "high", "sales_opportunities", opportunities[1].opportunity_id, "BlueWave proposal", sales_manager, sales_rep),
        ("Check overdue invoice", "Review payment status and send reminder.", "blocked", "medium", "finance_pos", invoices[2].id, invoices[2].invoice_number, finance, finance),
        ("Update catalog pricing", "Review public prices before website publish.", "todo", "medium", "catalog_products", None, "Catalog pricing update", admin, finance),
        ("Client portal onboarding", "Help new client activate portal account.", "completed", "low", "client_portal", None, "Portal onboarding", admin, support),
        ("Schedule quarterly review", "Book QBR with enterprise clients.", "todo", "medium", "calendar", None, "Quarterly business review", sales_manager, sales_manager),
    ]

    tasks = []

    for idx, (title, desc, status, priority, source_key, source_id, source_label, created_by, assigned_user) in enumerate(task_specs):
        task = get_or_create(
            db,
            Task,
            tenant_id=tenant.id,
            title=title,
            defaults={
                "description": desc,
                "status": status,
                "priority": priority,
                "start_at": NOW - timedelta(days=idx),
                "due_at": NOW + timedelta(days=idx + 2),
                "completed_at": NOW - timedelta(days=1) if status == "completed" else None,
                "source_module_key": source_key,
                "source_entity_id": str(source_id) if source_id else None,
                "source_label": source_label,
                "created_by_user_id": created_by.id,
                "updated_by_user_id": created_by.id,
                "assigned_by_user_id": created_by.id,
                "assigned_at": NOW - timedelta(days=idx),
            },
        )

        assignee_key = f"user:{assigned_user.id}"
        get_or_create(
            db,
            TaskAssignee,
            tenant_id=tenant.id,
            task_id=task.id,
            assignee_key=assignee_key,
            defaults={
                "assignee_type": "user",
                "user_id": assigned_user.id,
                "team_id": None,
            },
        )

        if idx in (1, 5):
            team = teams["Enterprise Sales"]
            get_or_create(
                db,
                TaskAssignee,
                tenant_id=tenant.id,
                task_id=task.id,
                assignee_key=f"team:{team.id}",
                defaults={
                    "assignee_type": "team",
                    "user_id": None,
                    "team_id": team.id,
                },
            )

        tasks.append(task)

    # Calendar connection demo
    for user in [admin, sales_manager, sales_rep, finance]:
        get_or_create(
            db,
            UserCalendarConnection,
            tenant_id=tenant.id,
            user_id=user.id,
            provider="google",
            defaults={
                "status": "connected",
                "account_email": user.email,
                "scopes": ["calendar.readonly", "calendar.events"],
                "access_token": "demo-access-token",
                "refresh_token": "demo-refresh-token",
                "token_expires_at": NOW + timedelta(hours=1),
                "provider_calendar_id": "primary",
                "provider_calendar_name": "Demo Calendar",
                "last_synced_at": NOW - timedelta(minutes=30),
            },
        )

    event_specs = [
        ("Discovery call - Ceylon Retail", "Initial discovery call.", 1, "sales_opportunities", opportunities[0].opportunity_id, sales_manager),
        ("Proposal review - BlueWave", "Walkthrough proposal and pricing.", 3, "sales_opportunities", opportunities[1].opportunity_id, sales_rep),
        ("Finance sync", "Review invoices and overdue payments.", 5, "finance_pos", invoices[2].id, finance),
        ("Internal pipeline review", "Weekly pipeline health check.", 7, "sales_opportunities", None, sales_manager),
    ]

    for idx, (title, desc, days_ahead, source_key, source_id, owner) in enumerate(event_specs):
        start_at = NOW + timedelta(days=days_ahead, hours=idx + 1)
        end_at = start_at + timedelta(hours=1)

        event = get_or_create(
            db,
            CalendarEvent,
            tenant_id=tenant.id,
            owner_user_id=owner.id,
            title=title,
            defaults={
                "description": desc,
                "start_at": start_at,
                "end_at": end_at,
                "is_all_day": False,
                "location": "Google Meet",
                "meeting_url": f"https://meet.google.com/demo-{idx}",
                "status": "confirmed",
                "source_module_key": source_key,
                "source_entity_id": str(source_id) if source_id else None,
                "source_label": title,
            },
        )

        participant_users = [owner, admin, sales_rep if owner.id != sales_rep.id else sales_manager]

        for user in participant_users:
            get_or_create(
                db,
                CalendarEventParticipant,
                tenant_id=tenant.id,
                event_id=event.id,
                participant_key=f"user:{user.id}",
                defaults={
                    "participant_type": "user",
                    "user_id": user.id,
                    "team_id": None,
                    "response_status": "accepted" if user.id == owner.id else "pending",
                    "is_owner": user.id == owner.id,
                    "external_provider": "google",
                    "external_event_id": f"demo-event-{event.id}-{user.id}",
                    "external_synced_at": NOW,
                },
            )

    db.commit()
    return tasks


def print_summary(
    tenant: Tenant,
    users,
    roles,
    organizations,
    contacts,
    opportunities,
    products,
    services,
    invoices,
    tasks,
):
    print("\nDemo CRM seed complete")
    print("=" * 60)
    print(f"Tenant:        {tenant.name} ({tenant.slug})")
    print(f"Domain:        {DEMO_DOMAIN}")
    print(f"Users:         {len(users)}")
    print(f"Roles:         {len(roles)}")
    print(f"Organizations:{len(organizations)}")
    print(f"Contacts:      {len(contacts)}")
    print(f"Opportunities: {len(opportunities)}")
    print(f"Products:      {len(products)}")
    print(f"Services:      {len(services)}")
    print(f"Invoices:      {len(invoices)}")
    print(f"Tasks:         {len(tasks)}")
    print("\nDemo login-style users:")
    print("  amaan.admin@demo.lynk.local")
    print("  ravi.sales@demo.lynk.local")
    print("  maya.finance@demo.lynk.local")
    print("  viewer@demo.lynk.local")
    print("\nDemo password hash source value:")
    print("  Demo@123456")
    print("\nNote: if your auth expects a specific password hash format, update the")
    print("password_hash generation to match your auth service before using these")
    print("accounts for real login testing.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reset-demo",
        action="store_true",
        help="Delete the demo tenant and recreate all linked demo data.",
    )
    args = parser.parse_args()

    db = SessionLocal()

    try:
        if args.reset_demo:
            reset_demo_tenant(db)

        modules = seed_modules(db)
        tenant = seed_tenant(db)
        roles, departments, teams = seed_roles_departments_teams(db, tenant, modules)
        users = seed_users(db, tenant, roles, departments, teams)
        groups = seed_customer_groups(db, tenant)
        organizations, contacts, opportunities = seed_sales_data(db, tenant, users, groups)
        products, services = seed_catalog(db, tenant, users)
        invoices = seed_finance(db, tenant, users, contacts, organizations, products, services, modules)
        seed_client_portal(db, tenant, users, contacts, organizations, products, services)
        tasks = seed_tasks_and_calendar(db, tenant, users, teams, contacts, opportunities, invoices)

        db.commit()

        print_summary(
            tenant=tenant,
            users=users,
            roles=roles,
            organizations=organizations,
            contacts=contacts,
            opportunities=opportunities,
            products=products,
            services=services,
            invoices=invoices,
            tasks=tasks,
        )

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
