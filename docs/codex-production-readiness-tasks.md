# Codex Task Plan: CRM Production Readiness Fixes

_Last updated: 2026-06-18_

This document converts the senior review notes for Contracts, Calendar, Catalog, Core Backend, and the available Client Portal context into implementation-ready tasks for Codex.

## Codex operating rules

1. Verify current code before editing. If a finding is already fixed, skip code changes and note it in the PR summary.
2. Prefer small, safe patches over broad rewrites.
3. Do not weaken tenant isolation, auth checks, audit logging, or validation while fixing performance issues.
4. Add or update tests for every backend behavior change.
5. Add Alembic migrations for new tables, indexes, constraints, defaults, or column type changes.
6. Keep public API response shapes backward compatible unless a task explicitly says to change the contract.
7. Use database-backed locking/constraints for concurrency. Do not use in-process locks for production correctness.
8. For frontend fixes, patch the local hook/component behavior. Avoid large UI rewrites unless the component is already broken.

## Recommended PR order

1. Core security/startup/cache safety: CORE-01 to CORE-08, CORE-14, CORE-15.
2. Contracts correctness/concurrency: CON-01 to CON-08, CON-13, CON-18, CON-19.
3. Calendar booking/sync correctness: CAL-01 to CAL-08, CAL-12, CAL-15, CAL-X1 to CAL-X4.
4. Catalog write-path/media integrity: CAT-01 to CAT-08, CAT-17.
5. Frontend state/query/render fixes: CON-09, CON-10, CON-15, CON-16, CON-20, CAL-10, CAL-16, CAL-19 to CAL-23, CAT-08 to CAT-11, CAT-17 to CAT-24.
6. Performance/indexing/cleanup: remaining count-query, search, SSE, export, and housekeeping tasks.

## Shared acceptance criteria

- Backend tests pass.
- Frontend lint/type-check passes.
- Migrations apply cleanly on empty and existing databases.
- User-fixable validation/constraint failures return 4xx, not unhandled 500s.
- Concurrency fixes include a regression test, integration test, or clear manual verification note.

---

# Core backend tasks

## CORE-01 — Require non-empty JWT secret at startup

- **Severity:** Critical
- **Files:** `backend/app/core/config.py`, `.env.sample`, config tests
- **Issue:** `JWT_SECRET` can default to an empty string in some debug/local paths.
- **Fix:** Make `validate_startup_settings()` fail unconditionally when `settings.JWT_SECRET` is blank. Document a local generated secret in `.env.sample` instead of accepting an empty value.
- **Tests:** Empty `JWT_SECRET` fails startup validation.
- **Done when:** API and worker cannot start with an empty JWT signing secret.

## CORE-02 — Require non-empty app encryption secret

- **Severity:** Medium
- **Files:** `backend/app/core/config.py`, `.env.sample`, tests
- **Issue:** `APP_ENCRYPTION_SECRET` can be blank and fail only at first encryption/decryption use.
- **Fix:** Fail startup validation when blank. Document that it must be separate from JWT/mail secrets.
- **Done when:** No runtime path silently uses an empty app encryption key.

## CORE-03 — Remove JWT fallback for mail credential encryption

- **Severity:** Critical
- **Files:** `backend/app/core/secrets.py`, `backend/app/core/config.py`, `.env.sample`, tests
- **Issue:** `_credential_secrets()` falls back to `JWT_SECRET`, coupling JWT rotation to encrypted mail credential decryption.
- **Fix:** Require `MAIL_CREDENTIAL_SECRET` in production. Remove JWT fallback. If backward compatibility is needed, add a dedicated legacy mail secret list, not JWT fallback.
- **Tests:** Mail credential encryption/decryption uses mail secret and survives JWT secret rotation.
- **Done when:** JWT signing and mail credential encryption secrets are independent.

## CORE-04 — Harden access-token error handling

- **Severity:** Critical
- **Files:** `backend/app/core/security.py`, auth tests
- **Issue:** `get_current_user()` catches broad `HTTPException` during access-token decode/tenant validation and silently falls through to refresh-token auth.
- **Fix:** Only fall through to refresh logic for expected access-token expiry. Hard-fail malformed, tampered, or tenant-mismatched access tokens. Log security-relevant failures without token values.
- **Tests:** Expired access token with valid refresh still works if intended; tenant mismatch and malformed tokens do not refresh.
- **Done when:** Token tampering and tenant mismatch cannot be hidden by refresh fallback.

## CORE-05 — Fix refresh-token revocation transaction and race behavior

- **Severity:** Medium
- **Files:** `backend/app/core/security.py`, refresh-token model if needed, auth tests
- **Issue:** `_revoke_refresh_token()` commits mid-request and deleting rows can hide concurrent refresh reuse.
- **Fix:** Replace helper-level `commit()` with `flush()` or move commit to outer flow. Prefer atomic `UPDATE ... WHERE is_revoked = false` and issue a new token only when exactly one row was updated. Cleanup old rows in background.
- **Tests:** Two simultaneous refresh attempts with the same token allow exactly one success.
- **Done when:** Refresh-token reuse cannot create two valid sessions.

## CORE-06 — Replace wildcard cloud CORS regex

- **Severity:** Critical
- **Files:** `backend/app/main.py`, `backend/app/core/config.py`, `.env.sample`, tests
- **Issue:** `allow_origin_regex=r"https?://.*"` in cloud mode allows arbitrary origins.
- **Fix:** Add a configured HTTPS-only allowed-origin regex or enumerate allowed domains. Keep localhost only for local development.
- **Tests:** Evil HTTP/HTTPS origins are rejected; configured origins pass.
- **Done when:** Credentialed CORS is limited to intended origins.

## CORE-07 — Replace module-level tenant cache with distributed cache

- **Severity:** Critical
- **Files:** `backend/app/core/tenancy.py`, tenant deactivation/domain services, `backend/app/core/cache.py`, tests
- **Issue:** `_tenant_context_cache` is a process-local dict, unsafe under multi-worker deployments and not invalidated on tenant deactivation.
- **Fix:** Store tenant-host context in shared cache keys such as `tenant:host:{hostname}` with TTL. Invalidate on tenant deactivation/domain updates. Keep local fallback only for dev/test with TTL/size cap.
- **Tests:** Tenant deactivation/domain change invalidates cached host context.
- **Done when:** Tenant resolution is not stale per worker.

## CORE-08 — Replace Redis KEYS in prefix deletion

- **Severity:** High
- **Files:** `backend/app/core/cache.py`, cache tests
- **Issue:** `cache_delete_prefix()` uses Redis `KEYS`, which can block Redis.
- **Fix:** Use incremental `SCAN` batches and delete batches. Preserve in-memory fallback behavior.
- **Tests:** Mock multiple scan batches and verify all matching keys are deleted.
- **Done when:** No production prefix delete path uses Redis `KEYS`.

## CORE-09 — Reduce authenticated user reload overhead

- **Severity:** High
- **Files:** `backend/app/core/security.py`, permission dependency tests
- **Issue:** `_load_user_with_team` may eager-load user/team/department/role repeatedly in one request.
- **Fix:** First verify whether FastAPI dependency caching already avoids duplicate loads. If duplicates exist, cache loaded user on `request.state.user` for the request only.
- **Done when:** Nested dependencies do not repeatedly load the same user.

## CORE-10 — Reduce role-level fallback warning noise

- **Severity:** High operational / low code risk
- **Files:** `backend/app/core/access_control.py`
- **Issue:** `get_user_role_level()` logs warning on every fallback when `_token_role_level` is missing.
- **Fix:** If fallback is expected, downgrade to debug or one-time metric. If migration is complete, remove fallback and require claim.
- **Done when:** Normal traffic does not emit repetitive warnings.

## CORE-11 — Add filter value length caps

- **Severity:** High
- **Files:** `backend/app/core/module_filters.py`, validation tests
- **Issue:** Very long text filter values can produce huge `%value%` SQL patterns.
- **Fix:** Cap text filter values, e.g. 200 chars, and return 400 for oversized values.
- **Done when:** Oversized filter params fail before query construction.

## CORE-12 — Correct text search/index strategy

- **Severity:** Medium
- **Files:** `backend/app/core/module_filters.py`, hot-module migrations
- **Issue:** Leading wildcard LIKE cannot use B-tree indexes. The original review overstated that trigram cannot help; PostgreSQL `pg_trgm` can index LIKE/ILIKE patterns.
- **Fix:** Do not blindly rewrite all filters to similarity. Add targeted trigram indexes for hot text filters and preserve semantics.
- **Done when:** Hot contains filters have an index strategy without changing user-visible results.

## CORE-13 — Rework SSE database polling connection pattern

- **Severity:** High
- **Files:** `backend/app/modules/platform/routes/realtime.py`, realtime tests
- **Issue:** SSE loop can open a new DB session every poll tick per client.
- **Fix:** Prefer Redis pub/sub long-term. Short-term, keep one safely recycled session per stream or centralize fanout. Ensure disconnect closes resources.
- **Done when:** SSE clients do not churn DB connections every few seconds indefinitely.

## CORE-14 — Validate config at Celery worker startup

- **Severity:** Medium
- **Files:** `backend/app/core/celery_app.py`, worker config tests
- **Issue:** FastAPI startup validates settings, but Celery workers may not.
- **Fix:** Call `validate_startup_settings()` from Celery startup/worker init.
- **Done when:** Workers fail fast on missing required settings.

## CORE-15 — Add task failure observability

- **Severity:** Medium
- **Files:** `backend/app/core/celery_app.py`, env docs
- **Issue:** `result_backend=None` makes failures hard to inspect after logs rotate.
- **Fix:** Configure Redis result backend where useful, set `task_ignore_result=True` only on tasks that do not need inspection, and set result expiry.
- **Done when:** Important side-effect task failures are inspectable.

## CORE-16 — Keep upload directory cleanup safe and documented

- **Severity:** Medium/Low
- **Files:** `backend/app/core/uploads.py`, tests
- **Issue:** Parent-dir `rmdir()` cleanup can race with sibling deletes, though existing `OSError` handling may already be safe.
- **Fix:** Keep best-effort `OSError` guard, add tests for already-deleted/missing parent dirs, and document non-fatal cleanup.
- **Done when:** Concurrent/missing path cleanup remains non-fatal.

## CORE-17 — Make export temp-file cleanup robust

- **Severity:** Medium
- **Files:** `backend/app/core/module_export.py`, export callers, tests
- **Issue:** Temp CSV/ZIP files can leak if caller raises before unlink.
- **Fix:** Return a context manager or audit all callers to use `try/finally` with `unlink(missing_ok=True)`.
- **Done when:** Export temp files are cleaned on success and failure.

## CORE-18 — Stream ZIP export generation

- **Severity:** Medium
- **Files:** `backend/app/core/module_export.py`, tests
- **Issue:** ZIP export may build full uncompressed CSV data in memory.
- **Fix:** Write one CSV module at a time into `zipfile.ZipFile`, use `allowZip64=True`, and avoid storing all CSVs in memory simultaneously.
- **Done when:** Export memory scales with current chunk/module, not total export.

## CORE-19 — Reduce realtime poll query count

- **Severity:** Medium
- **Files:** `backend/app/modules/platform/routes/realtime.py`, realtime service/repository
- **Issue:** `collect_realtime_events` runs separate queries for notification/job classes every poll tick.
- **Fix:** Combine where practical with `UNION ALL` or a single event/audit stream while preserving payload order/shape.
- **Done when:** Poll query count is reduced or explicitly documented if left unchanged.

## CORE-20 — Batch/cache module assignment checks

- **Severity:** Medium
- **Files:** `backend/app/core/access_control.py`, tests
- **Issue:** `user_has_module_assignment` can run up to three DB queries per permission check.
- **Fix:** Batch role/team/department checks into one query or load permissions once per request into `request.state`.
- **Done when:** Multiple permission gates do not multiply DB work unnecessarily.

## CORE-21 — Define empty pagination contract

- **Severity:** Medium
- **Files:** `backend/app/core/pagination.py`, frontend pagination consumers, tests
- **Issue:** Empty results can return `page=1,total_pages=0`, which frontends often render badly.
- **Fix:** Choose and enforce one contract: either `total_pages=1` for empty sets, or keep `0` and update/document all consumers.
- **Done when:** Empty paged lists render consistently.

## CORE-22 — Convert useful Celery beat intervals to wall-clock schedules

- **Severity:** Low
- **Files:** `backend/app/core/celery_app.py`
- **Issue:** Raw second intervals run relative to worker start, not predictable wall-clock times.
- **Fix:** Use `crontab()` for daily/hourly maintenance tasks; leave true interval tasks unchanged.
- **Done when:** Maintenance jobs run at predictable low-traffic times.

## CORE-23 — Add file-size gate before lazy CSV parsing

- **Severity:** Low
- **Files:** `backend/app/core/module_csv.py`, tests
- **Issue:** `MAX_CSV_ROWS` inside generator is only enforced when fully consumed.
- **Fix:** Add `MAX_CSV_BYTES` pre-parse gate and keep row limit as secondary guard.
- **Done when:** Huge CSVs cannot bypass preview-time limits.

## CORE-24 — Return duplicate detection copies, not aliased sets

- **Severity:** Low
- **Files:** `backend/app/core/duplicates.py`, tests
- **Issue:** `detect_duplicates()` returns the same `existing_values` set object it received.
- **Fix:** Return `set(existing_values)` or `frozenset(existing_values)` and document caller-supplied semantics.
- **Done when:** Mutating returned duplicates cannot mutate caller input.

## CORE-25 — Flatten PostgreSQL searchable text expression

- **Severity:** Low
- **Files:** `backend/app/core/postgres_search.py`, tests
- **Issue:** Repeated `||` concatenation creates deeply nested SQL expressions.
- **Fix:** Use `func.concat_ws(" ", *coalesced_columns)` while preserving null handling.
- **Done when:** Generated SQL is flatter and search semantics stay unchanged.

## CORE-26 — Make missing media URL behavior explicit

- **Severity:** Medium/Low
- **Files:** `backend/app/core/uploads.py`, frontend media consumers
- **Issue:** `build_media_url()` returns `None` for missing paths; consumers may render broken media UI.
- **Fix:** Define contract that `None` means no media, then audit frontend consumers to render placeholders. Avoid per-response filesystem checks unless required.
- **Done when:** Missing media renders intentionally.

## CORE-27 — Review common-password cache memory

- **Severity:** Low
- **Files:** `backend/app/core/passwords.py`
- **Issue:** `@lru_cache(maxsize=1)` loads the wordlist once per worker. Correct, but memory multiplies by worker count.
- **Fix:** Measure first. If small, leave and comment. If large, cap list or use a Bloom-filter-style structure.
- **Done when:** No premature optimization unless memory size justifies it.

---

# Contracts module tasks

## CON-01 — Split heavy contract loading from lightweight write loading

- **Severity:** Critical
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, `backend/app/modules/contracts/routes/contracts_routes.py`, tests
- **Issue:** `get_contract_or_404` eager-loads parties/signers/events and is used on write paths that do not need the full graph.
- **Fix:** Add a lightweight update/existence loader and keep a separate response loader for full serialization.
- **Done when:** Write operations do not always `selectinload` relationship graphs.

## CON-02 — Remove double-fetch on PATCH

- **Severity:** Critical
- **Files:** `backend/app/modules/contracts/routes/contracts_routes.py`, `backend/app/modules/contracts/services/contracts_services.py`, tests
- **Issue:** PATCH fetches in route and service/response path fetches again.
- **Fix:** Let service own fetch/update/return or pass already-loaded ORM object. Refresh once only if response relationships require it.
- **Done when:** PATCH performs one mutation fetch plus at most one intentional response refresh.

## CON-03 — Make contract number generation atomic

- **Severity:** Critical
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, `backend/app/modules/contracts/models.py`, Alembic migration, tests
- **Issue:** `_generate_contract_number` uses date-prefix `count()+1`, which races under concurrent creates.
- **Fix:** Add DB-backed counter table keyed by `(tenant_id, day)` and allocate with row lock/upsert + returning. Alternative: UUID/random suffix if sequential daily numbers are not required.
- **Tests:** Concurrent create simulation returns unique contract numbers without user-facing generated-number conflict.
- **Done when:** Normal concurrent creates do not fail due to generated number collision.

## CON-04 — Replace per-linked-FK existence queries with constraints plus clean errors

- **Severity:** Critical
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, models/migrations if constraints are missing, tests
- **Issue:** `_ensure_linked_records` fires one query per linked FK.
- **Fix:** Verify real DB FK constraints. Keep targeted tenant ownership checks only for fields present in payload. Translate `IntegrityError` into clean 4xx errors.
- **Done when:** FK validation is tenant-safe and not query-per-field by default.

## CON-05 — Only validate changed linked fields on PATCH

- **Severity:** High
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, tests
- **Issue:** Single-field patches may re-normalize/revalidate unrelated FKs.
- **Fix:** Use `exclude_unset=True`; validate only provided fields while preserving explicit null clearing behavior.
- **Done when:** PATCH title-only does not validate unrelated linked fields.

## CON-06 — Add IntegrityError guards to party/signer adds

- **Severity:** High
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, tests
- **Issue:** `add_contract_party` and `add_contract_signer` can bubble constraint violations as 500.
- **Fix:** Wrap commit in `try/except IntegrityError`, rollback, and return 400/409 based on constraint.
- **Done when:** Duplicate/invalid party or signer add returns clean 4xx.

## CON-07 — Tighten update schema for required title

- **Severity:** High
- **Files:** `backend/app/modules/contracts/schema.py`, tests
- **Issue:** `ContractUpdateRequest.title` allows explicit null to reach business logic.
- **Fix:** Omitted title remains valid, but provided null/blank title fails schema validation.
- **Done when:** Required-field errors are caught at schema boundary.

## CON-08 — Guard signer `signed_at` updates

- **Severity:** Medium
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`, routes/schema as needed, tests
- **Issue:** Generic signer update may let callers set `signed_at` arbitrarily.
- **Fix:** Only signer action endpoint or authorized admin override can set signed status/timestamp. Audit event timestamp changes.
- **Done when:** Signing status cannot be spoofed by generic update calls.

## CON-09 — Fix contracts React Query key

- **Severity:** High
- **Files:** frontend contracts hook, likely `useContracts.ts`
- **Issue:** Contracts list cache key may omit page/filter/sort/search params.
- **Fix:** Include every fetch-affecting value in query key. Do not include `visibleColumns` unless it changes fetch URL.
- **Done when:** Changing page/filter/sort/search fetches correct data and cannot reuse wrong cache entry.

## CON-10 — Fix ContractsTable default cell renderer

- **Severity:** Medium
- **Files:** frontend `ContractsTable.tsx`
- **Issue:** Default renderer can display `[object Object]` and fallback dash may never render.
- **Fix:** Render primitives only; render dash for null/empty/object/array unless explicitly handled.
- **Done when:** Unknown object-valued columns do not render `[object Object]`.

## CON-11 — Optimize contracts list count if hot

- **Severity:** Medium
- **Files:** `backend/app/modules/contracts/services/contracts_services.py`
- **Issue:** `query.count()` plus `.all()` uses two round trips.
- **Fix:** Use window count/subquery if endpoint is hot; otherwise document deferral.
- **Done when:** Pagination totals stay correct with either optimized query or documented defer.

## CON-12 — Add contracts search index strategy

- **Severity:** Medium
- **Files:** contracts models/migration/search builder
- **Issue:** Lower/LIKE search has no production index path.
- **Fix:** Add `pg_trgm` extension and targeted trigram GIN indexes for `contract_number` and `title`; preserve search semantics.
- **Done when:** Contract search has an index path.

## CON-13 — Remove or index contract-number prefix scan

- **Severity:** Medium
- **Files:** contracts service/models/migration
- **Issue:** Generated-number prefix `LIKE` scan is slow and race-prone.
- **Fix:** CON-03 should remove scan. If scan remains temporarily, add `(tenant_id, contract_number)` index supporting prefix lookup.
- **Done when:** Number allocation no longer relies on unindexed count scan.

## CON-14 — Clarify `contract_number` schema semantics

- **Severity:** Low
- **Files:** `backend/app/modules/contracts/schema.py`
- **Issue:** Nullable schema field is misleading because DB column is not null and server auto-generates.
- **Fix:** Add `Field(default=None, description="Auto-generated if omitted")`; ensure update schema cannot null it.
- **Done when:** API schema clearly communicates auto-generation.

## CON-15 — Harden contract dialog ID parsing

- **Severity:** Medium
- **Files:** frontend `CreateContractDialog.tsx`
- **Issue:** Some IDs are string form state and `Number()` can produce `NaN`.
- **Fix:** Store IDs as `number | null` where possible or use safe parse helper that rejects `NaN` before submit.
- **Done when:** API never receives `NaN` IDs from the dialog.

## CON-16 — Make linked-field clearing rules explicit

- **Severity:** Medium
- **Files:** frontend `CreateContractDialog.tsx`
- **Issue:** Cascading clears are correct in places but not clearly symmetric/documented.
- **Fix:** Define parent-child dependency graph. Parent clear clears children; child clear does not clear parent unless explicitly required.
- **Done when:** Cascading behavior is intentional and covered by helper/component tests if available.

## CON-17 — Deduplicate contracts list/search route logic

- **Severity:** Low
- **Files:** `backend/app/modules/contracts/routes/contracts_routes.py`
- **Issue:** `/search` duplicates most of `GET /`.
- **Fix:** Extract shared list/search handler while preserving endpoints and response shape.
- **Done when:** Filter/sort/pagination logic is shared.

## CON-18 — Add expiring-contracts index

- **Severity:** Low/Medium
- **Files:** contracts models/migration
- **Issue:** Likely dashboard query filters by `(tenant_id, expiration_date)`.
- **Fix:** Add composite index, optionally partial for active/non-deleted contracts.
- **Done when:** Expiring contracts query has an index path.

## CON-19 — Fix ContractEvent JSON server default

- **Severity:** Low
- **Files:** contracts models/migration
- **Issue:** `server_default="{}"` is brittle for JSON/JSONB.
- **Fix:** Use dialect-safe SQLAlchemy `text("'{}'")` or explicit JSONB default.
- **Done when:** New event row without payload gets `{}` at DB level.

## CON-20 — Remove or wire `visibleColumns` in contracts hook

- **Severity:** Low
- **Files:** frontend `useContracts.ts`
- **Issue:** `visibleColumns` may affect query key but not fetch URL.
- **Fix:** Remove from fetch/query key if no projection exists, or implement `fields=` projection end-to-end.
- **Done when:** Column visibility does not cause meaningless data refetches.

---

# Calendar and booking tasks

## CAL-01 — Make public booking slot creation concurrency-safe

- **Severity:** Critical
- **Files:** `backend/app/modules/calendar/services/booking_services.py`, models/migration if needed, tests
- **Issue:** `submit_public_booking` validates availability before insert, allowing concurrent submissions to pass.
- **Fix:** Put final overlap check and insert in one transaction. Lock booking type row with `FOR UPDATE` or use atomic insert/upsert conflict handling. Return clean conflict when slot was taken.
- **Done when:** Two concurrent same-slot submissions produce one success and one clean 409/422.

## CAL-02 — Ensure public booking rate limit uses shared cache in production

- **Severity:** Critical
- **Files:** booking service, core cache/config, tests
- **Issue:** In-process cache fallback makes rate limits per worker.
- **Fix:** Require Redis/shared cache for public rate limiting in production/cloud mode. Fail closed or warn loudly if unavailable.
- **Done when:** Multi-worker deployment enforces one global limit.

## CAL-03 — Make external calendar sync retryable and bounded

- **Severity:** Critical
- **Files:** `backend/app/modules/calendar/services/calendar_services.py`, calendar Celery tasks, tests
- **Issue:** Provider sync runs synchronous HTTP per participant with long blocking timeouts.
- **Fix:** Prefer one Celery subtask per participant/provider sync with retry/backoff and bounded timeout. Persist enough state for idempotent retries.
- **Done when:** Provider slowness does not block an entire worker for many participants.

## CAL-04 — Fix calendar route declaration order

- **Severity:** Critical
- **Files:** `backend/app/modules/calendar/routes/calendar_routes.py`, route tests
- **Issue:** `/events/from-task/{task_id}` routes can be shadowed by `/events/{event_id}`.
- **Fix:** Declare all `/events/from-task/...` routes before `/events/{event_id}`.
- **Done when:** `GET /events/from-task/123` reaches correct handler.

## CAL-05 — Prioritize direct user response over team response

- **Severity:** High
- **Files:** `backend/app/modules/calendar/services/calendar_services.py`, tests
- **Issue:** Team participant response can overwrite direct user response.
- **Fix:** Search direct user participant first; only fall back to team participant if no direct user record exists. Support multi-team membership if app model has it.
- **Done when:** Direct user response always wins.

## CAL-06 — Replace visibility outerjoin/distinct with EXISTS

- **Severity:** High
- **Files:** `backend/app/modules/calendar/repositories/calendar_repository.py`, tests
- **Issue:** `outerjoin + distinct()` inflates rows before dedup.
- **Fix:** Use relationship `.any()`/`EXISTS` filters and remove unnecessary `distinct()`.
- **Done when:** Visibility results match current behavior without row explosion.

## CAL-07 — Isolate notification side effects

- **Severity:** High
- **Files:** calendar service/notification tasks, tests
- **Issue:** `_notify_new_participants` can rollback/log/swallow failures in same session path.
- **Fix:** Enqueue notifications after commit or use savepoint/separate session. Add structured logging/metrics.
- **Done when:** Event creation is transaction-safe and notification failures are observable.

## CAL-08 — Remove N+1 overlap queries from `available_slots`

- **Severity:** High
- **Files:** booking service, tests
- **Issue:** One overlap query per candidate slot.
- **Fix:** Fetch all relevant events/bookings for owner and range once; check overlaps in Python.
- **Done when:** Slot generation DB queries do not grow with candidate count.

## CAL-09 — Stop calling private booking service functions from routes

- **Severity:** High
- **Files:** `backend/app/modules/calendar/routes/booking_routes.py`, booking service
- **Issue:** Route layer calls underscore-prefixed service helpers.
- **Fix:** Expose public service helpers or return audit snapshots from update service.
- **Done when:** Route layer uses public service API only.

## CAL-10 — Reset CalendarEventDialog state when event changes

- **Severity:** High
- **Files:** frontend `CalendarEventDialog.tsx`
- **Issue:** `useState` initializer uses only first `event` prop, causing stale dialog forms.
- **Fix:** Add `useEffect` keyed on `open`, `event?.id`, draft start/end, or key the dialog by event ID.
- **Done when:** Opening event B after event A shows event B values.

## CAL-11 — Remove unnecessary calendar connection refreshes

- **Severity:** High
- **Files:** calendar service
- **Issue:** Sync can refresh connection row repeatedly inside loops.
- **Fix:** Remove per-participant/per-event refreshes unless required; refresh once after loop if needed.
- **Done when:** Sync behavior unchanged with fewer round trips.

## CAL-12 — Make external delete retryable after soft delete

- **Severity:** Medium
- **Files:** calendar service/tasks, tests
- **Issue:** Internal soft delete can commit before external provider delete, leaving ghost external events if provider fails.
- **Fix:** Enqueue provider deletes as retryable Celery tasks with primitive IDs/provider metadata and failure state.
- **Done when:** External delete failures are retryable and observable.

## CAL-13 — Replace hardcoded 500-user participant cap

- **Severity:** Medium
- **Files:** calendar repository/routes/frontend picker
- **Issue:** `list_context_users.limit(500)` silently truncates large tenants.
- **Fix:** Add pagination/search-backed participant picker or return truncation metadata as interim.
- **Done when:** Users beyond first 500 can be found.

## CAL-14 — Early-return participant normalization for empty payloads

- **Severity:** Medium
- **Files:** calendar service, tests
- **Issue:** Empty participants payload can trigger unnecessary user/team existence queries.
- **Fix:** If payload is `None`, skip normalization. If empty list means owner only, return owner entry without extra queries.
- **Done when:** Empty/unchanged participants avoid redundant DB checks.

## CAL-15 — Align booking answer keys between frontend and backend

- **Severity:** Medium
- **Files:** booking service/schema, frontend `BookingForm.tsx`, tests
- **Issue:** Backend keys answers by `str(question.id)` while frontend can key by label when ID is null.
- **Fix:** Ensure public question IDs are non-null, or define shared fallback key rule and implement both sides.
- **Done when:** Required answers validate even when question ID is null or absent.

## CAL-16 — Harden CalendarSyncBridge sessionStorage usage

- **Severity:** Medium
- **Files:** frontend `CalendarSyncBridge.tsx`
- **Issue:** `sessionStorage` writes can throw in SSR/private/quota contexts.
- **Fix:** Guard all storage access with `typeof window`, wrap writes in try/catch, consider useRef + effect hydration.
- **Done when:** Storage unavailable errors do not break page.

## CAL-17 — Add calendar event range index

- **Severity:** Medium
- **Files:** calendar models/migration
- **Issue:** Range queries need `(tenant_id, start_at, end_at)` support.
- **Fix:** Add partial composite index, likely where `deleted_at IS NULL`.
- **Done when:** Main calendar range query has index path.

## CAL-18 — Add event/user participant index

- **Severity:** Medium
- **Files:** calendar models/migration
- **Issue:** Per-event participant lookup by user needs `(event_id, user_id)`.
- **Fix:** Add composite index.
- **Done when:** Participant lookup has index path.

## CAL-19 — Reword and verify useCalendar query key concern

- **Severity:** Medium, partially rejected as written
- **Files:** frontend `useCalendar.ts` and call sites
- **Issue:** The claim that new string instances alone cause TanStack Query double-fetch is not accurate. Real risk is missing fetch-affecting values or changing timestamp values.
- **Fix:** Ensure query key contains all fetch-affecting values and values are normalized. Do not add `useMemo` solely because strings are new instances.
- **Done when:** Query key is complete and deterministic.

## CAL-20 — Remove CalendarEventDialog double date conversion

- **Severity:** Low
- **Files:** frontend `CalendarEventDialog.tsx`
- **Issue:** `toIsoOrNull(toDatetimeLocalValue(...))` can round-trip through local format and risk timezone drift.
- **Fix:** Store one canonical date form and convert/validate once on submit.
- **Done when:** Submitted times match selected times.

## CAL-21 — Signal available slot truncation

- **Severity:** Low
- **Files:** booking service/schema/frontend slots UI
- **Issue:** `available_slots` clamps at 200 without `has_more` or metadata.
- **Fix:** Add optional `has_more`/limit metadata or document schema ceiling.
- **Done when:** Callers can detect truncation.

## CAL-22 — Replace O(n²) pending event dedup

- **Severity:** Low
- **Files:** calendar routes
- **Issue:** Pending event dedup scans all events per pending event.
- **Fix:** Use `existing_ids = {event.id for event in events}` and update set as appending.
- **Done when:** Same output with O(n) dedup.

## CAL-23 — Memoize timezone options in BookingForm

- **Severity:** Low
- **Files:** frontend `BookingForm.tsx`
- **Issue:** Timezone option dedup list recomputes each render.
- **Fix:** Wrap in `useMemo` keyed on `bookingType.timezone`.
- **Done when:** Same options with less render churn.

## CAL-X1 — Validate calendar update start/end after partial PATCH

- **Severity:** Medium
- **Files:** calendar service/schema/tests
- **Issue:** Schema validator only catches ordering when both fields are present; service check may occur after ORM mutation.
- **Fix:** Compute proposed start/end before mutating ORM object and validate merged state first.
- **Done when:** PATCH only `end_at` before existing `start_at` fails without dirtying/committing event.

## CAL-X2 — Add client-side calendar date-order validation

- **Severity:** Low/Medium
- **Files:** frontend `CalendarEventDialog.tsx`
- **Issue:** User can submit event ending before it starts and only backend rejects it.
- **Fix:** Show inline error or disable submit when `end_at <= start_at`.
- **Done when:** Invalid date order is caught before submit.

## CAL-X3 — Make external-event enqueue failures observable

- **Severity:** Medium
- **Files:** calendar service/task enqueue helpers
- **Issue:** External event enqueue failures can be swallowed except warning logs.
- **Fix:** Preserve user success if best-effort, but write durable sync warning/status or metric for ops.
- **Done when:** Operators can detect Celery enqueue failures.

## CAL-X4 — Make booking side effects idempotent

- **Severity:** Medium
- **Files:** booking service/activity/lead helpers
- **Issue:** Post-commit side-effect failure can leave booking/lead without activity log or follow-up records.
- **Fix:** Give side-effect tasks idempotency keys based on booking ID and make retries safe.
- **Done when:** Retrying side effects does not duplicate lead/activity records.

---

# Catalog module tasks

## CAT-01 — Use timezone-aware UTC timestamps for soft delete

- **Severity:** Critical
- **Files:** `backend/app/modules/catalog/services/product_services.py`, `backend/app/modules/catalog/services/service_services.py`, tests
- **Issue:** `datetime.utcnow()` writes naive datetimes into timezone-aware columns.
- **Fix:** Use `datetime.now(timezone.utc)` and import `timezone`.
- **Done when:** Soft delete timestamps are timezone-aware UTC.

## CAT-02 — Make media upload rollback safe

- **Severity:** Critical
- **Files:** product/service catalog services, media tests
- **Issue:** File is persisted before DB commit; commit failure can orphan new file or delete old file incorrectly.
- **Fix:** Track new and previous paths separately. On commit failure, rollback and delete only new file. Delete old file only after successful commit.
- **Done when:** Media and DB state remain consistent after upload failure.

## CAT-03 — Allow slug reuse after soft delete where intended

- **Severity:** Critical
- **Files:** catalog repositories/models/migration if needed, tests
- **Issue:** Slug checks can block slugs used by soft-deleted product/service records.
- **Fix:** Filter cross-table slug checks with `deleted_at IS NULL`. Align active-only unique indexes if needed.
- **Done when:** Active slug collisions fail; soft-deleted slugs can be reused if product rules allow.

## CAT-04 — Stabilize boolean flag handling

- **Severity:** Critical, migration optional
- **Files:** catalog models/serializers/schema tests
- **Issue:** `is_public`/`is_active` use `SmallInteger` while schemas expect bool.
- **Fix:** First ensure all serializers cast to bool and validators cover ORM-to-Pydantic bypasses. Defer physical Boolean migration unless needed.
- **Done when:** API always returns booleans, not numeric flags.

## CAT-05 — Clarify slug clearing behavior on update

- **Severity:** High
- **Files:** catalog product/service services/schema, tests
- **Issue:** Explicit empty/null slug may silently regenerate from name.
- **Fix:** Define contract: omitted leaves unchanged; explicit null clears or fails; blank clears or fails. Implement explicitly before fallback normalization.
- **Done when:** No silent slug regeneration on clear intent.

## CAT-06 — Make nullable update field contracts explicit

- **Severity:** High
- **Files:** catalog schema/services/tests
- **Issue:** Null behavior for fields like `stock_quantity` and `public_unit_price` is subtle.
- **Fix:** Add validators/service checks and schema descriptions for clearable vs required fields.
- **Done when:** Explicit null is accepted/rejected according to tests.

## CAT-07 — Validate catalog enum values at service boundary

- **Severity:** High
- **Files:** catalog product service/tests
- **Issue:** Service accepts raw dicts and relies on route Pydantic validation.
- **Fix:** Pass typed schema objects into service or validate enum values in service before writing.
- **Done when:** Direct service calls cannot write invalid enum-like values.

## CAT-08 — Fix catalog hook query keys/projection semantics

- **Severity:** High
- **Files:** frontend `useCatalogRecords.ts`
- **Issue:** Query key may ignore visible columns or collide across product/service/action contexts.
- **Fix:** Include fetch-affecting values only. Do not include `visibleColumns` unless the URL uses projection. Ensure product/service caches do not collide.
- **Done when:** Kind/filter/sort/page changes fetch correct data; column preference changes do not cause meaningless fetches.

## CAT-09 — Align `canSubmit` with submit validation

- **Severity:** High
- **Files:** frontend `CatalogRecordDialog.tsx`
- **Issue:** Button disabled state may not check invalid stock quantity while submit does.
- **Fix:** Share one validation helper between disabled state and submit path. Show inline error where feasible.
- **Done when:** Button state matches actual submit validation.

## CAT-10 — Improve create + media upload failure UX

- **Severity:** High
- **Files:** frontend `CatalogRecordsPage.tsx`, media hooks
- **Issue:** Record create can succeed and media upload fail, causing generic error and possible duplicate retry.
- **Fix:** Distinguish create failure from media upload failure. Navigate/show created record with retry upload action.
- **Done when:** Media upload failure after create does not encourage duplicate records.

## CAT-11 — Filter invalid product-only columns for services

- **Severity:** Medium
- **Files:** frontend `CatalogRecordsTable.tsx`, column config
- **Issue:** Service table can render blank product-only cells if saved columns are misconfigured.
- **Fix:** Filter visible columns by catalog kind before header/cell render.
- **Done when:** Services never render product-only blank column slots.

## CAT-12 — Extract shared slug normalization

- **Severity:** Medium
- **Files:** catalog shared util, product/service services, tests
- **Issue:** `_normalize_slug` is duplicated.
- **Fix:** Extract one helper and replace both copies.
- **Done when:** One canonical slug normalization implementation exists.

## CAT-13 — Add currency DB check constraints

- **Severity:** Medium
- **Files:** catalog models/migration/tests
- **Issue:** Currency validation is schema-only.
- **Fix:** Add DB check constraint such as `length(currency) = 3`, with backfill if needed.
- **Done when:** Raw DB writes cannot store invalid currency length.

## CAT-14 — Add catalog trigram search indexes

- **Severity:** Medium
- **Files:** catalog models/migration
- **Issue:** `%search%` on name/sku/description/slug can scan tables.
- **Fix:** Enable `pg_trgm` and add targeted GIN trigram indexes for high-use fields: product name, SKU, service name, maybe slug/description.
- **Done when:** Primary catalog search fields have index paths.

## CAT-15 — Optimize catalog count + list query if needed

- **Severity:** Medium
- **Files:** catalog repositories
- **Issue:** `count()` plus `.all()` uses two DB round trips.
- **Fix:** Use window count/subquery if hot; otherwise document deferral.
- **Done when:** Pagination totals remain correct and optimization/defer is explicit.

## CAT-16 — Make service search fields intentional

- **Severity:** Medium
- **Files:** service/product catalog repositories, tests
- **Issue:** Product and service search fields differ; slug may be omitted.
- **Fix:** Decide consistent fields and add slug to both if user-facing search should find slugs.
- **Done when:** Search-by-slug behavior matches documented contract.

## CAT-17 — Replace `window.confirm` delete UX

- **Severity:** Medium
- **Files:** frontend `CatalogRecordDetailPage.tsx`, shared ConfirmDialog
- **Issue:** Browser confirm is unstyled/blockable and unclear about soft-delete consequences.
- **Fix:** Use app ConfirmDialog with clear consequence copy.
- **Done when:** Delete confirmation uses app UI and clear wording.

## CAT-18 — Remove double-fetch after catalog detail update

- **Severity:** Medium
- **Files:** frontend `CatalogRecordDetailPage.tsx`, hooks
- **Issue:** Update invalidates query and manually refetches.
- **Fix:** Keep invalidation or manual refetch, not both.
- **Done when:** One refresh path after update.

## CAT-19 — Send minimal active-toggle payload

- **Severity:** Medium
- **Files:** frontend `CatalogRecordsPage.tsx`
- **Issue:** Toggle active sends full payload including product-only fields for services.
- **Fix:** Send `{ is_active: active }` only.
- **Done when:** Toggle payload contains only fields needed.

## CAT-20 — Deduplicate schema validators

- **Severity:** Low
- **Files:** catalog schema
- **Issue:** Validators duplicated across create/update product/service schemas.
- **Fix:** Extract shared validators/mixins only if it reduces complexity without behavior changes.
- **Done when:** Less duplication with same validation behavior.

## CAT-21 — Remove redundant dialog reset

- **Severity:** Low
- **Files:** frontend `CatalogRecordDialog.tsx`
- **Issue:** `handleClose` resets form and `useEffect` also resets.
- **Fix:** Let one mechanism own reset behavior.
- **Done when:** Same UX with less duplicate state logic.

## CAT-22 — Move duplicated catalog formatting helpers

- **Severity:** Low
- **Files:** catalog table/detail frontend files, shared catalog util
- **Issue:** `stockLabel`, `stockStyle`, and `formatAmount` duplicated.
- **Fix:** Move pure helpers to shared util.
- **Done when:** One implementation for shared formatting.

## CAT-23 — Add staleTime for single catalog record query

- **Severity:** Low
- **Files:** frontend `useCatalogRecords.ts`
- **Issue:** Single record query refetches on every mount.
- **Fix:** Add reasonable `staleTime`, e.g. 30 seconds, unless global defaults already cover it.
- **Done when:** Detail view avoids immediate needless refetch.

## CAT-24 — Add currency inline validation feedback

- **Severity:** Low
- **Files:** frontend `CatalogRecordDialog.tsx`
- **Issue:** Save can be disabled for invalid currency without explaining why.
- **Fix:** Show helper text and inline error for non-empty invalid currency.
- **Done when:** User can tell why Save is disabled.

---

# Client portal tasks

## CP-01 — Enforce client password policy at schema and service boundary

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/schema.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `frontend/app/client/setup/page.tsx`, tests.
- **Issue:** `ClientSetupPasswordRequest.password` uses `Field(min_length=1)`, and `setup_client_password` delegates to `hash_password` without an explicit client-portal policy.
- **Fix:** Add a single policy constant, for example `CLIENT_PASSWORD_MIN_LENGTH = 8`, and enforce it in both Pydantic schema and `setup_client_password` before hashing. Keep `ClientLoginRequest.password` as `min_length=1` unless product wants login-side min-length rejection too.
- **Frontend:** Add setup-page hint and pre-submit validation.
- **Tests:** One-character setup password returns 422/400 and never calls hash/write logic.
- **Done when:** A setup token cannot create a trivial password.

## CP-02 — Make default customer group seeding race-safe

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, `backend/app/modules/client_portal/repositories/client_portal_repository.py`, tests.
- **Issue:** `ensure_default_customer_groups` checks cache/DB, inserts missing keys, then commits. Concurrent workers can race and hit `uq_customer_groups_tenant_key`.
- **Fix:** Use PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` for seed rows, or wrap commit in `try/except IntegrityError` with rollback and re-read. Keep cache as optimization only, not correctness.
- **Done when:** Concurrent first access for a tenant does not produce a 500 or partial seed failure.

## CP-03 — Constrain support status action route

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/routes/client_portal_routes.py`, support service tests.
- **Issue:** `POST /client-support/cases/{case_id}/{action}` accepts arbitrary path strings and validates only inside service.
- **Fix:** Replace with explicit routes such as `/close` and `/reopen`, or use a FastAPI path enum/Literal constrained to supported actions.
- **Done when:** Unsupported support actions do not reach service logic as arbitrary strings.

## CP-04 — Standardize client page action names

- **Severity:** Medium/High
- **Assessment:** Partially valid. Current public backend route hardcodes `request_changes`, so the request-changes flow works today; the URL/frontend/API naming still mixes hyphen and underscore.
- **Files:** `backend/app/modules/client_portal/routes/client_portal_routes.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `frontend/hooks/useClientPortal.ts`, frontend public page.
- **Issue:** DB constraint uses `request_changes`; public route and frontend use `request-changes` in the URL.
- **Fix:** Keep the external URL `/request-changes` if desired, but centralize an action normalizer that maps `request-changes` to `request_changes`. Use typed constants for stored action values and URL action values.
- **Tests:** Service accepts only canonical stored actions or documented aliases; API response always returns canonical `request_changes`.
- **Done when:** There is one canonical internal action vocabulary and one documented URL alias.

## CP-05 — Replace client overview full-list fetches with summary queries

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, relevant module repositories/services for summary helpers, tests.
- **Issue:** `build_client_overview` loads catalog, orders, support cases, messages, documents, quotes, and bookings, then counts/slices in Python.
- **Fix:** Add dedicated count/latest helpers for each overview metric. Fetch counts with `COUNT(*)` and next-action candidates with `LIMIT 1` ordered by the relevant timestamp/status.
- **Done when:** Overview response does not pull full lists just to compute metrics and five next actions.

## CP-06 — Make customer-group relationship resolution explicit

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, repository helpers, tests.
- **Issue:** `resolve_client_customer_group` checks `account.__dict__` for loaded relationships and falls back to DB/session lookups. If no session exists, it returns `None`, which can hide a lazy-load/detached-object problem.
- **Fix:** Prefer passing `db` explicitly for all code paths that need group resolution. If no DB/session exists and a linked customer exists, raise or return an explicit “unavailable” path rather than silently `None`.
- **Done when:** Missing loaded relationship/session cannot silently change pricing from personalized to public.

## CP-07 — Tighten customer-group seeded cache semantics

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** client portal service/cache tests.
- **Issue:** The cache key is namespaced but cache-hit behavior still performs a DB check. That is safe but reduces the value of caching.
- **Fix:** After CP-02 makes DB seeding idempotent, simplify cache to an optimization: either trust it for a short TTL where safe, or remove it entirely and rely on upsert seeding.
- **Done when:** Seeding behavior is simple, race-safe, and not dependent on cache correctness.

## CP-08 — Limit page-action summaries at the database layer

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/repositories/client_portal_repository.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, tests.
- **Issue:** `action_summaries` fetches all actions for all page IDs, and the service keeps only three per page.
- **Fix:** Use a window function: `row_number() over (partition by client_page_id order by created_at desc, id desc)` and filter `row_number <= 3`. Keep a separate grouped count query or combine if practical.
- **Done when:** Recent action summaries fetch at most three action rows per page plus counts.

## CP-09 — Add service-level finite Decimal validation for pricing/order payloads

- **Severity:** Medium/High
- **Assessment:** Partially valid. Route schemas validate normal API calls, but services accept raw dicts.
- **Files:** `client_portal_services.py`, schema tests.
- **Issue:** `_normalize_pricing_items` and order/request flows convert raw values to `Decimal` and compare them without consistent finite checks.
- **Fix:** Add a helper like `_decimal_or_400(value, field, *, gt=None, ge=None)` that rejects invalid, NaN, Infinity, and wrong bounds. Use it for pricing item quantity/public price and catalog order quantity.
- **Done when:** Malformed direct service payloads return clean 400s, not `InvalidOperation`/500.

## CP-10 — Avoid clearing client token on every 401

- **Severity:** High frontend/auth
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`.
- **Issue:** `publicJson` and `publicBlob` call `clearClientToken()` on any 401 from any client endpoint.
- **Fix:** Clear token only for definitive auth/session endpoints, for example `/client-auth/me`, `/client-auth/login`, `/client-auth/setup`, or when backend returns a known invalid-token error code. Do not clear for unrelated transient 401s without confirming token invalidity.
- **Done when:** A single endpoint-specific 401 cannot unnecessarily log out a valid client session.

## CP-11 — Debounce client catalog search before query hook

- **Severity:** High frontend/perf
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`, client catalog page component.
- **Issue:** `useClientCatalog` query key includes raw search text, so callers that pass live input trigger one query per keystroke.
- **Fix:** Debounce in the page/component before calling `useClientCatalog`, or add a `useDebouncedValue` hook and pass the debounced search to the query hook.
- **Done when:** Typing in catalog search does not fire a request for every keystroke.

## CP-12 — Remove dynamic `_action_summary` ORM attribute

- **Severity:** Medium
- **Assessment:** Valid as fragility/maintainability.
- **Files:** `client_portal_services.py`, repository/service return types, tests.
- **Issue:** Page serializers can read `page._action_summary`, an arbitrary dynamic attribute on SQLAlchemy objects.
- **Fix:** Return a typed wrapper/dataclass, or pass `action_summary` explicitly into `serialize_client_page`.
- **Done when:** Action summaries are explicit typed data, not hidden ORM attributes.

## CP-13 — Make request metadata client host behavior explicit

- **Severity:** Low/Medium
- **Assessment:** Partially valid.
- **Files:** `client_portal_routes.py`, tests.
- **Issue:** `_request_metadata` handles missing/invalid `request.client`, but returns `client_host=None` silently.
- **Fix:** Keep no-crash behavior, but include a clear `client_host_status` or omit invalid hosts intentionally. Ensure tests cover `request.client is None`.
- **Done when:** Request metadata behavior is explicit for missing/invalid client host.

## CP-14 — Remove redundant order refresh after client catalog order creation

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, tests.
- **Issue:** `create_client_catalog_order` commits, refreshes `order`, then immediately discards it by calling `get_client_order_or_404`.
- **Fix:** Remove the intermediate `db.refresh(order)` before the selectinload refetch, or avoid the second fetch by loading required line items another way.
- **Done when:** Order creation performs only required post-commit DB round trips.

## CP-15 — Guard client account/page serialization against lazy-load surprises

- **Severity:** Medium
- **Assessment:** Valid as future-proofing.
- **Files:** `client_portal_services.py`, repository tests.
- **Issue:** `serialize_client_account` and `serialize_client_page` assume `contact`/`organization` are loaded. Repositories generally joinedload them, but future callers can trigger N+1 or detached-object errors.
- **Fix:** Add helper that checks SQLAlchemy inspection state without triggering lazy loads, or require serializers to receive display names from loaded query projections.
- **Done when:** Serialization cannot accidentally lazy-load per row or crash on detached objects.

## CP-16 — Keep DB action constraint canonical and document URL alias

- **Severity:** Medium
- **Assessment:** Partially valid; overlaps CP-04.
- **Files:** `models.py`, route/service tests.
- **Issue:** DB stores `request_changes`; external route uses `/request-changes`.
- **Fix:** Do not change DB constraint unless changing storage vocabulary. Add tests proving `/request-changes` stores `request_changes` and service normalizes aliases if exposed elsewhere.
- **Done when:** Route alias and DB value are documented/tested.

## CP-17 — Make browser download helpers safe in non-browser/test DOMs

- **Severity:** Medium frontend
- **Assessment:** Valid for `downloadClientDocument`; partially valid for `downloadPublicClientPageDocument` because it uses `window.open` rather than body append.
- **Files:** `frontend/hooks/useClientPortal.ts`, tests where practical.
- **Issue:** `downloadClientDocument` appends an anchor to `document.body` without a fallback. Public page download uses object URL/window.open and should also guard `window` availability.
- **Fix:** Use `const container = window.document.body ?? window.document.documentElement`; guard `typeof window !== "undefined"`; clean up object URLs in finally blocks.
- **Done when:** Download helpers do not crash under SSR/Jest-like environments.

## CP-18 — Trim public page brand accent before regex validation

- **Severity:** Low
- **Assessment:** Valid low-risk polish.
- **Files:** `frontend/app/client/pages/[token]/page.tsx`.
- **Issue:** `brandAccent` tests the raw string and falls back on values with harmless whitespace.
- **Fix:** `const trimmed = (value ?? "").trim(); return HEX_RE.test(trimmed) ? trimmed : fallback;`
- **Done when:** Whitespace around valid hex colors does not drop branding.

## CP-19 — Normalize public/setup token expiry datetimes consistently

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, core DB/timezone config/tests.
- **Issue:** `get_public_client_page` and `setup_client_password` patch naive datetimes with UTC but do not normalize aware non-UTC values.
- **Fix:** Add a shared `_as_utc` helper like other modules use. Convert naive values to UTC and aware values via `.astimezone(timezone.utc)`. Long-term, ensure DB sessions use UTC.
- **Done when:** Expiry comparisons are correct for naive and aware datetimes.

## CP-20 — Standardize retry policy for authenticated client hooks

- **Severity:** Low/Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`.
- **Issue:** `useClientMe` and `useClientOverview` use `retry: false`; sibling authenticated hooks rely on React Query defaults.
- **Fix:** Create `clientQueryDefaults = { retry: false, staleTime: 30_000 }` and apply to authenticated client portal queries unless a specific endpoint needs retry.
- **Done when:** 401/client-auth failures do not incur useless retry latency.

## CP-21 — Limit or deprecate flat client account/page list routes

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `client_portal_routes.py`, `client_portal_repository.py`, frontend admin hooks/pages.
- **Issue:** `GET /client-portal/accounts` and `GET /client-portal/pages` return all rows for a tenant. Cursor variants exist but flat routes remain unbounded.
- **Fix:** Prefer cursor routes in UI. Add hard `limit` query param with safe max to flat routes, or mark flat routes deprecated and remove call sites.
- **Done when:** No route can accidentally serialize thousands of client accounts/pages without a limit.

## CP-22 — Seed placeholder customer groups without misleading 0% discounts

- **Severity:** Low/Medium product correctness
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, seed migration/data tests if needed.
- **Issue:** Wholesale/retailer/VIP placeholders are seeded as `percent` with `0`, making them appear as personalized discount groups even though they do not change price.
- **Fix:** Seed placeholder groups with `discount_type="none"` and `discount_value=None`, or seed only the default group and let tenants create discount groups. Provide a migration/data correction for existing untouched zero-percent placeholder groups.
- **Done when:** Placeholder groups do not show misleading personalized 0% pricing.

## CP-23 — Add client-side setup password validation and hint

- **Severity:** Low/Medium frontend
- **Assessment:** Valid; pairs with CP-01.
- **Files:** `frontend/app/client/setup/page.tsx`.
- **Issue:** Setup form only checks required and password confirmation. Users see backend errors after submit.
- **Fix:** Add visible rule text, `minLength`, and explicit submit guard matching backend policy.
- **Done when:** User sees password requirements before submission.

---

## Migration checklist

- CP-02: no migration required if using upsert/IntegrityError handling; verify `uq_customer_groups_tenant_key` exists.
- CP-08: optional index review for `client_page_actions`: consider `(tenant_id, client_page_id, created_at DESC, id DESC)`.
- CP-21: no migration; API behavior/route change only.
- CP-22: optional data migration to update existing default placeholder groups from `percent/0` to `none/NULL` where they still match the original seed names and have not been customized.

## Test checklist

Backend:

- Setup password shorter than policy is rejected before hashing.
- Concurrent default group seeding succeeds without 500s.
- Public `/request-changes` stores canonical `request_changes`.
- Unsupported support case action is rejected at route/path boundary.
- Overview returns the same response shape with summary/count queries.
- Action summaries return max three recent actions per page.
- Decimal helper rejects NaN/Infinity/malformed values with 400.
- Expiry comparison handles naive and non-UTC aware datetimes.
- Flat list routes enforce a limit or UI uses cursor routes.

Frontend/manual:

- Client token is not cleared by a non-auth endpoint 401 unless backend confirms invalid token.
- Client catalog search is debounced.
- Authenticated client hooks do not retry 401s repeatedly.
- Setup page shows and enforces password minimum.
- Download helpers work in browser and do not crash in DOM-light tests.
- Brand accent accepts valid hex with whitespace.

## Explicit audit wording corrections

- The public `request-changes` flow is not currently broken at the backend route level because the route hardcodes `action="request_changes"` before calling the service. Treat this as a consistency/latent bug, not a confirmed current 400.
- The customer-group cache key already has a namespace prefix. The real problem is not collision; it is that cache is not a correctness mechanism for the seeding race.
- Decimal NaN/Infinity risk is mainly a service-boundary hardening issue because the public Pydantic schemas already cover normal route inputs.


# Migration checklist

Create migrations if current schema lacks the target state:

- CON-03: contract number counter table or equivalent atomic allocation schema.
- CON-12: `pg_trgm` extension and contract search indexes.
- CON-13: temporary contract number prefix index if prefix scan remains.
- CON-18: `(tenant_id, expiration_date)` index.
- CON-19: JSON default correction if DB default changes.
- CAL-17: calendar event `(tenant_id, start_at, end_at)` partial index.
- CAL-18: calendar participant `(event_id, user_id)` index.
- CAT-03: active-only slug uniqueness changes if current constraints include deleted rows.
- CAT-04: optional SmallInteger-to-Boolean migration only if chosen.
- CAT-13: currency check constraints.
- CAT-14: `pg_trgm` extension and catalog search indexes.

## DOC-01 — Lock document storage OAuth token refresh

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/services/document_services.py`, shared Redis/distributed-lock helper, tests.
- **Issue:** `_refresh_google_drive_access_token` and `_refresh_microsoft_onedrive_access_token` refresh the same connection with no cross-worker lock.
- **Fix:** Add a distributed lock keyed by `(tenant_id, user_id, provider)`. Re-read connection state after acquiring the lock so waiters can reuse a token refreshed by another worker. Redis is required for production correctness; local fallback is dev-only.
- **Acceptance:** Concurrent refresh attempts cannot clobber provider token state.

## DOC-02 — Replace global storage-path uniqueness with scoped constraints

- **Severity:** Critical/High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/models.py`, Alembic migration, tests.
- **Issue:** `Document.storage_path` and `DocumentVersion.storage_key` are globally unique, which is too broad for cloud provider item IDs.
- **Fix:** Remove global `unique=True`. Add scoped constraints/indexes matching the real contract, for example `(tenant_id, storage_provider, storage_path)` for documents and tenant/document-scoped storage-key uniqueness for versions if needed. Check/backfill duplicates before migration.
- **Acceptance:** Legitimate same provider IDs across tenants/providers do not fail as DB 500s.

## DOC-03 — Fix deleted-document repository filtering semantics

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, document service tests.
- **Issue:** `get_document(..., include_deleted=True)` filters `deleted_at IS NOT NULL`; the flag currently means “only deleted,” not “include deleted.”
- **Fix:** Make `include_deleted=True` omit the deleted filter. Add an explicit deleted-only helper if restore should only target deleted rows.
- **Acceptance:** Active fetch, deleted fetch, restore, and delete paths use the intended row set.

## DOC-04 — Simplify local document path resolution

- **Severity:** Medium, despite Critical audit label
- **Assessment:** Partially valid. The final `resolve()` containment guard is useful; the confusing part is accepting and stripping a `documents/` prefix.
- **Files:** `backend/app/modules/documents/services/storage_backends.py`, storage tests.
- **Issue:** `LocalDocumentStorage.resolve_path` strips `documents/` before resolving.
- **Fix:** Accept only canonical paths relative to `DOCUMENT_STORAGE_DIR`, such as `tenant-{id}/uuid.ext`. Reject absolute paths, `..`, null bytes, encoded traversal, and `documents/`-prefixed paths.
- **Acceptance:** Local storage paths cannot resolve outside the storage root and have one canonical format.

## DOC-05 — Define and enforce unlinked-document access

- **Severity:** Critical
- **Assessment:** Valid; product/security decision required.
- **Files:** document services/routes/schema/models as needed, tests.
- **Issue:** `_require_any_linked_record_access` succeeds when `document.links` is empty, making unlinked documents visible to any tenant user with documents permission.
- **Fix:** Define explicit document-level visibility for unlinked files: owner/uploader, admin, explicit visibility, or documented tenant-wide access. Prefer owner/admin unless tenant-wide visibility is intentional.
- **Acceptance:** Unlinked document visibility is explicit and tested.

## DOC-06 — Reduce full-byte upload memory retention

- **Severity:** High
- **Assessment:** Valid; staged fix acceptable.
- **Files:** `document_services.py`, `storage_backends.py`, tests.
- **Issue:** `read_document_upload` reads the whole file into memory and keeps bytes through quota, checksum, and cloud upload.
- **Fix:** Short term: avoid duplicate byte copies and keep strict max size. Medium term: stream to a temp file, compute signature/hash/quota from chunks, and pass file-like objects to storage backends.
- **Acceptance:** Upload memory use is bounded or explicitly limited by configuration and tests.

## DOC-07 — Remove blocking provider HTTP from async routes

- **Severity:** High
- **Assessment:** Valid.
- **Files:** document service/storage backends/routes, tests.
- **Issue:** Async upload/version routes call synchronous `requests` provider operations.
- **Fix:** Convert provider clients to `httpx.AsyncClient`, or make upload routes sync `def` so FastAPI runs them in a threadpool. Choose one consistent approach and preserve timeouts.
- **Acceptance:** Provider network I/O does not block the async event loop.

## DOC-08 — Optimize or intentionally defer document count queries

- **Severity:** Medium/High
- **Assessment:** Valid performance concern.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, tests.
- **Issue:** `list_documents` uses `count()` plus a separate paginated select.
- **Fix:** Use a window count/subquery if this endpoint is hot. If cursor pagination is the scalable path, document the offset/list endpoint as compatibility-only.
- **Acceptance:** Pagination totals remain correct and the query strategy is intentional.

## DOC-09 — Combine tenant storage usage aggregates

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/services/document_services.py`, tests.
- **Issue:** `_tenant_storage_used` runs two aggregate queries on every upload.
- **Fix:** Use one CTE or `UNION ALL` aggregate covering current-version rows and legacy rows while excluding deleted documents.
- **Acceptance:** Storage totals match current behavior with one aggregate query.

## DOC-10 — Make OAuth state decode fail closed

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `document_services.py`, OAuth callback routes/tests.
- **Issue:** `decode_drive_oauth_state` returns `None`; missed checks can become later `KeyError`/500 failures.
- **Fix:** Raise `HTTPException(400)` directly or add a required `decode_drive_oauth_state_or_400` helper and update all callbacks.
- **Acceptance:** Invalid/missing/wrong-provider state returns 400 before user lookup.

## DOC-11 — Use application UTC timestamp for soft delete

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `document_services.py`, tests.
- **Issue:** `soft_delete_document` assigns `func.now()` to `deleted_at`, which can make audit serialization observe stale/expression state before refresh.
- **Fix:** Use `_utcnow()` before commit.
- **Acceptance:** Delete audit `after_state.deleted_at` is populated with a timezone-aware timestamp.

## DOC-12 — Avoid full-file text decode for txt/rtf validation

- **Severity:** Medium
- **Assessment:** Valid, bounded by upload max.
- **Files:** document service tests.
- **Issue:** `_validate_document_signature` decodes full txt/rtf content.
- **Fix:** Decode a representative sample, for example `content[:8192]`, while preserving binary/polyglot and RTF magic checks.
- **Acceptance:** Text validation avoids full decode without accepting binary/polyglot files.

## DOC-13 — Remove redundant document refetch after create/version upload

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** `create_document` and `upload_document_version` commit/refresh, then call `get_document_or_404` again.
- **Fix:** Use one explicit response loader only when relationships are needed, or refresh/load required relationships directly.
- **Acceptance:** Response shape stays correct without redundant default refetch.

## DOC-14 — Verify client-share listing duplicate fetch

- **Severity:** Medium
- **Assessment:** Needs verification.
- **Files:** document service/routes/tests.
- **Issue:** `list_document_client_shares` fetches the document internally; the route may already fetch it.
- **Fix:** If duplicated, pass the loaded document to the share-list function or split permission check from share query. If not duplicated, mark skipped.
- **Acceptance:** No duplicate document fetch remains in the share-listing path.

## DOC-15 — Harden OAuth return-path normalization

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** `_safe_return_path` does not reject null bytes or encoded slash/backslash/traversal patterns.
- **Fix:** Reject control/null bytes and encoded traversal, or decode once before validation. Keep dashboard-relative paths and the length cap.
- **Acceptance:** Open-redirect/confusing encoded return paths fail closed.

## DOC-16 — Use one document content-type policy map

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service/schema tests.
- **Issue:** `ALLOWED_DOCUMENT_CONTENT_TYPES` and `DOCUMENT_CONTENT_TYPES_BY_EXTENSION` can drift.
- **Fix:** Derive allowed content types from one `DOCUMENT_TYPE_POLICY` or from the extension map.
- **Acceptance:** Adding a document type requires one policy update.

## DOC-17 — Clarify client-share dedup target semantics

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** document service tests.
- **Issue:** Exact AND matching on contact/org/null may be intentional, but it cannot merge a share with both contact and org when later sharing to one side only.
- **Fix:** Decide exact tuple versus target-overlap semantics. Implement a named helper and tests for contact-only, org-only, and contact+org cases. Do not switch to OR unless product behavior requires it.
- **Acceptance:** Share deduplication semantics are explicit and tested.

## DOC-18 — Add document template and active-share indexes

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** document models/migration.
- **Issue:** Template lists and active portal share lookups need composite/partial indexes.
- **Fix:** Add `(tenant_id, is_template)` partial index where `deleted_at IS NULL`, plus active share indexes such as `(tenant_id, contact_id)` and `(tenant_id, organization_id)` where `revoked_at IS NULL`.
- **Acceptance:** Template and active-share queries have targeted indexes.

## DOC-19 — Encode OAuth state iat/exp as NumericDate

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** OAuth state uses datetime objects for JWT `iat`/`exp`.
- **Fix:** Use Unix timestamp ints with `int(now.timestamp())` and `int(exp.timestamp())`.
- **Acceptance:** State JWT claims are RFC-compatible NumericDate values.

## DOC-20 — Reduce redundant document query invalidations

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useDocuments.ts`.
- **Issue:** `useDocumentActions.invalidate` awaits multiple invalidations sequentially, and broad `["documents"]` invalidation already covers subkeys.
- **Fix:** Use the narrowest correct invalidation set. If multiple invalidations remain, run them with `Promise.all`.
- **Acceptance:** Mutations refresh needed document data without redundant rerender cycles.

## DOC-21 — Canonicalize document query keys

- **Severity:** Medium frontend
- **Assessment:** Partially valid. Current key normalizes several values, but a helper reduces mismatch risk.
- **Files:** `frontend/hooks/useDocuments.ts`.
- **Issue:** The list query key has many primitive positions; call-site differences can create unnecessary cache misses.
- **Fix:** Add `buildDocumentQueryParams` and `buildDocumentQueryKey` helpers, then use the same normalized object for URL construction and query key.
- **Acceptance:** Query key and URL use identical canonical values.

## DOC-22 — Memoize active client shares in document rows

- **Severity:** Low frontend
- **Assessment:** Valid but low ROI.
- **Files:** `frontend/components/documents/DocumentList.tsx`.
- **Issue:** `activeShares` is recomputed every render.
- **Fix:** Wrap in `useMemo` keyed on `document.client_shares`, or leave skipped if profiling shows no issue.
- **Acceptance:** No behavior change; row render work is reduced if implemented.

## DOC-23 — Verify download auth model for raw new-tab URLs

- **Severity:** Medium frontend/security
- **Assessment:** Needs verification.
- **Files:** `frontend/hooks/useDocuments.ts`, `frontend/components/documents/DocumentList.tsx`, document download routes.
- **Issue:** `window.open(documentVersionDownloadUrl(...))` only works if API auth is cookie-based; JWT-only auth would 401.
- **Fix:** Confirm auth transport. If bearer-only, fetch with `apiFetch`, create an object URL/blob, and trigger download; otherwise document the cookie requirement.
- **Acceptance:** Version/download buttons work under the production auth model.

## DOC-24 — Stream provider downloads instead of loading full bytes

- **Severity:** Low/Medium
- **Assessment:** Valid for larger files.
- **Files:** storage backends, document routes.
- **Issue:** Google Drive and OneDrive download methods return `response.content`, loading the whole file in memory.
- **Fix:** Use streaming provider responses and return `StreamingResponse` for cloud downloads where possible.
- **Acceptance:** Large cloud downloads do not require full file bytes in app memory.

## DOC-25 — Deduplicate list and cursor endpoint logic

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/routes/document_routes.py`, repository/service list helpers.
- **Issue:** `GET /documents` and `GET /documents/cursor` duplicate filters and can diverge; cursor lacks response model/sort parity.
- **Fix:** Extract shared filter/list parameter handling. Add a cursor response model if schema exists, or create one. Decide whether cursor supports sorting or always uses IDs.
- **Acceptance:** List/cursor behavior remains intentional and shared where possible.

## DOC-26 — Remove fragile `order_by(None)` from cursor query

- **Severity:** Low
- **Assessment:** Valid low-risk cleanup.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, tests.
- **Issue:** `list_documents_cursor` uses `.order_by(None).order_by(Document.id.desc())`.
- **Fix:** Build the cursor query without default ordering before applying `Document.id.desc()`, or document why clearing is necessary.
- **Acceptance:** Cursor ordering is deterministic without fragile order clearing.

## DOC-27 — Reduce heavy audit state on downloads

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** document service/activity log tests.
- **Issue:** `log_document_download` serializes the full document, including relationships, just for audit state.
- **Fix:** Log a slim after-state with document ID, title, current version, provider, and size.
- **Acceptance:** Download audit remains useful without loading/serializing full relationship graphs.

## DOC-28 — Handle provider-upload DB failure cleanup

- **Severity:** Medium
- **Assessment:** Valid extension of storage consistency.
- **Files:** document service/storage backends.
- **Issue:** A file/provider object can be stored before DB commit; if DB commit fails, storage may be orphaned.
- **Fix:** Add best-effort cleanup/delete to the storage backend interface or record orphan cleanup jobs. At minimum, catch DB `IntegrityError`, rollback, and log orphan cleanup metadata.
- **Acceptance:** DB failures after storage upload do not silently leak storage forever.

## DOC-29 — Add clean IntegrityError handling for document/version writes

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** Storage path/key uniqueness or version uniqueness conflicts can bubble as 500s.
- **Fix:** Wrap create/version commit paths in `try/except IntegrityError`, rollback, and return 409/400 with a useful message.
- **Acceptance:** User-fixable document write conflicts return clean 4xx.

## DOC-30 — Keep local-storage collision handling explicit

- **Severity:** Low
- **Assessment:** Valid housekeeping.
- **Files:** storage backend tests.
- **Issue:** Local filenames use `uuid4().hex`; collisions are extremely unlikely but not impossible.
- **Fix:** Use exclusive create (`xb`) or retry on existing filename before write.
- **Acceptance:** Local storage save is collision-safe without relying only on probability.

## Migration checklist additions

- DOC-02: replace global document/version storage uniqueness with scoped indexes/constraints after duplicate checks.
- DOC-18: add document template and active client-share partial/composite indexes.

## Test checklist additions

Backend:

- Document OAuth token refresh concurrency lock.
- Document deleted/include-deleted filtering and restore behavior.
- Document local storage canonical path and traversal rejection.
- Document unlinked access model.
- Document storage usage aggregate totals.
- Document OAuth state invalid-token handling and NumericDate claims.
- Document write conflict handling returns 4xx.

Frontend/manual:

- Documents mutations invalidate correct query keys without redundant sequential invalidations.
- Documents query key and URL params use the same canonical values.
- Document version/download buttons work with the production auth transport.

## Explicit audit wording corrections

- Do not blindly switch document client-share matching from AND to OR. First decide whether share identity is an exact `(contact_id, organization_id)` tuple or target-overlap matching, then implement tests.
- Do not overstate local document path traversal. The existing final containment guard is useful; the required cleanup is canonical path acceptance and removal of confusing prefix stripping.

Migration rules:

- Use reversible migrations where safe.
- Check/backfill existing data before adding constraints.
- Match partial-index predicates to actual soft-delete predicates exactly.
- Use `CREATE EXTENSION IF NOT EXISTS pg_trgm` or Alembic equivalent.

---

# Test checklist

Backend:

- Startup config validation for API and Celery worker.
- Access token tenant mismatch and malformed token behavior.
- Refresh-token reuse race.
- Cache prefix deletion via SCAN.
- Contract number concurrent create.
- Contract PATCH unrelated FK validation.
- Contract party/signer duplicate handling returns 4xx.
- Calendar concurrent booking slot submission.
- Calendar `/events/from-task/{task_id}` route order.
- Calendar slot generation query count/behavior.
- Catalog media upload rollback.
- Catalog slug reuse after soft delete.
- Catalog timezone-aware soft delete.

Frontend/manual:

- Contracts list refetches on page/sort/filter/search changes.
- Contracts table never renders `[object Object]`.
- Contract dialog rejects invalid IDs before submit.
- Calendar event dialog resets when selected event changes.
- Calendar event dialog validates end after start.
- Calendar sync bridge survives unavailable sessionStorage.
- Catalog dialog disabled state matches submit validation.
- Catalog create media failure shows “record created, media failed” path.
- Catalog service table filters product-only columns.
- Catalog delete uses app confirm dialog.

---

# Explicitly revised or rejected audit wording

1. Do not treat TanStack Query string instances as unstable by identity. Fix missing or changing values in keys, not string object identity.
2. Do not claim trigram indexes cannot support `LIKE`/`ILIKE`. PostgreSQL `pg_trgm` can support these; the real issue is missing indexes.
3. Do not batch-preflight every FK by default. Prefer DB constraints plus targeted tenant ownership checks and clean `IntegrityError` translation.
4. Do not blindly migrate SmallInteger booleans. Serializer/validator hardening is lower risk; physical Boolean migration is optional.
5. Do not invent client-portal fixes. Add concrete tasks only after locating the missing client-portal audit text or completing a focused audit.

---

# PR summary template

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

# Finance Module Codex Task Plan

_Last updated: 2026-06-22_

This document converts the finance-module review into Codex-ready implementation tasks after checking the current repository. It covers insertion orders, POS invoices, repositories, routes, schemas, and finance frontend components.

## Verification summary

Confirmed/high-merit issues in the current codebase:

- `io_search_services.py` imports both `datetime` and `date`, uses `datetime.utcnow()` for defaults and soft delete, and annotates `parse_human_date` as `datetime.date | None` even though `datetime` is the imported class, not the module.
- Insertion order create/update split main record persistence and custom-field persistence across two commits.
- Insertion order serialization substitutes fallback dates for null `issue_date`, `effective_date`, and `due_date`.
- `IO_SEARCH_UPLOAD_DIR` is required at import time and can break unrelated finance imports.
- Insertion order CSV import parses the uploaded CSV twice and expires the full SQLAlchemy session inside per-row error handling.
- `get_downloadable_insertion_order` does not filter by tenant_id.
- POS invoice uniqueness ignores soft-deleted invoices, while the DB unique index is not partial.
- POS invoice create/update audit logs run after the mutation commit.
- POS invoice line updates delete/reinsert all lines.
- POS invoice tax rate has no upper bound.
- Finance list/count queries can do unnecessary ranked-search work.
- Insertion order list field gating is weakened by a hardcoded safe field expansion.
- Insertion order file downloads always use the DOCX MIME type.
- Frontend finance hooks and dialogs contain several cache, date, validation, and stale-search issues.

Partially valid or corrected findings:

- The claimed `io_search_api.py` `NameError` for `_finance_record_status` is not confirmed in the current fetched file; the helpers called in `io_search_api.py` are imported or not present in the visible overdue path. Treat this as a targeted verification task, not an assumed production bug.
- The claimed FastAPI route conflict for `POST /insertion-orders/import` is overstated because no `POST /insertion-orders/{io_id}` route exists. Static import/export routes are still better placed before dynamic routes to avoid future regressions.
- `useInsertionOrders` delegates pagination/search/filter state to `usePagedList`; the bare `queryKey` is only a problem if `usePagedList` does not append those dimensions internally. Verify before changing.
- React Query query keys are hashed structurally, so a sort object is not automatically unstable just because it is an object. Stabilize only if profiling/consumer code recreates problematic keys.

## Recommended implementation order

1. Correctness/security: FIN-01 to FIN-05, FIN-09, FIN-14, FIN-16, FIN-18, FIN-21, FIN-28, FIN-31, FIN-37.
2. Transaction/audit consistency: FIN-04, FIN-05, FIN-21, FIN-29.
3. Performance/scalability: FIN-11 to FIN-13, FIN-19, FIN-20, FIN-24, FIN-26, FIN-27.
4. Route/schema/API polish: FIN-25, FIN-31 to FIN-38.
5. Frontend cache/validation/UX: FIN-39 to FIN-49.

---

## FIN-01 — Replace naive UTC timestamps in finance services

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/finance/services/io_search_services.py`, `backend/app/modules/finance/services/pos_invoice_services.py`, tests.
- **Issue:** Insertion order and POS invoice services use `datetime.utcnow()` for issue-date defaults and soft delete timestamps.
- **Fix:** Use `datetime.now(timezone.utc)` for timestamp columns. For `Date` columns, use `datetime.now(timezone.utc).date()` or `date.today()` if business-local date semantics are desired.
- **Tests:** Soft deletes store timezone-aware timestamps; default issue dates remain date-only and do not regress.
- **Done when:** No finance service uses `datetime.utcnow()`.

## FIN-02 — Fix `parse_human_date` return annotation

- **Severity:** Critical/type-check correctness
- **Assessment:** Valid.
- **Files:** `backend/app/modules/finance/services/io_search_services.py`.
- **Issue:** `parse_human_date` is annotated as `datetime.date | None`, but `datetime` is imported as the class. This annotation is wrong/confusing.
- **Fix:** Change to `date | None`; keep `from __future__ import annotations` behavior safe for runtime.
- **Tests:** Static type checking or import smoke test passes.
- **Done when:** Date parser signature accurately reflects returned values.

## FIN-03 — Stop serializing fake fallback dates for insertion orders

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `io_search_services.py`, API response tests.
- **Issue:** `_serialize_finance_record_state` serializes `issue_date` as `record.issue_date or record.created_at`, `effective_date` as `record.effective_date or record.start_date`, and `due_date` as `record.due_date or record.end_date`.
- **Fix:** Serialize `None` when the actual field is null. If UI needs display fallbacks, compute them in a separate display-only field, not the canonical API field.
- **Tests:** Null date fields remain null after round-trip create/update/list/detail serialization.
- **Done when:** API responses no longer imply dates that are not stored.

## FIN-04 — Make insertion order create transaction atomic with custom fields

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `io_search_services.py`, custom-field tests.
- **Issue:** `create_insertion_order` commits the finance record, then saves custom fields, then commits again. A crash after the first commit creates a partially persisted record.
- **Fix:** Use one transaction. Add record, flush to get ID, save custom fields, log if needed, then commit once. On `IntegrityError`, rollback the whole transaction and return a clean 409/400.
- **Done when:** Record and custom fields commit or rollback together.

## FIN-05 — Make insertion order update transaction atomic with custom fields

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `io_search_services.py`, tests.
- **Issue:** `update_insertion_order` commits record changes before custom fields, then commits custom fields separately.
- **Fix:** Same pattern as FIN-04: validate payload, mutate record, save custom fields, flush/commit once.
- **Done when:** Update and custom-field changes cannot be split by a crash.

## FIN-06 — Simplify finance customer-name helper

- **Severity:** Low
- **Assessment:** Valid readability issue.
- **Files:** `io_search_services.py`.
- **Issue:** `_finance_record_customer_name` builds a joined string via repeated `getattr` fallbacks. Behavior is correct but noisy.
- **Fix:** Extract a clear helper for contact display name and organization display name.
- **Done when:** Same output with simpler readable code.

## FIN-07 — Harden insertion order filename sanitization

- **Severity:** Low/Medium
- **Assessment:** Valid hardening.
- **Files:** `io_search_services.py`, tests.
- **Issue:** `Path(file_name).name` strips directories, but the remaining stem can still contain suspicious repeated-dot patterns.
- **Fix:** After taking `Path(...).name`, collapse repeated dots in the stem, strip control chars, and keep a safe non-empty fallback filename.
- **Done when:** Filenames such as `../foo..bar.docx` become safe basename-only values.

## FIN-08 — Lazily resolve `IO_SEARCH_UPLOAD_DIR`

- **Severity:** Low/Medium operational
- **Assessment:** Valid.
- **Files:** `io_search_services.py`, `io_search_api.py`, config docs/tests.
- **Issue:** Missing `IO_SEARCH_UPLOAD_DIR` raises at module import time, breaking unrelated finance routes/imports.
- **Fix:** Replace module-level mandatory env read with a helper/lazy singleton, e.g. `get_io_search_upload_dir()`, and call it only in upload/download paths. Return a clean 500/config error if a file path operation needs the missing config.
- **Done when:** App can import finance modules without this env var unless file storage functionality is invoked.

## FIN-09 — Harden insertion order download path resolution

- **Severity:** Critical
- **Assessment:** Valid with correction: current containment check is good and returns a generic detail, but absolute DB paths and symlink/root drift should be handled explicitly.
- **Files:** `io_search_api.py`, storage tests.
- **Issue:** `_resolve_io_download_path` accepts `record.file_path` directly, resolves it, and checks containment. Absolute stored paths outside the root are rejected, but the path should be treated as invalid data earlier and logged server-side.
- **Fix:** Store only relative paths going forward. Reject absolute `record.file_path` values with a generic client error, log internal details, and resolve relative paths against the current lazy upload root.
- **Done when:** DB-stored paths cannot escape the configured upload root and errors do not expose filesystem layout.

## FIN-10 — Verify private helper imports in `io_search_api.py`

- **Severity:** Medium/High if confirmed
- **Assessment:** Not confirmed from the fetched current file.
- **Files:** `io_search_api.py`, tests around overdue event emission.
- **Issue:** Audit claims `_finance_record_status`, `_finance_record_customer_name`, `_date_to_iso`, and `_finance_record_currency` may be referenced without import. Current fetched import list includes `_serialize_finance_record_state/response` and not all private helpers.
- **Fix:** Run/import test for overdue event paths. If missing helper references exist, import explicit helpers or move overdue event construction into `io_search_services.py` with a public function.
- **Done when:** Overdue-event paths have a regression test and no private-helper `NameError` risk.

## FIN-11 — Parse insertion order CSV imports in one pass

- **Severity:** High performance
- **Assessment:** Valid.
- **Files:** `io_search_api.py`, import tests.
- **Issue:** `import_insertion_orders_csv_bytes` iterates the CSV once to collect IO numbers and again to build `prepared_rows`.
- **Fix:** Build preliminary prepared row metadata and collect IO numbers in one pass. Then fetch existing rows and annotate prepared rows with duplicates before chunk processing.
- **Done when:** CSV bytes are decoded/parsed once for import execution.

## FIN-12 — Move `db.expire_all()` out of per-row import exception handling

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `io_search_api.py`, import tests.
- **Issue:** `_process_insertion_order_import_chunk` calls `db.expire_all()` inside the per-row exception handler while other row objects may still be used.
- **Fix:** Avoid full-session expiration inside the loop. Use `db.rollback()`/savepoint rollback semantics only for the failed row, or call `expire_all()` after the chunk loop if still needed.
- **Done when:** One failed import row does not expire unrelated objects mid-chunk.

## FIN-13 — Verify export streaming behavior for insertion orders

- **Severity:** Medium
- **Assessment:** Needs verification.
- **Files:** `io_search_api.py`, `backend/app/core/module_export.py`.
- **Issue:** `export_generic_insertion_orders` reportedly uses `yield_per(500)` with `dict_rows_to_csv_file`. Benefit depends on whether the CSV helper streams or materializes rows.
- **Fix:** Inspect `dict_rows_to_csv_file`. If it materializes the generator, rewrite export to chunk rows directly to file. If it already streams, document and mark as no-op.
- **Done when:** Export memory scales with batch size, not full result size.

## FIN-14 — Add tenant filter to insertion order file downloads

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `io_search_api.py`, download authorization tests.
- **Issue:** `get_downloadable_insertion_order` filters by `module_id`, `io_number`, and deleted/user scope, but not `tenant_id`.
- **Fix:** Add `FinanceIO.tenant_id == current_user.tenant_id` to the query.
- **Done when:** A tenant cannot download another tenant's file by guessing `io_number`.

## FIN-15 — Avoid repeated overdue invoice events on every save

- **Severity:** Medium
- **Assessment:** Needs confirmation of current event path.
- **Files:** `io_search_api.py`, event/audit models if needed.
- **Issue:** Audit claims overdue events emit immediately after create/update and can repeat on every save.
- **Fix:** If confirmed, emit on transition only: add `last_overdue_event_at`, use an activity-log existence check, or emit only in a scheduled overdue scanner.
- **Done when:** Updating an already-overdue IO does not flood duplicate overdue events.

## FIN-16 — Ignore soft-deleted POS invoices in invoice-number uniqueness checks

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`, tests.
- **Issue:** `_validate_invoice_number` does not filter `deleted_at IS NULL`, so a soft-deleted invoice blocks reuse at service validation.
- **Fix:** Add `FinancePosInvoice.deleted_at.is_(None)` to uniqueness validation.
- **Done when:** Soft-deleted invoice numbers can be reused if the DB index also allows it.

## FIN-17 — Add conflict-retry guard for SQLite POS invoice numbering

- **Severity:** Medium/High in tests/dev
- **Assessment:** Valid but mostly test/dev because PostgreSQL uses a sequence.
- **Files:** `pos_invoice_services.py`, SQLite tests.
- **Issue:** SQLite branch uses `MAX(id) + 1` and can duplicate under concurrent test/dev requests.
- **Fix:** Keep PostgreSQL sequence path. For SQLite, catch invoice-number uniqueness conflict and retry a bounded number of times or switch test numbering to a dedicated in-memory counter under test isolation.
- **Done when:** SQLite tests cannot silently create duplicate invoice numbers.

## FIN-18 — Use aware UTC timestamp for POS soft delete

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`, tests.
- **Issue:** `soft_delete_invoice` uses `datetime.utcnow()`.
- **Fix:** Use `datetime.now(timezone.utc)`.
- **Done when:** POS soft deletes write timezone-aware timestamps.

## FIN-19 — Add direct POS invoice get-by-id repository path

- **Severity:** High performance
- **Assessment:** Valid.
- **Files:** `pos_invoice_repository.py`, `pos_invoice_services.py`, tests.
- **Issue:** `get_invoice` calls `build_invoice_query`, which applies ranked search plumbing even for direct ID lookup.
- **Fix:** Add `get_invoice_by_id` filtering by tenant, id, deleted state, and finance user scope only. Keep relationship loading as required for serialization.
- **Done when:** Direct invoice get/update/delete bypasses search ranking logic.

## FIN-20 — Diff POS invoice lines instead of delete/reinsert all

- **Severity:** High performance/data stability
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`, line tests.
- **Issue:** `_apply_lines` sets `invoice.lines = []`, causing delete-orphan/reinsert on every line update.
- **Fix:** Match incoming lines by `id`; update changed lines, add new lines, delete removed lines, and recalculate sort order/totals.
- **Done when:** Updating invoice header fields does not churn all line rows.

## FIN-21 — Make POS invoice audit logging transactional

- **Severity:** High audit integrity
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`, activity log tests.
- **Issue:** `create_invoice`, `update_invoice`, and `soft_delete_invoice` call `log_activity` after committing the invoice mutation.
- **Fix:** Use `db.flush()` to obtain IDs, write activity log in the same transaction, then commit once. If log fails, rollback mutation too.
- **Done when:** Invoice mutation and audit log are atomic.

## FIN-22 — Cap POS invoice tax rate

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`, `schema.py`, tests.
- **Issue:** `tax_rate` is only constrained as non-negative; values like `9999` create nonsensical totals.
- **Fix:** Add schema and service cap, for example `le=100`, unless product explicitly supports higher tax-like multipliers.
- **Done when:** `tax_rate > 100` returns 422/400.

## FIN-23 — Document balance clamping behavior

- **Severity:** Low
- **Assessment:** Valid but acceptable design.
- **Files:** `pos_invoice_services.py`, schema/API docs/tests.
- **Issue:** `serialize_invoice` computes `balance_due = max(0, total - paid)`, so overpayment is hidden in `balance_due`.
- **Fix:** Document this behavior and optionally expose `overpaid_amount` if needed. Add a test that overpaid invoices show `balance_due=0`.
- **Done when:** Clamping behavior is intentional and tested.

## FIN-24 — Delete dead duplicate POS invoice query function

- **Severity:** Medium cleanup
- **Assessment:** Valid.
- **Files:** `pos_invoice_services.py`.
- **Issue:** `_query_invoices` duplicates repository `build_invoice_query` and appears unused.
- **Fix:** Remove `_query_invoices` and unused imports used only by it.
- **Done when:** There is one invoice query builder.

## FIN-25 — Confirm cursor response slices `limit + 1` sentinels

- **Severity:** Medium if false
- **Assessment:** Needs verification.
- **Files:** `backend/app/core/cursor_pagination.py`, `pos_invoice_routes.py`, IO cursor routes.
- **Issue:** Cursor repositories return `limit + 1` rows. The route passes all to `build_cursor_response`.
- **Fix:** Verify `build_cursor_response` slices to `limit`. If not, fix centrally so sentinel rows are never returned.
- **Done when:** Cursor response never includes the sentinel row.

## FIN-26 — Strip ordering/ranking from IO count queries

- **Severity:** Medium/High performance
- **Assessment:** Valid.
- **Files:** `io_repository.py`, query tests if available.
- **Issue:** `list_insertion_orders` calls `query.count()` after search/ranking defaults may have been applied.
- **Fix:** Use `query.order_by(None).count()` or a count-specific query path that avoids ranking/order expressions.
- **Done when:** Count queries do not pay sort/rank cost unnecessarily.

## FIN-27 — Avoid hydrating custom fields for cursor sentinel row

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `io_repository.py`, cursor tests.
- **Issue:** `list_insertion_orders_cursor` fetches `limit + 1` records and hydrates custom fields for all of them, including the sentinel.
- **Fix:** Fetch `limit + 1`, compute `has_more`, hydrate only records returned to client. If `build_cursor_response` must receive the sentinel, add a wrapper that carries the sentinel without hydrating it.
- **Done when:** Custom field hydration excludes discarded cursor sentinel rows.

## FIN-28 — Make POS invoice-number uniqueness partial for active rows

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `models.py`, Alembic migration.
- **Issue:** `ix_finance_pos_invoices_tenant_number` is a plain unique index and blocks invoice-number reuse after soft delete.
- **Fix:** Replace with partial unique index on `(tenant_id, invoice_number)` where `deleted_at IS NULL`, matching service fix FIN-16. Handle existing duplicate/deleted data in migration notes.
- **Done when:** DB and service both allow reuse after soft delete but prevent active duplicates.

## FIN-29 — Simplify FinanceIO custom-field property surface

- **Severity:** Low
- **Assessment:** Valid cleanup.
- **Files:** `models.py`, serializers/tests.
- **Issue:** `FinanceIO` exposes both `custom_data` and `custom_fields`, delegating to the same runtime cache.
- **Fix:** Prefer one internal property, likely `custom_data`, and map to API `custom_fields` at the serializer boundary. If removing `custom_fields` is too risky, mark deprecated and stop new internal use.
- **Done when:** Internal custom-field access has one canonical property.

## FIN-30 — Document implicit tenancy of POS invoice lines

- **Severity:** Low
- **Assessment:** Valid but not urgent.
- **Files:** `models.py`, developer docs/reporting code.
- **Issue:** `FinancePosInvoiceLine` has no `tenant_id`; tenancy is inherited through parent invoice.
- **Fix:** Document that direct line reporting must join invoices for tenant filtering. Add `tenant_id` only if reporting/query volume justifies denormalization.
- **Done when:** No direct line query can be written without clear tenant guidance.

## FIN-31 — Validate insertion order status at schema/service boundary

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `schema.py`, `io_search_services.py`, import path tests.
- **Issue:** `InsertionOrderBase.status` is plain `str = "draft"`; invalid statuses pass schema and only fail at DB constraint.
- **Fix:** Use `Literal` or a shared allowed-status validator for create/update/import paths.
- **Done when:** Invalid IO status returns 422/400 before DB commit.

## FIN-32 — Treat `create_customer_if_missing` as write-only action flag

- **Severity:** Medium
- **Assessment:** Valid hardening.
- **Files:** `schema.py`, service payload handling.
- **Issue:** `create_customer_if_missing` is an action flag, not persisted data. Future refactors could accidentally pass it into generic update loops.
- **Fix:** Pop/consume it explicitly at service boundary. Consider `Field(exclude=True)` only if it does not break intended `model_dump` behavior needed by service.
- **Done when:** The flag cannot leak into persisted model fields.

## FIN-33 — Tighten `InsertionOrderListItem.io_number` typing

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `schema.py`, route serializer.
- **Issue:** `FinanceIO.io_number` is non-null, but `InsertionOrderListItem.io_number` is optional.
- **Fix:** Make `io_number: str` unless field-gated sparse list responses intentionally omit it. If field gating can omit it, document that list items are partial and keep optional.
- **Done when:** Schema matches either DB reality or explicit sparse-field behavior.

## FIN-34 — Align POS invoice update route with PATCH semantics

- **Severity:** Medium/High API clarity
- **Assessment:** Valid.
- **Files:** `pos_invoice_routes.py`, frontend hook, tests.
- **Issue:** `PUT /pos-invoices/{invoice_id}` uses `model_dump(exclude_unset=True)`, so it behaves like PATCH.
- **Fix:** Either change route to `PATCH` and update frontend, or implement full PUT replacement semantics. Prefer adding PATCH while keeping PUT as backward-compatible alias initially.
- **Done when:** HTTP method semantics match update behavior.

## FIN-35 — Deduplicate POS invoice cursor serialization

- **Severity:** Low
- **Assessment:** Valid cleanup.
- **Files:** `pos_invoice_routes.py`, `pos_invoice_services.py`.
- **Issue:** Cursor route has inline list-comprehension serialization separate from paged route.
- **Fix:** Add a service helper for list item serialization.
- **Done when:** Paged and cursor list serialization share one path.

## FIN-36 — Add finance route-order regression test and optionally reorder static routes

- **Severity:** Low/Medium
- **Assessment:** Original conflict is overstated; no current POST dynamic route intercepts `/insertion-orders/import`.
- **Files:** `io_search_routes.py`, route tests.
- **Issue:** Static import/export routes are declared after dynamic GET/PUT/DELETE routes. While not currently breaking POST imports, this is fragile if future dynamic POST routes are added.
- **Fix:** Move static routes (`/import`, `/import/preview`, `/export`, `/files/{io_number}`) before `/{io_id}` routes, or at least add route tests proving import/export endpoints resolve correctly.
- **Done when:** Static route behavior is protected against future dynamic route conflicts.

## FIN-37 — Respect insertion order field gating in list serialization

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `io_search_routes.py`, field-gating tests.
- **Issue:** `_serialize_insertion_order_list_item` expands requested/enabled fields with a hardcoded set including amounts, notes, custom fields, and other fields, weakening field-level gating.
- **Fix:** Remove broad `safe_fields.update(...)`. Always include only minimal required identifiers and fields explicitly requested/enabled. If some fields are mandatory for UI, document and whitelist narrowly.
- **Done when:** Disabled or unrequested fields do not appear in list responses.

## FIN-38 — Serve insertion order downloads with correct MIME type

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `io_search_routes.py`, download tests.
- **Issue:** Download route hardcodes DOCX MIME type for every insertion order file.
- **Fix:** Use `mimetypes.guess_type(file_name)` with explicit `.pdf` and `.docx` fallbacks. Preserve safe content disposition.
- **Done when:** PDF downloads are served as `application/pdf` and DOCX as DOCX MIME.

## FIN-39 — Verify `usePagedList` includes IO pagination/filter/sort state in query keys

- **Severity:** Medium/High if false
- **Assessment:** Needs verification.
- **Files:** `frontend/hooks/finance/useInsertionOrders.ts`, `frontend/hooks/usePagedList.ts`.
- **Issue:** `useInsertionOrders` passes `queryKey: ["insertion-orders"]` to `usePagedList`; the audit says pagination/filter/sort state may be omitted.
- **Fix:** Inspect `usePagedList`. If it does not append page/pageSize/filter/column/sort dimensions, update it or pass a composed key. If it already does, add a comment/test and skip changes.
- **Done when:** Changing page, page size, filters, visible columns, or sort produces the correct query/cache behavior.

## FIN-40 — Narrow sales-organization invalidation after IO mutations

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `useInsertionOrders.ts`.
- **Issue:** Create/update invalidates `sales-organizations` on every IO mutation even when no organization was created/linked.
- **Fix:** Invalidate `sales-organizations` only when `create_customer_if_missing` is true or when organization-related fields changed.
- **Done when:** IO saves no longer trigger unrelated organization refetches by default.

## FIN-41 — Verify POS invoice sort query-key stability

- **Severity:** Low/Medium
- **Assessment:** Partially valid. React Query hashes query keys structurally, so object references alone are not necessarily a bug.
- **Files:** `usePosInvoices.ts`, consuming components.
- **Issue:** `queryKey` includes `sort` object.
- **Fix:** Verify with current TanStack Query behavior and component code. If needed, key by primitives: `sort?.key ?? "", sort?.direction ?? ""`.
- **Done when:** Sort changes refetch correctly without render-loop refetches.

## FIN-42 — Improve POS invoice frontend error fallback

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `usePosInvoices.ts`.
- **Issue:** Error parsing uses `res.json().catch(() => null)` and fallback `Failed with ${res.status}`.
- **Fix:** Include `res.statusText` where available, e.g. `Failed with ${res.status}: ${res.statusText}`.
- **Done when:** Non-JSON errors surface more useful messages.

## FIN-43 — Compute POS invoice dialog default date at open time

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `PosInvoiceDialog.tsx`.
- **Issue:** `today` is computed at module load time. If the module stays loaded across midnight, new dialogs can default to yesterday.
- **Fix:** Compute current date inside `toHeaderForm` or the open-state effect.
- **Done when:** New invoice issue date is current on every dialog open.

## FIN-44 — Reject zero/invalid POS line values before submit

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `PosInvoiceDialog.tsx`, backend schema/service.
- **Issue:** `handleSubmit` maps invalid quantities/prices with `Math.max(0, Number(...) || 0)`. Invalid/blank quantity becomes 0 and is rejected only by backend.
- **Fix:** Validate before submit: quantity must be > 0 and unit price >= 0. Show an inline error and do not submit invalid lines.
- **Done when:** User gets client-side validation before backend rejection.

## FIN-45 — Remove or accept no-op memo around invoice totals

- **Severity:** Low
- **Assessment:** Valid but low value.
- **Files:** `PosInvoiceDialog.tsx`.
- **Issue:** `InvoiceTotalsSummary` is memoized even though totals object changes when totals change.
- **Fix:** Remove `memo()` for clarity unless profiling shows benefit.
- **Done when:** Component code is simpler with no behavior change.

## FIN-46 — Clear stale insertion-order customer search state on unlink

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `insertionOrderDialog.tsx`.
- **Issue:** After unlinking a selected contact, the existing search value can immediately re-enable the customer query and show stale results.
- **Fix:** On unlink, clear or reset `customer_name`/search state intentionally, or close the dropdown and require explicit user input.
- **Done when:** Unlinking a customer does not show stale previous search results unexpectedly.

## FIN-47 — Reuse one contact display-name utility in IO dialog

- **Severity:** Low/Medium
- **Assessment:** Partially valid.
- **Files:** `insertionOrderDialog.tsx`, shared frontend utility if available.
- **Issue:** `hasExactCustomerMatch` and option rendering build names inline from first/last name. Behavior is mostly okay, but duplicated and fragile.
- **Fix:** Extract `contactDisplayName(option)` and use it for option label, selected value, and exact-match comparison. Include email fallback.
- **Done when:** Contact matching/rendering uses one consistent display-name function.

## FIN-48 — Compare insertion order due dates as dates, not datetimes

- **Severity:** Medium
- **Assessment:** Needs path verification; include if `isDuePast` exists in current list component.
- **Files:** insertion order list component.
- **Issue:** Audit reports `new Date(dateStr) < new Date()` for date-only strings. This can mark today as past due depending on time comparison semantics.
- **Fix:** Compare ISO date strings (`dateStr < todayIso`) or compare both at date precision.
- **Done when:** Due date equal to today is not considered past due until the business rule says it should be.

## FIN-49 — Make imported IO status styling explicit

- **Severity:** Low
- **Assessment:** Needs path verification; valid UX polish if current switch omits `imported`.
- **Files:** insertion order list component.
- **Issue:** `imported` is a valid IO status and reportedly falls through to default border styling.
- **Fix:** Add explicit `imported` case or document default neutral style.
- **Done when:** Every valid IO status has intentional visual styling.

---

## Migration checklist

- FIN-28: replace `ix_finance_pos_invoices_tenant_number` with a partial unique index on active invoices only.
- FIN-15: if using a column to prevent repeated overdue events, add `last_overdue_event_at` to `finance_io`.
- FIN-30: no migration unless deciding to denormalize `tenant_id` onto POS invoice lines.

## Test checklist

Backend:

- Finance services import without `IO_SEARCH_UPLOAD_DIR` when upload/download paths are not used.
- `parse_human_date` handles ISO, month/year, invalid dates, and returns `date | None`.
- Insertion order null date fields serialize as null.
- Insertion order create/update and custom fields commit atomically.
- Insertion order download requires tenant match and rejects absolute/out-of-root paths.
- CSV import parses once, handles duplicate IO numbers, and does not expire unrelated row state on one row failure.
- POS invoice soft-deleted number reuse works with service and DB constraints.
- POS invoice tax rate > 100 is rejected.
- POS invoice create/update/delete logs are transactional.
- POS invoice direct get-by-id bypasses ranked search.
- Cursor responses do not return sentinel rows.
- Field-gated insertion order list responses do not include disabled fields.
- Static finance import/export/download routes resolve correctly.

Frontend/manual:

- IO pagination/filter/sort/cache behavior works after changing each input.
- IO create/update only invalidates sales organizations when relevant.
- POS invoice dialog default issue date updates after midnight/open time.
- POS invoice line validation blocks invalid quantities/prices before submit.
- Insertion order unlink behavior does not display stale customer search results.
- Due-date badges treat today correctly.
- Imported IO status styling is intentional.

## Explicit audit corrections

- Do not assume `POST /insertion-orders/import` is currently shadowed by a dynamic `POST /insertion-orders/{io_id}` route. No such dynamic POST route is present in the fetched route file. Add a regression test/reorder for future safety, not as a confirmed current outage.
- Do not assume React Query treats sort-object query keys by reference only. TanStack Query hashes query keys structurally; verify with current consumer behavior before rewriting.
- Do not assume `useInsertionOrders` has a broken static key until `usePagedList` is inspected. The wrapper may compose the full key internally.
- Do not remove POS invoice balance clamping unless product wants explicit overpayment display. Current behavior can be valid if documented and tested.
