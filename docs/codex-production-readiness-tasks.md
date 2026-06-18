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

The available uploaded audit text did not include a concrete client-portal issue list. The repository does include client portal routes, so use this section as a verification gate and do not invent speculative fixes.

## CP-01 — Reconcile missing client-portal audit notes before editing

- **Severity:** Needs verification
- **Files:** `backend/app/modules/client_portal/**`, frontend client portal paths, any later supplied audit source
- **Issue:** User indicated client portal audit text exists, but no concrete client-portal findings were available in the loaded audit text used for this plan.
- **Fix:** Search issue/PR context for client-portal audit notes before coding. If found, add tasks in this same format. If not found, skip speculative client-portal edits.
- **Done when:** Client portal work is based on actual findings, not assumptions.

## CP-02 — Smoke-test client portal after core hardening

- **Severity:** Depends on core tasks
- **Files:** client portal backend routes and frontend pages
- **Issue:** Core CORS, tenant cache, auth, pagination, and media behavior affect client portal flows.
- **Fix:** After CORE tasks, smoke-test client portal auth, public pages, bookings, catalog, documents, messages, orders, quotes, overview, and support routes.
- **Done when:** Core security/cache changes do not break legitimate portal origins or tenant resolution.

---

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
