# Remove Temporary Generic System Modules Implementation

This is a Codex cleanup brief.

The recent generic system module implementation should be removed completely. Do not replace it with a new framework and do not create new modules. New modules will be implemented properly later.

## Remove these backend pieces

Remove these files if present:

- `backend/app/modules/platform/system_modules.py`
- `backend/app/modules/platform/services/system_module_sync.py`
- `backend/scripts/sync_system_modules.py`
- `backend/app/modules/platform/routes/generic_system_records.py`
- `backend/app/modules/platform/services/generic_system_records.py`
- `backend/app/modules/platform/schema_generic_records.py`

Remove `GenericSystemRecord` from:

- `backend/app/modules/platform/models.py`

Remove router imports/registration from:

- `backend/app/api/v1/router.py`

Remove seed/bootstrap calls to `sync_system_modules`.

Search and remove references to:

```txt
GenericSystemRecord
generic_system_records
generic-system-modules
generic_system_records_router
sync_system_modules
system_module_sync
SYSTEM_MODULES
iter_system_modules
generic_route
GENERIC_SYSTEM_MODULE_KEYS

Remove:

frontend/app/dashboard/modules/[moduleKey]/page.tsx

Remove the route helper from frontend/lib/routes.ts if present:

genericModule: (moduleKey: string) => `/dashboard/modules/${moduleKey}`

Remove placeholder display entries from frontend/lib/module-display.ts for:

sales_leads
sales_activities
sales_notes
sales_quotes
sales_orders
finance_invoices
finance_payments
finance_credit_notes
finance_expenses
purchase_vendors
purchase_orders
inventory_warehouses
inventory_locations
inventory_stock_moves
inventory_stock_adjustments
support_tickets
projects
project_tasks
Migration cleanup

Remove or neutralize only the migration pieces that introduced generic_system_records.

Keep the Alembic chain valid.

Do not touch existing real business tables.

Do not remove

Do not remove existing real modules:

contacts
accounts / organizations
deals / opportunities
tasks
documents
products
services
finance IO
finance POS
mail
calendar
whatsapp backend helpers
message templates
module builder
field config
module settings

Do not remove the custom module builder system:

CustomModuleDefinition
CustomModuleFieldDefinition
CustomModuleRecord
/dashboard/settings/module-builder
/dashboard/custom/...
Expected final state
No /dashboard/modules/... route.
No /generic-system-modules/... API.
No GenericSystemRecord model.
No generic_system_records table/model references.
No placeholder ERP modules showing in sidebar or module settings.
Existing real modules still work.
Existing custom module builder still works.
Existing field config still works.
Existing module settings still works.
Validate

Run:

cd backend
alembic upgrade head
pytest

Then:

cd frontend
npm run lint
npm run bRemove:

frontend/app/dashboard/modules/[moduleKey]/page.tsx

Remove the route helper from frontend/lib/routes.ts if present:

genericModule: (moduleKey: string) => `/dashboard/modules/${moduleKey}`

Remove placeholder display entries from frontend/lib/module-display.ts for:

sales_leads
sales_activities
sales_notes
sales_quotes
sales_orders
finance_invoices
finance_payments
finance_credit_notes
finance_expenses
purchase_vendors
purchase_orders
inventory_warehouses
inventory_locations
inventory_stock_moves
inventory_stock_adjustments
support_tickets
projects
project_tasks
Migration cleanup

Remove or neutralize only the migration pieces that introduced generic_system_records.

Keep the Alembic chain valid.

Do not touch existing real business tables.

Do not remove

Do not remove existing real modules:

contacts
accounts / organizations
deals / opportunities
tasks
documents
products
services
finance IO
finance POS
mail
calendar
whatsapp backend helpers
message templates
module builder
field config
module settings

Do not remove the custom module builder system:

CustomModuleDefinition
CustomModuleFieldDefinition
CustomModuleRecord
/dashboard/settings/module-builder
/dashboard/custom/...
Expected final state
No /dashboard/modules/... route.
No /generic-system-modules/... API.
No GenericSystemRecord model.
No generic_system_records table/model references.
No placeholder ERP modules showing in sidebar or module settings.
Existing real modules still work.
Existing custom module builder still works.
Existing field config still works.
Existing module settings still works.
Validate

Run:

cd backend
alembic upgrade head
pytest

Then:

cd frontend
npm run lint
npm run build

Then run a repo-wide search for:

generic_system_records
GenericSystemRecord
generic-system-modules
/dashboard/modules
sync_system_modules
SYSTEM_MODULES

Those references should be gone except in documentation explaining this cleanup.uild

Then run a repo-wide search for:

generic_system_records
GenericSystemRecord
generic-system-modules
/dashboard/modules
sync_system_modules
SYSTEM_MODULES

Those references should be gone except in documentation explaining this cleanup