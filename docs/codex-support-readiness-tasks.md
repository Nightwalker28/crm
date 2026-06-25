# Support Module Codex Task Plan

_Last updated: 2026-06-22_

This document converts the support-functionality review into Codex-ready implementation tasks after checking the current repository. It covers support cases, comments, events, client portal support flows, schemas, indexes, and frontend support pages/hooks.

## Verification summary

Confirmed in the current codebase:

- `_generate_case_number` uses `CASE-YYYYMMDD` plus `COUNT + 1`; this is not safe under concurrent creates.
- `SupportCase` has no unique constraint on `(tenant_id, case_number)`.
- Admin and client case create paths flush, record an event, commit, then re-fetch by captured ID.
- Comment/status helper commits are missing rollback guards.
- `SupportCaseUpdateRequest` exposes `first_response_at`, and `update_support_case` applies payload fields before status timestamp logic.
- Linked-record validation can perform separate queries for contact, account, deal, quote, order, and assignee.
- List and summary endpoints use separate count/aggregate queries that can be optimized.
- Client portal case serialization loads all comments then filters internal comments in Python.
- Client source matching is case-sensitive.
- Support detail page uses raw `apiFetch` state instead of React Query and fully reloads after comments.
- Create dialog invalidates the list cache but not the summary cache.
- `useSupportCases` accepts visible columns but does not send a `fields=` param.

Corrections to the audit:

- `datetime.now(timezone.utc)` is not deprecated; it is the correct aware UTC pattern. The improvement is computing one timestamp per operation.
- `useSupportCases` is not missing page/filter/sort dimensions in the final query key because `usePagedList` appends them internally.
- Bulk list routes currently use `SupportCaseListItem`, not the heavy `SupportCaseResponse`, so the nested comments/events issue is a regression guard.

## Recommended implementation order

1. Critical correctness: SUP-01 to SUP-05.
2. Transaction and SLA integrity: SUP-06 to SUP-09.
3. Backend performance and indexes: SUP-10 to SUP-16.
4. API/schema polish: SUP-17 to SUP-22.
5. Frontend support UX/cache cleanup: SUP-23 to SUP-30.

---

## SUP-01 — Replace non-atomic support case number generation

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/support/services/cases_services.py`, model/migration/tests.
- **Issue:** `_generate_case_number` uses a date prefix plus count suffix. Concurrent creates can generate the same number.
- **Fix:** Implement an atomic allocator: PostgreSQL sequence, tenant/date counter table with row lock, or `INSERT ... ON CONFLICT DO UPDATE RETURNING`. Compute the prefix timestamp once per create.
- **Done when:** Concurrent admin/client case creation produces unique case numbers.

## SUP-02 — Add DB uniqueness for tenant case numbers

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/support/models.py`, Alembic migration.
- **Issue:** `case_number` is indexed but not unique per tenant.
- **Fix:** Add `UniqueConstraint('tenant_id', 'case_number', name='uq_support_cases_tenant_case_number')`. Add clean `IntegrityError` handling and retry where numbers are generated automatically.
- **Done when:** The DB enforces per-tenant case-number uniqueness.

## SUP-03 — Simplify support case create transaction and return path

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `cases_services.py`, tests.
- **Issue:** Create helpers flush, record event, commit, then call `get_case_or_404` with the captured ID.
- **Fix:** Add case and event in one transaction, flush, commit, refresh the same ORM object, and return it. Avoid post-commit re-fetch solely to recover the created row.
- **Done when:** Create paths commit atomically and return the created case predictably.

## SUP-04 — Add rollback guards around support comment/status commits

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `cases_services.py`, tests.
- **Issue:** `add_case_comment`, `add_client_support_case_comment`, and `update_client_support_case_status` call `db.commit()` without `IntegrityError` rollback handling.
- **Fix:** Wrap commits in `try/except IntegrityError`, rollback, and return clean 4xx errors.
- **Done when:** Failed comment/status writes do not leave a dirty DB session.

## SUP-05 — Protect SLA lifecycle fields from direct client writes

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `schema.py`, `cases_services.py`, route tests.
- **Issue:** `SupportCaseUpdateRequest` exposes `first_response_at`. `update_support_case` also assigns payload fields before service-owned timestamp logic.
- **Fix:** Remove `first_response_at` from client update schema. Drop/ignore `first_response_at`, `resolved_at`, and `closed_at` in update payloads unless a separate internal/admin endpoint intentionally supports them.
- **Done when:** SLA lifecycle timestamps are controlled by service logic only.

## SUP-06 — Rework status timestamp transition logic

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `cases_services.py`, tests.
- **Issue:** Generic `setattr` runs before resolved/closed timestamp logic.
- **Fix:** Filter service-owned timestamp fields before assignment, then apply transition-specific updates for `resolved`, `closed`, and reopened statuses.
- **Done when:** Status changes produce consistent `resolved_at` and `closed_at` behavior.

## SUP-07 — Narrow linked-record existence checks

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `cases_services.py`.
- **Issue:** `_ensure_linked_records` can run one query per linked field.
- **Fix:** On partial updates, validate only fields present in the payload. Batch lookups or cache request-local existence checks where practical.
- **Done when:** Updating one support field does not re-check unrelated linked records.

## SUP-08 — Normalize support case source values

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `cases_services.py`, optional model constraint.
- **Issue:** Client scope compares `SupportCase.source == 'client_portal'` exactly.
- **Fix:** Normalize source values on write and compare normalized values, for example with `func.lower` or a constrained enum/check.
- **Done when:** Client portal cases match consistently regardless of source casing.

## SUP-09 — Use one timestamp per logical support operation

- **Severity:** Low/Medium
- **Assessment:** Corrected audit item.
- **Files:** `cases_services.py`.
- **Issue:** `datetime.now(timezone.utc)` is correct, but multiple `now` calls in one operation can create small inconsistencies.
- **Fix:** Compute `now` once per create/update/comment/status operation and pass it through.
- **Done when:** A single operation uses one coherent timestamp.

## SUP-10 — Optimize support case list count/fetch pattern

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `cases_services.py`.
- **Issue:** `list_support_cases` uses `query.count()` plus a separate paged fetch.
- **Fix:** Add a count-specific query with ordering stripped, or use a window-count query if supported cleanly.
- **Done when:** List pagination avoids unnecessary DB cost.

## SUP-11 — Collapse support summary aggregates

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `cases_services.py`.
- **Issue:** `get_case_summary` runs separate queries for by-status counts, urgent open, and overdue.
- **Fix:** Use conditional aggregates and grouped counts in one or fewer queries.
- **Done when:** Summary output matches current shape with fewer DB round trips.

## SUP-12 — Filter client-visible comments in SQL

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `cases_services.py`, client portal tests.
- **Issue:** Client serialization filters internal comments in Python after loading all comments.
- **Fix:** Fetch only `is_internal=False` comments for client-facing case responses.
- **Done when:** Client support endpoints never load or return internal comments.

## SUP-13 — Add support case SLA index

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `models.py`, Alembic migration.
- **Issue:** Overdue summary filters by tenant and `sla_due_at`, but no `(tenant_id, sla_due_at)` index exists.
- **Fix:** Add `Index('ix_support_cases_tenant_sla', 'tenant_id', 'sla_due_at')`. Consider a partial active-case variant after EXPLAIN.
- **Done when:** Overdue summary can use a tenant/SLA index.

## SUP-14 — Review active-case partial index

- **Severity:** Medium
- **Assessment:** Valid, verify with EXPLAIN.
- **Files:** `models.py`, migration notes.
- **Issue:** `ix_support_cases_active_tenant` uses `closed_at IS NULL`, while active/open logic is based on status not in resolved/closed.
- **Fix:** Keep or replace based on EXPLAIN. Add a status/open partial index if query plans need it.
- **Done when:** Indexes match the support list/summary predicates.

## SUP-15 — Escape LIKE wildcards in support search

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `cases_services.py`, tests.
- **Issue:** Search inserts raw user input into a LIKE pattern, so `%` and `_` act as wildcards.
- **Fix:** Escape LIKE wildcards and pass an escape character to `.like()`.
- **Done when:** Literal `%`/`_` searches do not match unintended records.

## SUP-16 — Align visible columns with backend field projection

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `frontend/hooks/support/useCases.ts`, `cases_routes.py`.
- **Issue:** `fetchCases` receives visible columns but does not send `fields=`; changing columns can affect cache keys without changing payload.
- **Fix:** Either add backend field projection and send `fields`, or remove visible columns from the fetch/cache dimension for support cases.
- **Done when:** Column changes either intentionally change payload or stay UI-only.

## SUP-17 — Align support category schema/model constraints

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `schema.py`, `models.py`.
- **Issue:** Schema limits category to 80 chars; model stores it as `Text`.
- **Fix:** Choose the source of truth: DB `VARCHAR(80)` with migration, or service/schema-only validation with Text kept intentionally.
- **Done when:** Schema and DB constraints are intentionally aligned.

## SUP-18 — Decide whether support comments need `updated_at`

- **Severity:** Low
- **Assessment:** Forward-looking.
- **Files:** `models.py`.
- **Issue:** Comments have `created_at` but no `updated_at`. Current service does not support editing comments.
- **Fix:** If editing is planned, add `updated_at`; otherwise document comments as immutable.
- **Done when:** Comment edit/audit behavior is intentional.

## SUP-19 — Compare ORM status directly for CRM status events

- **Severity:** Low/Medium
- **Assessment:** Valid cleanup.
- **Files:** `cases_routes.py`.
- **Issue:** Route compares serialized `before_state['status']` with `updated.status`.
- **Fix:** Capture `before_status = case.status` before update and compare directly.
- **Done when:** Status-change event logic is independent of response serialization.

## SUP-20 — Verify saved-view search routing

- **Severity:** Low/Medium
- **Assessment:** Verify-first.
- **Files:** `cases_routes.py`, `frontend/lib/savedViewQuery.ts`.
- **Issue:** List route has no `search` query param; `/search` handles search. This is fine if frontend routes search requests there.
- **Fix:** Verify `appendSavedViewFilterParams` and `useSupportCases` always route search terms through `/search`. Add tests.
- **Done when:** Saved-view search works for support cases.

## SUP-21 — Keep bulk list responses light

- **Severity:** Low regression guard
- **Assessment:** Current code is fine.
- **Files:** route tests.
- **Issue:** `SupportCaseResponse` includes comments/events; if accidentally used for lists, it would be heavy.
- **Fix:** Add tests asserting list endpoints return `SupportCaseListItem` shape without comments/events.
- **Done when:** Bulk list responses cannot drift into heavy detail shape.

## SUP-22 — Include display names for assignees and comment authors

- **Severity:** Low/Medium UX
- **Assessment:** Valid.
- **Files:** `cases_services.py`, `schema.py`, frontend detail/list.
- **Issue:** UI renders `User #id` for assignee/comment author.
- **Fix:** Load user display fields and expose `assigned_user_name`, `assigned_user_email`, and comment author display data, or use a shared user lookup cache.
- **Done when:** Support UI shows human-readable names.

## SUP-23 — Migrate support case detail page to React Query

- **Severity:** High frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/support/cases/[caseId]/page.tsx`.
- **Issue:** Detail page manually manages fetching with `useState`/`useEffect` and raw `apiFetch`.
- **Fix:** Use `useQuery(['support-case', caseId])` and mutations for save/comment. Invalidate detail, list, and summary keys as needed.
- **Done when:** Detail data is cached and refetched through React Query.

## SUP-24 — Avoid full case reload after adding comment

- **Severity:** High/Medium frontend
- **Assessment:** Valid.
- **Files:** support case detail page.
- **Issue:** `handleComment` calls `loadCase()` after posting a comment.
- **Fix:** Optimistically append the returned comment or invalidate the detail query without showing a full page skeleton.
- **Done when:** Adding a comment updates comments without a visible full reload.

## SUP-25 — Remove exhaustive-deps suppression in detail loading

- **Severity:** Medium frontend
- **Assessment:** Valid; superseded by SUP-23.
- **Files:** support case detail page.
- **Issue:** `loadCase` is excluded from effect dependencies.
- **Fix:** Migrate to React Query or wrap `loadCase` in `useCallback([caseId])`.
- **Done when:** No stale closure risk is hidden by lint suppression.

## SUP-26 — Invalidate support summary after case changes

- **Severity:** Medium/High frontend
- **Assessment:** Valid.
- **Files:** `CreateSupportCaseDialog.tsx`, support detail page, support list/summary page.
- **Issue:** Create/save paths invalidate `['support-cases']` but not the summary query key.
- **Fix:** Also invalidate `['support-cases-summary']` or the exact summary widget key after create and status/SLA-changing updates.
- **Done when:** Summary widgets update immediately after support case changes.

## SUP-27 — Normalize linked ID state in create dialog

- **Severity:** Low/Medium frontend
- **Assessment:** Valid cleanup.
- **Files:** `CreateSupportCaseDialog.tsx`.
- **Issue:** `quote_id`, `order_id`, and `assigned_to_id` are strings while other linked IDs are `number | null`.
- **Fix:** Store all linked IDs as `number | null`, or centralize safe parsing before submit.
- **Done when:** Linked ID state is consistently typed.

## SUP-28 — Document linked-record cascade behavior

- **Severity:** Low frontend UX
- **Assessment:** Valid.
- **Files:** `CreateSupportCaseDialog.tsx`.
- **Issue:** Clearing contact and account cascades differently through related fields.
- **Fix:** Add code comments or adjust behavior based on product decision.
- **Done when:** Picker clearing behavior is predictable and intentional.

## SUP-29 — Add client-facing comment privacy tests

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** client portal support tests.
- **Issue:** Client portal must never expose internal comments.
- **Fix:** Test mixed internal/external comments and assert only external comments are returned.
- **Done when:** Internal comment privacy is covered by regression tests.

## SUP-30 — Add support case query/index EXPLAIN notes

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** docs/tests/migration notes.
- **Issue:** Index changes should be guided by real query plans.
- **Fix:** Add EXPLAIN notes for list, summary, and overdue queries before and after index changes.
- **Done when:** Index changes are justified by actual support query plans.

---

## Migration checklist

- SUP-02: add unique constraint on `(tenant_id, case_number)` after checking existing duplicates.
- SUP-13: add `ix_support_cases_tenant_sla`.
- SUP-14: optionally add/replace partial active-case index after EXPLAIN.
- SUP-17: optional category column type migration.
- SUP-18: optional comment `updated_at` migration if comment editing is planned.

## Test checklist

Backend:

- Concurrent support case creates generate unique case numbers.
- Duplicate case number conflicts rollback cleanly.
- Case create commits case and event atomically.
- Comment/status commit failures rollback and return clean errors.
- Client update payload cannot set service-owned SLA timestamps.
- Client portal case responses exclude internal comments.
- Source matching is normalized.
- Search escapes `%` and `_` literals.
- Summary counts match before and after aggregate refactor.

Frontend/manual:

- Case detail uses React Query and no longer flashes full loading state after comments.
- Creating/updating cases invalidates list and summary.
- Assignee/comment authors render display names.
- Visible-column changes do not cause pointless fetches unless `fields=` is implemented.

## Explicit audit corrections

- Keep `datetime.now(timezone.utc)`; it is not deprecated.
- Do not rewrite `useSupportCases` query key as if `usePagedList` were static; `usePagedList` already composes the full key.
- Do not add list-route search handling unless saved-view serialization proves it is needed.
- Keep `SupportCaseListItem` separate from `SupportCaseResponse` and protect that with tests.
