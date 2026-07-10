# Codex Production Readiness Backlog

_Last updated: 2026-07-10_

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
5. **Frontend cache, validation, and browser reliability:** FE-FORMS, FE-BROWSER, UM-FRONTEND.
6. **Cleanup and maintainability:** SALES-MODELS, OPS-MAINT, SERIALIZATION, ROUTES, DUPLICATION.

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
- **Source items:** SALES-13, SALES-14, SALES-16, SALES-17, SALES-18, SALES-DEEP-23, SALES-DEEP-29, SALES-DEEP-30, SALES-DEEP-31, SALES-DEEP-34
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

## FE-QUERY-KEYS — Canonicalize high-churn frontend query keys and user-management state

- **Completed:** 2026-07-01
- **Source items:** SUP-16, SALES-29, SALES-30, TASK-21, FIN-39, FIN-40, FIN-41, UM-27, UM-28, UM-29, UM-30, UM-32, UM-33, UM-34, UM-35, UM-38
- **Files:** shared paged-list/query helpers, task/opportunity/finance hooks, user-management hooks/dialogs/settings
- **Result:** Saved-view filters now have canonical serialized query keys that ignore non-semantic condition ordering. Shared paged lists include visible columns in the cache key only when the fetcher sends a `fields` projection, so support/contracts/catalog/orders column changes stay UI-only while sales, finance, and user lists still refetch for projected payloads. Task lists use stable filter/sort strings in their query keys. Opportunity pipeline summaries use canonical filter keys and are invalidated with opportunity list mutations. Finance insertion-order mutations avoid duplicate invalidate-plus-refetch calls. User-management self state now initializes from session storage on the first client render, table saved-view resets are gated by state-key changes, SSO drafts preserve dirty client-secret edits during background refetch, role permission refetches preserve the selected role unless it disappears, and approve/edit dialogs use explicit reset ownership.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SUPPORT — Move support case detail and summary refresh onto React Query

- **Completed:** 2026-07-01
- **Source items:** SUP-23, SUP-25, SUP-26
- **Files:** `frontend/hooks/support/useCases.ts`, support case list/detail pages, create-support dialog
- **Result:** Support case list, detail, and summary queries now use explicit shared query keys. The support list renders the existing backend summary metrics, and create/update/comment mutations invalidate the list, active detail, and summary keys together. The support detail page no longer owns fetched case data in local state, so comments and lifecycle updates refresh without forcing a full-page loading reset.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-TASKS — Stabilize task page query state and dialog refresh behavior

- **Completed:** 2026-07-01
- **Source items:** TASK-22, TASK-25
- **Files:** `frontend/hooks/useTasks.ts`, `frontend/app/dashboard/tasks/page.tsx`, `frontend/components/tasks/TaskDialog.tsx`
- **Result:** Task lists use stable canonical filter/sort strings in query keys and reset page state when fetch-affecting filters or sort change. The task dialog remount boundary now tracks only open state and selected task identity, no longer `updated_at`, so switching tasks still gets fresh form state while saving a task does not remount the dialog unexpectedly.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SALES-LISTS — Standardize sales list query helpers and pipeline summary typing

- **Completed:** 2026-07-02
- **Source items:** SALES-DEEP-45, SALES-DEEP-46, SALES-DEEP-47
- **Files:** `frontend/hooks/sales/*`, `frontend/app/dashboard/sales/opportunities/page.tsx`
- **Result:** Sales list hooks now share one API-column helper for stripping custom-only columns before `fields` projection and use fetcher signatures that match `usePagedList`. Orders remain UI-column-only because the backend sales-orders list/search routes do not expose a `fields` projection. Opportunity pipeline summary invalidation stays centralized in opportunity hook mutations, and the pipeline summary fetcher now uses the saved-view filter type plus the shared saved-view query param serializer instead of accepting `unknown`.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SALES-DETAIL-OPPORTUNITY — Move opportunity detail summary loading to React Query

- **Completed:** 2026-07-02
- **Source items:** SALES-34 partial
- **Files:** `frontend/app/dashboard/sales/opportunities/[opportunityId]/page.tsx`
- **Result:** Opportunity detail summary data now loads through a React Query detail key instead of manual `apiFetch` state. Save, stage-change, and follow-up activity refresh the detail query while list and pipeline-summary invalidation stay narrow, so successful mutations no longer force a full-page loading reset.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SALES-DETAIL-CONTACT — Move contact detail summary loading to React Query

- **Completed:** 2026-07-02
- **Source items:** SALES-34 partial
- **Files:** `frontend/app/dashboard/sales/contacts/[contactId]/page.tsx`
- **Result:** Contact detail summary data now loads through a React Query detail key instead of manual `apiFetch` state. Save, WhatsApp, customer-group, and follow-up activity refresh the detail query while contact list invalidation stays narrow, so successful mutations no longer force a full-page loading reset or duplicate list refetch.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SALES-DETAIL-LEAD — Move lead detail summary loading to React Query

- **Completed:** 2026-07-02
- **Source items:** SALES-34 partial
- **Files:** `frontend/app/dashboard/sales/leads/[leadId]/page.tsx`
- **Result:** Lead detail summary data now loads through a React Query detail key instead of manual `apiFetch` state. Save, conversion, and follow-up activity refresh the detail query while related list invalidations stay narrow, so successful mutations no longer force a full-page loading reset or duplicate list refetch.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-SALES-DETAIL-REMAINING — Finish sales detail summary query migration

- **Completed:** 2026-07-02
- **Source items:** SALES-34
- **Files:** `frontend/app/dashboard/sales/organizations/[orgId]/page.tsx`, `frontend/app/dashboard/sales/quotes/[quoteId]/page.tsx`
- **Result:** Organization and quote detail summary data now load through React Query detail keys instead of manual `apiFetch` state. Save, customer-group, proposal, conversion, and follow-up flows refresh the affected detail query while list invalidations stay narrow, completing the sales summary-detail migration started for opportunities, contacts, and leads.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-CONTRACT-DETAIL — Move contract detail loading to React Query

- **Completed:** 2026-07-02
- **Source items:** CON-20
- **Files:** `frontend/app/dashboard/contracts/[contractId]/page.tsx`
- **Result:** Contract detail data now loads through a React Query detail key instead of manual `apiFetch` state. Status updates invalidate the contract list and refresh the active detail query, while party and signer mutations refresh only the active detail record without forcing a full-page loading reset.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-QUERY-REMAINING — Finish non-sales frontend query cleanup

- **Completed:** 2026-07-02
- **Source items:** CON-09, CAL-19, CAT-08, DOC-20, DOC-21, PLAT-31
- **Files:** `frontend/hooks/useCalendar.ts`, `frontend/hooks/useDocuments.ts`, `frontend/hooks/contracts/useContracts.ts`, `frontend/components/catalog/CatalogRecordDetailPage.tsx`, `frontend/app/dashboard/settings/integrations/page.tsx`
- **Result:** Contract lists already use the shared paged-list query key that includes page, size, canonical filters, and sort while keeping visible columns UI-only because the endpoint does not project by `fields`. Document list queries are namespaced under `["documents", "list", ...]`, so list invalidation no longer catches versions/storage queries by accident; document and calendar mutation invalidations now run as scoped `Promise.all` batches instead of sequential cache work. Catalog detail updates no longer force a duplicate refetch after action hooks invalidate the exact record query. Integration event history now uses a stable primitive filter key instead of an object identity in the React Query key.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-SALES-RELIABILITY — Harden sales form refresh, errors, and stage updates

- **Completed:** 2026-07-02
- **Source items:** SALES-25, SALES-26, SALES-33, SALES-35, SALES-DEEP-44, SALES-DEEP-48, SALES-DEEP-49, SALES-DEEP-51, SALES-DEEP-55
- **Files:** `frontend/app/dashboard/sales/opportunities/page.tsx`, `frontend/app/dashboard/sales/opportunities/[opportunityId]/page.tsx`, `frontend/app/dashboard/sales/contacts/[contactId]/page.tsx`, `frontend/hooks/sales/useOrganizations.ts`, `frontend/components/organizations/createOrganizationModal.tsx`, `frontend/components/leads/ConvertLeadDialog.tsx`
- **Result:** Opportunity detail no longer uses full-page reload state for post-mutation refreshes, and stage changes are serialized with a dedicated in-flight guard so rapid stage actions cannot overlap with saves or each other. The opportunity pipeline board now explicitly states that it shows the current paginated record slice while stage totals cover all matching deals. Contact detail saves no longer resend a loaded organization id for unrelated field edits. Organization creation errors now rethrow from the hook and stay visible inline in the create-account modal instead of resetting the form as if creation succeeded. Convert-lead dialog transient state resets on reopen.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-SALES-PICKERS — Standardize sales creation pickers and quote linked IDs

- **Completed:** 2026-07-02
- **Source items:** SALES-24, SALES-32, SALES-36, SALES-DEEP-56, SALES-DEEP-57
- **Files:** `frontend/components/contacts/createContactModal.tsx`, `frontend/hooks/sales/useCreateContact.ts`, `frontend/components/quotes/CreateQuoteModal.tsx`
- **Result:** Contact creation now uses the shared server-backed `LinkedRecordPicker` for accounts instead of fetching and filtering the first 50 organizations in the modal. Quote creation keeps backend-aligned required validation at customer name, safely parses optional deal IDs so corrupted state cannot submit `NaN`, and shows relationship labels like "Linked via deal" or "Linked via contact" instead of raw contact/account ID placeholders when the search result only exposes linked IDs.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-TASK-DIALOG — Make task dialog state ownership explicit

- **Completed:** 2026-07-03
- **Source items:** TASK-23, TASK-24, TASK-26, TASK-27
- **Files:** `frontend/components/tasks/TaskDialog.tsx`, `frontend/app/dashboard/tasks/page.tsx`
- **Result:** Task dialog form state now resets from the open/task/update boundary directly, so the task page no longer needs a keyed remount to keep selected task data fresh. The dialog owns the post-delete close path after a successful delete, while the parent mutation only deletes and shows the toast. Completed timestamps now preserve an existing completion timestamp while a task remains completed and stamp a fresh value only when status transitions into completed.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-SUPPORT-LINKS — Normalize support case linked-record state

- **Completed:** 2026-07-03
- **Source items:** SUP-24, SUP-27, SUP-28
- **Files:** `frontend/components/support/CreateSupportCaseDialog.tsx`, support case detail query path
- **Result:** Support case creation now stores quote, order, and assignee IDs as `number | null` like the other linked records, so submit payloads no longer rely on per-field string parsing. Parent linked-record edits intentionally clear narrower child selections and document that cascade behavior beside the picker group. Support comments were already covered by the React Query detail path from `FE-QUERY-SUPPORT`: adding a comment invalidates the active detail query while preserving the currently rendered case data, avoiding the old full-page reload behavior.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-CATALOG-FINANCE-VALIDATION — Match form validation to backend contracts

- **Completed:** 2026-07-03
- **Source items:** CAT-09, CAT-10, CAT-11, CAT-17, CAT-18, CAT-19, FIN-43, FIN-44, FIN-46, FIN-48, FIN-49
- **Files:** `frontend/components/catalog/CatalogRecordDialog.tsx`, `frontend/components/finance/insertionOrderDialog.tsx`
- **Result:** Catalog create/edit now shares a single validation path for disabled state and submit, matching backend constraints for required name, 3-letter uppercase currency, non-negative public unit price, and blank-or-non-negative stock quantity. Insertion orders now validate required customer context, optional numeric totals, effective/due date order, and service start/end date order before submit, with inline field errors using the same helpers as the submit guard.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-CATALOG-TABLE-ACTIONS — Finish catalog table rendering and delete confirmation

- **Completed:** 2026-07-03
- **Source items:** CAT-21, CAT-22, CAT-24
- **Files:** `frontend/components/catalog/CatalogRecordDetailPage.tsx`, `frontend/components/catalog/CatalogRecordsTable.tsx`
- **Result:** Catalog detail delete now uses the shared confirmation dialog instead of a browser confirm. Catalog tables now render configured catalog columns intentionally, including description, currency, stock quantity, created date, and updated date, so saved-view columns no longer fall into the generic empty fallback. Truncated catalog descriptions and media filenames expose their full value through native titles.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-CONTRACT-CALENDAR-DIALOGS — Align dialog validation and reset ownership

- **Completed:** 2026-07-03
- **Source items:** CON-10, CON-15, CON-16, CAL-10, CAL-15
- **Files:** `frontend/components/contracts/CreateContractDialog.tsx`, `frontend/components/contracts/ContractsTable.tsx`, `frontend/components/calendar/CalendarEventDialog.tsx`, `frontend/app/dashboard/calendar/page.tsx`
- **Result:** Contract creation now validates the same parsed amount and optional linked IDs that submit sends, preventing invalid optional fields from becoming `NaN`; the contracts table fallback now renders only primitive values so unexpected configured fields cannot show `[object Object]`. Calendar event dialogs now reset from open/event/draft inputs directly instead of relying on a parent key remount, and they block end times that are not after start times with inline feedback matching the backend contract.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-SALES-DISPLAY-POLICY — Normalize website labels and quote-number policy

- **Completed:** 2026-07-03
- **Source items:** SALES-28, SALES-DEEP-53
- **Files:** `frontend/lib/urlDisplay.ts`, `frontend/components/organizations/organizationCard.tsx`, `frontend/components/organizations/OrganizationsTable.tsx`, `frontend/app/dashboard/sales/quotes/[quoteId]/page.tsx`
- **Result:** Organization website display now uses a shared URL helper so `http://`, `https://`, and bare domains render consistently while outbound links get a usable protocol. Quote detail now treats quote number as the protected field that backend module-field config already enforces: it is always rendered and included in save payloads alongside the other required relationship/custom-field values.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-SALES-ORG-DETAIL — Stabilize account detail refresh and assignment context

- **Completed:** 2026-07-03
- **Source items:** SALES-DEEP-52
- **Files:** `frontend/app/dashboard/sales/organizations/[orgId]/page.tsx`
- **Result:** Account detail now distinguishes initial loading from background refresh so save flows keep the current record visible while the summary query refreshes. Customer-group assignment rejects invalid or missing group values instead of silently converting them to no group. The page now surfaces the current owner and states that detail edits preserve account ownership, matching the current backend update contract where `assigned_to` is not accepted on organization detail updates.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-CALENDAR-INVALIDATION — Normalize calendar invite refresh and participant labels

- **Completed:** 2026-07-03
- **Source items:** CAL-20, CAL-21, CAL-22
- **Files:** `frontend/hooks/useCalendar.ts`, `frontend/components/calendar/CalendarParticipantPicker.tsx`
- **Result:** Calendar invite responses now use the shared calendar invalidation path once instead of invalidating the event detail query separately after the broad calendar-event invalidation already covers it. Participant display construction is centralized and keeps selected user/team entries visible with stable fallback labels when the current option list does not include the selected ID.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-BROWSER-SALES — Stabilize sales WhatsApp browser flow and stage helper imports

- **Completed:** 2026-07-03
- **Source items:** SALES-27, SALES-31, SALES-DEEP-50, SALES-DEEP-58
- **Files:** `frontend/app/dashboard/sales/contacts/[contactId]/page.tsx`, `frontend/components/opportunities/OpportunitiesTable.tsx`
- **Result:** Contact WhatsApp templates now load through React Query with a stable key and `staleTime`, and the selected template is derived without an effect-driven state sync. WhatsApp launch opens a pending browser window synchronously from the click handler, then navigates it after the API returns so popup blockers are less likely to block the flow. Opportunity tables now import stage labels and styles from the domain stage helper instead of mixing the domain helper with the shared status-style module.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-BROWSER-DOWNLOADS — Guard blob downloads and View Transition fallback

- **Completed:** 2026-07-06
- **Source items:** CP-17, DOC-22, PLAT-27, PLAT-28, FIN-42
- **Files:** `frontend/lib/browser.ts`, client portal download helpers, export/report/backup/public quote download paths, `frontend/components/ui/AnimatedThemeToggler.tsx`
- **Result:** Blob download and open-in-new-tab behavior now runs through a shared browser helper that checks for the required DOM/URL APIs and cleans up object URLs consistently. Client portal documents, public client page documents, quote proposals, background exports, reports, and backup downloads reuse the helper instead of duplicating unguarded `URL.createObjectURL` and `document.createElement` calls. Theme toggling now falls back when View Transitions are unsupported and still toggles when local storage is unavailable.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-REALTIME — Share the dashboard realtime SSE connection

- **Completed:** 2026-07-06
- **Source items:** PLAT-29
- **Files:** `frontend/lib/realtime.ts`, `frontend/hooks/useRealtimeNotifications.ts`, `frontend/hooks/useRealtimeJobStatus.ts`
- **Result:** Notification and data-transfer job realtime hooks now subscribe through one shared `/platform/realtime/stream` manager instead of opening separate `EventSource` connections for each hook. The shared manager broadcasts connection status, keeps per-event listener cleanup scoped to each subscriber, closes the stream when the last subscriber unmounts, and still reports unsupported browsers cleanly.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-TASKS — Stabilize task assignee and table render references

- **Completed:** 2026-07-06
- **Source items:** TASK-29, TASK-30
- **Files:** `frontend/components/tasks/TaskDialog.tsx`, `frontend/components/tasks/TasksTable.tsx`
- **Result:** Task assignee picker fallback option arrays are now module-level typed constants instead of fresh empty arrays on every loading render, so selected-entry memoization only changes when actual option or value data changes. Task table cell rendering now lives at module scope instead of being recreated inside the table component, keeping future row memoization viable without changing table output.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-UM-AUTH — Guard auth redirects, setup loading, and filter UI memo state

- **Completed:** 2026-07-06
- **Source items:** UM-31, UM-36, UM-37
- **Files:** `frontend/app/auth/callback/AuthCallbackClient.tsx`, `frontend/app/auth/setup-password/page.tsx`, `frontend/components/users/userFilters.tsx`, `frontend/components/users/userManagementTable.tsx`
- **Result:** Auth callback success redirects are guarded so `router.replace` can run at most once even if search params change. Setup-password policy loading now uses `AbortController` and passes the signal through `apiFetch`, cancelling the request on unmount instead of only suppressing state updates. User filter active-state memoization and saved-view filter equality no longer treat opening or closing the filter drawer as a fetch-affecting filter change.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-MFA-SETUP — Cover required MFA setup failure recovery

- **Completed:** 2026-07-06
- **Source items:** UM-39
- **Files:** `frontend/app/auth/login/page.tsx`, `frontend/tests/e2e/auth-dashboard.spec.ts`
- **Result:** Required MFA setup failures now explicitly reset the login page back to the manual sign-in step, clear partial MFA setup state, and surface the recoverable setup error. The auth Playwright suite now mocks the `mfa_setup_required` login response and failed setup endpoint, asserting that the login and SSO buttons are usable after the failure.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `docker compose exec -T frontend npx playwright test auth-dashboard.spec.ts -g "failed required MFA setup" --list`; browser execution attempted but blocked because the current e2e image mount lacks `@playwright/test` and the frontend container lacks the Playwright Chromium binary.

## UM-FRONTEND-SSO-DRAFT — Keep SSO settings drafts dirty-aware

- **Completed:** 2026-07-06
- **Source items:** UM-40
- **Files:** `frontend/app/dashboard/settings/users/page.tsx`
- **Result:** SSO settings now track draft dirtiness separately from the query refresh guard, so background SSO settings refetches continue to skip active edits while the UI exposes a `Discard Changes` action that intentionally resyncs the draft from the latest server settings. Saving clears the dirty state without reopening the background overwrite race.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-CALENDAR-A11Y — Preserve keyboard access in calendar day cells

- **Completed:** 2026-07-06
- **Source items:** CAL-16, CAL-23
- **Files:** `frontend/app/dashboard/calendar/page.tsx`
- **Result:** Calendar month cells no longer render an interactive button containing another interactive add control. Day cells are now keyboard-selectable containers, the add affordance is a real labeled button, and event chips can be opened with keyboard activation without bubbling into day selection.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## FE-BROWSER-FINAL — Close remaining browser-readiness list and fallback cleanup

- **Completed:** 2026-07-06
- **Source items:** PLAT-30, PLAT-32, PLAT-33, PLAT-34, PLAT-35, PLAT-36, CAT-23, FIN-45
- **Files:** `frontend/hooks/usePagedList.ts`, `frontend/hooks/catalog/useCatalogRecords.ts`, `frontend/hooks/finance/useInsertionOrders.ts`, `frontend/components/ui/ExportControls.tsx`, `frontend/lib/moduleViewConfigs.ts`
- **Result:** Shared paged-list queries now support an explicit `staleTime`, and catalog plus insertion-order lists use a short freshness window to avoid unnecessary browser refetch churn while preserving manual refresh/invalidation. Catalog and insertion-order fallbacks now identify the failing module/action instead of surfacing generic status text. The background export auto-download guard is documented as one-shot per completed job. Final audit found finance filter fields already module-owned, and catalog remains search/sort-only because the current catalog list API does not support saved-view condition filters.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`

## UM-PROFILE-SAVED-VIEW-BOUNDS — Bound saved-view configs and split module sets

- **Completed:** 2026-07-06
- **Source items:** UM-15, UM-17
- **Files:** `backend/app/modules/user_management/services/profile.py`, `backend/tests/test_saved_views.py`
- **Result:** Saved-view config normalization now has explicit total serialized-size, nesting-depth, list/object-size, string-size, visible-column, and condition-count caps before persistence. Saved-view modules are a separate set from table-preference modules, with regression coverage so future additions cannot accidentally alias the same mutable set. Added the missing total serialized-size regression to the existing saved-view bounds tests.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_saved_views`; `docker compose exec -T backend python -m compileall app tests`

## SALES-MODELS-LOADERS — Normalize sales relationship loading and soft-delete timestamps

- **Completed:** 2026-07-07
- **Source items:** SALES-08, SALES-DEEP-01, SALES-DEEP-13
- **Files:** `backend/app/modules/sales/models.py`, sales soft-delete services, focused sales model/opportunity tests
- **Result:** Sales contacts, leads, quotes, quote-open events, orders, opportunities, and organization customer-group relationships now use `selectin` relationship loading instead of joined eager defaults, so base sales model queries no longer compile with relationship joins. Sales contact, organization, opportunity, lead, and quote soft-delete paths now stamp aware UTC datetimes with `datetime.now(timezone.utc)`.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sales_models tests.test_opportunities_services`; `docker compose exec -T backend python -m unittest tests.test_contacts_services tests.test_organizations_services tests.test_lead_scoring tests.test_quotes_services tests.test_sales_orders`; `docker compose exec -T backend python -m compileall app tests`

## SALES-MODELS-DOMAIN-UTILS — Centralize sales UTC handling and partial-name duplicate checks

- **Completed:** 2026-07-07
- **Source items:** SALES-20, SALES-21
- **Files:** `backend/app/modules/sales/services/time_utils.py`, sales contact/lead/reminder/quote services, focused contact/lead tests
- **Result:** Sales services now share `utc_now()` and `as_utc()` helpers for naive-to-UTC normalization and current UTC timestamps. Lead scoring, reminder scans, quote proposal expiry checks, proposal send timestamps, and sales soft-delete paths use the shared helper. Contact duplicate detection now normalizes whichever name parts exist, so first-only or last-only contacts participate in duplicate detection instead of falling back to email-only matching.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_contacts_services tests.test_lead_scoring tests.test_task_reminders tests.test_quotes_services tests.test_opportunities_services tests.test_sales_models`; `docker compose exec -T backend python -m compileall app tests`

## SALES-MODELS-STAGES — Single-source opportunity stage metadata

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-20
- **Files:** `backend/app/modules/sales/opportunity_stages.py`, opportunity model/schema/service/route paths, `scripts/check-opportunity-stages.py`, focused opportunity tests
- **Result:** Opportunity stage order, labels, closed-stage membership, schema pattern, and model check SQL now come from one backend metadata module. Opportunity services, lead conversion validation, reminder scans, and stage-route close activity classification all consume the shared metadata. A lightweight repo script checks the frontend opportunity stage helper against the backend source so backend/frontend drift is visible during readiness verification.
- **Verification:** `python3 scripts/check-opportunity-stages.py`; `docker compose exec -T backend python -m unittest tests.test_opportunities_services tests.test_leads_conversion tests.test_task_reminders`; `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_sales_opportunity_stage_route_logs_close_activity`; `docker compose exec -T backend python -m compileall app tests`

## SALES-MODELS-CURRENCY-CACHE — Cache opportunity currency metadata per session

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-19
- **Files:** `backend/app/modules/sales/services/opportunities_services.py`, `backend/tests/test_opportunities_services.py`
- **Result:** Opportunity currency validation now caches the tenant operating-currency list on the active SQLAlchemy session, avoiding repeated profile-setting lookups across create/update/import loops while preserving the same 400 response for unsupported currencies. Test doubles without session metadata still fall back to a direct profile lookup.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_opportunities_services tests.test_sales_models`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-MODELS-CUSTOM-FIELDS — Document sales custom-field hydration fallback

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-06
- **Files:** `backend/app/modules/sales/models.py`, `backend/app/modules/platform/services/custom_fields.py`, `backend/tests/test_custom_fields.py`
- **Result:** Sales model custom-field properties are now documented as transient response hydration only; persisted `CustomFieldValue` rows remain the source of truth. Regression tests cover that persisted values override stale in-memory fallback data and that fallback cache values are pruned consistently when no persisted rows exist.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_custom_fields`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-MODELS-ORG-UPDATED-AT — Add organization recency timestamp

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-03
- **Files:** `backend/app/modules/sales/models.py`, `backend/app/modules/sales/schema.py`, `backend/alembic/versions/20260718_sales_org_updated_at.py`, focused sales organization/model tests
- **Result:** Sales organizations now have a persisted non-null `updated_at` timestamp with server defaults and ORM update behavior. The migration backfills existing rows from `created_time` when present, falling back to the current timestamp only when needed. Organization detail and list response schemas expose `updated_at` for recency display.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sales_models tests.test_organizations_services`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-MODELS-CONTACT-ASSIGNEE — Allow user deletion without blocking contacts

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-02
- **Files:** `backend/app/modules/sales/models.py`, `backend/app/modules/sales/schema.py`, `backend/alembic/versions/20260719_contact_assignee.py`, focused sales contact/model tests
- **Result:** Sales contact assignees now use nullable `ON DELETE SET NULL` foreign-key behavior so deleting a user does not fail on historical contact ownership. Contact create/update service validation still requires a valid assignee for normal writes, and response schemas tolerate null assignees after user deletion.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sales_models tests.test_contacts_services`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SALES-MODELS-TIMESTAMPS — Normalize sales timestamp contracts

- **Completed:** 2026-07-07
- **Source items:** SALES-DEEP-04, SALES-DEEP-07
- **Files:** `backend/app/modules/sales/models.py`, `backend/alembic/versions/20260720_sales_timestamp_contracts.py`, `backend/tests/test_sales_models.py`
- **Result:** Sales model timestamp declarations now consistently use timezone-aware `DateTime` columns for primary creation and soft-delete timestamps. Sales organization and opportunity `created_time` values are non-null at the model level, with a guarded migration that backfills existing nulls before enforcing the contract. Model tests now cover primary creation timestamp defaults and nullable soft-delete timestamp semantics across sales records.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sales_models`; `docker compose exec -T backend alembic upgrade head`; `docker compose exec -T backend alembic current`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-PROFILE-SAVED-VIEW-DEFAULT — Avoid redundant saved-view default scans

- **Completed:** 2026-07-07
- **Source items:** UM-16
- **Files:** `backend/app/modules/user_management/services/profile.py`, `backend/tests/test_saved_views.py`
- **Result:** Saved-view listing now uses the already-loaded response rows to find the system default view, so first-load default assignment no longer performs a second full saved-view query when the system view already exists. Existing duplicate-create race recovery remains in the create fallback path.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_saved_views`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-PROFILE-USER-LIST-PROJECTION — Make admin user field projection explicit

- **Completed:** 2026-07-07
- **Source items:** UM-25
- **Files:** `backend/app/modules/user_management/routes/admin.py`, `backend/tests/test_admin_users.py`
- **Result:** Admin user list serialization now respects the parsed `fields` projection instead of re-adding every supported list field for projected responses. Default requests still use the full supported user-list projection, and regression tests cover both default and narrowed field sets.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_users`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-PROFILE-USER-LIST-BOUNDS — Verify admin user query bounds

- **Completed:** 2026-07-07
- **Source items:** UM-14, UM-26
- **Files:** `backend/app/modules/user_management/repositories/admin_users_repository.py`, `backend/tests/test_admin_users.py`, `backend/tests/test_cursor_pagination.py`
- **Result:** Admin user list/search service paths now have query-count regression coverage: offset list/search stay bounded to the result query, count query, and tenant MFA policy query; cursor list/search stay bounded to the result query and tenant MFA policy query. Existing cursor regression coverage documents and verifies that admin user cursor repositories intentionally clear relevance/default ordering and use strict `id DESC` ordering for stable cursor semantics.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_users`; `docker compose exec -T backend python -m unittest tests.test_cursor_pagination.CursorRepositoryOrderingTests.test_admin_user_cursor_repositories_clear_existing_ordering`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## UM-SSO — Gate tenant-domain DNS process fallback

- **Completed:** 2026-07-09
- **Source items:** UM-18
- **Files:** `backend/app/core/config.py`, `backend/app/modules/user_management/services/tenant_domains.py`, `.env.sample`, `backend/tests/test_tenant_domains.py`
- **Result:** Tenant custom-domain TXT verification now normalizes lookup hostnames before DNS resolution and only uses the `dig` process fallback when `TENANT_DOMAIN_DNS_DIG_FALLBACK_ENABLED` allows it. The setting defaults to dev-only behavior through `DEBUG`, and the sample environment documents the production-safe false setting.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_tenant_domains tests.test_config`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## OPS-MAINT — Keep low-risk operational cleanup explicit

- **Completed:** 2026-07-09
- **Source items:** CORE-22, CORE-27, FIN-07, FIN-15
- **Files:** `backend/app/core/celery_app.py`, `backend/app/modules/finance/services/io_search_services.py`, `backend/app/modules/finance/services/io_search_api.py`, `backend/tests/test_config.py`, `backend/tests/test_finance_io_api.py`
- **Result:** True cleanup jobs now use UTC wall-clock Celery beat schedules while due scanners remain interval based. The common-password blocklist was measured at 104 entries, so the existing single-entry `lru_cache` remains appropriate. Finance insertion-order filename sanitization now strips path separators, control characters, empty basenames, and repeated-dot noise. Invoice overdue CRM events now emit only when an insertion order becomes overdue instead of on every later save that remains overdue.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_finance_io_api tests.test_config`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-CORE-TASKS — Freeze duplicate detection output and avoid redundant task response validation

- **Completed:** 2026-07-09
- **Source items:** CORE-24, TASK-10
- **Files:** `backend/app/core/duplicates.py`, `backend/app/modules/tasks/routes/tasks_routes.py`, `backend/tests/test_core_hardening.py`, `backend/tests/test_api_routes.py`
- **Result:** Shared duplicate detection now stores request and existing duplicate values as copied `frozenset`s, so callers cannot mutate serialized duplicate output through returned sets or later changes to input sets. Task routes now return the already validated serialized task dicts and rely on FastAPI `response_model`s for the HTTP boundary instead of manually validating each response twice.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_core_hardening.DuplicateDetectionTests tests.test_api_routes.APIRouteTests.test_task_recycle_route_passes_current_user_to_visibility_filtered_service tests.test_api_routes.APIRouteTests.test_task_restore_route_uses_deleted_only_lookup`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-CATALOG-MEDIA — Make missing catalog media fields explicit

- **Completed:** 2026-07-09
- **Source items:** CAT-04
- **Files:** `backend/app/modules/catalog/services/product_services.py`, `backend/app/modules/catalog/services/service_services.py`, `backend/tests/test_catalog_products.py`, `backend/tests/test_catalog_services.py`
- **Result:** Catalog product and service serializers now treat absent `media_path` as the source of truth for missing media and return `None` for `media_url`, `media_content_type`, and `media_original_filename` together. Regression coverage prevents stale media metadata from appearing when no media file is attached.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_catalog_products tests.test_catalog_services`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-SUPPORT-SHAPES — Guard support list and comment response contracts

- **Completed:** 2026-07-09
- **Source items:** SUP-18, SUP-21, SUP-22
- **Files:** `backend/tests/test_support_cases.py`
- **Result:** Support serialization now has regression coverage for the intended lightweight list/search response shape: list endpoints use `SupportCaseListItem`, include assignee display names, and do not include detail-only comments or events. Comment responses are explicitly guarded as immutable created-at-only shapes while comment editing remains unsupported.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_support_cases`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-SALES-CONTRACTS — Retire sales custom-field and score freshness serialization items

- **Completed:** 2026-07-09
- **Source items:** SALES-DEEP-06, SALES-DEEP-07
- **Files:** `backend/tests/test_lead_scoring.py`
- **Result:** The sales custom-field hydration contract is already documented and covered by the completed `SALES-MODELS-CUSTOM-FIELDS` slice. Lead-score freshness now has an explicit regression that score recalculation updates `score_calculated_at` through the scoring service, keeping `calculated_at` as the score freshness timestamp while `updated_at` remains generic row update metadata.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_lead_scoring`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-CLIENT-PORTAL — Guard client-page action and relationship serialization

- **Completed:** 2026-07-09
- **Source items:** CP-12, CP-15
- **Files:** `backend/tests/test_client_portal.py`
- **Result:** Client-page action summaries already use typed bounded summary data from the completed client portal slice. Client page serialization now has a direct regression matching client account serialization: unloaded contact/organization relationships are not lazy-loaded just to build display labels, preventing accidental serializer query drift.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_client_portal`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## SERIALIZATION-FINANCE-SHAPES — Guard finance nullable and lightweight list responses

- **Completed:** 2026-07-09
- **Source items:** FIN-23, FIN-30
- **Files:** `backend/tests/test_finance_io_api.py`, `backend/tests/test_finance_pos_invoices.py`
- **Result:** Finance insertion-order detail serialization now has regression coverage for explicit `None` handling on optional linked IDs, totals, custom fields, and absent file URLs while preserving status/currency defaults. POS invoice list serialization is guarded as a lightweight list shape that omits line-item details even when invoice ORM records have loaded lines.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_finance_io_api tests.test_finance_pos_invoices`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

---

# Consolidated Task Backlog

## PLAT-QUERY — Reduce platform over-fetching and harden raw-query helpers

- **Completed:** 2026-06-30
- **Source items:** PLAT-11, PLAT-15, PLAT-17, PLAT-18, PLAT-21, PLAT-22, PLAT-23, PLAT-26, PLAT-40, PLAT-41, PLAT-43
- **Files:** `backend/app/modules/platform/services/record_comments.py`, `backend/app/modules/platform/services/global_search.py`, `backend/app/modules/platform/services/recycle_purge.py`, `backend/app/modules/platform/services/message_templates.py`, focused platform tests
- **Result:** Mention suggestions now push module-view eligibility into SQL and escape literal wildcard searches instead of over-fetching candidates and permission sets for Python filtering. Global search resets PostgreSQL statement timeout in a `finally` block. Recycle purge SQL identifiers are validated and quoted through an explicit allowlist helper. Message-template create/update paths pre-check normalized duplicate keys and translate unique-key races to clean `409` responses.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_record_comments tests.test_message_templates tests.test_platform_query_hardening`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## FE-FORMS — Align frontend validation and state with backend contracts

- **Completed:** 2026-07-03
- **Source items:** Completed across the FE-FORMS sections below.
- **Files:** frontend contract/calendar/catalog/finance components and hooks
- **Result:** All consolidated FE-FORMS source items have been implemented, verified, or retired into completed FE-FORMS slices. The final pass closed the finance fallback-rendering duplication and confirmed the extra calendar marker was already covered by the calendar dialog, participant-label, and invalidation slices.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-FINANCE-DUPLICATION — Deduplicate insertion-order list display helpers

- **Completed:** 2026-07-03
- **Source items:** FIN-47
- **Files:** `frontend/components/finance/insertionOrderList.tsx`
- **Result:** Insertion-order table rendering now shares local empty/date/text cell helpers across date, due-date, owner, and reference-style fallback cells, reducing repeated fallback formatting without changing table behavior.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## FE-FORMS-CALENDAR-X2 — Retire duplicate calendar readiness marker

- **Completed:** 2026-07-03
- **Source items:** CAL-X2
- **Files:** `frontend/app/dashboard/calendar/page.tsx`, `frontend/components/calendar/CalendarEventDialog.tsx`, `frontend/components/calendar/CalendarParticipantPicker.tsx`, `frontend/hooks/useCalendar.ts`
- **Result:** Final calendar audit found the extra marker covered by the earlier calendar slices: dialog state resets and date validation, stable participant display labels, and centralized calendar invite invalidation. No separate calendar code path remained.
- **Verification:** `docker compose exec -T frontend npm run lint`; `docker compose exec -T frontend npm run build`; `git diff --check`

## SERIALIZATION-CORE-CONTRACTS-DOCUMENTS — Retire remaining serialization contract gaps

- **Completed:** 2026-07-09
- **Source items:** CORE-26, CON-14, DOC-27
- **Files:** `backend/app/modules/contracts/schema.py`, `backend/app/modules/documents/services/document_services.py`, `backend/tests/test_contracts.py`, `backend/tests/test_documents.py`
- **Result:** Contract create schemas now explicitly document server-allocated contract numbers when clients omit or blank `contract_number`. Document activity snapshots now use the slim document audit reference for version, template, create, attach, delete, and restore events instead of full response serialization. Regression coverage verifies slim document audit state and explicit tenant inheritance for created document versions.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_contracts tests.test_documents`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## ROUTES-SALES-SUPPORT-REPORTS — Normalize organization routes and guard static paths

- **Completed:** 2026-07-09
- **Source items:** CAL-04, CP-03, FIN-36, PLAT-26, PLAT-43, SALES-38, SALES-DEEP-37, SALES-DEEP-39, SALES-DEEP-40, SALES-DEEP-42, SUP-20
- **Files:** `backend/app/modules/sales/routes/organizations_routes.py`, `backend/app/modules/sales/services/organizations_services.py`, `backend/tests/test_api_routes.py`
- **Result:** Sales organizations now support canonical `POST /sales/organizations` and query-param `GET /sales/organizations/search?name=...` routes while keeping legacy `/create` and `/search/{name}` compatibility. Organization edit routes now pass the already-loaded organization into the update service, avoiding the redundant fetch/hydration path. Route regression coverage verifies canonical organization create/search, support saved-view search routing, report module CSV export suffix routing, and static opportunity GET routes staying ahead of dynamic IDs.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_api_routes`; `docker compose exec -T backend python -m unittest tests.test_organizations_services`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION-SALES-IO-MATCHING — Simplify related insertion-order matching

- **Completed:** 2026-07-09
- **Source items:** SALES-DEEP-30
- **Files:** `backend/app/modules/sales/services/summary_services.py`, `backend/tests/test_summary_services.py`
- **Result:** Related insertion-order summary matching now builds contact, organization, and normalized customer-name predicates programmatically and combines them once, replacing the previous branch matrix. Regression coverage verifies contact-only, organization-only, normalized-name-only, and combined matching while preserving tenant and deleted-row filtering.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_summary_services`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION-CATALOG-SHARED-PRIMITIVES — Share catalog slug, currency, boolean, and media helpers

- **Completed:** 2026-07-10
- **Source items:** CAT-12, CAT-20, CAT-22
- **Files:** `backend/app/modules/catalog/services/common.py`, `backend/app/modules/catalog/services/product_services.py`, `backend/app/modules/catalog/services/service_services.py`
- **Result:** Catalog product and service services now share slug normalization, currency normalization, boolean coercion, UTC timestamping, and media-field serialization through one catalog service helper. Product-only stock and decimal behavior remains local, preserving response shapes and validation behavior.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_catalog_products tests.test_catalog_services`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION-FINANCE-DATE-FORMATTING — Share finance date serialization

- **Completed:** 2026-07-10
- **Source items:** FIN-24, FIN-35
- **Files:** `backend/app/modules/finance/services/common.py`, `backend/app/modules/finance/services/io_search_api.py`, `backend/app/modules/finance/services/io_search_services.py`, `backend/app/modules/finance/services/pos_invoice_services.py`, `backend/tests/test_finance_pos_invoices.py`
- **Result:** Insertion-order, overdue-event, and POS invoice serializers now use one finance service helper for `date`, `datetime`, and `None` date-to-ISO conversion, removing duplicate formatting logic while preserving response shapes.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_finance_io_api tests.test_finance_pos_invoices`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION-LIST-FIELD-PROJECTION — Share list field projection parsing

- **Completed:** 2026-07-10
- **Source items:** FIN-06
- **Files:** `backend/app/core/list_fields.py`, `backend/app/modules/finance/routes/io_search_routes.py`, `backend/app/modules/sales/routes/contacts_routes.py`, `backend/app/modules/sales/routes/leads_routes.py`, `backend/app/modules/sales/routes/opportunities_routes.py`, `backend/app/modules/sales/routes/organizations_routes.py`, `backend/app/modules/sales/routes/quotes_routes.py`, `backend/app/modules/user_management/routes/admin.py`, `backend/tests/test_core_hardening.py`
- **Result:** Finance insertion orders, sales projected list routes, and admin user lists now share one core parser for comma-separated `fields` projection requests while keeping each module's allowed-field set and response serializer local.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_core_hardening tests.test_finance_io_api tests.test_admin_users tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION-CONTRACTS-DOCUMENTS — Share remaining contracts/documents list helpers

- **Completed:** 2026-07-10
- **Source items:** CON-17, DOC-16
- **Files:** `backend/app/modules/contracts/routes/contracts_routes.py`, `backend/app/modules/documents/services/document_services.py`, `backend/tests/test_contracts.py`, `backend/tests/test_documents.py`
- **Result:** Contract list and search routes now share one route helper for filter parsing, disabled-field sanitization, service dispatch, and paged response building. Document offset and cursor list services now share one linked-record scope validator before repository access, keeping tenant scoping and permission checks consistent.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_contracts tests.test_documents tests.test_api_routes`; `docker compose exec -T backend python -m compileall app tests`; `git diff --check`

## DUPLICATION — Remove low-risk duplication only where it improves clarity

- **Completed:** 2026-07-10
- **Source items:** CON-17, CAT-12, CAT-20, CAT-22, DOC-16, FIN-06, FIN-24, FIN-35, SALES-DEEP-30
- **Files:** Completed across the `DUPLICATION-*` sections above.
- **Result:** Low-risk duplication work is now split into completed, focused slices for related insertion-order matching, catalog shared primitives, finance date serialization, list field projection parsing, and contracts/documents list helpers. No active source items remain in this bucket.
- **Verification:** See the focused verification commands in the completed `DUPLICATION-*` sections above.

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
