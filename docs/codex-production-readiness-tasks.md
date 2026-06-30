# Codex Production Readiness Backlog

_Last updated: 2026-06-28_

This is the consolidated implementation backlog for the production-readiness audit across Core Backend, Contracts, Calendar, Catalog, Client Portal, Documents, Platform, Finance, Sales, Support, Tasks, and User Management.

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

1. **Critical security and startup safety:** complete for the user-management auth/SSO backend items.
2. **Concurrency and transaction correctness:** complete.
3. **External side effects and background work:** complete.
4. **Query scalability and indexes:** complete.
5. **Frontend cache, validation, and browser reliability:** FE-QUERY, FE-FORMS, FE-BROWSER, UM-FRONTEND.
6. **Cleanup and maintainability:** SALES-MODELS, UM-MAINT, OPS-MAINT, SERIALIZATION, ROUTES, DUPLICATION.

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
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_client_portal`; `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

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

## UM-AUTH — Harden user auth, setup tokens, and tenant-scoped email identity

- **Completed:** 2026-06-26
- **Source items:** UM-01, UM-02, UM-03, UM-04, UM-05, UM-20, UM-21, UM-22, UM-24
- **Files:** user-management models, auth services/routes, migrations, auth tests
- **Result:** Refresh/setup token timestamps are timezone-aware DB defaults; `users.email` uniqueness is tenant-scoped; passwordless manual login no longer returns or mints setup tokens; failed manual login/setup-required branches are rate-limited; setup-token cleanup/replacement has targeted indexes; cleanup returns `None`; same-email cross-tenant login paths are covered by tenant-scoped and ambiguous-resolution tests.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_setup_tokens tests.test_auth_manual_login tests.test_user_email_uniqueness tests.test_auth_module_access tests.test_sso`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-SSO-BACKEND — Make SSO and MFA backend failure paths safe

- **Completed:** 2026-06-26
- **Source items:** UM-06, UM-07, UM-08, UM-09, UM-19, UM-23
- **Files:** SSO/MFA services, auth routes, focused tests
- **Result:** OIDC callback work is offloaded from the async route; SSO test and callback failure telemetry persists through fresh sessions after rollback; TOTP HMAC uses explicit `digestmod=hashlib.sha1`; MFA challenge attempts are cache-throttled and backup-code comparisons use constant-time comparison; SSO allowed-domain sync uses one assignment path.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sso tests.test_mfa tests.test_api_routes.APIRouteTests.test_oidc_callback_endpoint_runs_sync_sso_work_in_threadpool`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-ADMIN — Make admin team/module/user updates transactional and accurate

- **Completed:** 2026-06-26
- **Source items:** UM-10, UM-11, UM-12, UM-13
- **Files:** admin structure/user/auth services, cache helpers, tests
- **Result:** Team update, permission sync, and user department updates roll back as one unit; duplicate team module permission rows now surface as data-integrity errors; user update options cache keys are schema-versioned; accessible-module schemas preserve built module metadata instead of forcing `is_enabled=True`.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_structure tests.test_admin_users tests.test_auth_module_access`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## CORE-EXPORT — Bound import/export memory and cleanup behavior

- **Completed:** 2026-06-26
- **Source items:** CORE-16, CORE-17, CORE-18, CORE-23, DOC-06, DOC-12, DOC-24, PLAT-07, FIN-13
- **Files:** `backend/app/core/uploads.py`, `backend/app/core/module_csv.py`, `backend/app/core/module_export.py`, `backend/app/core/config.py`, `.env.sample`, `backend/app/modules/documents/services/document_services.py`, `backend/app/modules/platform/services/data_transfer_jobs.py`, focused backend tests
- **Result:** CSV/data-transfer uploads now use bounded chunked reads with a hard configured size ceiling before decode/preview/remap work; document uploads reuse the bounded reader while preserving document-specific validation errors; failed batched ZIP exports delete their temp file; export jobs remove temporary Path artifacts even when result persistence fails; data-transfer upload limits are documented in the sample environment.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_core_hardening.ModuleCsvTests`; `docker compose exec -T backend python -m unittest tests.test_documents.DocumentUploadValidationTests`; `docker compose exec -T backend python -m unittest tests.test_data_transfer_job_permissions`

## CON-CONC — Make contract writes atomic, efficient, and constraint-safe

- **Completed:** 2026-06-26
- **Source items:** CON-01, CON-02, CON-03, CON-04, CON-05, CON-06, CON-07, CON-08, CON-13, CON-19
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, `backend/app/modules/contracts/routes/contracts_routes.py`, `backend/alembic/versions/20260714_contract_number_counters.py`, `backend/tests/test_contracts.py`, `backend/tests/test_crm_numbering.py`
- **Result:** Generated contract numbers now use the shared tenant-scoped `crm_number_counters` allocator with a contract backfill migration; write routes use lightweight mutation loaders and scalar audit snapshots before returning full responses; title-only PATCH avoids unchanged linked-record validation; create/update and party/signer writes translate integrity failures to clean 409 responses while invalid signer party/status/order inputs stay clean 400/404 paths.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_contracts`; `docker compose exec -T backend python -m unittest tests.test_crm_numbering`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## CAL-CONC — Make booking and calendar mutation flows race-safe

- **Completed:** 2026-06-26
- **Source items:** CAL-01, CAL-04, CAL-05, CAL-06, CAL-07, CAL-08, CAL-09, CAL-14, CAL-X1, CAL-X4
- **Files:** `backend/app/modules/calendar/services/booking_services.py`, `backend/app/modules/calendar/services/calendar_services.py`, `backend/app/modules/calendar/repositories/calendar_repository.py`, `backend/tests/test_calendar_booking_services.py`, `backend/tests/test_calendar_services.py`
- **Result:** Public booking slot generation now fetches busy ranges once per requested date range instead of querying per candidate slot; booking submission locks the booking type row, performs a final overlap check before CRM/event side effects, and keeps booking uniqueness conflicts as clean 409 responses; visible calendar list queries use `EXISTS` predicates instead of join-plus-distinct row inflation; calendar create/update service paths validate merged start/end times before mutating ORM state. Static `/events/from-task` routes and direct-user response precedence were already correct in the current code.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_calendar_booking_services`; `docker compose exec -T backend python -m unittest tests.test_calendar_services`; `docker compose exec -T backend python -m unittest tests.test_cursor_pagination`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## CAT-MEDIA — Stabilize catalog media, slug, enum, and boolean behavior

- **Completed:** 2026-06-27
- **Source items:** CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07, CAT-12, CAT-16, CAT-20
- **Files:** `backend/app/modules/catalog/models.py`, `backend/app/modules/catalog/repositories/product_repository.py`, `backend/app/modules/catalog/repositories/service_repository.py`, `backend/app/modules/catalog/services/product_services.py`, `backend/app/modules/catalog/services/service_services.py`, `backend/alembic/versions/20260715_catalog_active_slug.py`, focused catalog tests
- **Result:** Catalog slug uniqueness is now active-row scoped through partial unique indexes so soft-deleted product/service slugs can be reused while active collisions still fail; service-layer writes reject invalid direct enum, currency, price, and boolean values before hitting database constraints; media uploads delete newly persisted media when DB commit fails and only remove previous media after a successful commit; catalog soft deletes use aware UTC timestamps and restore checks reject active slug conflicts cleanly.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_catalog_products`; `docker compose exec -T backend python -m unittest tests.test_catalog_services`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m unittest tests.test_catalog_module_foundation`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## CP-SEED — Make client portal seed/action/list flows bounded and canonical

- **Completed:** 2026-06-27
- **Source items:** CP-02, CP-03, CP-04, CP-07, CP-11, CP-12, CP-13, CP-16, CP-17, CP-18, CP-20, CP-21, CP-22
- **Files:** `backend/app/modules/client_portal/repositories/client_portal_repository.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `backend/app/modules/client_portal/routes/client_portal_routes.py`, `frontend/hooks/useClientPortal.ts`, `backend/tests/test_client_portal.py`
- **Result:** Default customer-group seeding now treats uniqueness races as clean read-after-conflict paths and placeholder groups no longer imply fake 0% discounts; public page action aliases store canonical `request_changes`; client page action summaries use bounded windowed queries and typed summary data instead of dynamic ORM attributes; flat CRM client account/page list routes have explicit limits while cursor routes remain available; client document/proposal download helpers guard browser-only APIs and clean up object URLs.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_client_portal`; `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## DOC-STORAGE — Make document upload/write side effects recoverable

- **Completed:** 2026-06-27
- **Source items:** DOC-07, DOC-11, DOC-16, DOC-17, DOC-27, DOC-28, DOC-29
- **Files:** `backend/app/modules/documents/services/document_services.py`, `backend/app/modules/documents/services/storage_backends.py`, `backend/app/modules/documents/routes/document_routes.py`, `backend/tests/test_documents.py`
- **Result:** Document upload/version routes now run as sync handlers with bounded sync upload reads so provider I/O does not block an async route; content-type allow-lists derive from the extension policy map; local, Google Drive, and OneDrive storage backends expose cleanup hooks; create/version writes delete newly stored objects if DB persistence fails and translate integrity failures to clean conflicts; soft delete uses application UTC timestamps; document download audit logs now store slim document references instead of serializing relationship-heavy document state.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_documents`; `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_document_templates_route_calls_service_before_dynamic_document_route tests.test_api_routes.APIRouteTests.test_document_template_update_route_calls_service`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## FIN-TXN — Make finance writes, imports, invoices, and audits atomic

- **Completed:** 2026-06-27
- **Source items:** FIN-04, FIN-05, FIN-11, FIN-12, FIN-16, FIN-17, FIN-20, FIN-21, FIN-22, FIN-24, FIN-29, FIN-34, FIN-35
- **Files:** `backend/app/modules/finance/models.py`, `backend/app/modules/finance/schema.py`, `backend/app/modules/finance/services/pos_invoice_services.py`, `backend/alembic/versions/20260716_finance_pos_active_number.py`, `backend/tests/test_finance_pos_invoices.py`
- **Result:** POS invoice number uniqueness now matches soft-delete semantics through an active-row partial unique index; duplicate checks ignore deleted invoices while database conflicts return clean `409` responses; tax rates are capped at 100 in API schemas and service validation; POS invoice line updates preserve existing line rows by ID and remove only omitted rows; create/update/delete activity rows are inserted in the same transaction as the invoice mutation instead of committing after the mutation.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_finance_pos_invoices`; `docker compose exec -T backend python -m unittest tests.test_finance_io_api`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-TXN — Make sales writes, imports, follow-ups, and audits atomic

- **Completed:** 2026-06-27
- **Source items:** SALES-09, SALES-10, SALES-11, SALES-12, SALES-15, SALES-19, SALES-22, SALES-39, SALES-DEEP-11, SALES-DEEP-12, SALES-DEEP-14, SALES-DEEP-15, SALES-DEEP-16, SALES-DEEP-17, SALES-DEEP-18, SALES-DEEP-21, SALES-DEEP-26, SALES-DEEP-27, SALES-DEEP-28, SALES-DEEP-32, SALES-DEEP-33, SALES-DEEP-35, SALES-DEEP-36
- **Files:** `backend/app/modules/sales/services/contacts_services.py`, `backend/app/modules/sales/services/organizations_services.py`, `backend/app/modules/sales/services/leads_services.py`, `backend/app/modules/sales/services/quotes_services.py`, `backend/app/modules/sales/services/followups.py`, shared task/activity/notification helpers, focused sales/task tests
- **Result:** Sales contact, organization, lead, and quote create/update/duplicate-replacement paths now flush parent rows, save custom fields, and commit once with rollback guards on integrity failures; duplicate replacement preserves existing assignees unless an assignee is explicitly supplied; portal quote responses commit status and audit together; sales follow-up actions create source audit rows, optional task records, task notifications, and linked task activity in one transaction using opt-in no-commit helper modes while existing task/activity/notification callers keep default committing behavior.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_contacts_services tests.test_organizations_services`; `docker compose exec -T backend python -m unittest tests.test_quotes_services tests.test_sales_orders`; `docker compose exec -T backend python -m unittest tests.test_leads_conversion`; `docker compose exec -T backend python -m unittest tests.test_sales_followups`; `docker compose exec -T backend python -m unittest tests.test_task_source_activity tests.test_task_reminders tests.test_activity_logs`

## SUPPORT-SLA — Protect support SLA lifecycle and linked-record updates

- **Completed:** 2026-06-28
- **Source items:** SUP-05, SUP-06, SUP-07, SUP-17, SUP-18, SUP-19, SUP-22, SUP-29
- **Files:** `backend/app/modules/support/models.py`, `backend/app/modules/support/schema.py`, `backend/app/modules/support/services/cases_services.py`, `backend/app/modules/support/routes/cases_routes.py`, client portal support schemas/routes, support frontend types/views, focused support/client tests
- **Result:** Support create/update payloads no longer expose or honor service-owned SLA/lifecycle timestamps; service normalization whitelists mutable fields before status transition logic and category validation; partial updates validate only changed linked fields; support case/detail/list responses expose assignee and comment author display names; client support serialization continues to hide internal comments while returning client/team author display labels for visible comments.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_support_cases`; `docker compose exec -T backend python -m unittest tests.test_client_portal`

## PLAT-RESTORE — Protect platform restore, backup, retention, and data-transfer jobs

- **Completed:** 2026-06-28
- **Source items:** PLAT-02, PLAT-06, PLAT-08, PLAT-12, PLAT-14, PLAT-20, PLAT-42
- **Files:** `backend/app/modules/platform/services/tenant_restore_runs.py`, `backend/app/modules/platform/services/tenant_backup_runs.py`, `backend/app/modules/platform/routes/tenant_backup_runs.py`, `backend/app/tasks/tenant_backup_tasks.py`, `backend/app/modules/platform/services/data_transfer_jobs.py`, custom module import route/service, focused platform tests
- **Result:** Restore row application now runs inside nested transactions and normalizes restored datetime strings to UTC while failure status is recorded outside the savepoint; manual tenant backup requests create pending runs and enqueue Celery processing; tenant backup retention and data-transfer export cleanup select only IDs/file paths before clearing artifacts; data-transfer job sessions use context-managed sessions while preserving import temp-file cleanup; custom module import execution validates mapping from target headers without running the preview parser over the uploaded CSV.
- **Verification:** `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T backend python -m unittest tests.test_tenant_backup_settings`; `docker compose exec -T backend python -m unittest tests.test_custom_modules`; `docker compose exec -T backend python -m unittest tests.test_data_transfer_job_permissions`

## CAL-SYNC — Make external calendar sync/delete side effects retryable

- **Completed:** 2026-06-28
- **Source items:** CAL-03, CAL-11, CAL-12, CAL-X3
- **Files:** `backend/app/modules/calendar/services/calendar_services.py`, `backend/app/tasks/calendar_tasks.py`, focused calendar tests
- **Result:** Calendar event sync and external-event deletion now run through bounded Celery tasks with retry/backoff/time limits and primitive payloads. Invite accept/decline, event delete, and participant-removal cleanup enqueue provider work after the local transaction commits, so request paths no longer call Google/Microsoft delete or sync APIs inline. Enqueue failures are logged with tenant/event/user/provider context and recorded on participant sync status when the local row still exists.
- **Verification:** `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T backend python -m unittest tests.test_calendar_services`; `docker compose exec -T backend python -m unittest tests.test_calendar_booking_services`

## TASKS-EVENTS — Deduplicate task alerts and make notifications observable

- **Completed:** 2026-06-28
- **Source items:** TASK-07, TASK-17, TASK-18, TASK-19, TASK-20
- **Files:** `backend/app/modules/tasks/services/tasks_services.py`, `backend/app/modules/tasks/routes/tasks_routes.py`, `backend/app/modules/platform/services/crm_events.py`, focused task/event tests
- **Result:** Route-level and scheduled `task.due_today` emissions now share a tenant/day dedupe helper, while scheduled scans batch existing alert lookup by tenant and task IDs. Task alert event types are included in canonical CRM event definitions and asserted against alert event sets. Task assignment and due-today notification failures are logged with tenant/task/user/category context and no longer show raw UTC due-time text in assignment notifications.
- **Verification:** `docker compose exec -T backend python -m compileall app tests`; `docker compose exec -T backend python -m unittest tests.test_task_reminders`; `docker compose exec -T backend python -m unittest tests.test_crm_events`; `docker compose exec -T backend python -m unittest tests.test_task_source_activity`; `docker compose exec -T backend python -m unittest tests.test_sales_followups`; `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_task_recycle_route_passes_current_user_to_visibility_filtered_service tests.test_api_routes.APIRouteTests.test_task_restore_route_uses_deleted_only_lookup`

## PLAT-EVENTS — Move CRM event delivery/automation failures into observable retry paths

- **Completed:** 2026-06-28
- **Source items:** PLAT-03, PLAT-04, PLAT-05, PLAT-09, PLAT-16, PLAT-24, PLAT-25, PLAT-39
- **Files:** `backend/app/modules/platform/services/crm_events.py`, `backend/app/modules/platform/services/automation_rules.py`, `backend/app/modules/platform/models.py`, `backend/app/tasks/automation_tasks.py`, focused CRM event/automation tests
- **Result:** CRM alert events now persist pending Slack/Teams delivery rows and enqueue retryable Celery delivery work after commit instead of posting webhooks inline. Delivery enqueue failures are recorded on delivery rows, automation enqueue failures are logged and persisted on the event payload, alert event sets are asserted as canonical CRM event types, template rendering is single-pass, automation actors use a typed context, duplicate automation-run races recover using cached IDs after rollback, and the `payload`/`payload_json` alias is documented in the model.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_crm_events`; `docker compose exec -T backend python -m unittest tests.test_automation_rules`

## SEARCH-IDX — Add intentional text-search and hot-query index strategy

- **Completed:** 2026-06-28
- **Source items:** CORE-11, CORE-12, CORE-25, CON-12, CON-18, CAL-17, CAL-18, CAT-13, CAT-14, DOC-18, FIN-28, SALES-DEEP-08, SALES-DEEP-09, TASK-13, SUP-13, SUP-14, SUP-15, SUP-30
- **Files:** `backend/app/core/like_patterns.py`, `backend/app/core/module_filters.py`, `backend/app/core/postgres_search.py`, support/contract services and routes, search route caps, `backend/alembic/versions/20260717_search_hot_indexes.py`, focused support/contract tests
- **Result:** Shared `LIKE`/`ILIKE` search patterns now escape `%`, `_`, and backslashes so literal wildcard searches do not over-match. Text filter values are capped before query construction, uncapped search route params are bounded to 100 characters, support and contract hand-built searches use escaped patterns, and PostgreSQL gets targeted trigram search indexes plus partial support SLA and contract expiration hot-path indexes.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_support_cases tests.test_contracts`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`

## LIST-PERF — Consolidate count/list, pagination, and cursor-query optimizations

- **Completed:** 2026-06-30
- **Source items:** CORE-13, CORE-19, CORE-20, CORE-21, CON-11, CAL-13, CAT-15, CP-05, CP-08, CP-14, CP-21, DOC-08, DOC-09, DOC-13, DOC-14, DOC-25, DOC-26, FIN-19, FIN-25, FIN-26, FIN-27, PLAT-10, PLAT-13, PLAT-19, PLAT-38, SALES-13, SALES-16, SALES-17, SALES-DEEP-23, SALES-DEEP-29, SALES-DEEP-30, SALES-DEEP-31, TASK-11, TASK-14, TASK-16, TASK-28, TASK-34, UM-14, UM-16, UM-25, UM-26, SUP-10, SUP-11, SUP-12, SUP-21
- **Files:** `backend/app/core/cursor_pagination.py`, cursor list routes across calendar, catalog, client portal, documents, finance, mail, platform, sales, tasks, user management, and website integrations, focused cursor/API route tests
- **Result:** Cursor responses can now serialize through the shared helper after trimming the sentinel row. Cursor routes pass raw `limit + 1` results plus serializer callbacks, so expensive route serializers and client-page action-summary hydration run only for returned rows while preserving `has_more` and `next_cursor` behavior.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_cursor_pagination`; `docker compose exec -T backend python -m unittest tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-PERF — Bound sales summaries, reminders, exports, and board/list queries

- **Completed:** 2026-06-30
- **Source items:** SALES-13, SALES-14, SALES-16, SALES-17, SALES-18, SALES-DEEP-23, SALES-DEEP-29, SALES-DEEP-30, SALES-DEEP-31, SALES-DEEP-34, SALES-DEEP-48
- **Files:** `backend/app/modules/sales/repositories/opportunities_repository.py`, `backend/app/modules/sales/services/opportunities_services.py`, `backend/tests/test_opportunities_services.py`
- **Result:** Opportunity pipeline summaries now use grouped SQL aggregation for stage counts and numeric totals instead of loading every matching opportunity row into Python. The aggregation keeps tenant/deleted-row scoping and existing filter/search behavior through the shared opportunity query builder while normalizing invalid or comma-formatted text totals consistently with the previous response shape.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_opportunities_services`; `docker compose exec -T backend python -m unittest tests.test_summary_services tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-FILES — Make sales attachments and quote/public-file behavior durable

- **Completed:** 2026-06-30
- **Source items:** SALES-06, SALES-07, SALES-18, SALES-DEEP-05, SALES-DEEP-22, SALES-DEEP-43, SALES-DEEP-54
- **Files:** `backend/app/modules/sales/services/quotes_services.py`, `backend/tests/test_quote_proposals.py`, `frontend/app/dashboard/sales/quotes/[quoteId]/page.tsx`, `frontend/app/public/quotes/proposal/[token]/page.tsx`
- **Result:** Quote proposal send links now point to the public frontend proposal route instead of opening the backend API JSON route directly. The public page loads the signed proposal through the existing token-scoped API and records explicit public download events. Backend proposal event constants now separate internal `sent` events from public `opened`/`viewed`/`downloaded` tracking, with regression coverage that public tracking cannot spoof the internal sent lifecycle event. Existing opportunity attachment cleanup/path-containment tests remain in place for the previously hardened upload/delete paths.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_quote_proposals tests.test_opportunities_api`; `docker compose exec -T backend python -m compileall app tests`; `docker compose run --rm frontend npm run lint`; `docker compose run --rm frontend npm run build`; `git diff --check`

## SUPPORT-PERF — Optimize support summaries, comments, search, and projection

- **Completed:** 2026-06-30
- **Source items:** SUP-10, SUP-11, SUP-12, SUP-13, SUP-14, SUP-15, SUP-16, SUP-20, SUP-21, SUP-30
- **Files:** `backend/app/modules/support/services/cases_services.py`, `backend/tests/test_support_cases.py`
- **Result:** Support summary metrics now come from one grouped aggregate query with conditional urgent/open-SLA counts instead of separate count queries. Client support detail fetches only non-internal comments for client responses and refreshes the in-session relationship with that scoped collection, while CRM support detail explicitly refreshes the full comment collection for internal users. Existing support search wildcard escaping, hot-path indexes, and lightweight list schemas remain covered by the earlier search/list work.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_support_cases`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## TASKS-PERF — Batch task assignees, options, scans, and serialization

- **Completed:** 2026-06-30
- **Source items:** TASK-09, TASK-10, TASK-11, TASK-12, TASK-14, TASK-15, TASK-16, TASK-28, TASK-32, TASK-34
- **Files:** `backend/app/modules/tasks/services/tasks_services.py`, `backend/app/modules/tasks/routes/tasks_routes.py`, `backend/tests/test_task_source_activity.py`
- **Result:** Task assignee validation now batches user and team existence checks instead of querying once per assignee, and task assignment notification recipient resolution batches direct user and team-member lookup into one tenant-scoped user query. Assignment options are bounded, searchable, active-user filtered by default, and can include explicitly selected users/teams so edit screens can resolve current selections without loading every tenant principal. Existing due-scan duplicate detection remains batched from the earlier task events work.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_task_source_activity tests.test_task_reminders`; `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_task_recycle_route_passes_current_user_to_visibility_filtered_service tests.test_api_routes.APIRouteTests.test_task_restore_route_uses_deleted_only_lookup`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

---

# Consolidated Task Backlog

## SALES-MODELS — Normalize sales model loading, timestamps, and domain metadata

- **Severity:** Medium
- **Source items:** SALES-08, SALES-20, SALES-21, SALES-DEEP-01, SALES-DEEP-02, SALES-DEEP-03, SALES-DEEP-04, SALES-DEEP-06, SALES-DEEP-07, SALES-DEEP-13, SALES-DEEP-19, SALES-DEEP-20
- **Files:** sales models, shared sales utilities, lead score services, relationship query tests, migrations where needed
- **Issue:** Sales models use list-heavy `lazy="joined"` defaults, timestamp declarations and soft-delete timestamp creation are inconsistent, organizations lack `updated_at`, assigned-contact user deletion behavior is restrictive, custom-field hydration depends on an in-memory cache, duplicate name/timezone/stage behavior is duplicated, and opportunity currency lookups can repeat per row.
- **Fix:** Prefer `selectin`/explicit eager loading for relationships. Use aware UTC timestamps and a shared timezone normalization helper. Add `updated_at` to organizations if product wants recency display. Change or guard assigned-user delete behavior. Document/test custom-field hydration. Normalize partial-name duplicate handling, stage metadata, lead-score freshness, and per-request currency lookup caching.
- **Acceptance:** Base sales list queries do not auto-join unrelated tables, sales timestamps and hydration contracts are explicit, and model/domain metadata has one clear update path.

## UM-SSO — Finish DNS fallback and login regression guards

- **Severity:** Medium
- **Source items:** UM-18, UM-39
- **Files:** tenant-domain services, frontend login tests where relevant
- **Issue:** Tenant-domain DNS fallback shells out to `dig` in request flow, and MFA setup loading needs a regression guard unless current code proves it already clears reliably.
- **Fix:** Normalize hostnames before DNS lookup and make `dig` fallback explicitly configured or dev-only. Add tests ensuring failed MFA setup clears all loading flags and shows a recoverable error.
- **Acceptance:** DNS process fallback is intentional and normalized, and MFA setup errors cannot leave the login page stuck loading.

## UM-PROFILE — Bound saved-view/user-list payloads and query behavior

- **Severity:** High/Medium
- **Source items:** UM-14, UM-15, UM-16, UM-17, UM-25, UM-26
- **Files:** admin user repositories/routes, profile services, saved-view tests
- **Issue:** Cursor user search can strip relevance/default sort, saved-view config accepts unbounded nested JSON, default saved-view assignment commits and re-queries all views, saved-view and table-preference module sets alias the same mutable set, and admin user projection/query counts need verification.
- **Fix:** Preserve or explicitly document cursor search ordering. Cap saved-view serialized size and nesting depth. Mark default saved views in memory or use a one-query/update-returning path. Split or document shared module sets. Verify admin user list field projection and add query-count tests for list/search/cursor paths.
- **Acceptance:** Saved-view payloads cannot grow unbounded, first saved-view load avoids unnecessary full re-query, user search ordering is intentional, and admin user list performance stays bounded.

## UM-MAINT — Keep low-risk user-management cleanup explicit

- **Severity:** Low/Medium
- **Source items:** UM-38
- **Files:** frontend user table hook docs/tests
- **Issue:** The admin users fetcher is stable today only by convention.
- **Fix:** Document or preserve the module-scoped `fetchUsers` contract unless `usePagedList` later needs a different dependency model.
- **Acceptance:** User fetching does not refetch due to avoidable fetcher identity churn.

## PLAT-QUERY — Reduce platform over-fetching and harden raw-query helpers

- **Completed:** 2026-06-30
- **Source items:** PLAT-11, PLAT-15, PLAT-17, PLAT-18, PLAT-21, PLAT-22, PLAT-23, PLAT-26, PLAT-40, PLAT-41, PLAT-43
- **Files:** `backend/app/modules/platform/services/record_comments.py`, `backend/app/modules/platform/services/global_search.py`, `backend/app/modules/platform/services/recycle_purge.py`, `backend/app/modules/platform/services/message_templates.py`, focused platform tests
- **Result:** Mention suggestions now push module-view eligibility into SQL and escape literal wildcard searches instead of over-fetching candidates and permission sets for Python filtering. Global search resets PostgreSQL statement timeout in a `finally` block. Recycle purge SQL identifiers are validated and quoted through an explicit allowlist helper. Message-template create/update paths pre-check normalized duplicate keys and translate unique-key races to clean `409` responses.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_record_comments tests.test_message_templates tests.test_platform_query_hardening`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## FE-QUERY — Canonicalize frontend query keys and invalidation behavior

- **Severity:** High/Medium
- **Source items:** CON-09, CON-20, CAL-19, CAT-08, DOC-20, DOC-21, FIN-39, FIN-40, FIN-41, PLAT-31, SALES-29, SALES-30, SALES-34, SALES-DEEP-45, SALES-DEEP-46, SALES-DEEP-47, TASK-21, TASK-22, TASK-25, UM-29, UM-35, UM-38, SUP-16, SUP-23, SUP-25, SUP-26
- **Files:** frontend module hooks and saved-view hooks
- **Issue:** Several hooks may omit fetch-affecting values, include UI-only values, invalidate too broadly/sequentially, or compare logically equivalent saved-view conditions order-sensitively. Sales/support detail pages still use raw fetch/local state in places, opportunity/support summaries can stay stale after mutations, task page/query state can diverge when filter/sort keys change, and user-management saved-view/filter refreshes can churn or double-refetch.
- **Fix:** Build query keys from the same canonical values used in URLs. Include page, size, sort, filters, search, module kind, and context where they affect fetches. Exclude visible columns unless the API supports projection. Use narrow invalidations, `Promise.all` where multiple invalidations remain, and normalized condition comparisons when order is not semantic. Migrate high-churn sales/support detail pages to React Query gradually and invalidate list/detail/summary keys after mutations. Use stable task filter/sort key strings in query keys and explicitly reset task page state on filter/sort changes. Avoid duplicate invalidate+refetch calls and memoize user saved-view filters by stable serialized config.
- **Acceptance:** Changing fetch-affecting inputs gets fresh data; UI-only preferences do not refetch; saved views do not reset because of non-semantic condition ordering; sales/support summary widgets do not remain stale after create/update/comment/status changes; task rendered page and internal page state stay aligned.

## FE-FORMS — Align frontend validation and state with backend contracts

- **Severity:** High/Medium
- **Source items:** CON-10, CON-15, CON-16, CAL-10, CAL-15, CAL-20, CAL-21, CAL-22, CAL-X2, CAT-09, CAT-10, CAT-11, CAT-17, CAT-18, CAT-19, CAT-21, CAT-22, CAT-24, FIN-43, FIN-44, FIN-46, FIN-47, FIN-48, FIN-49, SALES-24, SALES-25, SALES-26, SALES-28, SALES-32, SALES-33, SALES-35, SALES-36, SALES-DEEP-44, SALES-DEEP-48, SALES-DEEP-49, SALES-DEEP-51, SALES-DEEP-52, SALES-DEEP-53, SALES-DEEP-55, SALES-DEEP-56, SALES-DEEP-57, TASK-23, TASK-24, TASK-26, TASK-27, UM-30, UM-32, UM-33, UM-34, UM-40, SUP-24, SUP-27, SUP-28
- **Files:** frontend contract/calendar/catalog/finance components and hooks
- **Issue:** Forms/tables can show stale state, submit invalid IDs/dates/line values, render objects as `[object Object]`, mismatch disabled state with submit validation, hide truncation, use browser confirm, double-refresh, or keep stale search/display helpers. Sales/support forms also use fixed first-page pickers, can race stage/status changes, can swallow create errors, and can send stale linked IDs. Task dialog state currently depends on forced remount keys and delete/complete semantics need ownership clarity. User-management dialogs and SSO drafts can reset incorrectly on refetch/open/user changes.
- **Fix:** Reset dialog state on selected record changes. Safely parse IDs and dates once. Validate date order and numeric lines before submit. Render primitives only in default cells. Share validation helpers between disabled and submit paths. Show truncation/inline validation feedback. Use app confirm dialogs. Send minimal toggle payloads. Clear stale search state on unlink and centralize display-name helpers. Prefer searchable linked pickers, serialize stage/status updates, propagate modal mutation errors, track dirty linked fields, and document/normalize cascade clearing. Re-sync task dialog state explicitly on task/open changes, remove `updated_at` from dialog keys, define delete-close ownership, and document completion timestamp behavior. Make SSO draft sync dirty-aware, preserve typed client secrets, and choose one reset strategy for approve/edit user dialogs.
- **Acceptance:** Frontend cannot submit known-invalid values that backend rejects; dialogs show selected record data; table fallback rendering is intentional; destructive actions use app UI; sales/support linked pickers scale beyond fixed first-page data; saving a task does not remount the dialog unexpectedly.

## FE-BROWSER — Guard browser-only APIs and accessibility edge cases

- **Severity:** Medium
- **Source items:** CAL-16, CP-17, DOC-22, PLAT-27, PLAT-28, PLAT-29, PLAT-30, PLAT-32, PLAT-33, PLAT-34, PLAT-35, PLAT-36, CAT-23, CAL-23, FIN-42, FIN-45, SALES-27, SALES-31, SALES-DEEP-50, SALES-DEEP-58, TASK-29, TASK-30, UM-31, UM-36, UM-37, UM-39
- **Files:** frontend client/document/platform/catalog/calendar/finance components and hooks
- **Issue:** Browser-only APIs can throw in SSR/private/unsupported contexts, shared filter fields are hardcoded, nested controls can lose keyboard behavior, SSE hooks may duplicate connections, some memoization/comment/test coverage is missing, and error fallbacks can be vague. Sales WhatsApp launch and stage helper imports also need browser-flow and metadata cleanup. User-management auth callback/setup/login flows need redirect, abort, and loading regression guards.
- **Fix:** Guard `window`, `document`, `sessionStorage`, object URLs, and `startViewTransition`. Provide View Transitions type guards. Make shared filter fields module-owned. Preserve keyboard activation for nested controls. Share SSE connections per endpoint/session if duplicate connections are verified. Add comments/tests for double-download guards. Add reasonable `staleTime` or memoization only where useful. Use React Query for WhatsApp templates and open popups synchronously before async URL assignment. Canonicalize opportunity stage helper imports. Stabilize empty task assignee option arrays and move/memoize task table cell renderers only where it helps row memoization. Add redirect-once guard to auth callback, abortable setup-password policy loading, and MFA setup loading regression tests.
- **Acceptance:** Unsupported browsers/SSR-like tests do not crash; shared UI is module-correct; nested controls remain keyboard-operable; realtime hooks avoid duplicate connections if verified; WhatsApp launch is not blocked by async popup behavior.

## UM-FRONTEND — Stabilize user-management table, self state, and settings forms

- **Severity:** Critical/High
- **Source items:** UM-27, UM-28, UM-30, UM-32, UM-33, UM-34, UM-35, UM-40
- **Files:** user-management table/hooks/dialogs, settings users page, role-permission hooks
- **Issue:** The user table state-key sync effect can loop or reset excessively, current user ID loads after first render so self-actions can be wrong initially, SSO settings refetches can wipe dirty client-secret edits, role permission refetch can jump selected role, and approve/edit dialogs have unclear reset ownership.
- **Fix:** Gate table state reset only on state-key changes using refs for current state. Initialize current user ID lazily from session storage on the first client render. Make SSO draft sync dirty-aware and preserve typed secrets across background refetch. Auto-select a role only before initial selection or when the selected role no longer exists. Reset approve/edit dialogs on open/user change through one explicit strategy.
- **Acceptance:** Saved-view changes reset user table state once, self rows/actions are correct on first client render, SSO edits are not wiped by refetch, and user/role dialogs do not carry stale local state.

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
- **User Management:** no pending production-readiness schema items after the user email, token timestamp, and setup-token index migrations.
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
- Saved-view config rejects oversized or deeply nested JSON.
- User cursor search ordering semantics are tested and documented.
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
- User table saved-view state changes reset once without loops.
- Current user row is marked correctly on first client render.
- SSO client secret and dirty draft fields survive background refetch.
- Auth callback redirects once and setup-password policy request aborts on unmount.
- Approve/edit user dialogs reset according to one clear strategy.

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
26. `hmac.new(..., hashlib.sha1)` is valid today; make it explicit with `digestmod=` for readability, not as a runtime bug fix.
27. DNS `dig` fallback uses an argv list, so do not label it shell-string injection. Treat it as hostname-normalization and runtime-hardening work.
28. Module-scope `fetchUsers` is stable today; only change it if `usePagedList` dependency behavior requires it.
29. MFA setup loading concerns should be covered by regression tests unless current code proves a stuck state.

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
