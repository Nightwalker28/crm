# Backend Module Architecture Audit

Status key:

- `Complete`: matches the current backend module default for its surface.
- `Partial`: has some pieces, but still needs backend-architecture cleanup.
- `Platform`: shared infrastructure where the standard applies differently.
- `Integration`: external/public surface where cursor/list defaults apply only to internal operational lists.

## Default Backend Module Standard

Tenant-owned operational modules should use this shape by default:

- Routes handle HTTP, auth, module/action permission checks, request parsing, and response serialization.
- Services own business rules, side effects, activity/audit behavior, import/export orchestration, and linked-record validation.
- Repositories own database query construction and persistence-only helpers with explicit `tenant_id` or scoped current-user input.
- List routes keep offset pagination for compatibility and add cursor/keyset mode for high-volume operational lists.
- Cursor mode must use one deterministic ordering that matches its cursor. Current default is strict descending primary-key order with `order_by(None).order_by(<id>.desc())`.
- Search stays Postgres-backed through shared search helpers or the platform search backend; do not add external search services.
- Soft-delete/recoverable modules keep `deleted_at`, recycle-bin listing/restore where supported, and purge through the shared retention job.
- Schema changes go through Alembic with additive safe migrations and tenant-aware indexes.

## Current Module Status

| Module area | Status | Done | Remaining work |
| --- | --- | --- | --- |
| Sales contacts | Complete | Repository/service split, import/export split, tenant-scoped queries, offset and cursor lists, search, recycle, data-transfer jobs, tests. | Keep future changes on repository/service boundaries. |
| Sales organizations / Accounts | Complete | Repository layer, tenant-scoped list/search/filter, cursor endpoint, recycle/import/export, tests. | Keep table/route compatibility while labels remain Accounts. |
| Sales opportunities / Deals | Complete | Repository layer, tenant-scoped list/search/filter, cursor endpoint, recycle/import/export, tests. | Keep table/route compatibility while labels remain Deals. |
| Finance insertion orders | Complete | Repository layer, service/API split, tenant and finance user scoping, cursor endpoint, import/export, search, tests. | Keep route compatibility. |
| Finance POS invoices | Complete | Repository layer, service split, tenant-scoped list/search, cursor endpoint, soft delete, tests. | Payment allocation automation remains deferred. |
| Catalog products | Complete | Repository/service/routes, tenant-scoped list/search, cursor endpoint, soft delete/restore, media validation, tests. | Inventory automation remains deferred. |
| Catalog services | Complete | Repository/service/routes, tenant-scoped list/search, cursor endpoint, soft delete/restore, media validation, tests. | None for current standard. |
| Tasks | Complete | Repository/service/routes, tenant and assignee visibility, cursor endpoint, soft delete, task-source validation, tests. | None for current standard. |
| Documents | Complete | Repository/service/routes, tenant-scoped list/cursor, linked-record access validation, secure storage paths, soft delete, tests. | Restore route is not exposed; document recovery stays through shared recycle behavior if supported. |
| Calendar | Complete | Repository/service/routes, tenant and participant visibility, additive `/events/cursor`, soft delete, task links, tests. | Provider sync remains background-job scoped; no external-search work needed now. |
| Mail | Complete | Repository/service/routes exist, tenant and owner-user scoping, Postgres search helper usage, additive `/mail/messages/cursor`, tests. | Mail sync/send remain provider-specific integration flows and should stay background/scope-aware. |
| Client portal | Complete | Repository/service/routes exist, tenant-scoped account/page/customer-group behavior, public/private auth boundaries, additive cursor lists for internal admin accounts/pages. | Keep public signed/token surfaces separate. |
| Website integrations | Integration complete | Repository/service/routes exist, public catalog/order integration boundaries, POS invoice bridge, additive cursor list for internal website orders. | Do not force generic cursor/recycle onto public integration endpoints. |
| WhatsApp | Integration | Repository/service/routes exist for click/interaction tracking. | Keep intentionally deferred automated sending closed; add cursor/list only if an internal operational interaction list is exposed. |
| User management/admin | Complete for admin users | Admin user list/search query construction now lives in a repository, existing offset routes remain, and additive cursor routes exist for list/search. | Add repositories for modules/structure later only where query complexity justifies it. |
| Platform custom fields/module fields | Platform | Shared tenant-scoped configuration services and routes. | Keep as platform primitives, not business modules. |
| Platform custom modules | Complete | Runtime custom module definitions/records/services/routes exist; record lists now use a repository boundary and additive cursor mode, tests. | Keep module-builder/admin-only boundaries intact. |
| Generic system records | Complete | Generic record repository/service/routes for new ERP/CRM modules, soft delete/restore, additive cursor list, tests. | None for current standard. |
| Global search | Platform | Shared service across modules using Postgres search helpers. | Wire future module search through `backend/app/modules/platform/search` when changing search behavior. |
| Activity logs, comments, notifications, CRM events, data-transfer jobs, message templates, recycle bin | Platform | Shared services/routes with tenant scoping and module-aware behavior; additive cursor mode exists for high-volume activity, comment, notification, CRM event, and data-transfer job lists. | Keep shared contracts stable; add cursor mode to any future high-volume shared list when introduced. |

## Next Completion Order

1. Keep WhatsApp as integration-specific unless an internal operational interaction list becomes a product surface.
2. Add repositories for user-management modules/roles/departments/teams later only when query complexity or volume justifies it.
3. Continue enforcing these defaults for all new operational modules and shared high-volume platform lists.

Do not broaden integration/public surfaces just to match internal module ergonomics.
