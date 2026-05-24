# Module Template

Use this scaffold to create a standard tenant-scoped CRUD module without rebuilding the same backend and frontend structure each time.

The template follows the current built-in module pattern:

- Backend files live under `backend/app/modules/<area>/` with model/schema snippets pasted into the area's shared `models.py` and `schema.py`.
- Backend routes are registered from `backend/app/api/v1/router.py`; area routers such as sales are included with `prefix="/sales"`.
- Frontend pages use the Next.js App Router under `frontend/app/dashboard/<area>/<modules>/`.
- Frontend API calls use `apiFetch` from `frontend/lib/api.ts`.
- List pages use saved views, module field configs, custom fields, shared table primitives, `Pagination`, `SearchBar`, `SavedViewSelector`, and `InlineSavedViewFilters`.
- Sidebar entries come from seeded module metadata, with `components/sidebar/Sidebar.tsx` only needing a canonical route mapping when the module should use a built-in dashboard route.

## Create a Module

Run the helper from the repo root:

```bash
python3 scripts/create-module.py sales vendors
```

This creates backend route/repository/service files, a migration template, and frontend hook/type/page/component files. It refuses to overwrite existing files.

The script does not patch shared production registries. It prints snippets to paste into:

- `backend/app/modules/<area>/models.py`
- `backend/app/modules/<area>/schema.py`
- `backend/app/api/v1/router.py`
- `backend/app/bootstrap/seed.py` when the module should be seeded for all tenants
- `frontend/lib/routes.ts`
- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/lib/moduleViewConfigs.ts`
- `frontend/lib/module-display.ts`
- `frontend/hooks/useModuleFieldConfigs.ts` if a protected field is required
- record activity/document union types only when those panels are enabled for the module

## Placeholders

- `__area__`: module area, for example `sales`
- `__module__`: singular snake case, for example `vendor`
- `__modules__`: plural snake case, for example `vendors`
- `__Module__`: singular PascalCase, for example `Vendor`
- `__Modules__`: plural PascalCase, for example `Vendors`
- `__MODULE_KEY__`: module key, for example `sales_vendors`
- `__table__`: database table, for example `sales_vendors`
- `__id_field__`: primary key, for example `vendor_id`
- `__api_prefix__`: API path, for example `/sales/vendors`
- `__route_prefix__`: dashboard route, for example `/dashboard/sales/vendors`
- `__display_name__`: UI label, for example `Vendors`
- `__frontend_path__`: frontend page path, for example `frontend/app/dashboard/sales/vendors`
- `__frontend_route__`: frontend route, for example `/dashboard/sales/vendors`

## What to Edit

Safe generated files to edit for the module domain:

- `backend/app/modules/<area>/repositories/<modules>_repository.py`
- `backend/app/modules/<area>/services/<modules>_services.py`
- `backend/app/modules/<area>/routes/<modules>_routes.py`
- `backend/alembic/versions/create_<table>.py`
- `frontend/hooks/<area>/use<Modules>.ts`
- `frontend/types/<modules>.ts`
- `frontend/components/<modules>/<Module>Form.tsx`
- `frontend/components/<modules>/<Modules>Table.tsx`
- generated list/detail/create/edit pages

Shared registry edits should stay minimal and match the printed snippets.

## Route Mapping

With `area=sales` and `modules=vendors`, backend routes use:

- FastAPI router prefix in the module route file: `/vendors`
- Main router registration: `router.include_router(sales_vendors_router, prefix="/sales")`
- Frontend API path: `/sales/vendors`
- Dashboard route: `/dashboard/sales/vendors`

The browser calls `/api/v1/sales/vendors` through `apiFetch`.

## Example: Sales Vendors

```bash
python3 scripts/create-module.py sales vendors
```

The script derives:

- module key: `sales_vendors`
- table: `sales_vendors`
- primary key: `vendor_id`
- backend files: `vendors_repository.py`, `vendors_services.py`, `vendors_routes.py`
- frontend names: `VendorListPage`, `VendorDetailPage`, `VendorCreatePage`, `VendorEditPage`, `VendorForm`, `VendorsTable`

Then paste the printed snippets, adjust fields, and revise validation/search labels for the real vendor domain.

## Migrations

Review the generated migration, set a real revision/down revision, then run:

```bash
docker compose exec -T backend alembic upgrade head
docker compose exec -T backend alembic current
```

## Testing

Use targeted checks first:

```bash
docker compose exec -T backend python -m compileall app tests
docker compose exec -T frontend npm run lint
```

For a production module slice, also add focused backend route/service tests and smoke the list, create, detail, edit, delete, module-field, and permission paths.
