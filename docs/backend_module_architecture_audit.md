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
| Mail | Complete, pending container rerun | Repository/service/routes exist, tenant and owner-user scoping, Postgres search helper usage, additive `/mail/messages/cursor`, syntax-checked. | Re-run `tests.test_cursor_pagination tests.test_mail_imap_smtp` in the backend container after the Docker approval limit clears. Mail sync/send remain provider-specific integration flows and should stay background/scope-aware. |
| Client portal | Partial | Repository/service/routes exist, tenant-scoped account/page/customer-group behavior, public/private auth boundaries. | Add cursor mode only for internal admin lists if needed; keep public signed/token surfaces separate. |
| Website integrations | Integration | Repository/service/routes exist, public catalog/order integration boundaries, POS invoice bridge. | Do not force generic cursor/recycle onto public integration endpoints; audit internal orders list separately. |
| WhatsApp | Integration | Repository/service/routes exist for click/interaction tracking. | Keep intentionally deferred automated sending closed; add cursor/list only if an internal operational interaction list is exposed. |
| User management/admin | Partial | Services/routes for users, modules, roles, departments, teams, profile, saved views. | Add repositories for admin users/modules/structure where query complexity justifies it; add cursor mode for admin user lists if they become high-volume. |
| Platform custom fields/module fields | Platform | Shared tenant-scoped configuration services and routes. | Keep as platform primitives, not business modules. |
| Platform custom modules | Partial | Runtime custom module definitions/records/services/routes exist. | Add cursor mode and stricter repository split for custom module record lists. |
| Generic system records | Partial | Generic record service/routes for new ERP/CRM modules, soft delete/restore. | Add cursor mode for generic record lists and route tests. |
| Global search | Platform | Shared service across modules using Postgres search helpers. | Wire future module search through `backend/app/modules/platform/search` when changing search behavior. |
| Activity logs, comments, notifications, message templates, data-transfer jobs, recycle bin | Platform | Shared services/routes with tenant scoping and module-aware behavior. | Add cursor mode only where list volume requires it; keep shared contracts stable. |

## Next Completion Order

1. Generic system records cursor list and tests.
2. Custom module records cursor list and tests.
3. Client portal internal admin lists, only where volume justifies cursor mode.
4. User management admin users list repository/cursor cleanup.
5. Website integration orders audit without changing public API contracts unless needed.

Do not broaden integration/public surfaces just to match internal module ergonomics.
