# Backend Rules

The backend is FastAPI + SQLAlchemy + Alembic on PostgreSQL, with Redis and Celery for shared caching and background work.

## Core backend rules

- New tenant-owned or tenant-configurable data must be tenant-aware from the start.
- Route access is layered:
  1. tenant module enablement
  2. department/team module availability
  3. role action permission
- Service-layer queries must scope by tenant explicitly; auth alone is not enough.
- Linked-record validation must stay inside the same tenant.
- Core operational records use soft delete where recovery is expected.
- Important writes should create activity/audit history where the domain already supports it.
- Prefer existing shared helpers and platform services over module-specific duplication.

## Architecture preferences

- Put route concerns in routes, business logic in services, persistence in models, and reusable platform concerns in shared core/platform helpers.
- For tenant-owned operational modules, use repositories for DB/query construction, services for business rules and side effects, and routes only for HTTP/auth/serialization concerns.
- Keep offset pagination for existing list routes, and add cursor/keyset pagination for high-volume operational lists. Cursor endpoints must use deterministic ordering that matches the cursor value; the current default is strict descending primary-key order after clearing inherited ordering with `order_by(None)`.
- Reuse shared search, import/export, pagination, upload/download, notification, activity, comments, and background-job patterns before adding new implementations.
- Keep Postgres-backed search as the default. Use existing shared search helpers or the platform search backend rather than adding module-specific search engines or external services.
- Long-running import/export or provider-sync work should use persisted jobs + Celery, not block request threads.
- Prefer explicit, trusted serializers and variable maps over evaluating arbitrary user input.
- Keep client portal auth, CRM user auth, and public integration-key auth as separate boundaries.
- Public integration endpoints may return only explicitly public data.

## Foundations every module uses (13-final-fixes.md FQ)

- **One commit per business action.** Services flush; the route, job or automation run that
  owns the action commits once, with its activity rows and events in the same transaction.
  A composite flow (conversion, quote → order, posting a document) wraps its route body in
  `with unit_of_work(db):` (`app/core/unit_of_work.py`), which turns a nested `db.commit()`
  into a flush. Work that must wait for the commit (queueing Celery tasks) goes through
  `on_commit(db, fn)`; events are staged with `stage_crm_event` / `stage_standard_crm_event`
  and dispatched after commit. `safe_emit_crm_event` and `safe_log_activity` use a savepoint
  inside a unit of work, so their failure never undoes the action.
- **One list query per module.** The list, its cursor, its export, reports and mass actions
  all start from the same builder, so an export holds exactly the rows the list shows:
  - repositories (`build_*_query` in `modules/<area>/repositories/`): leads, contacts,
    accounts, deals, quotes, tasks, documents, calendar, mail, custom module records, admin
    users, invoices, catalog items (`catalog_item_repository`), client portal, website
    integrations, WhatsApp, call logs, inventory documents;
  - services: deliveries, returns, purchase orders, receipts, bills, credit notes and
    payments (`list_query`), sales orders (`build_orders_query`). The document exports go through
    `platform/services/document_exports.py`, and the export-job routes take the list's own
    filters.
  New code follows the module it joins; a new module uses a repository.
- **One permission check outside a route's dependencies:** `can_access` / `require_access`
  (and the `_any` forms) from `app/core/permissions.py`, or `PermissionPolicy(db, user).can(...)`
  in a service. All three layers, every time; no private `_allowed`/`_can`/`_require`.
- **Products and services are one implementation** (`catalog_item_services`,
  `catalog_item_repository`, `catalog_item_routes`), parameterised by `CatalogKind`.

## Data and migration rules

- Use Alembic for schema changes.
- Keep Alembic revision IDs at 32 characters or fewer; the existing `alembic_version.version_num` column is `VARCHAR(32)`.
- Make defaults/backfills deterministic for existing rows.
- Avoid silent data loss during cleanup migrations.
- Validate migration chain and model drift when schema work is touched.
- Use PostgreSQL deliberately: proper indexes, tenant-scoped queries, and query/load choices that fit real access patterns.

## Files and external systems

- Uploaded documents must stay behind authenticated download routes unless intentionally public.
- Validate upload type, shape, size, quota, and path safety.
- Treat Redis as shared acceleration with graceful local fallback where the existing architecture allows it.
- Keep Google, mail, calendar, document-provider, and webhook integrations least-privilege and explicitly opt-in.

## Verification expectations

For backend changes, consider:
- targeted unit/route tests through the backend container
- `docker compose exec -T backend python -m compileall app tests`
- migration upgrade/current checks through the backend container when schema changes exist
- tenant-scope, permission, linked-record, soft-delete, activity-log, and failure-path checks
