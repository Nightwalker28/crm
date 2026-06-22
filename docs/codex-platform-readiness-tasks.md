# Platform Module Codex Task Plan

_Last updated: 2026-06-22_

This document converts the platform-related review into Codex-ready implementation tasks after checking the current repository. It covers platform services, routes, models, cache behavior, backups/restores, CRM events/automation, notifications, data-transfer jobs, comments/mentions, custom modules, recycle bin, and related frontend utilities.

## Verification summary

Confirmed/high-merit issues in the current codebase:

- Manual tenant backups perform zip/export/upload work synchronously in `create_manual_tenant_backup_run`, moving the run from pending to running to completed inside the request path.
- Tenant restore row application is performed in `_apply_restore_rows` without its own explicit savepoint around destructive replace/upsert work.
- CRM event delivery posts Slack/Teams webhooks synchronously from `emit_crm_event`, and automation enqueue failures are swallowed with `except Exception: pass`.
- `SLACK_ALERT_EVENT_TYPES` contains event names not present in `CRM_EVENT_TYPES`, while `safe_publish_crm_event` rejects non-standard event types.
- Global search uses `SET LOCAL statement_timeout` without an explicit reset/finally wrapper.
- Record mention suggestions fetch users and filter permissions in Python rather than pushing permission predicates into SQL.
- Notification list pagination manually recomputes offset/page size instead of using `Pagination.offset` and `Pagination.limit`.
- Backup retention cleanup loads all expired/old backup run ORM rows and loops through them.
- Data-transfer job sessions are closed in `finally`, so the original claim that they are never closed is overstated; using `with SessionLocal() as db:` is still a worthwhile cleanup.
- Frontend theme toggler assumes `document.startViewTransition` exists.
- Saved-view condition comparison uses order-sensitive `JSON.stringify`.

Partially valid or needs-verification issues:

- Custom-field cache invalidation is only a production problem if cache helpers fall back to process-local memory. Verify Redis/shared cache is used in deployed environments.
- Automation `IntegrityError` handling around `db.flush()` appears present in `execute_rule_for_event` paths; add regression tests instead of assuming a bug.
- Data transfer session closure is present in `finally`; convert to context manager for clarity, not because every path currently leaks.
- SSE singleton concerns need path verification. If hooks were renamed or removed, skip.
- Recycle-bin custom module key checks should be cached per request only if profiling shows duplicate DB work on hot paths.

## Recommended implementation order

1. Critical correctness/observability: PLAT-01, PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-06.
2. High performance/resilience: PLAT-07 to PLAT-15.
3. Medium cleanup and query improvements: PLAT-16 to PLAT-29.
4. Frontend reliability/accessibility: PLAT-30 to PLAT-36.
5. Low-risk documentation/guardrails: PLAT-37 to PLAT-43.

---

## PLAT-01 — Verify platform cache backend is shared across workers

- **Severity:** Critical if cache falls back to process-local memory
- **Assessment:** Needs deployment/config verification.
- **Files:** `backend/app/modules/platform/services/custom_fields.py`, shared cache helpers, cache config/tests.
- **Issue:** Custom-field definitions use cached reads/writes. If cache helpers use an in-process fallback in production, invalidation from one worker will not propagate to other workers.
- **Fix:** Ensure all production `cache_get_json`, `cache_set_json`, and `cache_delete` calls use Redis/shared cache. Fail closed or log clearly if Redis is unavailable in production. Add an integration-style test or fake two-cache-client test proving invalidation is visible across workers.
- **Done when:** Custom-field definition updates are reflected across worker processes.

## PLAT-02 — Wrap tenant module restore row application in an explicit savepoint

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/platform/services/tenant_restore_runs.py`, restore tests.
- **Issue:** `_apply_restore_rows` soft-deletes stale rows and upserts incoming rows in one loop. The outer restore function rolls back on exceptions, but `_apply_restore_rows` has no explicit savepoint protecting the entire destructive operation.
- **Fix:** Wrap `_apply_restore_rows` body in `with db.begin_nested():` or make the caller use an explicit transaction/savepoint around preview+apply+summary update. Keep the restore-run status update outside the destructive savepoint so failure state can be recorded after rollback.
- **Done when:** Any exception during module restore leaves module data unchanged and records the restore run as failed.

## PLAT-03 — Log and persist CRM event automation enqueue failures

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/platform/services/crm_events.py`, automation task tests.
- **Issue:** `emit_crm_event` calls `enqueue_crm_event_automation(event.id)` and silently ignores all exceptions.
- **Fix:** Add `logger.exception(...)` at minimum. Prefer adding a pending/failed automation dispatch table or flag on event metadata so a scheduled retry can dispatch events missed while the broker is down.
- **Done when:** Broker/enqueue failures are observable and recoverable.

## PLAT-04 — Move CRM channel webhook delivery out of request path

- **Severity:** High/Critical under slow webhooks
- **Assessment:** Valid.
- **Files:** `crm_events.py`, Celery task module, delivery tests.
- **Issue:** `emit_crm_event` synchronously sends Slack/Teams webhooks with `requests.post(..., timeout=5)` before committing the event.
- **Fix:** Persist `CrmEventDelivery` rows as pending and enqueue a Celery delivery task. The task should send Slack/Teams messages, update status, and retry transient failures. If synchronous delivery remains temporarily, reduce timeout to 1-2s and log failures.
- **Done when:** Slow Slack/Teams APIs cannot block CRM route handlers.

## PLAT-05 — Align Slack alert event types with persisted CRM event types

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `crm_events.py`, startup/import tests.
- **Issue:** `SLACK_ALERT_EVENT_TYPES` includes `deal.assigned`, `invoice.overdue`, `task.due_today`, and `task.assigned`, but these are not in `CRM_EVENT_TYPES`. `safe_publish_crm_event` rejects event types outside `CRM_EVENT_TYPES`, so some alert paths may never persist.
- **Fix:** Decide canonical event types. Either add those alert event types to `CRM_EVENT_TYPES` or remove/rename Slack alert types. Add `assert SLACK_ALERT_EVENT_TYPES.issubset(CRM_EVENT_TYPES)` at import/startup once aligned.
- **Done when:** Any event eligible for Slack delivery is also a valid persisted CRM event.

## PLAT-06 — Move manual tenant backups to background jobs

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `tenant_backup_runs.py`, backup routes, Celery tasks, frontend polling if needed.
- **Issue:** `create_manual_tenant_backup_run` performs the entire backup synchronously: create run, write zip, optionally include documents, optionally upload to destination, update retention.
- **Fix:** Route should create a queued run and return `run_id` immediately. Celery task performs export/upload/retention cleanup and updates status/progress. Keep a synchronous path only for tests or explicitly small/admin-only safety backups if unavoidable.
- **Done when:** Large tenant backups cannot timeout HTTP requests.

## PLAT-07 — Make backup artifact upload streaming-safe

- **Severity:** High
- **Assessment:** Valid extension of PLAT-06.
- **Files:** `tenant_backup_runs.py`, document storage artifact upload helper.
- **Issue:** `_upload_destination_artifact` reads the entire zip with `artifact_path.read_bytes()` before upload.
- **Fix:** Add a streaming/file-like storage upload path for backup artifacts, or enforce a size cap and use background task memory limits.
- **Done when:** Backup artifact upload memory does not scale with full zip size.

## PLAT-08 — Harden tenant restore datetime parsing

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `tenant_restore_runs.py`, tests.
- **Issue:** `_coerce_column_value` parses datetimes with `datetime.fromisoformat(value.replace("Z", "+00:00"))`.
- **Fix:** On Python 3.11+, use `datetime.fromisoformat` directly where safe and normalize `Z`; otherwise use `dateutil.parser.isoparse`. Convert aware datetimes to UTC consistently.
- **Done when:** Restore handles ISO timestamps with `Z`, microseconds, and offsets reliably.

## PLAT-09 — Verify automation rule run IntegrityError path

- **Severity:** High if broken
- **Assessment:** Partially valid; current code has `IntegrityError` handling around skipped runs and visible run creation paths, but this deserves regression coverage.
- **Files:** `automation_rules.py`, automation tests.
- **Issue:** Race on `uq_automation_rule_runs_rule_event` could surface as an unhandled `IntegrityError` if a caller catches too broadly or if flush handling misses a path.
- **Fix:** Add tests that concurrently process the same event/rule and assert one run is recorded and the loser returns/loads the existing run. Ensure callers do not swallow the `IntegrityError` before service handling.
- **Done when:** Duplicate event/rule executions are idempotent and cleanly handled.

## PLAT-10 — Optimize CRM dashboard summary aggregation

- **Severity:** High
- **Assessment:** Valid if current dashboard path remains query-heavy.
- **Files:** `backend/app/modules/platform/services/module_reports.py`, dashboard tests.
- **Issue:** `generate_crm_dashboard_summary` reportedly runs many sequential aggregate queries.
- **Fix:** Combine related aggregates, add filtered aggregate queries, or materialize an hourly/daily summary table. Keep exact live dashboard optional behind a flag if needed.
- **Done when:** Dashboard summary uses fewer DB round trips and is bounded on large datasets.

## PLAT-11 — Push mentionable-user permission filtering into SQL

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `record_comments.py`, mention tests.
- **Issue:** `list_mentionable_record_users` fetches up to `limit * 5` users and then filters permissions in Python using role/team/department permission sets.
- **Fix:** Join/subquery `RoleModulePermission`, `TeamModulePermission`, and `DepartmentModulePermission` so the DB returns only mentionable users. Keep admin role-level bypass in SQL if practical.
- **Done when:** Mention suggestions do not over-fetch users just to discard them in Python.

## PLAT-12 — Convert data-transfer worker sessions to context managers

- **Severity:** Medium/High cleanup
- **Assessment:** Original leak claim is overstated; current `finally` closes the session. Context manager improves safety/readability.
- **Files:** `data_transfer_jobs.py`, task tests.
- **Issue:** `process_import_job` and `process_export_job` manually create `SessionLocal()` and close in `finally`.
- **Fix:** Use `with SessionLocal() as db:` and keep temp-file cleanup in a nested/finally block. Preserve behavior for all early errors.
- **Done when:** Session lifecycle is obviously correct and covered by tests.

## PLAT-13 — Add pagination metadata or cursor pagination for automation runs

- **Severity:** High frontend usability
- **Assessment:** Valid product/API issue.
- **Files:** `routes/automation_rules.py`, `services/automation_rules.py`, schema/frontend.
- **Issue:** `list_automation_rule_runs` applies offset/limit but returns a list response without total count/page metadata.
- **Fix:** Add `total_count`/pagination fields or introduce cursor response. Update frontend to use next/previous metadata.
- **Done when:** Automation-run history can be paged reliably.

## PLAT-14 — Optimize backup retention cleanup

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `tenant_backup_runs.py`, tests.
- **Issue:** `_cleanup_retention` loads all old completed backup runs into memory and iterates ORM objects.
- **Fix:** Select only old run IDs/file paths via subquery/window function, delete files, then bulk-update matching rows to clear file metadata. Keep filesystem deletion per file but avoid loading full ORM rows.
- **Done when:** Retention cleanup scales with minimal selected columns, not full ORM rows.

## PLAT-15 — Reduce custom module access seeding queries

- **Severity:** Medium
- **Assessment:** Valid if current `_seed_access` still fetches all departments/teams/roles.
- **Files:** `services/custom_modules.py`, tests.
- **Issue:** New custom module creation reportedly queries departments, teams, roles, then loops in Python to seed access rows.
- **Fix:** Use bulk insert with `ON CONFLICT DO NOTHING`, or SQL `INSERT ... SELECT ... WHERE NOT EXISTS` for each permission table.
- **Done when:** Creating a custom module does not require fetching all access principals into Python.

## PLAT-16 — Make automation template substitution single-pass

- **Severity:** Medium
- **Assessment:** Valid low-risk performance improvement.
- **Files:** `automation_rules.py`, tests.
- **Issue:** `_template` repeatedly calls `str.replace` for each key/payload item.
- **Fix:** Use a compiled regex for `{{...}}` placeholders and resolve each placeholder in one pass. Keep missing values as empty strings.
- **Done when:** Template output is unchanged with better asymptotic behavior.

## PLAT-17 — Reset global search statement timeout in a finally block

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `global_search.py`, tests.
- **Issue:** `SET LOCAL statement_timeout` is executed for PostgreSQL searches without an explicit reset wrapper.
- **Fix:** Wrap search execution in `try/finally`; execute `SET LOCAL statement_timeout = 0` or rely on a clearly scoped transaction with tests. Prefer explicit reset for safety.
- **Done when:** Statement timeout cannot affect later queries on reused connections.

## PLAT-18 — Audit RecordComment author-name lazy loading

- **Severity:** Medium
- **Assessment:** Mostly valid; current list paths use `joinedload(RecordComment.actor)`.
- **Files:** `models.py`, `record_comments.py`, tests.
- **Issue:** `RecordComment.author_name` property reads `self.actor`; missing eager loading can create N+1 queries.
- **Fix:** Keep/verify joinedload on all list/detail paths that serialize comments. Add a regression test or code comment near the property.
- **Done when:** Comment list serialization does not emit one actor query per comment.

## PLAT-19 — Use Pagination.offset/limit consistently for notifications and jobs

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `notifications.py`, `data_transfer_jobs.py`, `activity_logs.py` if similar.
- **Issue:** `list_notifications` and `list_data_transfer_jobs` manually compute `(page - 1) * page_size` and use `page_size` instead of `pagination.offset`/`pagination.limit`.
- **Fix:** Replace manual calculations with `pagination.offset` and `pagination.limit`.
- **Done when:** Pagination behavior stays consistent if `Pagination` internals change.

## PLAT-20 — Avoid duplicate custom module import preview parsing

- **Severity:** Medium
- **Assessment:** Needs file verification but likely valid.
- **Files:** `routes/custom_modules.py`, import tests.
- **Issue:** `import_custom_module_records` reportedly calls `preview_import` twice, doubling parsing work.
- **Fix:** Store the first preview result and reuse its target headers/metadata after remapping.
- **Done when:** Custom module import preview/execute parses the uploaded file once per required phase.

## PLAT-21 — Whitelist raw SQL purge identifiers

- **Severity:** Medium
- **Assessment:** Valid hardening.
- **Files:** `services/recycle_purge.py`, tests/static-analysis notes.
- **Issue:** Raw `text()` SQL interpolates hardcoded table/column names. Currently safe if tuple is hardcoded, but easy to misuse later.
- **Fix:** Add strict identifier whitelist/assertions or use SQLAlchemy Table metadata rather than f-string identifiers.
- **Done when:** Static analysis no longer flags dynamic identifier interpolation, or whitelist assertions protect it.

## PLAT-22 — Cache recycle-bin custom-module checks per request

- **Severity:** Low/Medium
- **Assessment:** Valid optimization if route paths call it repeatedly.
- **Files:** `routes/recycle_bin.py`, tests.
- **Issue:** `is_custom_module_key` is reportedly called in multiple route paths and each call may query DB.
- **Fix:** Resolve once per request and pass the result through helper functions, or add request-scoped cache on `request.state`.
- **Done when:** Recycle-bin item restore/list paths do not repeat identical module-key lookups.

## PLAT-23 — Catch readable duplicate-key errors for message templates

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `services/message_templates.py`, tests.
- **Issue:** `_normalize_key` can map different names to the same `template_key`; DB constraint catches duplicates but service may surface raw `IntegrityError`.
- **Fix:** Pre-check normalized key per tenant and catch `IntegrityError`, rollback, return clean 409/400.
- **Done when:** Duplicate template keys produce user-readable errors.

## PLAT-24 — Replace automation actor SimpleNamespace with typed context

- **Severity:** Low/Medium
- **Assessment:** Valid maintainability.
- **Files:** `automation_rules.py`, type tests if any.
- **Issue:** `automation_actor` returns a duck-typed `SimpleNamespace` stand-in for a user.
- **Fix:** Define a dataclass/named tuple with required actor fields, or make downstream services accept an explicit actor context protocol.
- **Done when:** Automation actor shape is explicit and type-checkable.

## PLAT-25 — Document CrmEvent payload column alias

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** `models.py`, developer docs.
- **Issue:** `CrmEvent.payload` maps to DB column `payload_json`. This is fine, but raw SQL/reporting can be confused.
- **Fix:** Add a model comment/docstring and reporting docs note.
- **Done when:** Future raw SQL knows to query `payload_json`, not `payload`.

## PLAT-26 — Add route-conflict test for module field `field_key:path`

- **Severity:** Low/Medium
- **Assessment:** Valid route guard.
- **Files:** `routes/module_fields.py`, route tests.
- **Issue:** `field_key:path` intentionally captures slashes, but can swallow extra path segments.
- **Fix:** Add tests proving intended field keys work and unintended extra segments return 404/validation error.
- **Done when:** Path converter behavior is documented by tests.

## PLAT-27 — Accept dynamic filter fields instead of hardcoded UI filter search fields

- **Severity:** Low/Medium
- **Assessment:** Valid if component is shared.
- **Files:** `frontend/components/ui/filter-button.tsx`, consumers.
- **Issue:** `SEARCH_FIELDS` is hardcoded and may be finance/campaign-specific.
- **Fix:** Accept field definitions as props and keep a module-specific default only at call sites.
- **Done when:** Shared filter UI displays module-correct fields.

## PLAT-28 — Add comment for export double-download guard

- **Severity:** Low
- **Assessment:** Current behavior appears defensible.
- **Files:** `frontend/components/ui/ExportControls.tsx`.
- **Issue:** `downloadedExportJobRef` protects against duplicate downloads; the dependency array can look suspicious.
- **Fix:** Add a short comment explaining the ref guard and status-cycle behavior. Only change logic if tests show double-downloads.
- **Done when:** Future maintainers understand why the guard exists.

## PLAT-29 — Preserve keyboard accessibility inside clickable module rows

- **Severity:** Low/Medium accessibility
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/settings/modules/page.tsx`.
- **Issue:** `stopRowNavigation` is called for `onKeyDown` on controls inside clickable rows, which can block Enter/Space activation for nested controls.
- **Fix:** Stop propagation on click/pointer events only where needed. Let keyboard events reach inner controls unless row-level keyboard handling specifically conflicts.
- **Done when:** Nested controls remain keyboard-operable.

## PLAT-30 — Add View Transitions API fallback to theme toggler

- **Severity:** Medium frontend compatibility
- **Assessment:** Valid.
- **Files:** `frontend/components/ui/AnimatedThemeToggler.tsx`.
- **Issue:** Component calls `document.startViewTransition(...).ready` without checking whether the API exists.
- **Fix:** If `document.startViewTransition` is unavailable, toggle theme synchronously and return. Add TypeScript typing/fallback for browsers without the API.
- **Done when:** Theme toggle works in Firefox and unsupported browsers without throwing.

## PLAT-31 — Make saved-view condition comparison order-insensitive where appropriate

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useSavedViews.ts`.
- **Issue:** `sameConditions` compares `JSON.stringify(left) === JSON.stringify(right)`, so logically equivalent conditions in different order are treated as different.
- **Fix:** Normalize conditions before comparison by sorting on stable keys (`field`, `operator`, serialized value/id). If condition order is intentionally meaningful, document and keep order-sensitive behavior only for ordered groups.
- **Done when:** Saved views do not rerender/reset due only to non-semantic condition ordering.

## PLAT-32 — Remove unsafe `set-state-in-effect` suppressions in users settings page

- **Severity:** Medium
- **Assessment:** Needs file verification but likely valid.
- **Files:** `frontend/app/dashboard/settings/users/page.tsx`.
- **Issue:** ESLint suppressions around setting SSO draft state in effects can hide dependency-loop bugs.
- **Fix:** Compare field-by-field before setting state, or derive draft state from query data through controlled initialization. Remove suppressions where possible.
- **Done when:** No effect can loop solely because `ssoSettings` reference changes.

## PLAT-33 — Share realtime SSE connections per session

- **Severity:** Medium
- **Assessment:** Needs path verification.
- **Files:** realtime notification/job-status hooks if present.
- **Issue:** Multiple hook instances can open multiple `EventSource` connections to the same endpoint.
- **Fix:** Use a React context or singleton connection manager with subscribe/unsubscribe semantics.
- **Done when:** One SSE connection per endpoint/session is used even with multiple mounted consumers.

## PLAT-34 — Improve export control status-cycle test coverage

- **Severity:** Low
- **Assessment:** Valid defensive test.
- **Files:** `frontend/components/ui/ExportControls.tsx`, tests if available.
- **Issue:** The double-download ref should survive rapid status transitions.
- **Fix:** Add a test or comment proving one completed export job triggers one download.
- **Done when:** Ref guard behavior is covered/documented.

## PLAT-35 — Make filter-button field list module-owned

- **Severity:** Low/Medium
- **Assessment:** Valid if `filter-button.tsx` is shared across modules.
- **Files:** `frontend/components/ui/filter-button.tsx`, consumers.
- **Issue:** Hardcoded search fields can be wrong for non-finance/non-campaign modules.
- **Fix:** Pass field options from each module/page. Keep no broad global fallback except a minimal empty/default state.
- **Done when:** Each module controls its filter field list.

## PLAT-36 — Add fallback-safe theme transition typing

- **Severity:** Low
- **Assessment:** Pairs with PLAT-30.
- **Files:** `AnimatedThemeToggler.tsx`, global type declarations if needed.
- **Issue:** TypeScript DOM typings may not include `startViewTransition` in all TS/lib versions.
- **Fix:** Add a local type guard/interface for `document.startViewTransition` rather than using `any` broadly.
- **Done when:** TypeScript build passes with and without View Transitions API DOM typings.

## PLAT-37 — Add cache invalidation smoke test for custom-field definitions

- **Severity:** Low/Medium
- **Assessment:** Pairs with PLAT-01.
- **Files:** custom fields tests.
- **Issue:** The correctness of definition cache invalidation is important enough to test directly.
- **Fix:** Seed definitions, cache list, update/delete a definition, then assert subsequent list reflects the change.
- **Done when:** Cache invalidation is tested independent of deployment config.

## PLAT-38 — Clarify notification/activity pagination duplication

- **Severity:** Low
- **Assessment:** Valid cleanup.
- **Files:** `activity_logs.py`, `notifications.py`, `data_transfer_jobs.py`.
- **Issue:** Several services manually compute offsets.
- **Fix:** Replace with `pagination.offset`/`pagination.limit` and add a simple test for page 2/page size behavior.
- **Done when:** Pagination code is consistent across platform services.

## PLAT-39 — Add startup assertion for event-type set consistency

- **Severity:** Low but protects PLAT-05
- **Assessment:** Valid.
- **Files:** `crm_events.py`.
- **Issue:** Alert event types can drift from standard event types.
- **Fix:** After aligning sets, add `assert SLACK_ALERT_EVENT_TYPES.issubset(CRM_EVENT_TYPES)` or a startup validation that raises a clear config/developer error.
- **Done when:** Drift fails fast in tests/startup.

## PLAT-40 — Make recycle purge SQL static-analysis friendly

- **Severity:** Low/Medium
- **Assessment:** Valid hardening.
- **Files:** `recycle_purge.py`.
- **Issue:** Hardcoded identifiers interpolated into raw SQL are probably safe today but create a future footgun.
- **Fix:** Use SQLAlchemy table metadata or assert identifiers against a whitelist regex and explicit allowlist before interpolation.
- **Done when:** Static analysis accepts the purge SQL pattern or the whitelist is explicit.

## PLAT-41 — Add readable duplicate handling to message template creation

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `message_templates.py`, tests.
- **Issue:** Normalized keys can collide and rely on DB integrity errors.
- **Fix:** Pre-check normalized key per tenant and catch `IntegrityError` as 409/400.
- **Done when:** Creating duplicate-normalized templates returns a clean message.

## PLAT-42 — Document data-transfer session lifecycle

- **Severity:** Low
- **Assessment:** Current code closes sessions; doc/comment only if not converted to context managers immediately.
- **Files:** `data_transfer_jobs.py`.
- **Issue:** Manual session lifecycle is easy to misread.
- **Fix:** Add a short comment or convert to context managers via PLAT-12.
- **Done when:** Session cleanup path is obvious.

## PLAT-43 — Add tests for module-field path converter behavior

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** `routes/module_fields.py`, route tests.
- **Issue:** `field_key:path` route converter can capture slashes.
- **Fix:** Tests for intended custom field keys and unintended extra path segments.
- **Done when:** Route matching behavior is fixed by tests.

---

## Migration checklist

- PLAT-03: optional dispatch table or event metadata for pending automation dispatch retry.
- PLAT-06: optional new backup job progress fields if existing `TenantBackupRun` status/progress fields are insufficient.
- PLAT-10: optional materialized dashboard summary table or cache table.
- PLAT-14: no schema migration unless retention state needs new metadata.

## Test checklist

Backend:

- Custom-field cache invalidation visible after update/delete.
- Tenant restore destructive mode rolls back all row changes on one failure.
- CRM event automation enqueue failure is logged and/or persisted for retry.
- CRM event Slack/Teams delivery is queued and does not block route writes.
- Slack alert event types are all valid CRM event types.
- Manual tenant backup route returns queued run quickly; Celery task completes it.
- Backup retention cleanup clears only runs beyond retention and deletes artifact files safely.
- Restore datetime parser handles `Z`, microseconds, and timezone offsets.
- Mentionable user search returns only users with view access without Python over-fetching.
- Global search resets statement timeout after execution/failure.
- Notifications/data-transfer pagination uses `Pagination.offset` and `Pagination.limit`.
- Automation rule duplicate run race is idempotent.
- Message template duplicate normalized key returns clean 4xx.
- Module field path converter does not swallow unintended extra routes.

Frontend/manual:

- Theme toggle works in browsers without View Transitions API.
- Saved views do not reset when conditions are logically equivalent but ordered differently, unless order is intentionally meaningful.
- Users settings SSO draft effect does not loop when settings object reference changes.
- Realtime notification/job hooks do not open duplicate SSE connections.
- Nested controls in settings module rows remain keyboard accessible.
- Shared filter button shows module-specific fields.
- Export controls download each completed job once.

## Explicit audit corrections

- Do not treat `process_import_job` / `process_export_job` as confirmed session leaks; the current implementation closes sessions in `finally`. Prefer context-manager refactor for clarity.
- Do not assume automation-rule `IntegrityError` is unhandled; add a regression test around concurrent rule/event processing and fix only missing paths.
- Do not require per-request cache for recycle-bin custom module checks unless profiling or code inspection confirms repeated hot-path DB lookups.
- Do not change saved-view condition comparison to order-insensitive if condition order is a deliberate UI behavior; decide and test the intended semantics.
