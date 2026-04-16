# Shared Platform Primitives

This file lists the shared/global primitives that should be reused across modules instead of reimplemented locally.

## Frontend Shared Primitives

### Saved Views / Module Views

- `frontend/hooks/useSavedViews.ts`
  - Shared hook for loading, selecting, creating, updating, deleting, and defaulting named saved views.
- `frontend/components/ui/SavedViewSelector.tsx`
  - Shared compact UI for switching the active module view and navigating to the dedicated manage-view route.
- `frontend/components/ui/ColumnPicker.tsx`
  - Shared UI for visible-column toggling and reordering.
- `frontend/lib/moduleViewConfigs.ts`
  - Shared registry of module view defaults, current module column definitions, routes, and filterable field definitions.
- `frontend/app/dashboard/views/[moduleKey]/page.tsx`
  - Shared route-based manage-view surface for naming, columns, default search, and reusable filter conditions.
- `frontend/lib/savedViewQuery.ts`
  - Shared query-param serializer for search and saved-view condition filters.

### List / Table Presentation

- `frontend/components/ui/ModuleTableShell.tsx`
  - Shared list/table container shell.
- `frontend/components/ui/SearchBar.tsx`
  - Shared search input pattern.
- `frontend/components/ui/Pagination.tsx`
  - Shared pagination control.

### Reference / Shared Data Hooks

- `frontend/hooks/useCompanyCurrencies.ts`
  - Shared hook for company-managed currency options.
- `frontend/hooks/useModuleCustomFields.ts`
  - Shared hook for module custom-field definitions.

## Backend Shared Primitives

### Saved Views

- `backend/app/modules/user_management/services/profile.py`
  - `list_saved_views`
  - `create_saved_view`
  - `update_saved_view`
  - `delete_saved_view`
- `backend/app/modules/user_management/routes/profile.py`
  - shared saved-view API surface
- `backend/app/core/module_filters.py`
  - shared condition-filter parsing and SQLAlchemy filter application helpers

### Search / Import / Export

- `backend/app/core/module_search.py`
  - shared ranked search helper
- `backend/app/core/module_csv.py`
  - shared CSV parsing / upload helpers
- `backend/app/core/module_export.py`
  - shared export/download helpers

### Permissions / Access

- `backend/app/core/permissions.py`
  - route-level action permission helpers
- `backend/app/core/access_control.py`
  - access-control helpers and enforcement logic

### Caching

- `backend/app/core/cache.py`
  - shared cache abstraction with Redis/local fallback

### Custom Fields

- `backend/app/modules/platform/services/custom_fields.py`
  - shared definition lookup, validation, hydration, and persistence helpers

## Module Onboarding Rules

When adding a new module that has a list/index view, do not build view-state behavior from scratch.

### Minimum required shared integration

1. Add the module key to the saved-view allowlist on the backend.
2. Add the module’s column definitions and default config to `frontend/lib/moduleViewConfigs.ts`.
3. Use `useSavedViews.ts` in the module page.
4. Use `SavedViewSelector.tsx` in the module page and route detailed view-management work through the shared manage-view route.
5. Keep `ColumnPicker.tsx` inside the manage-view flow instead of rebuilding a module-specific column editor.
6. Use `ModuleTableShell.tsx` for the list/table container.
7. Send `fields` to the backend list endpoint based on the active visible columns.
8. Send the shared saved-view filter payload to the backend list/search endpoint rather than inventing module-local filter query shapes.
9. Prefer shared search/import/export helpers instead of new one-off implementations.

### Expected saved-view config direction

Saved views should eventually store:
- visible columns
- column order
- search/filter state
- filter logic (`all` / `any`)
- reusable condition rules
- sort state

### Things not to do

- Do not add a new module with module-specific hidden table-preference behavior.
- Do not create a new list-page visual system if the module is table-oriented.
- Do not introduce free-text relationship fields if the platform rule is a linked selector.
