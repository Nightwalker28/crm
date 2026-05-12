# Module Builder — Phased Implementation Plan

**Status:** Phase 10 complete  
**Owner:** Platform / CRM Core  
**Priority:** High  
**Type:** Platform Primitive  
**Scope:** Tenant-specific runtime modules

## Goal

Build a tenant-specific Module Builder that allows CRM admins to create simple business modules without code changes.

Admins should be able to define:
- module name
- description
- fields
- field type
- field label
- required flag
- unique flag
- default values
- validation
- display settings

Created modules must behave like normal Lynk modules:
- tenant-scoped
- permission-gated
- role access controlled
- module enablement supported
- CRUD support
- recycle bin support
- import/export support
- saved views compatibility
- activity logging

## Product Principles

### Tenant Isolation
Custom modules are tenant-specific.
A module created by Tenant A must never appear for Tenant B.

All queries must enforce:
- tenant_id

### Platform Primitive First
Reuse:
- module architecture
- role permissions
- tenant module configs
- recycle bin
- activity logging
- import/export patterns
- saved views

Avoid one-off shortcuts.

### Extensible Architecture
Relationships are NOT Phase 1.
Design schema so relationships can be added later.

## Architecture Decision

### Generic Runtime Storage
Do NOT dynamically create DB tables.

Use generic storage tables.

Why:
- easier migrations
- easier permissions
- easier imports/exports
- easier schema evolution
- easier maintenance

## Phase 1 Architecture Spec

**Status:** Complete

The Module Builder is a platform primitive, not a standalone module. It uses:
- global `modules` rows for navigation and role/action permission integration
- tenant-owned `custom_module_definitions` rows for the actual module schema
- generic `custom_module_records` and `custom_module_record_values` rows for runtime data
- existing tenant module configs, department/team access, role module permissions, recycle bin, activity logs, saved views, and CSV export primitives

Security boundary:
- `module_key` is never trusted by itself
- custom module definitions are always resolved by `tenant_id + key`
- custom module registry rows must not be visible to other tenants
- runtime record queries must always scope by `tenant_id` and `custom_module_id`

Phase 1 intentionally excludes relationships, formulas, workflow automation, file/image fields, public forms, and dynamic DB tables.

## Phase 1 Field Types

Supported:
- text
- textarea
- number
- currency
- date
- datetime
- boolean
- email
- phone
- url
- single_select
- multi_select

Deferred:
- relationship
- lookup
- formula
- computed
- file
- image
- user
- team
- address
- rich_text

## Data Model

### custom_module_definitions

Purpose:
Stores module metadata.

Fields:
- id
- tenant_id
- name
- key
- description
- icon
- is_active
- module_id
- created_by_user_id
- updated_by_user_id
- created_at
- updated_at
- deleted_at

Constraints:
- unique(tenant_id, key)

### custom_module_field_definitions

Fields:
- id
- tenant_id
- custom_module_id
- key
- label
- field_type
- help_text
- placeholder
- is_required
- is_unique
- display_in_list
- default_value
- validation_json
- sort_order
- is_active
- created_at
- updated_at
- deleted_at

Constraints:
- unique(custom_module_id, key)

### custom_module_records

Fields:
- id
- tenant_id
- custom_module_id
- title
- created_by_user_id
- updated_by_user_id
- created_at
- updated_at
- deleted_at

### custom_module_record_values

Fields:
- id
- tenant_id
- custom_module_id
- record_id
- field_id
- text_value
- number_value
- datetime_value
- boolean_value
- json_value
- created_at
- updated_at

Constraint:
- unique(record_id, field_id)

## Value Mapping

| Field Type | Storage |
|------------|----------|
| text | text_value |
| textarea | text_value |
| email | text_value |
| phone | text_value |
| url | text_value |
| single_select | text_value |
| number | number_value |
| currency | number_value |
| date | datetime_value |
| datetime | datetime_value |
| boolean | boolean_value |
| multi_select | json_value |

## Permissions & Access

When module is created:

1. Register module
2. Create tenant module config
3. Seed default role permissions
4. Apply department/team access rules

## Routing Strategy

Builder:
- /dashboard/module-builder
- /dashboard/module-builder/{module_id}
- /dashboard/module-builder/{module_id}/fields

Runtime:
- /dashboard/custom/{module_key}
- /dashboard/custom/{module_key}/{record_id}

## UI Plan

### Module Builder Screen
Allow:
- create module
- edit metadata
- add fields
- reorder fields
- disable module
- delete/restore module

### Field Builder
Per field:
- label
- type
- required
- unique
- display in list
- help text
- default value
- validation/options

### Generated Runtime Module
Must support:
- list
- search
- create
- edit
- detail
- delete
- restore
- export

## Validation Rules

Required:
- reject empty values

Unique:
- enforce uniqueness by tenant + module + field

Type validation:
- email
- url
- number
- date
- select option validation

## Recycle Bin
Support:
- soft delete
- restore

Reuse existing recycle bin.

## Activity Logging
Track:
- module created/updated
- field changes
- record CRUD
- restore actions

## Import / Export

Phase 1:
- CSV export

Later:
- CSV import with validation

## Security Rules

Always verify:
- tenant
- module
- permission

Never trust module_key alone.

## Out of Scope (Phase 1)

Do NOT implement:
- relationships
- formulas
- computed fields
- workflow automation
- dashboards
- kanban/calendar
- file/image uploads
- public forms
- field-level permissions
- dynamic DB tables

## Future Relationship Plan

Later support:
- many_to_one
- one_to_many
- many_to_many

Examples:
- Asset → Organization
- Vehicle → Contact
- Contract → Opportunity

Not Phase 1.

## Implementation Phases

### Phase 1 — Planning
Create architecture/spec only.

### Phase 2 — Backend Schema
Status: Complete.

Build:
- module definitions
- field definitions
- records
- record values

Schema notes:
- all custom-module tables carry `tenant_id`
- module keys are unique per tenant
- field keys are unique per custom module
- record values use one typed storage column per supported field category
- record values retain `tenant_id` and `custom_module_id` for explicit scoping and future indexing
- relationships remain deferred, but the record/value model can later add relationship value storage without dynamic DB tables

### Phase 3 — Module Builder APIs
Status: Complete.

Build:
- create/edit/delete module
- field management

API notes:
- builder routes are admin-only CRM dashboard routes
- module reads use public service functions instead of route-level private helper calls
- module delete is soft-delete and disables the backing `modules` registry row
- module restore re-enables the backing `modules` registry row
- field delete is soft-delete and hides prior values from runtime serialization
- duplicate keys and unsupported unique multi-select fields return explicit errors

### Phase 4 — Runtime Record APIs
Status: Complete.

Build:
- list/create/edit/delete/restore records

API notes:
- runtime schema and record APIs resolve modules by `tenant_id + module_key`
- list/search requires view access and searches record title plus text-backed values
- create requires create access and validates required/type/select/unique rules
- update requires edit access and treats omitted fields as unchanged
- delete is soft-delete and requires delete access
- restore requires restore access
- unknown field keys are rejected instead of silently ignored

### Phase 5 — Module Builder UI
Status: Complete.

Build admin screens.

UI notes:
- admins can create modules from `/dashboard/module-builder`
- admins can edit module name/description
- admins can soft-delete and restore modules
- admins can add, update, deactivate, delete, and reorder fields
- field builder supports required, unique, list display, defaults, help text, placeholders, and select options
- deleted modules remain visible in the builder with restore controls

### Phase 6 — Generated Module UI
Status: Complete.

Build runtime screens.

UI notes:
- generated runtime pages live at `/dashboard/custom/{module_key}`
- runtime pages support list, search, create, edit, delete, and CSV export
- runtime forms render field-type-aware controls for text, textarea, number, currency, date, datetime, boolean, single-select, and multi-select
- runtime pages use the configured `display_in_list` fields for table columns

### Phase 7 — Access Hardening
Status: Complete.

Ensure permissions and module visibility.

Access notes:
- custom module runtime access resolves definitions by tenant before checking module/action permissions
- runtime access honors tenant module enablement even for admins
- builder active/delete/restore operations keep the backing `modules` row and tenant module config in sync
- custom module registry rows are hidden from other tenants in module lists and role-permission surfaces

### Phase 8 — Export
Status: Complete.

Add CSV export.

Export notes:
- runtime CSV export lives at `/api/v1/custom-modules/{module_key}/export`
- export requires module `export` action access
- export resolves the module by `tenant_id + module_key`
- export uses typed runtime values and existing CSV formula-cell hardening

### Phase 9 — Import
Status: Complete.

Add CSV import.

Import notes:
- runtime CSV import lives at `/api/v1/custom-modules/{module_key}/import`
- import preview lives at `/api/v1/custom-modules/{module_key}/import/preview`
- import requires module `create` action access
- import uses existing CSV upload validation, mapping helpers, and standard import summary shape
- imported rows use the same required/type/select/unique validation as normal runtime record creation
- row-level failures are reported without stopping the entire import

### Phase 10 — Polish
Recycle bin, activity logs, saved views, UX.
Status: Complete.

Polish notes:
- Recycle Bin includes tenant custom modules in the module selector
- module, field, record, delete, and restore writes use existing activity logging
- custom module keys are reserved against built-in module names to avoid shared-surface collisions
- generated runtime module pages use saved-view selection for search and visible columns
- `/dashboard/views/{module_key}` can manage saved views for custom modules using the generated field schema

## Codex Rules

1. Keep changes small.
2. Follow phases strictly.
3. Do not jump ahead.
4. Reuse platform primitives.
5. No dynamic DB tables.
6. Alembic revision IDs <= 32 chars.
7. Follow tenant isolation everywhere.
8. Keep future relationships possible.
