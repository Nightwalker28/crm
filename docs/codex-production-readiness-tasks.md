# Codex Production Readiness Backlog

_Last updated: 2026-06-22_

This is the consolidated implementation backlog for the production-readiness audit across Core Backend, Contracts, Calendar, Catalog, Client Portal, Documents, Platform, and Finance.

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

1. **Critical security and startup safety:** CP-SEC.
2. **Concurrency and transaction correctness:** CON-CONC, CAL-CONC, CAT-MEDIA, CP-SEED, DOC-STORAGE, FIN-TXN, PLAT-RESTORE.
3. **External side effects and background work:** CAL-SYNC, DOC-STORAGE, PLAT-EVENTS, PLAT-RESTORE.
4. **Query scalability and indexes:** SEARCH-IDX, LIST-PERF, PLAT-QUERY.
5. **Frontend cache, validation, and browser reliability:** FE-QUERY, FE-FORMS, FE-BROWSER.
6. **Cleanup and maintainability:** OPS-MAINT, SERIALIZATION, ROUTES, DUPLICATION.

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
- **Source items:** CORE-11, CORE-12, CORE-25, CON-12, CON-18, CAL-17, CAL-18, CAT-13, CAT-14, DOC-18, FIN-28
- **Files:** module filter/search helpers, models, Alembic migrations, tests
- **Issue:** Contains searches and hot range/lookups lack targeted indexes; some generated SQL is unnecessarily complex; several constraints need active-row semantics.
- **Fix:** Cap text filter values. Use `pg_trgm` GIN indexes for high-use contains searches while preserving LIKE/ILIKE semantics. Add targeted composite/partial indexes for contract expiration, calendar ranges/participants, document template/active shares, catalog currency constraints, and active POS invoice number uniqueness. Flatten PostgreSQL searchable expressions with `concat_ws` where applicable.
- **Acceptance:** Hot contains/range/lookup paths have an index strategy; oversized filter values fail before query construction; active-row uniqueness matches soft-delete behavior.

## LIST-PERF — Consolidate count/list, pagination, and cursor-query optimizations

- **Severity:** Medium/High
- **Source items:** CORE-13, CORE-19, CORE-20, CORE-21, CON-11, CAL-13, CAT-15, CP-05, CP-08, CP-14, CP-21, DOC-08, DOC-09, DOC-13, DOC-14, DOC-25, DOC-26, FIN-19, FIN-25, FIN-26, FIN-27, PLAT-10, PLAT-13, PLAT-19, PLAT-38
- **Files:** shared pagination helpers, module repositories/services/routes, frontend consumers where response contracts change
- **Issue:** Several endpoints load full lists to count/slice, run duplicate fetches, manually compute offsets, hydrate cursor sentinel rows, churn DB sessions/queries in polling paths, or lack pagination metadata.
- **Fix:** Add summary/count/latest helpers for overview pages. Use count-specific or window-count queries on hot endpoints. Enforce bounded flat list routes or cursor alternatives, including searchable participant pickers instead of fixed caps. Use `Pagination.offset`/`limit`. Ensure cursor responses strip sentinel rows before serialization/hydration. Remove redundant refresh/refetch paths. Verify and remove duplicate document share-list fetches if present. Reduce SSE/realtime DB session and query churn.
- **Acceptance:** Pagination contracts are explicit and consistent; overview/list endpoints do not fetch full datasets for summaries; cursor sentinels are not returned or over-hydrated; polling/list paths do not multiply DB work unnecessarily.

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

## CP-SEC — Harden client portal password, auth, pricing, and visibility boundaries

- **Severity:** Critical/High
- **Source items:** CP-01, CP-06, CP-09, CP-10, CP-15, CP-19, CP-23
- **Files:** client portal schemas/services/routes, `frontend/hooks/useClientPortal.ts`, setup page, tests
- **Issue:** Setup passwords can be trivial, pricing/customer-group resolution can silently degrade, Decimal parsing lacks finite checks at service boundaries, frontend clears tokens on any 401, serializers assume loaded relationships, and expiry datetime normalization is inconsistent.
- **Fix:** Add one client password policy constant enforced in schema, service, and setup UI. Require explicit DB/session-backed customer-group resolution where personalized pricing matters. Add finite Decimal helper. Clear client token only for definitive invalid-session responses. Guard serializers against lazy-load surprises. Normalize naive and aware datetimes to UTC.
- **Acceptance:** Setup tokens cannot create trivial passwords; personalized pricing does not silently fall back to public because of detached state; malformed pricing/order data returns clean 400; unrelated 401s do not log out valid clients.

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
- **Source items:** CON-09, CON-20, CAL-19, CAT-08, DOC-20, DOC-21, FIN-39, FIN-40, FIN-41, PLAT-31
- **Files:** frontend module hooks and saved-view hooks
- **Issue:** Several hooks may omit fetch-affecting values, include UI-only values, invalidate too broadly/sequentially, or compare logically equivalent saved-view conditions order-sensitively.
- **Fix:** Build query keys from the same canonical values used in URLs. Include page, size, sort, filters, search, module kind, and context where they affect fetches. Exclude visible columns unless the API supports projection. Use narrow invalidations, `Promise.all` where multiple invalidations remain, and normalized condition comparisons when order is not semantic.
- **Acceptance:** Changing fetch-affecting inputs gets fresh data; UI-only preferences do not refetch; saved views do not reset because of non-semantic condition ordering.

## FE-FORMS — Align frontend validation and state with backend contracts

- **Severity:** High/Medium
- **Source items:** CON-10, CON-15, CON-16, CAL-10, CAL-15, CAL-20, CAL-21, CAL-22, CAL-X2, CAT-09, CAT-10, CAT-11, CAT-17, CAT-18, CAT-19, CAT-21, CAT-22, CAT-24, FIN-43, FIN-44, FIN-46, FIN-47, FIN-48, FIN-49
- **Files:** frontend contract/calendar/catalog/finance components and hooks
- **Issue:** Forms/tables can show stale state, submit invalid IDs/dates/line values, render objects as `[object Object]`, mismatch disabled state with submit validation, hide truncation, use browser confirm, double-refresh, or keep stale search/display helpers.
- **Fix:** Reset dialog state on selected record changes. Safely parse IDs and dates once. Validate date order and numeric lines before submit. Render primitives only in default cells. Share validation helpers between disabled and submit paths. Show truncation/inline validation feedback. Use app confirm dialogs. Send minimal toggle payloads. Clear stale search state on unlink and centralize display-name helpers.
- **Acceptance:** Frontend cannot submit known-invalid values that backend rejects; dialogs show selected record data; table fallback rendering is intentional; destructive actions use app UI.

## FE-BROWSER — Guard browser-only APIs and accessibility edge cases

- **Severity:** Medium
- **Source items:** CAL-16, CP-17, DOC-22, PLAT-27, PLAT-28, PLAT-29, PLAT-30, PLAT-32, PLAT-33, PLAT-34, PLAT-35, PLAT-36, CAT-23, CAL-23, FIN-42, FIN-45
- **Files:** frontend client/document/platform/catalog/calendar/finance components and hooks
- **Issue:** Browser-only APIs can throw in SSR/private/unsupported contexts, shared filter fields are hardcoded, nested controls can lose keyboard behavior, SSE hooks may duplicate connections, some memoization/comment/test coverage is missing, and error fallbacks can be vague.
- **Fix:** Guard `window`, `document`, `sessionStorage`, object URLs, and `startViewTransition`. Provide View Transitions type guards. Make shared filter fields module-owned. Preserve keyboard activation for nested controls. Share SSE connections per endpoint/session if duplicate connections are verified. Add comments/tests for double-download guards. Add reasonable `staleTime` or memoization only where useful.
- **Acceptance:** Unsupported browsers/SSR-like tests do not crash; shared UI is module-correct; nested controls remain keyboard-operable; realtime hooks avoid duplicate connections if verified.

## OPS-MAINT — Keep low-risk operational cleanup explicit

- **Severity:** Low/Medium
- **Source items:** CORE-22, CORE-27, FIN-07, FIN-15
- **Files:** Celery beat config, password cache helper, finance IO services/routes, tests or docs
- **Issue:** Some audit items are not large enough for their own production-readiness epic but should remain visible: maintenance jobs use relative intervals, common-password memory should be measured before optimizing, insertion-order filenames need extra sanitization, and overdue finance events may repeat if emitted on every save.
- **Fix:** Convert true maintenance jobs to wall-clock `crontab()` schedules where useful. Measure common-password cache size before changing it. Harden uploaded filename basenames by stripping control characters and collapsing suspicious repeated-dot patterns. Verify overdue event emission and emit only on transition or through a scheduled scanner if repeated events are confirmed.
- **Acceptance:** Low-risk operational cleanup is documented or tested, with no premature optimization and no repeated overdue-event spam if the path exists.

## SERIALIZATION — Make API serialization contracts explicit

- **Severity:** Medium
- **Source items:** CORE-24, CORE-26, CON-14, CAT-04, DOC-27, FIN-23, FIN-30, CP-12, CP-15
- **Files:** serializers, schemas, models/docs, tests
- **Issue:** Some responses expose misleading nullable/default semantics, aliased mutable sets, missing-media ambiguity, heavy audit states, or implicit tenant inheritance.
- **Fix:** Return copies/frozen sets for duplicate detection. Define `None` media URL behavior and render placeholders. Clarify auto-generated contract numbers. Keep boolean serialization stable. Use slim audit states. Document inherited tenancy for child rows. Replace hidden dynamic ORM serializer attributes with typed inputs.
- **Acceptance:** API consumers see intentional null/default/media/boolean behavior, and serializers do not mutate caller-owned state or trigger accidental lazy loads.

## ROUTES — Add route-order and path-boundary regression coverage

- **Severity:** Medium/Low
- **Source items:** CAL-04, CP-03, FIN-36, PLAT-26, PLAT-43
- **Files:** module route files and route tests
- **Issue:** Static routes and constrained action/path routes need regression coverage so future dynamic routes do not intercept them.
- **Fix:** Place static routes before dynamic routes where applicable. Use enum/Literal route params for finite action vocabularies. Add route tests for import/export/task/path-converter behavior.
- **Acceptance:** Known static/action routes reach intended handlers, and unsupported path/action values fail at route boundary.

## DUPLICATION — Remove low-risk duplication only where it improves clarity

- **Severity:** Low/Medium
- **Source items:** CON-17, CAT-12, CAT-20, CAT-22, DOC-16, FIN-06, FIN-24, FIN-35, FIN-47
- **Files:** affected module utilities, services, schemas, frontend helpers
- **Issue:** Some list/search handlers, validators, slug/content-type/formatting/display helpers, and query serializers are duplicated.
- **Fix:** Extract shared helpers only when behavior is identical and the abstraction reduces complexity. Preserve endpoint response shapes.
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
