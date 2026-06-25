# Codex Production Readiness Backlog

_Last updated: 2026-06-25_

This is the consolidated implementation backlog for the production-readiness audit across Core Backend, Contracts, Calendar, Catalog, Client Portal, Documents, Platform, Finance, Sales, Support, and Tasks.

Use this document as a routing layer for Codex work. Each item is intentionally scoped so an agent can pick one task, inspect the current code, implement the smallest safe fix, and run focused verification.

## Codex Operating Rules

1. Inspect current code and nearby tests before editing. If a finding is already fixed or not present, skip code changes and note it in the PR summary.
2. Keep changes inside one coherent slice. Avoid broad rewrites, new dependencies, or compatibility layers unless the task explicitly requires them.
3. Preserve tenant isolation, auth checks, audit logging, validation, and response compatibility while fixing performance or cleanup issues.
4. Add or update tests for every backend behavior change.
5. Add Alembic migrations for schema changes: tables, indexes, constraints, defaults, data corrections, and column type changes.
6. Use database constraints, row locks, upserts, or distributed locks for production concurrency. Do not rely on process-local locks.
7. For frontend fixes, patch the hook/component behavior in place and avoid redesigns.
8. User-fixable validation, uniqueness, and constraint failures must return clean 4xx responses, not unhandled 500s.

## Shared Acceptance Criteria

Every task should satisfy the applicable shared criteria below instead of repeating them locally:

- **Security/tenant scope:** Queries and writes include tenant scoping and permission checks appropriate to the surface.
- **Concurrency:** Race-prone flows have a database-backed or distributed correctness mechanism plus a regression test or documented manual concurrency check.
- **Transactions:** Multi-step mutations commit atomically or have explicit rollback/compensation behavior.
- **Side effects:** Slow or unreliable external calls run after commit or through retryable background work unless synchronous behavior is intentional.
- **Validation:** Invalid user input is rejected at schema/service boundary with a stable 4xx error.
- **Migrations:** Empty-database and existing-database paths are considered, with backfill/duplicate cleanup notes where constraints are tightened.
- **Frontend cache:** Query keys include all fetch-affecting values only. UI-only preferences do not trigger network fetches unless projection is implemented end-to-end.
- **Frontend UX:** Disabled submit states, client-side validation, and error messages match backend validation.

## Recommended PR Order

1. **Critical security and startup safety:** None currently active.
2. **Concurrency and transaction correctness:** CON-CONC, CAL-CONC, CAT-MEDIA, CP-SEED, DOC-STORAGE, FIN-TXN, SALES-TXN, SUPPORT-SLA, PLAT-RESTORE.
3. **External side effects and background work:** CAL-SYNC, DOC-STORAGE, TASKS-EVENTS, PLAT-EVENTS, PLAT-RESTORE.
4. **Query scalability and indexes:** SEARCH-IDX, LIST-PERF, SALES-PERF, SUPPORT-PERF, TASKS-PERF, PLAT-QUERY.
5. **Frontend cache, validation, and browser reliability:** FE-QUERY, FE-FORMS, FE-BROWSER.
6. **Cleanup and maintainability:** SALES-FILES, SALES-MODELS, OPS-MAINT, SERIALIZATION, ROUTES, DUPLICATION.

---

# Completed Production-Readiness Tasks

## CORE-SEC — Harden startup secrets and worker config validation

- **Completed:** 2026-06-22
- **Files:** `backend/app/core/config.py`, `backend/app/core/secrets.py`, `backend/app/core/celery_app.py`, `.env.sample`, focused backend tests
- **Result:** Startup validation now requires `JWT_SECRET`, `APP_ENCRYPTION_SECRET`, and `MAIL_CREDENTIAL_SECRET`; mail credential encryption no longer falls back to JWT; explicit `MAIL_CREDENTIAL_PREVIOUS_SECRETS` handles legacy mail-secret rotation; Celery workers run startup validation and keep task failures inspectable through the configured result backend.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_config tests.test_sensitive_encryption tests.test_mail_imap_smtp`

## CORE-AUTH — Fix token fallback, refresh-token races, and role fallback noise

- **Completed:** 2026-06-22
- **Files:** `backend/app/core/security.py`, `backend/app/core/access_control.py`, `backend/app/modules/user_management/services/auth.py`, focused auth tests
- **Result:** Implicit refresh now only follows an expired access token; malformed/tampered and tenant-mismatched access tokens hard-fail. Refresh-token rotation deletes the old token and inserts the replacement in one transaction, so reused tokens fail cleanly. Legacy role-level fallback logs at debug level instead of warning level.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_tokens tests.test_refresh_token_revocation tests.test_access_control`; `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_refresh_returns_401_without_cookie tests.test_api_routes.APIRouteTests.test_refresh_failure_logs_when_tenant_context_is_known`

## CORE-CACHE — Replace unsafe process-local and blocking cache operations

- **Completed:** 2026-06-22
- **Files:** `backend/app/core/cache.py`, `backend/app/core/tenancy.py`, `backend/app/main.py`, `backend/app/core/config.py`, `backend/app/modules/user_management/services/tenant_domains.py`, `.env.sample`, focused cache/tenancy tests
- **Result:** Redis prefix deletion now uses batched `SCAN` instead of `KEYS`; tenant host context resolution uses the shared cache layer and tenant-domain changes invalidate host cache entries; CORS allows only configured origins; production startup requires Redis for public rate limits and host tenant resolution.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_core_hardening.CacheTests tests.test_tenancy tests.test_config tests.test_tenant_domains tests.test_custom_fields tests.test_calendar_booking_services.CalendarBookingServiceTests.test_public_booking_submit_rate_limit_counts_slug_and_host tests.test_client_portal.ClientPortalServiceTests.test_public_client_page_action_attempts_are_rate_limited_by_token_and_ip`

## FIN-SEC — Fix finance tenant scoping, timestamps, path handling, status validation, and field gating

- **Completed:** 2026-06-22
- **Files:** `backend/app/modules/finance/services/io_search_services.py`, `backend/app/modules/finance/services/io_search_api.py`, `backend/app/modules/finance/services/pos_invoice_services.py`, `backend/app/modules/finance/routes/io_search_routes.py`, `backend/app/modules/finance/schema.py`, focused finance tests
- **Result:** Finance file storage is resolved lazily and stored/downloaded paths are relative-only; insertion-order downloads are tenant-scoped; PDF/DOCX downloads use extension-based MIME types; IO status is validated in schema and service/import paths; IO list serialization now respects requested/enabled fields; finance soft-delete/default dates use aware UTC timestamps and the human-date parser annotation matches `date | None`.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_finance_io_api tests.test_finance_pos_invoices`

## DOC-SEC — Fix document access, storage uniqueness, path, and OAuth safety

- **Completed:** 2026-06-22
- **Files:** `backend/app/core/cache.py`, `backend/app/modules/documents/models.py`, `backend/app/modules/documents/repositories/documents_repository.py`, `backend/app/modules/documents/services/document_services.py`, `backend/app/modules/documents/services/storage_backends.py`, `backend/alembic/versions/20260709_document_storage_scope.py`, focused document tests
- **Result:** Document OAuth provider token refresh now uses a Redis-backed lock with state re-read after lock acquisition; document storage uniqueness is scoped by tenant/provider/document instead of global storage keys; local document downloads accept canonical relative paths only while the migration normalizes legacy `documents/` prefixes; deleted-row retrieval has explicit include-vs-deleted-only semantics; OAuth state uses NumericDate timestamps and fail-closed origin/return-path normalization; local saves use exclusive-create retries.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_documents`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`

## CP-SEC — Harden client portal password, auth, pricing, and visibility boundaries

- **Completed:** 2026-06-25
- **Files:** `backend/app/modules/client_portal/schema.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `backend/tests/test_client_portal.py`, `frontend/hooks/useClientPortal.ts`, `frontend/app/client/setup/page.tsx`
- **Result:** Client setup passwords now share the core password-policy minimum at schema, service, and setup UI boundaries; client pricing and discount Decimal handling rejects non-finite values with clean 400/422 responses; public personalized pricing fails closed when a matching client account lacks a resolvable DB/session context; client account/page serializers avoid lazy relationship loads; public/client frontend requests only clear stored client tokens for explicit invalid-session responses; client setup UI mirrors the shared password policy before submit.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_client_portal`; `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## SALES-SEC — Fix sales tenant boundaries, deleted-row semantics, and field policy bypasses

- **Completed:** 2026-06-25
- **Files:** `backend/app/modules/sales/repositories/opportunities_repository.py`, `backend/app/modules/sales/services/opportunities_services.py`, `backend/app/modules/sales/services/opportunities_api.py`, `backend/app/modules/sales/services/organizations_services.py`, `backend/app/modules/sales/services/quotes_services.py`, `backend/app/modules/sales/routes/opportunities_routes.py`, `backend/app/modules/sales/routes/contacts_routes.py`, focused sales/API tests
- **Result:** Opportunity attachment upload/delete paths now pass the authenticated user through update validation; opportunity active/detail, include-deleted, and restore lookups use explicit active-plus-deleted vs deleted-only semantics; contact-side organization search requires organization view access; quote CSV import parses linked record IDs and validates them through tenant-scoped link checks; opportunity create defaults are sanitized before disabled-field policy can drop them.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_opportunities_services tests.test_opportunities_api tests.test_quotes_services tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## TASKS-CORE — Make task writes and deleted-record access safe

- **Completed:** 2026-06-25
- **Files:** `backend/app/modules/tasks/repositories/tasks_repository.py`, `backend/app/modules/tasks/services/tasks_services.py`, `backend/app/modules/tasks/routes/tasks_routes.py`, `backend/tests/test_task_source_activity.py`, `backend/tests/test_api_routes.py`
- **Result:** Task create/update/delete/restore writes now roll back on failure; blank titles are rejected at service boundary before database constraints; task lookups now distinguish active-plus-deleted from deleted-only restore/recycle paths; recycle listing requires restore permission and still applies normal task visibility; restore uses a deleted-only lookup and logs restore activity; duplicate task query-builder code was removed from the service layer.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_task_source_activity tests.test_task_reminders tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SUPPORT-CASES — Make support case creation, comments, and case numbers safe

- **Completed:** 2026-06-25
- **Files:** `backend/app/modules/support/models.py`, `backend/app/modules/support/services/cases_services.py`, `backend/tests/test_support_cases.py`
- **Result:** Support case model metadata now matches the existing per-tenant case-number uniqueness constraint; generated admin and client case numbers retry cleanly on uniqueness collisions instead of returning generic failures; create paths commit the case and initial event in one transaction and return the committed object without a post-commit lookup; admin/client comment and status writes now roll back on integrity failures with clean 409 responses; support source values are normalized and client source lookups are case-insensitive.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_support_cases`; `docker compose exec -T backend python -m unittest tests.test_client_portal`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## CRM-NUMBERS — Make sales and support number allocation atomic

- **Completed:** 2026-06-25
- **Files:** `backend/app/modules/platform/models.py`, `backend/app/modules/platform/services/numbering.py`, `backend/alembic/versions/20260710_crm_number_counters.py`, `backend/app/modules/sales/services/quotes_services.py`, `backend/app/modules/sales/services/orders_services.py`, `backend/app/modules/support/services/cases_services.py`, focused numbering/sales/support tests
- **Result:** Added a tenant-scoped `crm_number_counters` platform primitive with atomic upsert allocation per tenant, scope, and day. Quote, order, and support case generated numbers now use that allocator instead of date-prefix count scans. The migration backfills counter rows from existing `Q-YYYYMMDD-NNNN`, `SO-YYYYMMDD-NNNN`, and `CASE-YYYYMMDD-NNNN` values so new allocations continue after current data. Existing quote/order/support uniqueness remains the database backstop for manual numbers and race protection.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_crm_numbering tests.test_quotes_services tests.test_sales_orders tests.test_support_cases`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

---

# Consolidated Task Backlog

## CORE-EXPORT — Bound import/export memory and cleanup behavior

- **Severity:** Medium
- **Source items:** CORE-16, CORE-17, CORE-18, CORE-23, DOC-06, DOC-12, DOC-24, PLAT-07, FIN-13
- **Files:** `backend/app/core/module_export.py`, `backend/app/core/module_csv.py`, document storage/services/routes, backup artifact upload, finance export paths, tests
- **Issue:** CSV/ZIP/export/upload paths can retain full files in memory, leak temp files, or defer size checks until generators are fully consumed.
- **Fix:** Add pre-parse file-size gates, stream ZIP/CSV/provider downloads where practical, clean temp files with context managers or `try/finally`, keep strict max-size enforcement for staged upload fixes, and keep upload directory cleanup best-effort/non-fatal.
- **Acceptance:** Memory scales with current chunk/module where feasible; temp files are removed on success and failure; huge CSVs cannot bypass preview-time limits; missing/concurrently removed upload directories do not fail cleanup.

## SEARCH-IDX — Add intentional text-search and hot-query index strategy

- **Severity:** Medium
- **Source items:** CORE-11, CORE-12, CORE-25, CON-12, CON-18, CAL-17, CAL-18, CAT-13, CAT-14, DOC-18, FIN-28, SALES-DEEP-08, SALES-DEEP-09, TASK-13, SUP-13, SUP-14, SUP-15, SUP-30
- **Files:** module filter/search helpers, models, Alembic migrations, tests
- **Issue:** Contains searches and hot range/lookups lack targeted indexes; some generated SQL is unnecessarily complex; several constraints need active-row semantics; support search treats `%` and `_` as wildcards; sales/support indexes need query-plan justification.
- **Fix:** Cap text filter values. Use `pg_trgm` GIN indexes for high-use contains searches while preserving LIKE/ILIKE semantics. Add targeted composite/partial indexes for contract expiration, calendar ranges/participants, document template/active shares, catalog currency constraints, task tenant/status and tenant/due filters, support SLA/open-case predicates, sales quote-open hash columns/search documents, and active POS invoice number uniqueness. Escape LIKE wildcards where literal search is expected. Flatten PostgreSQL searchable expressions with `concat_ws` where applicable.
- **Acceptance:** Hot contains/range/lookup paths have an index strategy; oversized filter values fail before query construction; active-row uniqueness matches soft-delete behavior; support literal wildcard searches do not over-match.

## LIST-PERF — Consolidate count/list, pagination, and cursor-query optimizations

- **Severity:** Medium/High
- **Source items:** CORE-13, CORE-19, CORE-20, CORE-21, CON-11, CAL-13, CAT-15, CP-05, CP-08, CP-14, CP-21, DOC-08, DOC-09, DOC-13, DOC-14, DOC-25, DOC-26, FIN-19, FIN-25, FIN-26, FIN-27, PLAT-10, PLAT-13, PLAT-19, PLAT-38, SALES-13, SALES-16, SALES-17, SALES-DEEP-23, SALES-DEEP-29, SALES-DEEP-30, SALES-DEEP-31, TASK-11, TASK-14, TASK-16, TASK-28, TASK-34, SUP-10, SUP-11, SUP-12, SUP-21
- **Files:** shared pagination helpers, module repositories/services/routes, frontend consumers where response contracts change
- **Issue:** Several endpoints load full lists to count/slice, run duplicate fetches, manually compute offsets, hydrate cursor sentinel rows, churn DB sessions/queries in polling paths, or lack pagination metadata. Sales/support summaries also over-fetch related records, hydrate unused custom fields, or filter client-visible data in Python. Task assignment options and linked-record task widgets are currently bounded poorly or not searchable.
- **Fix:** Add summary/count/latest helpers for overview pages. Use count-specific, grouped, conditional aggregate, or window-count queries on hot endpoints. Enforce bounded flat list routes or cursor alternatives, including searchable participant/assignee pickers instead of fixed caps. Use `Pagination.offset`/`limit`. Ensure cursor responses strip sentinel rows before serialization/hydration. Remove redundant refresh/refetch paths. Verify and remove duplicate document/share/proposal/task fetches if present. Reduce SSE/realtime DB session and query churn. Filter client-visible support comments in SQL.
- **Acceptance:** Pagination contracts are explicit and consistent; overview/list endpoints do not fetch full datasets for summaries; cursor sentinels are not returned or over-hydrated; polling/list paths do not multiply DB work unnecessarily; client-facing list/detail responses avoid loading private/internal rows; task assignment and linked-task views scale beyond small tenants/default page sizes.

## CON-CONC — Make contract writes atomic, efficient, and constraint-safe

- **Severity:** Critical/High
- **Source items:** CON-01, CON-02, CON-03, CON-04, CON-05, CON-06, CON-07, CON-08, CON-13, CON-19
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, routes, schemas, models, migrations, tests
- **Issue:** Contract write paths eager-load too much, double-fetch, generate numbers with race-prone counts, preflight linked FKs with excessive queries, and can surface integrity failures as 500s.
- **Fix:** Split lightweight mutation loaders from full response loaders. Let service own update fetch/return. Allocate contract numbers atomically with a counter table/upsert/lock or non-sequential collision-resistant scheme. Validate only changed PATCH fields. Prefer DB constraints plus tenant ownership checks and clean `IntegrityError` translation. Guard signer status updates and required title schema. Correct JSON defaults if needed.
- **Acceptance:** Concurrent contract creates get unique numbers; PATCH title-only does not revalidate unrelated linked records; duplicate/invalid party/signer operations return clean 4xx; write operations avoid unnecessary graph loads.

## CAL-CONC — Make booking and calendar mutation flows race-safe

- **Severity:** Critical/High
- **Source items:** CAL-01, CAL-04, CAL-05, CAL-06, CAL-07, CAL-08, CAL-09, CAL-14, CAL-X1, CAL-X4
- **Files:** calendar booking/event services, repositories, routes, tasks, tests
- **Issue:** Public booking slot creation validates before insert, route order can shadow `/events/from-task`, participant response precedence can be wrong, visibility joins inflate rows, notification side effects share mutation sessions, slot generation has N+1 overlap queries, and partial date updates can validate after mutation.
- **Fix:** Do final overlap check and insert atomically with row locks or conflict handling. Declare static task routes before dynamic event routes. Prefer direct user responses before team responses. Replace visibility joins with `EXISTS`. Enqueue notifications/side effects after commit with idempotency keys. Fetch overlap data once per range. Validate merged start/end before mutating ORM state.
- **Acceptance:** Concurrent same-slot bookings produce one success and one clean conflict; task routes resolve correctly; event creation is transaction-safe; slot-generation query count does not grow with candidate count.

## CAL-SYNC — Make external calendar sync/delete side effects retryable

- **Severity:** Critical/Medium
- **Source items:** CAL-03, CAL-11, CAL-12, CAL-X3
- **Files:** calendar services, Celery tasks, provider connection code, tests
- **Issue:** Provider sync/delete paths can block workers or leave ghost external events, and enqueue failures are weakly observable.
- **Fix:** Move provider sync/delete to bounded Celery tasks with retry/backoff, primitive IDs, idempotency state, and durable warning/status for enqueue failures. Remove repeated connection refreshes inside loops unless required.
- **Acceptance:** Provider slowness/failure does not block entire request/worker paths indefinitely and remains retryable/observable.

## CAT-MEDIA — Stabilize catalog media, slug, enum, and boolean behavior

- **Severity:** Critical/High
- **Source items:** CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07, CAT-12, CAT-16, CAT-20
- **Files:** catalog product/service services, schemas, repositories, models/migrations if needed, tests
- **Issue:** Catalog soft deletes use naive timestamps, media files can orphan or delete incorrectly on commit failure, slug reuse/update semantics are unclear, booleans are stored as small integers, and service boundaries can accept invalid raw enum/null values.
- **Fix:** Use aware UTC timestamps. Track new and previous media paths separately; delete new media on rollback and old media only after commit. Define slug/null/update contracts explicitly. Cast booleans in serializers and validate service inputs before writing. Extract shared slug/validator helpers only where it reduces duplication.
- **Acceptance:** Media and DB state remain consistent on failures; active slug collisions fail while intended soft-deleted reuse works; API returns booleans; direct service calls cannot write invalid enum-like values.

## CP-SEED — Make client portal seed/action/list flows bounded and canonical

- **Severity:** Critical/High
- **Source items:** CP-02, CP-03, CP-04, CP-07, CP-11, CP-12, CP-13, CP-16, CP-17, CP-18, CP-20, CP-21, CP-22
- **Files:** client portal services/repositories/routes/models, frontend hooks/pages, tests
- **Issue:** Default customer-group seeding can race, support/page action names are inconsistent, action summaries and flat lists are unbounded, dynamic ORM attributes hide data shape, browser helpers can fail in DOM-light contexts, and placeholder groups imply fake 0% personalization.
- **Fix:** Seed with `INSERT ... ON CONFLICT DO NOTHING` or clean IntegrityError retry/read. Constrain support actions at route/path boundary. Keep canonical stored action values with documented URL aliases. Limit action summaries with window functions and flat list routes with cursor/limit paths. Return typed action-summary data instead of `_action_summary`. Guard download/window/document access. Correct placeholder discount seed/data semantics.
- **Acceptance:** Concurrent first access never 500s; unsupported support actions do not reach arbitrary service logic; `/request-changes` stores canonical `request_changes`; list/action summary queries are bounded.

## DOC-STORAGE — Make document upload/write side effects recoverable

- **Severity:** High/Medium
- **Source items:** DOC-07, DOC-11, DOC-16, DOC-17, DOC-27, DOC-28, DOC-29
- **Files:** document services/storage backends/routes/activity logging, tests
- **Issue:** Async routes can call blocking provider HTTP, soft-delete audit can serialize expression state, content-type policy maps can drift, share dedup semantics are unclear, download audit state is too heavy, and DB failures after storage writes can leak provider objects or bubble integrity errors.
- **Fix:** Use async provider clients or sync FastAPI route functions consistently. Use application UTC timestamps before commit. Derive content-type policy from one map. Name and test share dedup semantics. Log slim download audit state. Add cleanup/compensation metadata for storage-written-then-DB-failed paths. Wrap write conflicts as clean 4xx.
- **Acceptance:** Provider I/O does not block the async event loop; document mutation/audit states are clear; storage write conflicts and cleanup failures are handled intentionally.

## FIN-TXN — Make finance writes, imports, invoices, and audits atomic

- **Severity:** High/Critical
- **Source items:** FIN-04, FIN-05, FIN-11, FIN-12, FIN-16, FIN-17, FIN-20, FIN-21, FIN-22, FIN-24, FIN-29, FIN-34, FIN-35
- **Files:** finance IO/POS services, repositories, routes, models/migrations, tests
- **Issue:** IO custom fields commit separately from records, CSV import parses twice and expires full session inside row errors, POS invoice uniqueness ignores soft deletes while DB index does not, SQLite number generation can race, line updates churn all rows, audit logs commit after mutations, tax rates are unbounded, and update route semantics are PATCH-like on PUT.
- **Fix:** Flush IDs and commit IO/custom fields once. Parse CSV once and use row savepoints instead of broad `expire_all()`. Align service and DB uniqueness on active POS invoices. Add bounded SQLite retry if needed. Diff invoice lines by ID. Write audit logs in the same transaction. Cap tax rates. Remove dead duplicate query helpers. Add PATCH or document/alias PUT semantics. Share cursor/list serializers.
- **Acceptance:** Record/custom-field and invoice/audit writes commit or roll back together; soft-deleted invoice numbers can be reused while active duplicates fail; invoice line updates preserve unchanged rows; invalid tax rates return 4xx.

## SALES-TXN — Make sales writes, imports, follow-ups, and audits atomic

- **Severity:** High/Critical
- **Source items:** SALES-09, SALES-10, SALES-11, SALES-12, SALES-15, SALES-19, SALES-22, SALES-39, SALES-DEEP-11, SALES-DEEP-12, SALES-DEEP-14, SALES-DEEP-15, SALES-DEEP-16, SALES-DEEP-17, SALES-DEEP-18, SALES-DEEP-21, SALES-DEEP-26, SALES-DEEP-27, SALES-DEEP-28, SALES-DEEP-32, SALES-DEEP-33, SALES-DEEP-35, SALES-DEEP-36
- **Files:** sales contact/organization/opportunity/lead/quote/order/follow-up/reminder services, import paths, tests
- **Issue:** Multiple sales create/update/import paths commit parent records before custom fields, imports commit per row or use mixed transaction patterns, follow-up/reminder side effects can split from activity/task creation, quote status changes can split from audit logging, duplicate conversion flags and order transitions need explicit rules, and some duplicate pre-checks have TOCTOU windows.
- **Fix:** Standardize sales writes on `flush()` plus one commit for parent/custom fields/audit where possible. Use import-specific helpers with batch transactions or row savepoints. Add rollback guards around known conflict paths. Preserve explicit assignees on duplicate replacement. Make follow-up/reminder side effects atomic or explicitly best-effort with durable logging. Define quote follow-up, quote-to-order duplicate, and order transition semantics.
- **Acceptance:** Sales parent/custom-field/audit writes commit or roll back together; large imports avoid N commits while preserving row summaries; follow-up/reminder task side effects have clear all-or-best-effort behavior; duplicate/order state behavior matches the exposed flags.

## SALES-FILES — Make sales attachments and quote/public-file behavior durable

- **Severity:** High/Medium
- **Source items:** SALES-06, SALES-07, SALES-18, SALES-DEEP-05, SALES-DEEP-22, SALES-DEEP-43, SALES-DEEP-54
- **Files:** opportunity attachment services/models, quote proposal services/routes/frontend, export paths, migrations/tests
- **Issue:** Opportunity attachment files are written before DB commit, delete path containment is fragile, attachment metadata is stored as raw JSON text, quote export behavior is inconsistent, public/internal proposal event types need explicit boundaries, and proposal links may point to the wrong base URL.
- **Fix:** Stage attachment files and move/delete them only after transaction success, or add cleanup for orphaned staged files. Resolve/delete files against one canonical root and reject symlink escapes. Move attachment metadata to JSON/JSONB or validate strictly. Stream large quote exports or document background-only policy. Separate internal proposal event types from public event constants. Verify public proposal link generation uses the intended frontend route.
- **Acceptance:** Attachment DB/file state cannot silently diverge, attachment metadata cannot be malformed JSON, quote export/link behavior is intentional, and internal/public proposal events are clearly separated.

## SALES-MODELS — Normalize sales model loading, timestamps, and domain metadata

- **Severity:** Medium
- **Source items:** SALES-08, SALES-20, SALES-21, SALES-DEEP-01, SALES-DEEP-02, SALES-DEEP-03, SALES-DEEP-04, SALES-DEEP-06, SALES-DEEP-07, SALES-DEEP-13, SALES-DEEP-19, SALES-DEEP-20
- **Files:** sales models, shared sales utilities, lead score services, relationship query tests, migrations where needed
- **Issue:** Sales models use list-heavy `lazy="joined"` defaults, timestamp declarations and soft-delete timestamp creation are inconsistent, organizations lack `updated_at`, assigned-contact user deletion behavior is restrictive, custom-field hydration depends on an in-memory cache, duplicate name/timezone/stage behavior is duplicated, and opportunity currency lookups can repeat per row.
- **Fix:** Prefer `selectin`/explicit eager loading for relationships. Use aware UTC timestamps and a shared timezone normalization helper. Add `updated_at` to organizations if product wants recency display. Change or guard assigned-user delete behavior. Document/test custom-field hydration. Normalize partial-name duplicate handling, stage metadata, lead-score freshness, and per-request currency lookup caching.
- **Acceptance:** Base sales list queries do not auto-join unrelated tables, sales timestamps and hydration contracts are explicit, and model/domain metadata has one clear update path.

## SALES-PERF — Bound sales summaries, reminders, exports, and board/list queries

- **Severity:** High/Medium
- **Source items:** SALES-13, SALES-14, SALES-16, SALES-17, SALES-18, SALES-DEEP-23, SALES-DEEP-29, SALES-DEEP-30, SALES-DEEP-31, SALES-DEEP-34, SALES-DEEP-48
- **Files:** sales summary services, reminder scans, quote exports, opportunity board/list endpoints, tests
- **Issue:** Opportunity pipeline summary and sales summaries can load or hydrate too much in Python, reminder scans query all tenants, quote proposal/event and related insertion-order paths can over-query, quote export can materialize large result sets, and the opportunity board may show only the current page while looking like a full pipeline.
- **Fix:** Use grouped SQL aggregation for pipeline/summary metrics. Hydrate custom fields only where response schemas expose them. Scope reminder scans per tenant and chunk/cursor work. Avoid proposal/event queries when no proposal exists. Stream quote exports or route large jobs through background export. Make opportunity board scope explicit or load complete stage data incrementally.
- **Acceptance:** Sales summaries preserve response shapes with fewer queries, reminders are tenant-scoped and bounded, large exports do not materialize whole datasets, and board scope is clear to users.

## SUPPORT-SLA — Protect support SLA lifecycle and linked-record updates

- **Severity:** High/Medium
- **Source items:** SUP-05, SUP-06, SUP-07, SUP-17, SUP-18, SUP-19, SUP-22, SUP-29
- **Files:** support schemas/services/routes/models, client portal support tests, frontend display schemas
- **Issue:** Client update schemas expose service-owned SLA timestamps, generic field assignment can run before transition logic, linked-record validation can re-check every field, category DB/schema constraints differ, comment edit/audit policy is undefined, and client-facing comment privacy/display-name behavior needs tests.
- **Fix:** Remove/ignore service-owned lifecycle timestamps from public update payloads. Apply status transition timestamp logic after filtering payload fields. Validate only changed linked fields and batch checks where practical. Align category constraints or document schema-only validation. Decide comment immutability/`updated_at`. Expose user display fields and test internal comment privacy.
- **Acceptance:** SLA timestamps are service-owned, partial updates do not revalidate unrelated links, internal comments never reach client responses, and support UI can show human-readable assignee/comment author names.

## SUPPORT-PERF — Optimize support summaries, comments, search, and projection

- **Severity:** Medium/High
- **Source items:** SUP-10, SUP-11, SUP-12, SUP-13, SUP-14, SUP-15, SUP-16, SUP-20, SUP-21, SUP-30
- **Files:** support services/routes/models/migrations/frontend hooks, tests or EXPLAIN notes
- **Issue:** Support list/summary endpoints use separate count/aggregate queries, client serialization loads then filters internal comments, search wildcard behavior is literal-unsafe, visible columns affect frontend keys without backend projection, and saved-view search routing needs verification.
- **Fix:** Use count-specific or conditional aggregate queries. Fetch only client-visible comments for client responses. Add or adjust support SLA/open-case indexes after EXPLAIN. Escape LIKE wildcards. Either implement `fields=` projection or keep visible columns UI-only. Verify saved-view search routes through `/search`. Keep list responses on lightweight schemas with regression tests.
- **Acceptance:** Support list/summary/search responses remain compatible with lower query cost, client endpoints avoid internal-comment over-fetching, and column/search cache behavior matches actual payloads.

## TASKS-PERF — Batch task assignees, options, scans, and serialization

- **Severity:** High/Medium
- **Source items:** TASK-09, TASK-10, TASK-11, TASK-12, TASK-14, TASK-15, TASK-16, TASK-28, TASK-32, TASK-34
- **Files:** task services, repository, models, task options route, task widgets, tests
- **Issue:** Assignee validation and notification resolution can run one query per user/team, assignment options load all users/teams, due-scan dedupe checks one task at a time, task base queries join user relationships by default, count queries can inherit ordering/ranking, and task serializers can validate through Pydantic more than once.
- **Fix:** Batch user/team validation and notification recipient resolution. Add search/pagination and active-principal filtering to assignment options, with selected-assignee resolution if needed. Batch due-alert event lookups per scan window. Change eager user relationships to `selectin`/explicit loads and add query-count tests. Strip ordering from count queries. Serialize/validate task responses once.
- **Acceptance:** Large-assignee tasks and due scans use bounded query counts; assignment dialogs do not load every tenant principal; list/detail serialization stays query-bounded after loader changes.

## TASKS-EVENTS — Deduplicate task alerts and make notifications observable

- **Severity:** Medium/High
- **Source items:** TASK-07, TASK-17, TASK-18, TASK-19, TASK-20
- **Files:** task services/routes, CRM event definitions, notification paths, tests
- **Issue:** Route-level `task.due_today` emission can duplicate events on every save, scan dedupe must stay tenant-safe, task alert event types can drift from canonical CRM event sets, assignment notification failures can be silent, and due-time notification text can show raw UTC as local time.
- **Fix:** Reuse a shared due-alert dedupe helper for route and scan emissions. Batch existing alert lookup by tenant/day/task IDs. Assert task event types exist in canonical CRM event and alert sets. Decide whether task notifications are best-effort or queued/outbox-backed; log or persist failures accordingly. Format due-time text in recipient timezone or omit misleading time.
- **Acceptance:** Saving the same due-today task emits at most one alert per day, scan dedupe is tenant-scoped, task events persist/deliver consistently, and notification failures are observable.

## PLAT-RESTORE — Protect platform restore, backup, retention, and data-transfer jobs

- **Severity:** Critical/High
- **Source items:** PLAT-02, PLAT-06, PLAT-08, PLAT-12, PLAT-14, PLAT-20, PLAT-42
- **Files:** platform backup/restore/data-transfer/custom-module import services, Celery tasks, tests
- **Issue:** Restore row application needs an explicit destructive-operation savepoint, manual backups run synchronously, datetime parsing needs normalization, data-transfer sessions are manually closed, retention cleanup loads full ORM rows, and custom module import preview may parse twice.
- **Fix:** Wrap destructive restore apply in `begin_nested()` or equivalent while recording failed status outside the savepoint. Queue manual backups and run export/upload/retention in Celery. Normalize restore datetimes to UTC. Convert data-transfer sessions to context managers. Select only retention IDs/file paths for cleanup. Reuse import preview data.
- **Acceptance:** Restore failure leaves module data unchanged and records failure; backup routes return queued runs quickly; retention cleanup scales with selected columns; import preview/execute avoids duplicate parsing.

## PLAT-EVENTS — Move CRM event delivery/automation failures into observable retry paths

- **Severity:** Critical/High
- **Source items:** PLAT-03, PLAT-04, PLAT-05, PLAT-09, PLAT-16, PLAT-24, PLAT-25, PLAT-39
- **Files:** platform CRM event/automation services, Celery tasks, models/docs, tests
- **Issue:** Automation enqueue failures can be swallowed, Slack/Teams delivery runs synchronously before commit, alert event types drift from persisted event types, automation duplicate-run races need regression coverage, and payload/actor conventions are implicit.
- **Fix:** Log and preferably persist automation dispatch failures for retry. Persist pending delivery rows and send webhooks through Celery. Align Slack alert event types with `CRM_EVENT_TYPES` and assert subset consistency. Add duplicate run race tests. Make template substitution single-pass. Replace `SimpleNamespace` automation actor with a typed context. Document `payload`/`payload_json` alias.
- **Acceptance:** Broker/webhook failures are observable and retryable; CRM route handlers are not blocked by slow webhooks; alert event type drift fails fast.

## PLAT-QUERY — Reduce platform over-fetching and harden raw-query helpers

- **Severity:** High/Medium
- **Source items:** PLAT-11, PLAT-15, PLAT-17, PLAT-18, PLAT-21, PLAT-22, PLAT-23, PLAT-26, PLAT-40, PLAT-41, PLAT-43
- **Files:** platform comments/custom modules/search/recycle/message-template/module-field services/routes, tests
- **Issue:** Mention suggestions over-fetch and filter in Python, custom module access seeding loads principals into Python, global search statement timeout lacks an explicit reset, raw purge SQL uses interpolated identifiers, recycle module-key checks can repeat, duplicate template keys can bubble integrity errors, and path converters need regression tests.
- **Fix:** Push mention permission predicates into SQL. Use bulk insert/select for access seeding. Reset statement timeout in `finally` or prove transaction scope. Whitelist raw SQL identifiers or use SQLAlchemy metadata. Cache repeated module-key checks per request only if verified hot. Pre-check/catch normalized template-key conflicts. Add route tests for path converter behavior.
- **Acceptance:** Mention suggestions return only allowed users without Python over-fetching; global search timeout cannot leak to later queries; raw SQL identifier interpolation is protected by explicit allowlists/tests.

## FE-QUERY — Canonicalize frontend query keys and invalidation behavior

- **Severity:** High/Medium
- **Source items:** CON-09, CON-20, CAL-19, CAT-08, DOC-20, DOC-21, FIN-39, FIN-40, FIN-41, PLAT-31, SALES-29, SALES-30, SALES-34, SALES-DEEP-45, SALES-DEEP-46, SALES-DEEP-47, TASK-21, TASK-22, TASK-25, SUP-16, SUP-23, SUP-25, SUP-26
- **Files:** frontend module hooks and saved-view hooks
- **Issue:** Several hooks may omit fetch-affecting values, include UI-only values, invalidate too broadly/sequentially, or compare logically equivalent saved-view conditions order-sensitively. Sales/support detail pages still use raw fetch/local state in places, opportunity/support summaries can stay stale after mutations, and task page/query state can diverge when filter/sort keys change.
- **Fix:** Build query keys from the same canonical values used in URLs. Include page, size, sort, filters, search, module kind, and context where they affect fetches. Exclude visible columns unless the API supports projection. Use narrow invalidations, `Promise.all` where multiple invalidations remain, and normalized condition comparisons when order is not semantic. Migrate high-churn sales/support detail pages to React Query gradually and invalidate list/detail/summary keys after mutations. Use stable task filter/sort key strings in query keys and explicitly reset task page state on filter/sort changes.
- **Acceptance:** Changing fetch-affecting inputs gets fresh data; UI-only preferences do not refetch; saved views do not reset because of non-semantic condition ordering; sales/support summary widgets do not remain stale after create/update/comment/status changes; task rendered page and internal page state stay aligned.

## FE-FORMS — Align frontend validation and state with backend contracts

- **Severity:** High/Medium
- **Source items:** CON-10, CON-15, CON-16, CAL-10, CAL-15, CAL-20, CAL-21, CAL-22, CAL-X2, CAT-09, CAT-10, CAT-11, CAT-17, CAT-18, CAT-19, CAT-21, CAT-22, CAT-24, FIN-43, FIN-44, FIN-46, FIN-47, FIN-48, FIN-49, SALES-24, SALES-25, SALES-26, SALES-28, SALES-32, SALES-33, SALES-35, SALES-36, SALES-DEEP-44, SALES-DEEP-48, SALES-DEEP-49, SALES-DEEP-51, SALES-DEEP-52, SALES-DEEP-53, SALES-DEEP-55, SALES-DEEP-56, SALES-DEEP-57, TASK-23, TASK-24, TASK-26, TASK-27, SUP-24, SUP-27, SUP-28
- **Files:** frontend contract/calendar/catalog/finance components and hooks
- **Issue:** Forms/tables can show stale state, submit invalid IDs/dates/line values, render objects as `[object Object]`, mismatch disabled state with submit validation, hide truncation, use browser confirm, double-refresh, or keep stale search/display helpers. Sales/support forms also use fixed first-page pickers, can race stage/status changes, can swallow create errors, and can send stale linked IDs. Task dialog state currently depends on forced remount keys and delete/complete semantics need ownership clarity.
- **Fix:** Reset dialog state on selected record changes. Safely parse IDs and dates once. Validate date order and numeric lines before submit. Render primitives only in default cells. Share validation helpers between disabled and submit paths. Show truncation/inline validation feedback. Use app confirm dialogs. Send minimal toggle payloads. Clear stale search state on unlink and centralize display-name helpers. Prefer searchable linked pickers, serialize stage/status updates, propagate modal mutation errors, track dirty linked fields, and document/normalize cascade clearing. Re-sync task dialog state explicitly on task/open changes, remove `updated_at` from dialog keys, define delete-close ownership, and document completion timestamp behavior.
- **Acceptance:** Frontend cannot submit known-invalid values that backend rejects; dialogs show selected record data; table fallback rendering is intentional; destructive actions use app UI; sales/support linked pickers scale beyond fixed first-page data; saving a task does not remount the dialog unexpectedly.

## FE-BROWSER — Guard browser-only APIs and accessibility edge cases

- **Severity:** Medium
- **Source items:** CAL-16, CP-17, DOC-22, PLAT-27, PLAT-28, PLAT-29, PLAT-30, PLAT-32, PLAT-33, PLAT-34, PLAT-35, PLAT-36, CAT-23, CAL-23, FIN-42, FIN-45, SALES-27, SALES-31, SALES-DEEP-50, SALES-DEEP-58, TASK-29, TASK-30
- **Files:** frontend client/document/platform/catalog/calendar/finance components and hooks
- **Issue:** Browser-only APIs can throw in SSR/private/unsupported contexts, shared filter fields are hardcoded, nested controls can lose keyboard behavior, SSE hooks may duplicate connections, some memoization/comment/test coverage is missing, and error fallbacks can be vague. Sales WhatsApp launch and stage helper imports also need browser-flow and metadata cleanup.
- **Fix:** Guard `window`, `document`, `sessionStorage`, object URLs, and `startViewTransition`. Provide View Transitions type guards. Make shared filter fields module-owned. Preserve keyboard activation for nested controls. Share SSE connections per endpoint/session if duplicate connections are verified. Add comments/tests for double-download guards. Add reasonable `staleTime` or memoization only where useful. Use React Query for WhatsApp templates and open popups synchronously before async URL assignment. Canonicalize opportunity stage helper imports. Stabilize empty task assignee option arrays and move/memoize task table cell renderers only where it helps row memoization.
- **Acceptance:** Unsupported browsers/SSR-like tests do not crash; shared UI is module-correct; nested controls remain keyboard-operable; realtime hooks avoid duplicate connections if verified; WhatsApp launch is not blocked by async popup behavior.

## OPS-MAINT — Keep low-risk operational cleanup explicit

- **Severity:** Low/Medium
- **Source items:** CORE-22, CORE-27, FIN-07, FIN-15
- **Files:** Celery beat config, password cache helper, finance IO services/routes, tests or docs
- **Issue:** Some audit items are not large enough for their own production-readiness epic but should remain visible: maintenance jobs use relative intervals, common-password memory should be measured before optimizing, insertion-order filenames need extra sanitization, and overdue finance events may repeat if emitted on every save.
- **Fix:** Convert true maintenance jobs to wall-clock `crontab()` schedules where useful. Measure common-password cache size before changing it. Harden uploaded filename basenames by stripping control characters and collapsing suspicious repeated-dot patterns. Verify overdue event emission and emit only on transition or through a scheduled scanner if repeated events are confirmed.
- **Acceptance:** Low-risk operational cleanup is documented or tested, with no premature optimization and no repeated overdue-event spam if the path exists.

## SERIALIZATION — Make API serialization contracts explicit

- **Severity:** Medium
- **Source items:** CORE-24, CORE-26, CON-14, CAT-04, DOC-27, FIN-23, FIN-30, CP-12, CP-15, SALES-DEEP-06, SALES-DEEP-07, TASK-10, SUP-18, SUP-21, SUP-22
- **Files:** serializers, schemas, models/docs, tests
- **Issue:** Some responses expose misleading nullable/default semantics, aliased mutable sets, missing-media ambiguity, heavy audit states, implicit tenant inheritance, hidden sales custom-field hydration contracts, or heavy list response shapes.
- **Fix:** Return copies/frozen sets for duplicate detection. Define `None` media URL behavior and render placeholders. Clarify auto-generated contract numbers. Keep boolean serialization stable. Use slim audit states. Document inherited tenancy for child rows. Replace hidden dynamic ORM serializer attributes with typed inputs. Document/test sales custom-field cache hydration and support immutable-comment/list-item contracts. Ensure task responses are serialized/validated once, either as plain dicts plus route validation or as response models directly.
- **Acceptance:** API consumers see intentional null/default/media/boolean behavior, and serializers do not mutate caller-owned state or trigger accidental lazy loads; bulk list schemas stay lightweight; task serialization avoids repeated Pydantic validation.

## ROUTES — Add route-order and path-boundary regression coverage

- **Severity:** Medium/Low
- **Source items:** CAL-04, CP-03, FIN-36, PLAT-26, PLAT-43, SALES-38, SALES-DEEP-37, SALES-DEEP-39, SALES-DEEP-40, SALES-DEEP-42, SUP-20
- **Files:** module route files and route tests
- **Issue:** Static routes and constrained action/path routes need regression coverage so future dynamic routes do not intercept them. Some sales routes have inconsistent shapes, broad `ValueError` catches, or double-fetch update paths; support saved-view search routing needs verification.
- **Fix:** Place static routes before dynamic routes where applicable. Use enum/Literal route params for finite action vocabularies. Add route tests for import/export/task/path-converter behavior. Normalize organization create/search routes with backward-compatible aliases where needed. Remove broad catches or narrow them to known parse/config errors. Pass already-loaded raw records to update services where practical.
- **Acceptance:** Known static/action routes reach intended handlers, unsupported path/action values fail at route boundary, and sales/support route helpers do not hide errors or duplicate work.

## DUPLICATION — Remove low-risk duplication only where it improves clarity

- **Severity:** Low/Medium
- **Source items:** CON-17, CAT-12, CAT-20, CAT-22, DOC-16, FIN-06, FIN-24, FIN-35, FIN-47, SALES-DEEP-30, SALES-DEEP-45
- **Files:** affected module utilities, services, schemas, frontend helpers
- **Issue:** Some list/search handlers, validators, slug/content-type/formatting/display helpers, query serializers, sales hook fetcher signatures, and related-record matching helpers are duplicated.
- **Fix:** Extract shared helpers only when behavior is identical and the abstraction reduces complexity. Preserve endpoint response shapes. Standardize sales hook fetcher signatures and API-column filtering around shared utilities.
- **Acceptance:** Duplicated logic is reduced without broad refactors or behavior drift.

---

# Migration Checklist

Create migrations only after inspecting the current schema and data.

- **Contracts:** atomic contract number counter table or alternative allocation schema; contract search trigram indexes; temporary contract-number prefix index if a prefix scan remains; expiration-date index; JSON default correction if DB default changes.
- **Calendar:** event range partial composite index; participant `(event_id, user_id)` index.
- **Catalog:** active-only slug uniqueness if current constraints include deleted rows; optional SmallInteger-to-Boolean migration only if chosen; currency check constraints; catalog trigram search indexes.
- **Client Portal:** optional page-action index for per-page latest summaries; optional correction for untouched placeholder customer groups from `percent/0` to `none/NULL`.
- **Documents:** replace global storage uniqueness with scoped indexes/constraints after duplicate checks; template and active client-share indexes.
- **Finance:** replace POS invoice tenant/number unique index with partial active-row unique index; add overdue-event suppression column only if using column-based suppression; do not denormalize POS line `tenant_id` unless reporting volume justifies it.
- **Platform:** optional automation dispatch table/event metadata; optional backup progress fields; optional dashboard summary/materialized table.
- **Sales:** add quote/order number allocator tables or sequences; add `updated_at` to `sales_organizations` if product wants recency display; change opportunity attachments from `Text` to JSON/JSONB after validating existing rows; consider `String(64)` for quote open-event hash columns; relationship loader changes need query tests but usually no DB migration.
- **Tasks:** add composite indexes for `(tenant_id, status)` and `(tenant_id, due_at)` after EXPLAIN; relationship loader changes need query tests but no DB migration; include/deleted semantics are repository/service changes only.
- **Support:** add unique constraint on `(tenant_id, case_number)` after duplicate checks; add tenant/SLA and active-case indexes based on EXPLAIN; optionally align category column type with schema limit; add comment `updated_at` only if comment editing is planned.
- **Search:** use `CREATE EXTENSION IF NOT EXISTS pg_trgm` or Alembic equivalent before trigram indexes.

Migration rules:

- Use reversible migrations where safe.
- Check and backfill data before adding constraints.
- Match partial-index predicates to the actual soft-delete predicate exactly.
- Keep DB and service validation semantics aligned.

---

# Verification Checklist

Run the subset that matches touched areas. For broad or cross-cutting work, use `./scripts/codex-check.sh`.

## Backend

- Startup config validation fails for missing API and worker secrets.
- Access-token malformed/tenant-mismatch paths do not refresh.
- Concurrent refresh-token reuse allows exactly one success.
- Redis prefix deletion uses `SCAN` and deletes all batches.
- Tenant/custom-field cache invalidation is visible across shared cache clients.
- Contract number concurrent create returns unique values.
- Contract PATCH only validates changed linked fields.
- Contract duplicate/invalid party or signer returns clean 4xx.
- Calendar concurrent booking same-slot submission returns one success and one conflict.
- Calendar `/events/from-task/{task_id}` reaches the correct route.
- Calendar available-slots query count does not grow with candidate slot count.
- Catalog media upload rollback leaves DB and files consistent.
- Catalog slug reuse after soft delete matches product rules.
- Client setup password policy rejects short passwords before hashing.
- Client default-group seeding is race-safe.
- Client page action alias stores canonical `request_changes`.
- Document OAuth token refresh lock prevents clobbered provider state.
- Document include-deleted filtering and restore behavior are correct.
- Document local storage rejects traversal and non-canonical paths.
- Document unlinked access model is explicit.
- Finance downloads require tenant match and reject out-of-root paths.
- Finance IO create/update custom fields commit atomically.
- POS invoice soft-deleted number reuse works in service and DB.
- Quote/order/support case concurrent creates generate unique numbers.
- Sales opportunity attachment upload/delete passes `current_user`, keeps file paths contained, and cleans up staged/orphaned files.
- Sales include-deleted semantics are consistent across active/detail/restore paths.
- Sales imports cannot be blocked by cross-tenant duplicate preloads or link to cross-tenant records.
- Sales parent/custom-field writes roll back together for contacts, organizations, opportunities, leads, and quotes.
- Sales reminder scans are tenant-scoped and chunked.
- Task create rolls back task and assignee rows when assignee sync fails.
- Task include-deleted semantics distinguish include-all from deleted-only restore lookups.
- Deleted task listing respects normal visibility or explicit admin/restore policy.
- Task assignee validation and notification recipient resolution use batched user/team queries.
- Task route-level due-today events are deduped, and scan dedupe remains tenant-scoped.
- Support case create commits case and initial event atomically.
- Support comments/status commit failures roll back and return clean 4xx.
- Support client responses exclude internal comments and source matching is normalized.
- Support search escapes literal `%` and `_` values.
- Platform restore destructive apply rolls back all row changes on failure.
- CRM event enqueue/webhook failures are observable and retryable.
- Global search statement timeout is reset or transaction-scoped safely.
- Message/template/document write conflicts return clean 4xx.

## Frontend/Manual

- Contract, calendar, catalog, document, finance, and client portal query keys refetch only on fetch-affecting changes.
- Dialogs reset when selected records change.
- Forms reject invalid IDs, dates, currency, password, stock, and line values before submit where frontend validation exists.
- Tables do not render `[object Object]` for unknown cell values.
- Catalog create-media failure shows a “record created, media failed” recovery path.
- Client token is not cleared by unrelated endpoint-specific 401s.
- Download helpers work in browsers and DOM-light tests.
- Theme toggle works without View Transitions API support.
- Saved views do not reset on non-semantic condition ordering.
- Nested controls inside clickable rows remain keyboard accessible.
- Realtime hooks do not open duplicate SSE connections if duplicate hooks are present.
- Sales create-contact and quote/support linked pickers find records beyond the first page and never submit `NaN` IDs.
- Sales opportunity stage updates are disabled or serialized while a save/stage mutation is in flight.
- Sales/support detail saves and comments refresh without full-page skeleton flashes.
- Opportunity pipeline and support summary widgets refresh after mutations.
- Quote proposal links open the intended public/frontend route.
- Convert-lead and support dialogs reset transient state on reopen.
- Task query keys use stable filter/sort strings and reset page state explicitly on filter/sort changes.
- Task dialog updates form state when switching tasks without relying on remount, and saving does not remount because of `updated_at`.
- Linked record task widgets can show more than 10 tasks or link to a full task view.

---

# Explicit Audit Corrections

Keep these corrections in mind when implementing tasks:

1. TanStack Query keys are structurally hashed. Do not fix “new string/object identity” by itself; fix missing, unstable, or non-canonical fetch-affecting values.
2. PostgreSQL `pg_trgm` can support `LIKE`/`ILIKE` contains searches. The issue is missing targeted indexes, not that trigram is unusable.
3. Do not preflight every FK by default. Prefer DB constraints, targeted tenant ownership checks, and clean `IntegrityError` translation.
4. Do not blindly migrate SmallInteger booleans. Serializer and validator hardening is lower risk; a physical Boolean migration is optional.
5. The client portal `/request-changes` backend route already hardcodes the canonical action in current notes. Treat naming mismatch as consistency/latent-risk work, not a confirmed broken route.
6. Client portal customer-group cache namespacing is not the core issue. The race is seeding correctness; cache is only an optimization.
7. Document local path traversal is partly mitigated by a final containment guard. The cleanup is canonical path acceptance and removal of confusing prefix stripping.
8. Do not switch document client-share matching from exact tuple to overlap matching until product semantics are decided.
9. Data-transfer job sessions are closed in `finally` in current notes. Context-manager work is clarity/safety cleanup, not a confirmed universal leak.
10. Automation-rule `IntegrityError` handling may already exist. Add regression tests and fix missing paths only.
11. Finance `POST /insertion-orders/import` is not confirmed shadowed by a dynamic POST route. Route tests/reordering are future-safety work.
12. Do not assume `useInsertionOrders` has a broken static key until `usePagedList` is inspected.
13. POS invoice balance clamping may be valid. Document/test it unless product wants explicit overpayment display.
14. Sales lead score timezone handling is not fully broken in current notes; centralize and test the behavior instead of rewriting scoring blindly.
15. Do not require `CreateQuoteModal` to demand `contact_id` unless product/backend rules make contact linking mandatory.
16. Contact import `bulk_insert_mappings` is not automatically wrong; document or replace it only if ORM events/listeners are required.
17. Sales organization `customer_group_id` sorting and cursor ordering are already present in current notes; add regression tests if useful instead of duplicate code.
18. Public quote proposal client-host handling is already guarded in current notes; the cleanup is around event constants and URL/link generation.
19. `datetime.now(timezone.utc)` is the correct support timestamp pattern. The support cleanup is to compute one timestamp per logical operation.
20. Do not rewrite `useSupportCases` query keys as if `usePagedList` were static; current notes say `usePagedList` appends page/filter/sort dimensions.
21. Keep `SupportCaseListItem` separate from heavy detail responses and protect that shape with tests.
22. Do not assume task refresh alone loads every relationship; remove redundant refresh-plus-requery, but keep one reliable explicit loading strategy.
23. `TaskDialog` currently avoids stale prop state through a parent key. The fix is to replace that fragile dependency with explicit form synchronization.
24. `TasksTable.renderCell` is a low-risk performance cleanup, not an immediate correctness bug.
25. Task due-time notification timezone handling is a UX accuracy improvement, not a storage bug.

---

# PR Summary Template

```md
## What changed
- ...

## Why
- ...

## Risk
- Low/Medium/High
- Migration: yes/no
- Backward compatibility: preserved/changed

## Tests
- [ ] Backend tests run
- [ ] Frontend lint/typecheck run
- [ ] Migration applied locally
- [ ] Manual verification notes

## Findings skipped as already fixed or not present
- ...
```
