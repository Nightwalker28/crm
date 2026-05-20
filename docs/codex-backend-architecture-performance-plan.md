# Codex Task: Backend Architecture + Multi-Tenant Performance Refactor Plan

## Context

This repository is a CRM built with FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, Celery, Pydantic, and a Next.js frontend.

The backend already has a modular structure under `backend/app/modules/`, with modules such as sales, finance, catalog, calendar, tasks, client portal, platform, user management, documents, mail, website integrations, and WhatsApp.

The goal is **not** to rewrite the stack. Keep Python, FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, and Celery.

The goal is to make the backend cleaner, more maintainable, and safer for multi-tenant scale where a single tenant may eventually have 1M+ records in CRM tables.

---

## Very Important Rules for Codex

1. Do not rewrite the entire backend.
2. Do not change frameworks.
3. Do not replace SQLAlchemy with Prisma or any other ORM.
4. Do not introduce Elasticsearch/OpenSearch/Meilisearch yet.
5. Do not change API contracts unless absolutely necessary.
6. Keep existing routes working.
7. Make small, reviewable commits/PRs.
8. Prefer incremental refactoring over big-bang rewrites.
9. Every migration must be safe for existing data.
10. Every large table query must remain tenant-scoped.
11. Do not move deleted rows into separate per-module deleted tables unless a real production bottleneck proves it is needed.

---

## Target Backend Module Pattern

Each major module should gradually move toward this structure:

```text
backend/app/modules/<module>/
  models.py
  schema.py
  routes/
    <entity>_routes.py
  services/
    <entity>_service.py
    <entity>_import_service.py      # only where needed
    <entity>_export_service.py      # only where needed
    <entity>_summary_service.py     # only where needed
  repositories/
    __init__.py
    <entity>_repository.py
```

### Responsibility Split

#### `models.py`

Only SQLAlchemy table definitions and relationships.

#### `schema.py`

Only Pydantic request and response schemas.

#### `routes/`

Routes should be thin. They should handle URL structure, dependencies, permissions, request/response models, and service calls.

Routes should not contain complex DB query logic, duplicate detection logic, import/export processing, heavy business rules, or search ranking logic.

#### `services/`

Services are responsible for business rules: create/update/delete behavior, duplicate handling, custom field orchestration, activity/event logging orchestration, import/export workflow coordination, and repository calls.

#### `repositories/`

Repositories are responsible for database reads/writes/query composition: get by id, list active records, list deleted records, find duplicates, search within tenant, bulk insert, and aggregate query helpers.

Repositories should not know about FastAPI `Depends` or route dependencies.

---

## Current Refactor Priority

Start with **sales contacts** because it touches many CRM patterns:

- tenant scoping
- users/assigned owners
- organizations
- custom fields
- duplicate detection
- import/export
- activity logs
- CRM events
- soft delete
- recycle bin
- pagination
- search/filtering

Current file to refactor first:

```text
backend/app/modules/sales/services/contacts_services.py
```

Split it into:

```text
backend/app/modules/sales/repositories/contacts_repository.py
backend/app/modules/sales/services/contacts_service.py
backend/app/modules/sales/services/contacts_import_service.py
backend/app/modules/sales/services/contacts_export_service.py
```

Keep `backend/app/modules/sales/routes/contacts_routes.py` working with minimal changes.

---

## Suggested Sales Contacts Split

### Move to `contacts_repository.py`

Move pure DB/query functions here:

- build base tenant query
- apply active/deleted filter
- get contact by id
- list contacts
- list deleted contacts
- search contacts
- find duplicate by email/name
- validate assigned user exists
- bulk insert contacts
- fetch contacts for export

Repository functions should accept `db: Session` and explicit arguments such as `tenant_id`, `contact_id`, `pagination`, etc.

Example style:

```python
def get_contact(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int,
    include_deleted: bool = False,
) -> SalesContact | None:
    query = db.query(SalesContact).filter(
        SalesContact.tenant_id == tenant_id,
        SalesContact.contact_id == contact_id,
    )
    if not include_deleted:
        query = query.filter(SalesContact.deleted_at.is_(None))
    return query.first()
```

### Keep in `contacts_service.py`

Keep business rules here: create, update, soft delete, restore, duplicate behavior decisions, custom field orchestration, activity/event logging calls.

### Move to `contacts_import_service.py`

Move CSV import logic here: header validation, row normalization, duplicate import behavior, bulk insert mapping, and import summary.

### Move to `contacts_export_service.py`

Move CSV export logic here: export columns, row serialization, and CSV byte generation.

---

## Apply Same Pattern Later

After contacts, gradually apply the same structure to:

1. Sales organizations
2. Sales opportunities
3. Finance POS invoices
4. Finance IO
5. Catalog products
6. Catalog services
7. Tasks
8. Calendar events
9. Documents
10. Mail
11. Platform custom modules
12. Activity logs / global search

Do not refactor every module in one PR.

---

## Multi-Tenant Performance Standards

Any table that can grow large must follow these rules.

Large tables include:

- `sales_contacts`
- `sales_organizations`
- `sales_opportunities`
- `finance_pos_invoices`
- `finance_pos_invoice_lines`
- `finance_io`
- `tasks`
- `task_assignees`
- `calendar_events`
- `calendar_event_participants`
- `documents`
- `mail_messages` or equivalent mail tables
- `activity_logs`
- `record_comments`
- `notifications`
- custom module records
- website integration leads/orders

### Required Query Pattern

Large active list queries should generally look like:

```sql
WHERE tenant_id = :tenant_id
  AND deleted_at IS NULL
ORDER BY id DESC
LIMIT :limit
```

or:

```sql
WHERE tenant_id = :tenant_id
  AND deleted_at IS NULL
  AND id < :cursor_id
ORDER BY id DESC
LIMIT :limit
```

Never allow unbounded list queries on large tables.

---

## Indexing Standards

Use composite indexes, not only single-column indexes.

Recommended patterns:

```text
(tenant_id, id DESC)
(tenant_id, created_at DESC)
(tenant_id, updated_at DESC)
(tenant_id, status, created_at DESC)
(tenant_id, assigned_to, created_at DESC)
(tenant_id, deleted_at)
```

For soft-deleted tables, prefer partial indexes where supported.

### Active Row Partial Index Example

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_active_tenant_contact_desc
ON sales_contacts (tenant_id, contact_id DESC)
WHERE deleted_at IS NULL;
```

### Deleted Row / Recycle Bin Partial Index Example

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_deleted_tenant_deleted_desc
ON sales_contacts (tenant_id, deleted_at DESC, contact_id DESC)
WHERE deleted_at IS NOT NULL;
```

### Alembic Direction

```python
op.create_index(
    "ix_sales_contacts_active_tenant_contact_desc",
    "sales_contacts",
    ["tenant_id", sa.text("contact_id DESC")],
    postgresql_where=sa.text("deleted_at IS NULL"),
    postgresql_concurrently=True,
)
```

When using `postgresql_concurrently=True`, ensure the Alembic migration handles autocommit correctly because PostgreSQL cannot create indexes concurrently inside a normal transaction.

---

## Pagination Standards

Offset pagination becomes slow with millions of records:

```python
query.offset(pagination.offset).limit(pagination.limit)
```

This is acceptable for small tables but risky for large CRM tables.

Add cursor/keyset pagination for large modules.

Preferred API style:

```text
GET /api/v1/sales/contacts?limit=50&cursor=<last_seen_id>
```

Response style:

```json
{
  "items": [],
  "next_cursor": "12345",
  "has_more": true
}
```

Rules:

1. Keep existing offset pagination for now if frontend depends on it.
2. Add cursor pagination as an additional path or optional mode.
3. Use cursor pagination for high-volume screens.
4. Do not calculate exact total counts by default for huge tables.

---

## Count Query Standards

Avoid calling `query.count()` on every list request for large tables.

Bad at scale:

```python
total_count = query.count()
```

Better options:

- return `has_more`
- calculate approximate totals in background
- cache counts by tenant/module/filter
- only run exact counts on explicit request
- use dashboard summary tables

---

## Search Strategy

### Do Not Add Elasticsearch/OpenSearch Yet

PostgreSQL should remain the source of truth.

For now, optimize PostgreSQL search first:

- computed `search_doc` fields where useful
- `pg_trgm` extension
- GIN trigram indexes
- full-text search where appropriate
- tenant-scoped search queries

### Search Index Pattern

Enable trigram extension:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Add indexes like:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_search_doc_trgm_active
ON sales_contacts
USING gin (search_doc gin_trgm_ops)
WHERE deleted_at IS NULL;
```

Use this pattern for sales contacts, sales organizations, sales opportunities, invoices, documents, client pages, and custom module records.

### Future Search Abstraction

Create a future-safe search abstraction but keep the initial implementation backed by Postgres.

Suggested structure:

```text
backend/app/modules/platform/search/
  __init__.py
  search_backend.py
  postgres_search_backend.py
  search_indexer.py
  search_service.py
```

Interfaces should allow future OpenSearch/Meilisearch without rewriting every module.

---

## Redis/Caching Strategy

Use Redis for derived/read-heavy data, not source-of-truth data.

Good Redis use cases:

- dashboard counters
- summary cards
- tenant module config cache
- permissions cache
- global app config cache
- short-lived search result cache for repeated dashboard queries
- rate limits
- background job state

Suggested cache keys:

```text
tenant:{tenant_id}:dashboard:summary:v1
tenant:{tenant_id}:module-configs:v1
tenant:{tenant_id}:role:{role_id}:permissions:v1
tenant:{tenant_id}:counts:{module_key}:v1
```

Invalidate cache after writes where needed.

---

## Celery / Background Jobs Strategy

Use Celery for anything heavy:

- imports over threshold
- exports
- document processing
- PDF parsing
- email sync
- calendar sync
- search indexing
- dashboard count refresh
- reminder scans
- cleanup jobs
- recycle bin purge jobs

Do not run large imports/exports or purge jobs inside request handlers.

Existing threshold settings should be respected:

- `DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD`
- `DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD`

---

## Database Connection Pooling

Keep these environment variables and tune them per deployment:

```text
DB_POOL_SIZE
DB_MAX_OVERFLOW
DB_POOL_RECYCLE_SECONDS
DB_POOL_PRE_PING
DB_STATEMENT_TIMEOUT_MS
DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
```

Guidelines:

1. Do not blindly increase pool size.
2. Total DB connections = backend replicas × pool size + overflow + Celery workers.
3. Keep PostgreSQL `max_connections` in mind.
4. Use PgBouncer later if connection pressure becomes high.

---

## Transaction Rules

Avoid long-running transactions.

Rules:

1. Keep request transactions short.
2. Do not hold DB transactions while reading large files.
3. Do not hold DB transactions while calling external APIs.
4. For imports, validate/parse outside the transaction where possible, then bulk insert/update in batches.
5. For large update/delete jobs, process in chunks.

---

## Import/Export Standards

For large imports:

- parse and validate in chunks
- use background jobs
- use bulk insert/update where safe
- keep failure reporting separate from the main data transaction
- support resume/retry where possible later

For large exports:

- never load millions of rows into memory
- stream or batch export
- write result file to storage
- return job ID first
- let frontend poll job status

---

## Dashboard / Reporting Standards

Dashboard pages must not run heavy aggregate queries on every page load.

Bad:

```sql
SELECT count(*) FROM sales_contacts WHERE tenant_id = ?;
SELECT count(*) FROM finance_pos_invoices WHERE tenant_id = ?;
SELECT sum(total_amount) FROM finance_pos_invoices WHERE tenant_id = ?;
```

Better:

- cached dashboard summaries
- background refreshed aggregates
- summary tables/materialized views later
- Redis cache with invalidation after important writes

Suggested future table:

```text
tenant_module_metrics
  id
  tenant_id
  module_key
  metric_key
  metric_value
  calculated_at
```

---

## Soft Delete / Recycle Bin Standards

Soft delete should consistently use `deleted_at` for normal user delete behavior.

Normal user-facing list queries:

```sql
deleted_at IS NULL
```

Recycle bin queries:

```sql
deleted_at IS NOT NULL
```

Do not expose "move to trash" wording in normal user UI if the product wording is "delete". Admin recycle bin can still exist internally.

### Recommended Approach: 90-Day Two-Stage Delete Lifecycle

Use a **two-stage delete lifecycle**:

```text
Stage 1: Active table soft delete
  User clicks Delete
  Row remains in original table
  deleted_at is set
  deleted_by_user_id and delete_reason can be added later if needed
  Row appears in admin recycle bin
  Restore is allowed for 90 days

Stage 2: Permanent delete after retention
  After 90 days, a Celery job permanently deletes old soft-deleted rows
  Purge runs in small batches
  Restore is no longer available after purge
```

Default retention configuration:

```env
RECYCLE_BIN_RETENTION_DAYS=90
RECYCLE_BIN_PURGE_BATCH_SIZE=1000
```

### Do Not Move Deleted Rows Immediately By Default

Avoid immediately moving deleted rows into separate per-module tables such as `sales_contacts_deleted`, `finance_pos_invoices_deleted`, etc.

Reasons:

- restore becomes harder
- foreign key relationships become complicated
- audit/history becomes harder
- every module needs duplicate archive models
- cross-module references can break
- queries and migrations become more complex

For example, moving a deleted contact to `sales_contacts_deleted` means related opportunities, invoices, client accounts, tasks, comments, custom fields, and activity logs may still reference the original contact.

### Make Soft Delete Fast With Partial Indexes

For large active-table queries, add partial indexes that only include active rows:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_active_tenant_contact_desc
ON sales_contacts (tenant_id, contact_id DESC)
WHERE deleted_at IS NULL;
```

For recycle bin queries, add separate deleted-row partial indexes:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_deleted_tenant_deleted_desc
ON sales_contacts (tenant_id, deleted_at DESC, contact_id DESC)
WHERE deleted_at IS NOT NULL;
```

This allows normal list screens to ignore deleted rows efficiently while admin recycle bin screens remain fast.

Apply the same active/deleted index pattern to every large soft-deletable table, adjusting the primary key column name:

```text
sales_contacts: contact_id
sales_organizations: org_id
sales_opportunities: opportunity_id
finance_pos_invoices: id
finance_io: id
tasks: id
calendar_events: id
documents: id
custom module records: id
```

### Recycle Bin Query Pattern

Recycle bin endpoints should be admin-only and use cursor pagination:

```sql
WHERE tenant_id = :tenant_id
  AND deleted_at IS NOT NULL
  AND (
    deleted_at < :cursor_deleted_at
    OR (deleted_at = :cursor_deleted_at AND id < :cursor_id)
  )
ORDER BY deleted_at DESC, id DESC
LIMIT :limit
```

Do not use heavy exact counts for recycle bin by default.

### Restore Rules

Restore should:

1. Confirm the row still exists in the original table.
2. Confirm it belongs to the current tenant.
3. Confirm it is still inside the 90-day retention window.
4. Set `deleted_at = NULL`.
5. Restore dependent custom fields only if they still exist.
6. Log the restore activity.
7. Invalidate relevant dashboard/list caches.

### Permanent Purge Rules

Permanent purge should:

1. Be admin-only or system-job-only.
2. Run in Celery.
3. Delete rows older than `RECYCLE_BIN_RETENTION_DAYS`.
4. Delete in small batches using `RECYCLE_BIN_PURGE_BATCH_SIZE`.
5. Respect FK/cascade rules.
6. Log what was purged.
7. Never run as part of normal request flow for large modules.

Example purge direction:

```sql
DELETE FROM sales_contacts
WHERE tenant_id = :tenant_id
  AND deleted_at < now() - interval '90 days'
LIMIT 1000;
```

If PostgreSQL version/query style does not support `DELETE ... LIMIT` directly, use a CTE:

```sql
WITH rows_to_delete AS (
  SELECT contact_id
  FROM sales_contacts
  WHERE tenant_id = :tenant_id
    AND deleted_at < now() - interval '90 days'
  ORDER BY deleted_at ASC, contact_id ASC
  LIMIT 1000
)
DELETE FROM sales_contacts
USING rows_to_delete
WHERE sales_contacts.contact_id = rows_to_delete.contact_id;
```

### Optional Future Archive Snapshot Table

Archive tables can be added later for compliance or long-term audit use, but they should be treated as cold storage, not the default recycle bin.

Possible future pattern:

```text
deleted_record_archives
  id
  tenant_id
  module_key
  entity_type
  entity_id
  deleted_at
  deleted_by_user_id
  archived_at
  record_snapshot JSONB
```

This pattern stores a snapshot for audit/history, not a fully active relational copy.

Use this only if the product needs long-term deleted-record history after purge.

---

## Tenant Isolation Rules

Every tenant-owned query must include `tenant_id`.

Dangerous:

```python
db.query(SalesContact).filter(SalesContact.contact_id == contact_id).first()
```

Correct:

```python
db.query(SalesContact).filter(
    SalesContact.tenant_id == tenant_id,
    SalesContact.contact_id == contact_id,
).first()
```

Add repository/helper patterns that make tenant scoping hard to forget.

---

## Permissions / Module Access Standards

Keep permission checks in route dependencies where possible:

```python
require_module=Depends(require_module_access("sales_contacts"))
require_permission=Depends(require_action_access("sales_contacts", "view"))
```

Services should not trust caller blindly for tenant boundaries. Services/repositories should still receive explicit `tenant_id` and use it in queries.

---

## Activity Logs and CRM Events

Activity/event logging is useful but can become heavy.

Rules:

1. Keep logs tenant-scoped.
2. Index logs by `(tenant_id, created_at DESC)`.
3. Consider background event processing for non-critical events.
4. Do not let event logging failure break the main write unless the event is business-critical.
5. Avoid storing huge before/after payloads for very large records.

---

## File Naming and Consistency Rules

Standardize naming over time.

Prefer singular service file names:

```text
contacts_service.py
organizations_service.py
opportunities_service.py
```

Avoid mixed names like:

```text
contacts_services.py
```

However, do not rename everything at once if imports become noisy. Rename module-by-module.

---

## Testing / Validation Requirements

After each refactor PR:

1. Backend imports successfully.
2. Existing routes still work.
3. Existing schemas are unchanged unless intentionally updated.
4. Alembic migrations run.
5. Seed script still runs.
6. Basic CRUD works for the touched module.
7. Permissions still work.
8. Tenant scoping is not broken.
9. Soft delete and restore still work.
10. Recycle bin still works.
11. 90-day purge job only deletes records older than retention.
12. Import/export still works if touched.

---

## Load Testing Plan

Add a separate load seed script later:

```text
backend/scripts/seed_load_crm.py
```

It should generate configurable large datasets:

```text
--tenants 3
--contacts-per-tenant 100000
--organizations-per-tenant 10000
--opportunities-per-tenant 50000
--invoices-per-tenant 50000
--tasks-per-tenant 50000
```

Use this to test:

- first page load
- cursor pagination
- search
- filter by assigned user
- filter by status/stage
- opening detail records
- dashboard summary
- import/export job creation
- recycle bin list
- 90-day purge job in batches

Performance targets for normal API list screens:

```text
P50 < 200ms
P95 < 800ms
P99 < 1500ms
```

These are rough targets and should be adjusted based on deployment size.

---

## First Codex Implementation Plan

### Current Implementation Status

The backend refactor phases below have now been implemented in the working tree:

- Phase 1: repository layers exist for sales contacts and the other major backend modules.
- Phase 2: sales contacts import/export services are split from the main contacts service.
- Phase 3: cursor pagination foundation exists, and cursor endpoints exist for contacts, organizations, opportunities, POS invoices, insertion orders, catalog products, catalog services, tasks, documents, calendar events, and mail messages.
- Phase 4: tenant-aware composite/partial performance indexes exist in Alembic.
- Phase 5: Postgres trigram/search indexes exist in Alembic for high-volume searchable modules.
- Phase 6: the platform search abstraction stub exists under `backend/app/modules/platform/search/`.
- Phase 7: recycle-bin retention config and Celery purge job exist.
- Load testing: `backend/scripts/seed_load_crm.py` exists for deterministic large-data seeding.

Verification completed in the backend container:

- `python -m unittest tests.test_cursor_pagination`
- `python -m unittest tests.test_api_routes tests.test_documents tests.test_finance_io_api tests.test_finance_pos_invoices`
- `python -m unittest tests.test_catalog_products tests.test_catalog_services tests.test_task_source_activity tests.test_organizations_services tests.test_opportunities_services tests.test_contacts_services`
- `python -m compileall app tests`
- `alembic upgrade head`
- `alembic current` confirmed `20260606_search_indexes (head)`
- Guarded load-seed smoke run with tiny record counts and `LOAD_CRM_SEED_ALLOW=1`

Calendar cursor tests passed after calendar was added to the cursor standard. Mail cursor implementation is landed and syntax-checked, but the focused container rerun for mail was blocked by the Codex Docker approval usage limit after updating the stale mail test patch target.

See `docs/backend_module_architecture_audit.md` for the current module-by-module completion audit and the next completion order.

### Phase 1: Repository Layer for Sales Contacts

Create:

```text
backend/app/modules/sales/repositories/__init__.py
backend/app/modules/sales/repositories/contacts_repository.py
```

Move query-only helpers from `contacts_services.py` into repository.

Keep behavior identical.

Do not change API response shape.

### Phase 2: Split Sales Contacts Import/Export

Create:

```text
backend/app/modules/sales/services/contacts_import_service.py
backend/app/modules/sales/services/contacts_export_service.py
```

Move CSV import/export logic out of the main contacts service.

Update route imports.

Keep behavior identical.

### Phase 3: Add Cursor Pagination Foundation

Create core helper:

```text
backend/app/core/cursor_pagination.py
```

Support generic keyset pagination.

Add optional cursor pagination to contacts list without removing existing offset pagination.

### Phase 4: Add Performance Index Migration

Create Alembic migration adding safe composite/partial indexes for:

- sales contacts
- sales organizations
- sales opportunities
- catalog products
- catalog services
- finance POS invoices
- finance IO
- tasks
- calendar events
- activity logs if table exists

Use `IF NOT EXISTS` or Alembic-safe checks where necessary.

### Phase 5: Add Postgres Search Indexes

Add `pg_trgm` extension migration.

Add GIN trigram indexes for existing `search_doc` columns.

Only apply indexes to tables/columns that exist.

### Phase 6: Add Search Abstraction Stub

Create:

```text
backend/app/modules/platform/search/
  __init__.py
  search_backend.py
  postgres_search_backend.py
  search_service.py
```

Keep it simple and non-invasive.

Do not integrate external search yet.

### Phase 7: Add 90-Day Recycle Bin Retention Cleanup

Add a safe recycle-bin retention strategy:

- keep normal delete as soft delete using `deleted_at`
- add active-row partial indexes
- add deleted-row partial indexes
- add config values `RECYCLE_BIN_RETENTION_DAYS=90` and `RECYCLE_BIN_PURGE_BATCH_SIZE=1000`
- add Celery purge job for rows older than 90 days
- delete in small batches
- keep restore behavior unchanged for records still inside retention
- do not move deleted rows into separate relational archive tables yet

---

## Done Criteria

The backend is considered improved when:

- routes are thin
- business logic lives in services
- query logic lives in repositories
- high-volume modules have cursor pagination option
- high-volume modules avoid exact count by default where possible
- large tables have tenant-aware composite indexes
- active-row partial indexes exist
- deleted-row/recycle-bin partial indexes exist
- 90-day recycle-bin retention cleanup exists
- search uses Postgres trigram/full-text indexes first
- heavy work runs in Celery/background jobs
- seed and load-test scripts exist
- tenant scoping is consistently enforced

---

## Final Guidance

The stack is capable of scaling to large CRM workloads if the database and query patterns are designed properly.

Do not rewrite the backend.

Do not add Elasticsearch/OpenSearch yet.

Do not move deleted rows into separate tables as the first solution.

First make PostgreSQL, SQLAlchemy, Alembic, Redis, and Celery work properly with clean architecture, safe indexes, cursor pagination, background jobs, cached summaries, and 90-day recycle-bin retention cleanup.
