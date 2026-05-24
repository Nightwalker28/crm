Create a reusable full-stack module boilerplate system for this CRM repo, based on the actual existing backend and frontend module architecture.

Important:
Inspect the repo before editing. Do not assume paths. Find and follow the existing patterns used by the current CRM modules.

Known backend conventions:
- FastAPI app includes app.api.v1.router from backend/app/main.py.
- Main API router is backend/app/api/v1/router.py with prefix /api/v1.
- Sales routes are imported from app.modules.sales.routes.<name>_routes and included with prefix="/sales".
- Existing sales backend uses:
  - backend/app/modules/sales/models.py
  - backend/app/modules/sales/schema.py
  - backend/app/modules/sales/routes/*_routes.py
  - backend/app/modules/sales/services/*_services.py
  - backend/app/modules/sales/repositories/*_repository.py
- Models use app.core.database.Base, BigInteger IDs, tenant_id, deleted_at, created_time, PostgreSQL partial indexes, and sometimes search_doc Computed columns.
- Routes use get_db, require_user, require_module_access, require_action_access, Pagination, build_paged_response, filtering helpers, and module field/custom field helpers.
- Schemas use Pydantic v2 ConfigDict(from_attributes=True).

Frontend requirements:
Before creating frontend templates, inspect the actual frontend structure and identify:
1. Where frontend pages live.
2. Where API helper/client files live.
3. How API requests are made.
4. How routes are registered.
5. How sidebar/module navigation entries are registered.
6. How module permissions/access checks are handled in the UI.
7. How list pages, detail pages, create/edit pages, forms, tables, loading states, empty states, and error handling are currently implemented.
8. How custom fields/module fields are rendered or hidden in existing modules.
9. How existing sales modules such as contacts, leads, organizations, opportunities, quotes, tasks, or catalog modules are structured.

Goal:
Add a reusable full-stack boilerplate under docs/module-template for creating a new standard tenant-scoped CRUD module with matching backend and frontend files.

Do not create a real production module yet. Only create the template/scaffold docs and helper script.

Create these documentation/template files:

1. docs/module-template/README.md
2. docs/module-template/checklist.md

Backend template files:
3. docs/module-template/backend/app/modules/__area__/models.__module__.snippet.py
4. docs/module-template/backend/app/modules/__area__/schema.__module__.snippet.py
5. docs/module-template/backend/app/modules/__area__/repositories/__modules___repository.py
6. docs/module-template/backend/app/modules/__area__/services/__modules___services.py
7. docs/module-template/backend/app/modules/__area__/routes/__modules___routes.py
8. docs/module-template/backend/app/api/v1/router.registration.snippet.py
9. docs/module-template/backend/alembic/versions/create___table__.py

Frontend template files:
Inspect the repo first, then create frontend templates in paths that match the real project structure.

The frontend template should include equivalents for:
- API functions/client file
- TypeScript types/interfaces
- list page
- detail/view page
- create page
- edit page
- reusable form component
- reusable table/list component
- route registration snippet
- sidebar/module navigation registration snippet
- permissions/module access snippet if the frontend uses one
- optional custom fields/module fields integration snippet if existing modules support it

Use the project’s actual UI components, import aliases, hooks, layout wrappers, table components, form components, button/input components, toast/notification system, loading components, and route style. Do not invent a new UI style.

Suggested frontend template placeholders:
- __area__
- __module__
- __modules__
- __Module__
- __Modules__
- __MODULE_KEY__
- __table__
- __id_field__
- __api_prefix__
- __route_prefix__
- __frontend_path__
- __frontend_route__
- __display_name__

Use these placeholders across backend and frontend:
- __area__
- __module__
- __modules__
- __Module__
- __Modules__
- __MODULE_KEY__
- __table__
- __id_field__
- __api_prefix__
- __route_prefix__

The scaffold script:
Create scripts/create-module.py.

It should:
- Accept area and plural module name, for example:
  python scripts/create-module.py sales vendors
- Generate backend repository, service, and route files.
- Generate frontend module files using the real frontend structure.
- Print snippets that must be manually appended to:
  - backend/app/modules/<area>/models.py
  - backend/app/modules/<area>/schema.py
  - backend/app/api/v1/router.py
  - frontend route registry
  - frontend sidebar/module registry
  - frontend permission/module access registry if applicable
- Refuse to overwrite existing files.
- Use repo-style names:
  - vendors_repository.py
  - vendors_services.py
  - vendors_routes.py
- Use module key sales_vendors for area=sales and modules=vendors.
- Use table name sales_vendors.
- Use primary key vendor_id for vendors.
- Generate frontend names consistently:
  - VendorListPage
  - VendorDetailPage
  - VendorCreatePage
  - VendorEditPage
  - VendorForm
  - VendorTable
  - vendorsApi or equivalent matching repo style
  - Vendor / VendorCreateRequest / VendorUpdateRequest types

Backend boilerplate must support:
- tenant scoping
- list with pagination
- search
- get by id
- create
- update
- soft delete
- permission checks
- module access checks
- custom field hydration
- disabled module field filtering/sanitization
- repository/service/route separation
- Alembic migration template

Frontend boilerplate must support:
- list page with pagination/search if existing modules do
- create/edit forms
- detail/view page
- delete action if existing modules expose it
- API error handling matching the repo
- loading states matching the repo
- empty states matching the repo
- navigation after create/update matching the repo
- route registration matching the repo
- sidebar/module metadata matching the repo
- permissions/access checks matching the repo
- custom/module fields only if existing frontend modules use them

README.md must explain:
1. How to create a new module.
2. Which placeholders are used.
3. Which generated files are safe to edit.
4. Which snippets must be manually pasted.
5. How backend routes map to frontend API paths.
6. How to create a sample module called vendors under sales.
7. How to run migrations.
8. How to test the generated module.

checklist.md must include:
Backend:
- model snippet added
- schema snippet added
- repository created
- service created
- route created
- router registered
- migration created
- module key registered if needed
- permissions seeded if needed
- module fields/custom fields configured if needed

Frontend:
- API file created
- types created
- list page created
- detail page created
- create page created
- edit page created
- form component created
- table/list component created
- route registered
- sidebar/module nav registered
- permissions/access registry updated if needed
- custom/module fields handled if needed

After implementation:
- List every file created.
- List every existing file that was modified.
- Explain how to create a vendors module under sales.
- Explain exactly which manual edits are still required.
- Mention any frontend areas where the repo has multiple patterns and which one you chose.
- Do not create an actual vendors module.
- Do not modify existing production modules except adding docs/scripts/templates.
- Keep the generated template minimal but complete enough for a working standard CRUD module.