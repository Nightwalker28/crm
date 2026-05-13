# Codex Task: Backend Architecture + Multi-Tenant Performance Refactor Plan

## Context

This repository is a CRM built with:

- FastAPI
- SQLAlchemy
- Alembic
- PostgreSQL
- Redis
- Celery
- Pydantic
- Next.js frontend

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

Do not put business logic here except small model-level helper properties when unavoidable.

#### `schema.py`

Only Pydantic request and response schemas.

Keep request validation here where possible.

#### `routes/`

Routes should be thin.

Routes are responsible for:

- URL structure
- FastAPI dependencies
- permission checks
- request/response models
- calling service functions
- translating unexpected user-facing errors into HTTP responses

Routes should not contain:

- complex DB query logic
- duplicate detection logic
- import/export processing
- heavy business rules
- search ranking logic

#### `services/`

Services are responsible for business rules.

Examples:

- create/update/delete rules
- duplicate handling decisions
- permission-aware business behavior
- custom field validation orchestration
- activity/event logging orchestration
- import/export workflow coordination
- calling repositories

Services should not contain large query-building logic if it can live in repositories.

#### `repositories/`

Repositories are responsible for database reads/writes/query composition.

Examples:

- get by id
- get by id or 404 helper if desired
- list active records
- list deleted records
- find duplicates
- search within tenant
- bulk insert
- aggregate query helpers

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

Keep business rules here:

- create contact
- update contact
- soft delete contact
- restore contact
- duplicate behavior decision
- custom field validation orchestration
- activity/event logging calls

### Move to `contacts_import_service.py`

Move CSV import logic here:

- header validation
- row normalization
- duplicate import behavior
- bulk insert mapping
- import summary

### Move to `contacts_export_service.py`

Move CSV export logic here:

- export columns
- row serialization
- CSV byte generation

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

Large list queries should generally look like:

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

### Every Large Tenant Table Should Have Indexes For Common Access Patterns

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

For soft-deleted tables, prefer partial indexes where supported:

```sql
WHERE deleted_at IS NULL
```

Example SQL:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_contacts_tenant_contact_desc_active
ON sales_contacts (tenant_id, contact_id DESC)
WHERE deleted_at IS NULL;
```

Example SQLAlchemy/Alembic direction:

```python
op.create_index(
    "ix_sales_contacts_tenant_contact_desc_active",
    "sales_contacts",
    ["tenant_id", sa.text("contact_id DESC")],
    postgresql_where=sa.text("deleted_at IS NULL"),
    postgresql_concurrently=True,
)
```

When using `postgresql_concurrently=True`, ensure the Alembic migration handles autocommit correctly because PostgreSQL cannot create indexes concurrently inside a normal transaction.

---

## Pagination Standards

### Problem

Offset pagination becomes slow with millions of records:

```python
query.offset(pagination.offset).limit(pagination.limit)
```

This is acceptable for small tables but risky for large CRM tables.

### Target

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

### Rules

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

Recommended response for high-volume lists:

```json
{
  "items": [],
  "has_more": true,
  "next_cursor": "..."
}
```

Instead of always:

```json
{
  "items": [],
  "total": 1234567
}
```

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

Use this pattern for:

- sales contacts
- sales organizations
- sales opportunities
- invoices
- documents
- client pages
- custom module records

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

Example future-safe call:

```python
search_service.index_record(
    tenant_id=tenant_id,
    module_key="sales_contacts",
    record_id=contact.contact_id,
    title="Dilshan Perera",
    body="CEO at Ceylon Retail Holdings dilshan@example.com",
    metadata={
        "assigned_to": contact.assigned_to,
        "organization_id": contact.organization_id,
    },
)
```

For now this can write to Postgres or no-op. Later it can sync to OpenSearch/Meilisearch using Celery.

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

Do not use Redis as the primary store for CRM records.

### Suggested cache keys

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

Do not run large imports/exports inside request handlers.

Existing threshold settings should be respected:

- `DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD`
- `DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD`

---

## Database Connection Pooling

Current SQLAlchemy engine already supports configurable pool settings.

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
5. For large update jobs, process in chunks.

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

on every dashboard request.

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

Soft delete should consistently use `deleted_at`.

Normal list queries:

```sql
deleted_at IS NULL
```

Recycle bin queries:

```sql
deleted_at IS NOT NULL
```

Indexes should match both access patterns where needed.

Do not expose "move to trash" wording in normal user UI if the product wording is "delete". Admin recycle bin can still exist internally.

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

Standardize naming over time:

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
10. Import/export still works if touched.

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

Performance targets for normal API list screens:

```text
P50 < 200ms
P95 < 800ms
P99 < 1500ms
```

These are rough targets and should be adjusted based on deployment size.

---

## First Codex Implementation Plan

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

---

## Done Criteria

The backend is considered improved when:

- routes are thin
- business logic lives in services
- query logic lives in repositories
- high-volume modules have cursor pagination option
- high-volume modules avoid exact count by default where possible
- large tables have tenant-aware composite indexes
- soft-delete indexes exist
- search uses Postgres trigram/full-text indexes first
- heavy work runs in Celery/background jobs
- seed and load-test scripts exist
- tenant scoping is consistently enforced

---

## Final Guidance

The stack is capable of scaling to large CRM workloads if the database and query patterns are designed properly.

Do not rewrite the backend.

Do not add Elasticsearch/OpenSearch yet.

First make PostgreSQL, SQLAlchemy, Alembic, Redis, and Celery work properly with clean architecture, safe indexes, cursor pagination, background jobs, and cached summaries.
