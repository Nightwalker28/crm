# Generic ERP/CRM Module Refactor Plan

This document is the implementation brief for Codex. The goal is to refactor the current CRM module set into a generic ERP/CRM foundation while preserving the existing shared module system, tenant module configuration, module field configuration, sidebar rules, UI patterns, and workflows.

The work must happen in this order:

1. Clean existing modules.
2. Remove or migrate non-generic fields safely.
3. Delete or update records/configuration that reference removed fields.
4. Refactor routes, schemas, services, imports, exports, filters, search, and UI that depend on removed or renamed fields.
5. Standardize all existing modules.
6. Add missing general ERP/CRM modules using the same architecture and UI workflow as existing modules.
7. Do not build deep cross-module relationships yet beyond the minimum required foreign keys and display labels. Relationship workflows can be done in a later phase.

## Existing architecture to preserve

Use the existing shared structures instead of creating a second module framework.

Important files and systems:

- `backend/app/modules/user_management/models.py`
  - `Module`
  - `TenantModuleConfig`
  - `TenantSidebarTab`
  - module permissions
- `backend/app/modules/user_management/services/admin_modules.py`
  - sidebar tab defaults
  - module listing and tenant module config logic
- `backend/app/modules/platform/models.py`
  - `ModuleFieldConfig`
  - `CustomFieldDefinition`
  - `CustomFieldValue`
  - `CustomModuleDefinition`
  - `CustomModuleFieldDefinition`
  - `CustomModuleRecord`
- `backend/app/modules/platform/services/module_fields.py`
  - protected field handling
  - tenant-level module field config updates
- `backend/app/modules/platform/routes/module_fields.py`
- `frontend/lib/module-display.ts`
- `frontend/lib/routes.ts`
- `frontend/hooks/useAccessibleModules.ts`
- `frontend/hooks/useModuleFieldConfigs.ts`
- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/app/dashboard/settings/modules/page.tsx`
- `frontend/app/dashboard/settings/fields/page.tsx`
- `frontend/app/dashboard/settings/module-builder/page.tsx`

The shared module field config table is the source of truth for tenant-visible system fields:

```txt
module_field_configs
- tenant_id
- module_key
- field_key
- label
- field_type
- field_source
- is_enabled
- is_protected
- sort_order
```

The module table is the shared module registry:

```txt
modules
- id
- name
- base_route
- description
- is_enabled
- import_duplicate_mode
- created_at
```

## Non-negotiable rules

- Do not create a parallel module registry.
- Do not bypass `modules`, `tenant_module_configs`, `module_field_configs`, or existing permission/access logic.
- Do not hard-delete business data unless this document explicitly says a record/config row is safe to delete.
- Do not drop old DB columns in the first pass unless all references are removed and a migration/backfill exists.
- Prefer hiding/removing fields from module config and UI first, then clean DB columns in a later migration.
- Preserve tenant isolation on all new tables.
- Every new table must include `tenant_id` unless it is a global lookup by design.
- Every normal business record table should support soft delete with `deleted_at` unless there is a strong reason not to.
- Every module must have consistent CRUD, list, detail, search, import/export compatibility where the existing module type supports it.
- New modules must use the same visual/layout conventions as existing modules.
- Protected identifier fields must not be disabled in the UI.
- Make all seeds/syncs idempotent.
- Avoid one-off UI implementations. Reuse shared table/form/list/detail components where possible.

## Phase 1: Add a central system module registry

Create:

```txt
backend/app/modules/platform/system_modules.py
```

This file should define all built-in ERP/CRM modules and their standard field metadata.

Suggested shape:

```py
SYSTEM_MODULES = {
    "sales_contacts": {
        "display_name": "Contacts",
        "category": "Sales",
        "sidebar_tab_key": "sales",
        "base_route": "/dashboard/sales/contacts",
        "description": "People related to accounts, deals, support, and transactions.",
        "sort_order": 100,
        "fields": [
            {
                "field_key": "contact_id",
                "label": "Contact ID",
                "field_type": "number",
                "field_source": "system",
                "is_enabled": True,
                "is_protected": True,
                "sort_order": 10,
            },
            {
                "field_key": "first_name",
                "label": "First Name",
                "field_type": "text",
                "field_source": "system",
                "is_enabled": True,
                "is_protected": False,
                "sort_order": 20,
            },
        ],
    },
}
```

Also create a sync service, for example:

```txt
backend/app/modules/platform/services/system_module_sync.py
```

The sync service must:

1. Upsert rows in `modules`.
2. Upsert rows in `module_field_configs` for every tenant.
3. Preserve tenant-specific `label`, `is_enabled`, and `sort_order` once created, unless the field is protected.
4. Force protected fields to `is_enabled=True` and `is_protected=True`.
5. Mark deprecated fields disabled by default using `is_enabled=False` but do not delete their values yet.
6. Be safe to run multiple times.
7. Be callable from a management script or bootstrap flow.

Create a management script such as:

```txt
backend/scripts/sync_system_modules.py
```

This lets Codex/devs run the module sync manually after migrations.

## Phase 2: Inventory and clean current modules

Current modules to inspect and standardize:

- `sales_contacts`
- `sales_organizations`
- `sales_opportunities`
- `tasks`
- `documents`
- `catalog_products`
- `catalog_services`
- `finance_io`
- `finance_pos`
- `mail`
- `calendar`
- `whatsapp`
- `message_templates`

Current model files to inspect:

- `backend/app/modules/sales/models.py`
- `backend/app/modules/tasks/models.py`
- `backend/app/modules/documents/models.py`
- `backend/app/modules/catalog/models.py`
- `backend/app/modules/finance/models.py`
- `backend/app/modules/mail/models.py`
- `backend/app/modules/calendar/models.py`
- `backend/app/modules/whatsapp/models.py`
- `backend/app/modules/platform/models.py`

For each existing module:

1. List all DB columns.
2. List all Pydantic schema fields.
3. List all route/service references.
4. List frontend table/form/filter/detail references.
5. Mark every field as one of:
   - keep generic system field
   - rename conceptually now, DB rename later
   - hide from default UI
   - migrate to custom field
   - remove config/reference
   - delete row/config only, not underlying business data
6. Update `module_field_configs` sync metadata.
7. Update frontend display names and routes.
8. Add or update tests.

## Phase 3: Clean and standardize existing Sales modules

### `sales_contacts`

Current business model has fields similar to:

```txt
contact_id
tenant_id
first_name
last_name
contact_telephone
linkedin_url
primary_email
current_title
region
country
email_opt_out
assigned_to
organization_id
customer_group_id
created_time
last_contacted_at
last_contacted_channel
last_contacted_by_user_id
whatsapp_last_contacted_at
deleted_at
search_doc
```

Generic target fields:

```txt
contact_id
tenant_id
first_name
last_name
primary_email
secondary_email
primary_phone
secondary_phone
job_title
department
account_id / organization_id
owner_id / assigned_to
lead_source
lifecycle_stage
status
email_opt_out
phone_opt_out
last_contacted_at
last_contacted_channel
last_contacted_by_user_id
created_at
updated_at
deleted_at
search_doc
custom_fields
```

Actions:

- Keep `contact_id` as protected.
- Keep `tenant_id` protected.
- Keep `first_name`, `last_name`, `primary_email`.
- Standardize display label of `contact_telephone` to `Primary Phone` for now.
- Prefer future DB rename: `contact_telephone -> primary_phone`.
- Standardize display label of `current_title` to `Job Title` for now.
- Prefer future DB rename: `current_title -> job_title`.
- Standardize display label of `assigned_to` to `Owner` for now.
- Prefer future DB rename: `assigned_to -> owner_id`.
- Standardize display label of `organization_id` to `Account` for now.
- Prefer future UI naming: Account, not Organization.
- Hide or remove `whatsapp_last_contacted_at` from default contact fields.
- Replace WhatsApp-specific contact tracking with the generic communication/activity model later.
- Keep `last_contacted_at`, `last_contacted_channel`, and `last_contacted_by_user_id` as generic communication summary fields.
- Add `status` and `lifecycle_stage` if missing.
- Add `phone_opt_out` if missing.
- Add `created_at`/`updated_at` standard timestamps if missing, or map `created_time` to label `Created At` until a migration renames it.

Route/service/frontend cleanup:

- Search for `whatsapp_last_contacted_at` and remove it from default forms, lists, filters, and exports.
- Search for `contact_telephone` and make the UI label `Primary Phone`.
- Search for `current_title` and make the UI label `Job Title`.
- Ensure imports/exports accept both old and new labels where possible.

### `sales_organizations`

This module should be displayed as **Accounts**.

Current fields are similar to:

```txt
org_id
tenant_id
org_name
website
primary_phone
secondary_phone
primary_email
secondary_email
industry
annual_revenue
assigned_to
customer_group_id
created_time
deleted_at
billing_address
billing_city
billing_state
billing_postal_code
billing_country
search_doc
```

Generic target fields:

```txt
account_id / org_id
tenant_id
name / org_name
website
primary_email
secondary_email
primary_phone
secondary_phone
industry
account_type
status
owner_id / assigned_to
annual_revenue
employee_count
billing_address
billing_city
billing_state
billing_postal_code
billing_country
shipping_address
shipping_city
shipping_state
shipping_postal_code
shipping_country
created_at
updated_at
deleted_at
search_doc
custom_fields
```

Actions:

- Keep DB table `sales_organizations` for now to avoid breaking routes.
- Display module as `Accounts` everywhere.
- Standardize `org_name` label to `Account Name` or `Name`.
- Prefer future DB rename: `org_name -> name`.
- Standardize `org_id` label to `Account ID`.
- Prefer future DB rename: `org_id -> account_id`.
- Standardize `assigned_to` label to `Owner`.
- Add generic `account_type`, `status`, and `employee_count` if missing.
- Add shipping address fields if missing.
- Preserve `customer_group_id` if currently used by client portal, but label it generically as `Customer Group`.

Route/service/frontend cleanup:

- Update frontend labels from Organizations to Accounts unless the URL path remains `/organizations` for compatibility.
- Existing route can remain `/dashboard/sales/organizations`, but display text should be Accounts.
- Ensure breadcrumbs, sidebar, module settings, and permissions display Accounts.

### `sales_opportunities`

This module should be displayed as **Deals**.

Current generic-ish fields:

```txt
opportunity_id
tenant_id
opportunity_name
client
sales_stage
contact_id
organization_id
assigned_to
start_date
expected_close_date
created_time
last_contacted_at
last_contacted_channel
last_contacted_by_user_id
deleted_at
```

Current non-generic fields that must be removed from default module behavior:

```txt
campaign_type
total_leads
cpl
total_cost_of_project
currency_type
target_geography
target_audience
domain_cap
tactics
delivery_format
attachments
```

Generic target fields:

```txt
deal_id / opportunity_id
tenant_id
name / opportunity_name
account_id / organization_id
contact_id
owner_id / assigned_to
stage / sales_stage
amount
currency
probability
source
expected_close_date
closed_at
lost_reason
description
last_contacted_at
last_contacted_channel
last_contacted_by_user_id
created_at
updated_at
deleted_at
custom_fields
```

Actions:

- Keep table `sales_opportunities` for now.
- Display module as `Deals` everywhere.
- Standardize `opportunity_id` label to `Deal ID`.
- Standardize `opportunity_name` label to `Deal Name`.
- Prefer future DB rename: `opportunity_name -> name`.
- Standardize `sales_stage` label to `Stage`.
- Prefer future DB rename: `sales_stage -> stage`.
- Standardize `assigned_to` label to `Owner`.
- Standardize `organization_id` label to `Account`.
- Replace `currency_type` with generic `currency`.
- Add `amount`, `probability`, `source`, `closed_at`, `lost_reason`, `description`, `updated_at` if missing.
- Hide/remove all campaign/media-specific fields from default field configs and UI.

Required cleanup for removed non-generic fields:

- Remove from create/update schemas unless kept only for backwards compatibility.
- Remove from form components.
- Remove from list columns.
- Remove from saved default column sets.
- Remove from filters.
- Remove from search text unless still used by custom field search.
- Remove from import/export default templates.
- Remove from validation rules.
- Remove from tests that assert those fields are system fields.
- Delete `module_field_configs` rows for these fields only if they are system-field configs and no longer part of default system modules.
- If records have values in these columns, do not delete the record. Either leave the DB column unused or migrate values into custom fields in a later phase.

Non-generic fields to remove from default module configs:

```txt
campaign_type
total_leads
cpl
total_cost_of_project
target_geography
target_audience
domain_cap
tactics
delivery_format
attachments
```

`currency_type` should be migrated/renamed to `currency`, not treated as an industry-specific field.

## Phase 4: Standardize existing Workspace and Platform modules

### `tasks`

The task model is already generic. Keep and standardize:

```txt
id
tenant_id
title
description
status
priority
start_at
due_at
completed_at
source_module_key
source_entity_id
source_label
created_by_user_id
updated_by_user_id
assigned_by_user_id
assigned_at
created_at
updated_at
deleted_at
```

Actions:

- Keep `tasks` as a Workspace module.
- Ensure field configs exist.
- Ensure protected fields cannot be disabled.
- Ensure list/detail/form workflow matches other modules.
- Consider label `source_module_key` as `Related Module` and `source_entity_id` as `Related Record`.

### `documents`

Keep as generic document storage/linking module.

Generic fields:

```txt
id
tenant_id
title
description
original_filename
content_type
extension
file_size_bytes
storage_provider
storage_path
uploaded_by_user_id
created_at
updated_at
deleted_at
```

Actions:

- Ensure documents can link to any module by `module_key` and `entity_id`.
- Keep document relationship enhancements for a later phase.
- Ensure field configs exist.

### `message_templates`

Keep as Platform module.

Actions:

- Ensure it is not treated as a business CRM module.
- Keep visible in Settings/Platform, not Sales/Finance.

### `mail`, `calendar`, `whatsapp`

Actions:

- Treat as Workspace/Communication modules.
- Do not let WhatsApp-specific fields leak into Contacts/Deals defaults.
- If WhatsApp has no valid frontend page, do not show it in sidebar. Keep backend APIs if used by click-to-chat/templates.
- Future relationship work can connect communications to contacts/deals/accounts.

## Phase 5: Standardize Catalog modules

### `catalog_products`

Generic target fields:

```txt
id
tenant_id
name
sku
slug
description
currency
public_unit_price
stock_status
stock_quantity
is_public
is_active
media_path
media_content_type
media_original_filename
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Actions:

- Keep as Product module.
- Ensure labels are generic.
- Do not overbuild inventory relationships yet.
- Ensure field configs exist.

### `catalog_services`

Generic target fields:

```txt
id
tenant_id
name
slug
description
currency
public_unit_price
is_public
is_active
media_path
media_content_type
media_original_filename
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Actions:

- Keep as Service module.
- Ensure field configs exist.
- Later phase can unify products/services under `catalog_items` if needed.

## Phase 6: Standardize Finance modules

### `finance_io`

`finance_io` / Insertion Orders are not generic ERP naming. Do not delete immediately because routes/data may depend on them.

Actions now:

- Keep existing route and table for compatibility.
- Move it under a more generic label if possible:
  - `finance_insertion_orders` can remain as a legacy module label, or
  - treat as a future `sales_orders` / `contracts` migration source.
- Do not create new business workflows around IO yet.
- Ensure its fields are not used as the model for all finance docs.

Generic reusable fields from IO:

```txt
id
tenant_id
number / io_number
external_reference
customer_contact_id
customer_organization_id
customer_name
counterparty_reference
issue_date
effective_date
due_date
status
currency
subtotal_amount
tax_amount
total_amount
notes
start_date
end_date
created_at
updated_at
deleted_at
```

Non-generic fields to hide from normal ERP finance docs:

```txt
file_name
file_path
module_id if it only exists because of imported IO behavior
```

### `finance_pos`

`finance_pos` should become or be complemented by a generic `finance_invoices` module.

Actions now:

- Keep existing POS invoice table and route for compatibility.
- Add generic `finance_invoices` module definition.
- If reusing `finance_pos_invoices` table for the first pass, display the module as `Invoices` where appropriate, not only POS.
- POS-specific behavior should become optional mode/config, not the whole module identity.

Generic invoice fields:

```txt
id
tenant_id
invoice_number
customer_contact_id
customer_organization_id
customer_name
customer_email
customer_address
issue_date
due_date
status
payment_status
payment_method
currency
subtotal_amount
discount_amount
tax_rate
tax_amount
total_amount
amount_paid
payment_terms
notes
created_at
updated_at
deleted_at
```

Presentation-specific fields to hide from core field config unless needed in UI settings:

```txt
template_id
accent_color
```

## Phase 7: Add missing generic modules

Add new modules using the same pattern as current modules:

- SQLAlchemy models under the correct backend module package.
- Pydantic schemas.
- Services.
- Routes.
- Alembic migration.
- Module registry entry in `modules`.
- Field config entries in `module_field_configs`.
- Frontend route.
- Frontend list/create/edit/detail UI matching existing modules.
- Sidebar/module settings integration.
- Tests.

Do not overbuild relationships yet. Add minimal relation fields as nullable IDs where needed, but keep relationship workflows for a later task.

### Sales modules to add

#### `sales_leads`

Purpose: unqualified prospects before they become contacts/accounts/deals.

Fields:

```txt
id
tenant_id
first_name
last_name
company_name
job_title
primary_email
primary_phone
website
source
status
rating
owner_id
notes
converted_contact_id
converted_account_id
converted_deal_id
converted_at
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
new
contacted
qualified
unqualified
converted
lost
```

#### `sales_activities`

Purpose: generic timeline interactions.

Fields:

```txt
id
tenant_id
activity_type
subject
description
status
priority
activity_at
due_at
completed_at
module_key
entity_id
contact_id
account_id
deal_id
owner_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Activity types:

```txt
call
email
meeting
message
note
task
other
```

#### `sales_notes`

Purpose: record-linked notes.

Fields:

```txt
id
tenant_id
title
body
module_key
entity_id
contact_id
account_id
deal_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `sales_quotes`

Purpose: generic customer quote/estimate.

Fields:

```txt
id
tenant_id
quote_number
status
customer_contact_id
customer_account_id
customer_name
issue_date
expiry_date
currency
subtotal_amount
discount_amount
tax_amount
total_amount
notes
terms
owner_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
draft
sent
accepted
rejected
expired
cancelled
```

#### `sales_quote_lines`

Fields:

```txt
id
tenant_id
quote_id
item_type
product_id
service_id
description
quantity
unit_price
discount_amount
tax_amount
line_total
sort_order
created_at
updated_at
```

#### `sales_orders`

Purpose: confirmed customer order.

Fields:

```txt
id
tenant_id
order_number
status
customer_contact_id
customer_account_id
customer_name
order_date
expected_delivery_date
currency
subtotal_amount
discount_amount
tax_amount
total_amount
notes
owner_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
draft
confirmed
processing
fulfilled
cancelled
closed
```

#### `sales_order_lines`

Fields:

```txt
id
tenant_id
sales_order_id
item_type
product_id
service_id
description
quantity
unit_price
discount_amount
tax_amount
line_total
sort_order
created_at
updated_at
```

### Finance modules to add

#### `finance_invoices`

If possible, reuse or generalize the current POS invoice implementation. If reuse would be messy, create a new generic table and keep POS as legacy.

Fields:

```txt
id
tenant_id
invoice_number
status
payment_status
customer_contact_id
customer_account_id
customer_name
customer_email
billing_address
issue_date
due_date
currency
subtotal_amount
discount_amount
tax_rate
tax_amount
total_amount
amount_paid
balance_due
payment_terms
notes
owner_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
draft
issued
paid
void
cancelled
```

Payment statuses:

```txt
unpaid
partial
paid
refunded
```

#### `finance_invoice_lines`

Fields:

```txt
id
tenant_id
invoice_id
item_type
product_id
service_id
description
quantity
unit_price
discount_amount
tax_amount
line_total
sort_order
created_at
updated_at
```

#### `finance_payments`

Fields:

```txt
id
tenant_id
payment_number
invoice_id
customer_contact_id
customer_account_id
payment_date
payment_method
reference_number
currency
amount
status
notes
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
draft
received
failed
refunded
void
```

#### `finance_credit_notes`

Fields:

```txt
id
tenant_id
credit_note_number
invoice_id
customer_contact_id
customer_account_id
issue_date
currency
amount
reason
status
notes
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `finance_expenses`

Fields:

```txt
id
tenant_id
expense_number
vendor_id
expense_date
category
currency
amount
tax_amount
payment_method
status
notes
receipt_document_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

### Purchasing modules to add

#### `purchase_vendors`

Fields:

```txt
id
tenant_id
name
website
primary_email
primary_phone
secondary_email
secondary_phone
vendor_type
status
tax_id
billing_address
billing_city
billing_state
billing_postal_code
billing_country
payment_terms
owner_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `purchase_orders`

Fields:

```txt
id
tenant_id
purchase_order_number
vendor_id
status
order_date
expected_delivery_date
currency
subtotal_amount
discount_amount
tax_amount
total_amount
notes
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
draft
sent
confirmed
received
cancelled
closed
```

#### `purchase_order_lines`

Fields:

```txt
id
tenant_id
purchase_order_id
item_type
product_id
service_id
description
quantity
unit_price
discount_amount
tax_amount
line_total
sort_order
created_at
updated_at
```

### Inventory modules to add

Do not build full stock automation yet. Create the modules and basic CRUD/list views first.

#### `inventory_warehouses`

Fields:

```txt
id
tenant_id
name
code
status
address
city
state
postal_code
country
manager_user_id
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `inventory_locations`

Fields:

```txt
id
tenant_id
warehouse_id
name
code
location_type
status
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Location types:

```txt
stock
receiving
shipping
adjustment
scrap
```

#### `inventory_stock_moves`

Fields:

```txt
id
tenant_id
move_number
product_id
source_location_id
destination_location_id
quantity
unit_of_measure
move_type
status
reference_module_key
reference_entity_id
notes
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `inventory_stock_adjustments`

Fields:

```txt
id
tenant_id
adjustment_number
product_id
location_id
quantity_before
quantity_after
quantity_delta
reason
status
notes
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

### Support and project modules to add

#### `support_tickets`

Fields:

```txt
id
tenant_id
ticket_number
subject
description
status
priority
source
customer_contact_id
customer_account_id
owner_id
due_at
resolved_at
closed_at
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

Statuses:

```txt
new
open
pending
resolved
closed
cancelled
```

#### `projects`

Fields:

```txt
id
tenant_id
name
code
description
status
priority
customer_account_id
customer_contact_id
owner_id
start_date
due_date
completed_at
budget_amount
currency
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

#### `project_tasks`

Fields:

```txt
id
tenant_id
project_id
title
description
status
priority
assigned_to_user_id
start_at
due_at
completed_at
created_by_user_id
updated_by_user_id
created_at
updated_at
deleted_at
```

## Phase 8: Frontend requirements for all new modules

For each new module:

1. Add route constants in `frontend/lib/routes.ts`.
2. Add display name/category in `frontend/lib/module-display.ts`.
3. Ensure sidebar can render it under the correct tab.
4. Ensure Module Settings can display it.
5. Ensure Field Config can display and update its fields.
6. Create list page matching existing table workflow.
7. Create create/edit form matching existing styling.
8. Create detail page if existing module pattern supports detail pages.
9. Ensure loading, empty, error, and permission states are consistent.
10. Ensure mobile/responsive behavior is not worse than existing modules.

Recommended sidebar categories:

```txt
Sales
- Leads
- Accounts
- Contacts
- Deals
- Activities
- Quotes
- Sales Orders

Finance
- Invoices
- Payments
- Credit Notes
- Expenses

Products & Services
- Products
- Services
- Warehouses
- Stock Locations
- Stock Moves
- Stock Adjustments

Purchasing
- Vendors
- Purchase Orders

Workspace
- Tasks
- Documents
- Calendar
- Mail

Support
- Tickets
- Projects
```

If the sidebar currently supports only system tabs plus custom tabs, add missing system tabs carefully:

```txt
purchasing
inventory
support
workspace
```

Do not break existing tab keys. If adding new tabs is too risky in the first pass, place new modules under existing tabs and document the follow-up.

## Phase 9: Backend route/service requirements for new modules

Each new module should follow existing route/service conventions.

Minimum API behavior:

- list records
- get record
- create record
- update record
- soft delete record
- restore record if existing recycle-bin pattern supports it
- export if existing modules support export
- import if existing modules support import
- custom field hydration if existing system supports it for that module type
- activity log where existing modules use activity logs
- permission checks through shared module access system
- tenant filtering on every query

Every list endpoint must:

- filter by `tenant_id`
- ignore soft-deleted records by default
- support search where practical
- support pagination where existing modules do
- avoid leaking records across tenants

## Phase 10: Data cleanup rules

When removing non-generic fields from default modules:

### Safe to delete

Delete only configuration/reference rows that make removed fields appear as default/system fields:

- stale `module_field_configs` rows for removed system fields
- stale frontend default column config entries
- stale import/export template headers
- stale tests expecting non-generic fields as required/system fields

### Not safe to delete yet

Do not delete actual business records just because they have values in old fields.

Do not drop old columns in this pass unless:

1. all service/schema/frontend references are gone,
2. there is a migration/backfill path,
3. tests prove the old field is not needed,
4. the column is not needed for old deployments/imports.

### Custom-field migration option

If existing records have values in non-generic fields, write a migration or management script later to move them to custom fields:

```txt
campaign_type -> custom field: Campaign Type
total_leads -> custom field: Total Leads
cpl -> custom field: CPL
total_cost_of_project -> custom field: Total Cost of Project
target_geography -> custom field: Target Geography
target_audience -> custom field: Target Audience
domain_cap -> custom field: Domain Cap
tactics -> custom field: Tactics
delivery_format -> custom field: Delivery Format
attachments -> document links or custom field only if necessary
```

For this pass, it is enough to remove them from default module workflows and field config.

## Phase 11: Tests and validation

Add or update tests for:

- system module registry sync is idempotent
- module rows exist for every system module
- field config rows exist for every system field
- protected fields cannot be disabled
- deprecated non-generic fields are not shown as default fields
- Sales modules display Accounts/Contacts/Deals correctly
- new modules appear in Module Settings
- new modules appear in sidebar only when enabled and routed
- tenant A cannot see tenant B records
- soft-deleted records do not appear in default list endpoints
- create/update/list works for each new module
- old routes still work where compatibility is required

Recommended commands after implementation:

```bash
cd backend
alembic upgrade head
python scripts/sync_system_modules.py
pytest

cd ../frontend
npm run lint
npm run build
```

Also run any existing backend/frontend type checks used by this repo.

## Phase 12: Acceptance criteria

This work is complete when:

- Existing modules are cleaned and standardized.
- Contacts, Accounts, Deals, Tasks, Documents, Products, Services, and Finance modules use generic labels and fields.
- Campaign/media-specific fields are no longer default Deal fields.
- Stale field configs/routes/UI references for removed fields are gone.
- Existing business data is preserved.
- The shared `modules` table remains the module registry.
- The shared `module_field_configs` table remains the system field visibility/config source.
- New general CRM/ERP modules are created with consistent backend and frontend workflow.
- New modules are visible in Module Settings.
- New modules have consistent sidebar behavior.
- New modules follow tenant isolation and soft-delete conventions.
- Tests pass.

## Out of scope for this pass

Do not spend time on deep workflow automation yet.

The following should be handled in later phases:

- automatic lead conversion workflows
- quote-to-order conversion
- order-to-invoice conversion
- invoice payment allocation automation
- full inventory quantity automation
- stock valuation
- purchase receiving automation
- advanced activity timeline relationship UI
- advanced reporting dashboards
- role-specific workflow automation
- industry templates
- migrating old campaign/media fields into optional templates

For now, create the generic module foundation cleanly and consistently.