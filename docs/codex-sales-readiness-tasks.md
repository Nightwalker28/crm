# Sales Module Codex Task Plan

_Last updated: 2026-06-22_

This document converts the sales-module review into Codex-ready implementation tasks after checking the current repository. It covers sales contacts, organizations, opportunities, quotes, orders, follow-ups, reminder scans, summaries, and related frontend hooks/pages/components.

## Verification summary

Confirmed/high-merit issues in the current codebase:

- `opportunities_api.upload_opportunity_attachments` and `delete_opportunity_attachments` call `update_opportunity(...)` without the required `current_user` keyword argument.
- `opportunities_repository.get_opportunity(..., include_deleted=True)` filters `deleted_at IS NOT NULL`, so it returns only deleted records instead of including both active and deleted records.
- Opportunity create/update and quote create/update use the double-commit custom-field pattern.
- Quote and order number generation use `datetime.utcnow()` plus count-based suffixes, which are non-atomic under concurrent requests.
- Several soft-delete paths still use `datetime.utcnow()`.
- `organizations_services.list_organizations()` lacks a tenant filter and calls `hydrate_custom_field_records` without `tenant_id`; it appears unused by current routes but is dangerous if called.
- Organization import calls update/create service functions that commit inside the loop.
- Opportunity pipeline summary loads all matching opportunities into Python and aggregates there.
- Reminder scans load all stale contacts/inactive opportunities across all tenants into memory.
- Summary endpoints perform multiple separate queries and custom-field hydration passes per request.
- Frontend create-contact modal fetches only the first 50 organizations on open and filters client-side.
- Opportunity detail page can send stage changes while another save/stage request is already running, and reloading summary toggles full-page loading after mutations.
- Contact detail page fetches WhatsApp templates in a raw `useEffect` instead of React Query.
- Organization card strips only `https://` from websites.
- Opportunity page uses an object directly in the pipeline-summary query key.
- `useOpportunities` invalidates the opportunity list but not the pipeline-summary query after mutations.

Partially valid or verify-first items:

- `leads_services.calculate_lead_score` already normalizes naive `last_contacted_at` to UTC when scoring, but there is no shared `_as_utc` utility. Treat as consistency cleanup, not a confirmed score bug.
- `import_leads_from_csv` has row-level error handling around payload parsing and DB operations; the concern is mostly around transactional clarity for score/custom-field side effects.
- `contacts_services.import_contacts_from_csv` using `bulk_insert_mappings` is a deliberate tradeoff unless ORM events/listeners are required for contact creation.
- `CreateQuoteModal` frontend contact validation depends on backend `ensure_linked_records` requirements. Backend currently requires `customer_name`; contact/organization are optional unless linked opportunity constraints apply.
- “All detail pages should use React Query” is a valid refactor direction but should be treated as broad cleanup rather than an urgent bug.

## Recommended implementation order

1. Critical correctness/security: SALES-01, SALES-02, SALES-03, SALES-04, SALES-05, SALES-07, SALES-08.
2. Transaction consistency: SALES-06, SALES-09, SALES-10, SALES-11, SALES-12, SALES-15.
3. Performance/scalability: SALES-13, SALES-14, SALES-16, SALES-17, SALES-18, SALES-19.
4. Frontend reliability/UX: SALES-24 through SALES-36.
5. Cleanup/verify-first tasks: SALES-20 through SALES-23 and SALES-37 through SALES-40.

---

## SALES-01 — Pass `current_user` through opportunity attachment updates

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/sales/routes/opportunities_routes.py`, `backend/app/modules/sales/services/opportunities_api.py`, tests.
- **Issue:** `upload_opportunity_attachments` and `delete_opportunity_attachments` call `update_opportunity(db, opportunity, data)` without the required `current_user` keyword-only argument.
- **Fix:** Pass `current_user` from the route into the API helper and into `update_opportunity`. Alternatively add an internal `_update_opportunity_fields` helper for attachment-only updates that does not require currency/user validation.
- **Tests:** Uploading and deleting attachments succeeds and updates `attachments`; missing `current_user` TypeError cannot occur.
- **Done when:** Attachment endpoints work against the current `update_opportunity` signature.

## SALES-02 — Fix opportunity `include_deleted` repository semantics

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/sales/repositories/opportunities_repository.py`, recycle-bin/restore tests.
- **Issue:** `get_opportunity(... include_deleted=True)` applies `SalesOpportunity.deleted_at.is_not(None)`, returning only deleted rows. The name implies active + deleted, while restore routes separately check `deleted_at` after fetch.
- **Fix:** Use no deleted filter when `include_deleted=True`; otherwise filter `deleted_at IS NULL`. If a deleted-only lookup is desired, add an explicit `only_deleted` parameter/helper.
- **Tests:** Active detail lookup works; restore lookup can fetch deleted records; `include_deleted=True` can fetch active records if called that way.
- **Done when:** `include_deleted` means include both active and deleted records.

## SALES-03 — Replace count-based quote number generation with an atomic allocator

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `quotes_services.py`, model/migration if needed, tests.
- **Issue:** `_generate_quote_number` uses `datetime.utcnow()` date prefix and `COUNT(... LIKE prefix)` suffix. Concurrent requests can generate the same number.
- **Fix:** Use a PostgreSQL sequence, a tenant/date counter table locked with `SELECT ... FOR UPDATE`, or an atomic `INSERT ... ON CONFLICT DO UPDATE RETURNING` counter. Use `datetime.now(timezone.utc)` for the date prefix.
- **Tests:** Concurrent quote creation produces unique sequential numbers.
- **Done when:** Quote numbers are unique under concurrent workers without relying on post-facto integrity failure.

## SALES-04 — Replace count-based order number generation with an atomic allocator

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `orders_services.py`, model/migration if needed, tests.
- **Issue:** `_generate_order_number` has the same `datetime.utcnow()` + count suffix race as quotes.
- **Fix:** Share a generic document-number allocator or implement a sales-order-specific sequence/counter table.
- **Tests:** Concurrent order creation produces unique numbers.
- **Done when:** Order numbers are safe under concurrent workers.

## SALES-05 — Fix tenant leak in legacy `list_organizations()`

- **Severity:** Critical if reachable
- **Assessment:** Valid.
- **Files:** `organizations_services.py`, tests.
- **Issue:** `list_organizations(db)` returns all non-deleted organizations across all tenants and hydrates custom fields without `tenant_id`. Current route paths appear to use paginated tenant-aware functions, but this helper is unsafe if reused.
- **Fix:** Remove the helper if unused, or change signature to `list_organizations(db, *, tenant_id: int)` and filter by `SalesOrganization.tenant_id == tenant_id`; pass `tenant_id` into `hydrate_custom_field_records`.
- **Tests:** Helper cannot return records from another tenant.
- **Done when:** No sales organization list helper can bypass tenant scoping.

## SALES-06 — Make opportunity attachment writes crash-safe

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `opportunities_api.py`, cleanup job/tests.
- **Issue:** Attachment files are written to final disk paths before DB commit. If the process crashes after file write but before DB update or cleanup, orphaned files remain.
- **Fix:** Write to a temp/staging path; update DB; then atomically rename staged files to final paths, or store attachments in object storage with lifecycle cleanup. Add a scheduled cleanup for orphaned staged files.
- **Done when:** DB failure/crash cannot leave permanent orphaned attachment files.

## SALES-07 — Harden opportunity attachment delete path containment

- **Severity:** Medium/High
- **Assessment:** Valid hardening.
- **Files:** `opportunities_api.py`, tests.
- **Issue:** Delete resolves `(OPPORTUNITY_ATTACHMENTS_DIR.parent.parent / path_str)` and checks `allowed_root in candidate.parents`. The check is mostly correct but fragile around symlinks and path assumptions.
- **Fix:** Resolve against a single canonical attachment root and use `Path.is_relative_to(allowed_root)` where available. Reject symlinked files if they resolve outside the root.
- **Done when:** Attachment deletion cannot escape the attachment directory.

## SALES-08 — Replace `datetime.utcnow()` in sales soft deletes

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `quotes_services.py`, `opportunities_services.py`, `organizations_services.py`, lead delete path if present, tests.
- **Issue:** Quote, opportunity, and organization soft-delete paths use naive `datetime.utcnow()`.
- **Fix:** Use `datetime.now(timezone.utc)` consistently for timezone-aware timestamp columns.
- **Tests:** Soft delete timestamps are timezone-aware.
- **Done when:** Sales services do not use `datetime.utcnow()`.

## SALES-09 — Make opportunity create/update custom-field persistence atomic

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `opportunities_services.py`, tests.
- **Issue:** `create_opportunity` commits the opportunity, saves custom fields, then commits again; `update_opportunity` commits main changes, then optionally saves custom fields and commits again.
- **Fix:** Use one transaction: add/update opportunity, `flush()`, save custom fields, then commit once. Rollback all changes on failure.
- **Done when:** Opportunity and custom-field writes cannot be split.

## SALES-10 — Make quote create/update custom-field persistence atomic

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `quotes_services.py`, tests.
- **Issue:** Quote create/update and replace-duplicate paths commit quote changes before custom fields.
- **Fix:** Use `flush()` to get quote ID, save custom fields, commit once. Catch `IntegrityError` and rollback the full transaction.
- **Done when:** Quote and custom-field writes commit or rollback together.

## SALES-11 — Batch organization import writes

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `organizations_services.py`, import tests.
- **Issue:** `import_organizations_from_csv` calls `update_organization` and `create_organization`, both of which commit internally; imports can do N commits for N rows.
- **Fix:** Add commit-control parameters or lower-level create/update helpers that use `flush()` inside the import loop and one final `commit()` at the end. Use nested transactions/savepoints for per-row failure isolation if needed.
- **Done when:** Organization import avoids per-row commits while preserving row-level error reporting.

## SALES-12 — Clarify lead import transaction/error handling around score recalculation

- **Severity:** High/Medium
- **Assessment:** Partially valid.
- **Files:** `leads_services.py`, import tests.
- **Issue:** Lead import recalculates lead scores inside the loop, with final commit behavior and per-row failure handling that can be hard to reason about.
- **Fix:** Add explicit per-row savepoints or clearly batch all changes and scores together. Ensure any commit failure is reported in the import summary and does not leave score records partially inconsistent.
- **Done when:** Lead import has predictable rollback/error semantics for lead + score + custom fields.

## SALES-13 — Optimize opportunity pipeline summary with SQL aggregation

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `opportunities_services.py`, `opportunities_repository.py`, route tests.
- **Issue:** `summarize_opportunity_pipeline` calls `query.all()` and aggregates stage counts/value totals in Python.
- **Fix:** Use `GROUP BY sales_stage` with `COUNT(*)` and `SUM(...)`. Because `total_cost_of_project` appears string-ish, first normalize storage to numeric or safely cast only numeric values. Keep the existing stage order in the response.
- **Done when:** Pipeline summary does not load every matching opportunity row.

## SALES-14 — Chunk reminder scans and scope them by tenant intentionally

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `reminder_scans.py`, Celery task, tests.
- **Issue:** `_stale_contacts` and `_inactive_opportunities` load all matching rows across all tenants into memory. The task then creates tenant-specific reminders from those global result sets.
- **Fix:** Run per tenant or accept a `tenant_id` argument. Use `.yield_per(...)`, cursor pagination, or chunked ID batches. Consider moving duplicate-open-task checks into a bulk query.
- **Done when:** Reminder scans are bounded and tenant scope is explicit.

## SALES-15 — Make follow-up logging and task creation transactional

- **Severity:** Medium/High
- **Assessment:** Valid if current follow-up path commits before side effects.
- **Files:** `followups.py`, tests.
- **Issue:** The audit reports `log_contact_follow_up` commits `last_contacted_at` and activity before creating follow-up tasks. A task failure can leave contact activity persisted without the requested task.
- **Fix:** Move commit after all related side effects, or wrap follow-up update/activity/task creation in a transaction/savepoint.
- **Done when:** Follow-up update and optional task creation are consistent.

## SALES-16 — Consolidate sales summary endpoint queries

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `summary_services.py`, summary route tests.
- **Issue:** Contact, organization, opportunity, and quote summary builders issue multiple independent queries and hydration calls per request.
- **Fix:** Use `selectinload`/joined relationships where appropriate, `IN` queries for related lists, and batch custom-field hydration. Avoid per-list repeated hydration where counts can be computed via SQL.
- **Done when:** Summary endpoints return the same shape with fewer DB round trips.

## SALES-17 — Avoid related-list custom-field query fan-out in summaries

- **Severity:** Medium/High
- **Assessment:** Valid; overlaps SALES-16.
- **Files:** `summary_services.py`, custom-field hydration helpers.
- **Issue:** Summaries hydrate custom fields for related contacts/opportunities/quotes lists. If many related records have custom fields, this can become many queries depending on helper behavior.
- **Fix:** Verify hydration helper batches by record IDs. If not, add a batched hydration path and use it for all summary related lists.
- **Done when:** Hydrating 12 contacts/opportunities does not perform 12+ separate custom-field queries.

## SALES-18 — Stream quote exports for large result sets

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `quotes_services.py`, export routes/jobs.
- **Issue:** `export_quotes_to_csv` receives records and builds a full list of rows in memory. Inline export paths can therefore materialize large tables.
- **Fix:** Add a query-level streaming export path using `yield_per` and a CSV writer/generator/temp file. Keep background export for large jobs.
- **Done when:** Quote export memory scales with batch size.

## SALES-19 — Document or replace contact bulk insert behavior

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** `contacts_services.py`, import tests/docs.
- **Issue:** Contact import reportedly uses `bulk_insert_mappings` for new rows and `db.add()` for updates. Bulk insert bypasses ORM events/listeners.
- **Fix:** If no ORM events are required, document the assumption and add tests for fields normally populated by events. If events are needed, switch to ORM objects or `bulk_save_objects` with explicit event-equivalent logic.
- **Done when:** Import behavior is intentional and documented/tested.

## SALES-20 — Improve contact name duplicate normalization for partial names

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `contacts_services.py`, duplicate tests.
- **Issue:** `_normalize_name` returns an empty string unless both first and last name are present, so contacts with only first or only last name never participate in name-based duplicate detection.
- **Fix:** Normalize whichever name parts exist. Return empty only when both are missing.
- **Done when:** Partial-name contacts can be duplicate-checked where name matching is used.

## SALES-21 — Centralize timezone normalization utility

- **Severity:** Medium
- **Assessment:** Valid cleanup.
- **Files:** shared utility module, `leads_services.py`, `reminder_scans.py`, quote/public-link code.
- **Issue:** `_as_utc` exists in reminder scans and quotes but lead scoring has local normalization logic.
- **Fix:** Add shared `_as_utc` utility and use it across sales services. Ensure naive datetimes are explicitly treated as UTC or business-local per product decision.
- **Done when:** Sales code has one timezone normalization behavior.

## SALES-22 — Avoid overwriting organization assignee during replace-duplicate unless intended

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `organizations_services.py`, tests.
- **Issue:** `_apply_org_payload` sets `assigned_to = current_user.id` on every replace path, overwriting existing assignees.
- **Fix:** Only set `assigned_to` when creating a record, when existing `assigned_to` is null, or when an explicit assignee field is provided.
- **Done when:** Replace-duplicate updates do not silently change ownership unless intended.

## SALES-23 — Fix opportunity list field gating expansion

- **Severity:** Medium
- **Assessment:** Valid by pattern.
- **Files:** `opportunities_routes.py`, field-gating tests.
- **Issue:** `_serialize_opportunity_list_item` expands requested/enabled fields with a broad hardcoded set including attachments and custom fields, weakening field-level list controls.
- **Fix:** Return only required identifiers and explicitly requested/enabled fields. If the UI requires certain fields, whitelist them narrowly and document why.
- **Done when:** Disabled/unrequested opportunity fields do not appear in list responses.

## SALES-24 — Replace create-contact inline organization fetcher with linked record picker

- **Severity:** High frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/sales/useCreateContact.ts`, create contact modal component.
- **Issue:** The hook fetches `/sales/organizations?page=1&page_size=50` when the modal opens, so tenants with more than 50 orgs silently miss options; it also fetches even if the org picker is never used.
- **Fix:** Use `LinkedRecordPicker` or a search-backed organization picker with debounced server search. Only fetch when the picker opens/searches.
- **Done when:** Create-contact organization selection scales beyond 50 orgs.

## SALES-25 — Disable opportunity stage select while saving

- **Severity:** High frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/sales/opportunities/[opportunityId]/page.tsx`.
- **Issue:** Stage `Select.onValueChange` immediately calls `handleStageChange` without checking `saving`. Save button and close buttons guard saving, but the select does not.
- **Fix:** Disable the select trigger/content while `saving`, or ignore stage changes if `saving` is true. Optionally debounce stage updates.
- **Done when:** Stage changes cannot race with save or another stage update.

## SALES-26 — Avoid full-page loading flash on detail-page refetches

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** contact, organization, opportunity, quote detail pages.
- **Issue:** Detail pages call `loadSummary()` after mutations and `loadSummary` sets `loading=true`, causing the whole page to flash a loading skeleton after every save/action.
- **Fix:** Split `isInitialLoading` from `isRefetching`, or migrate to React Query and use `isFetching` for subtle refresh UI only.
- **Done when:** Mutations refresh data without replacing the entire page with a loading state.

## SALES-27 — Move WhatsApp template fetch to React Query

- **Severity:** High/Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/sales/contacts/[contactId]/page.tsx`.
- **Issue:** WhatsApp templates are fetched in a raw `useEffect` with no cache, deduplication, retry, or shared state.
- **Fix:** Use `useQuery({ queryKey: ["message-templates", "whatsapp", "sales_contacts"], ... })`; set selected template in an effect only when data changes.
- **Done when:** Template fetches are cached and deduped.

## SALES-28 — Normalize organization website display robustly

- **Severity:** Medium/Low frontend
- **Assessment:** Valid.
- **Files:** `frontend/components/organizations/organizationCard.tsx`.
- **Issue:** Website label uses `org.website.replace("https://", "")`, so `http://` still renders with protocol.
- **Fix:** Use `new URL(...)` with try/catch and display `hostname` plus path if useful. Add protocol fallback for protocol-less domains.
- **Done when:** `http://`, `https://`, and bare domains display consistently.

## SALES-29 — Stabilize opportunity pipeline summary query key

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/sales/opportunities/page.tsx`.
- **Issue:** `pipelineSummaryQuery` uses `activeFilters` object directly in the query key. TanStack Query hashes structurally, but a stable derived key is clearer and avoids accidental non-serializable values.
- **Fix:** Use a memoized stable key such as `JSON.stringify(activeFilters)` or the exact querystring used by `fetchPipelineSummary`.
- **Done when:** Equivalent filters share the same query key predictably.

## SALES-30 — Invalidate pipeline summary from `useOpportunities`

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/sales/useOpportunities.ts`, opportunities page.
- **Issue:** `refreshLists` invalidates only `["sales-opportunities"]`. The page separately invalidates `["sales-opportunities-pipeline-summary"]` in some handlers, but hook mutations can leave summaries stale.
- **Fix:** Invalidate both list and pipeline-summary keys inside hook mutation `onSuccess`, or accept an optional `onMutationSuccess` callback.
- **Done when:** Create/update/delete/stage-change refresh the pipeline summary consistently.

## SALES-31 — Canonicalize opportunity stage style imports

- **Severity:** Low/Medium frontend
- **Assessment:** Valid if both import paths still exist.
- **Files:** `components/opportunities/opportunityStages.ts`, table/board components.
- **Issue:** `opportunityStages.ts` re-exports `getOpportunityStageStyle` while other components import directly from `@/lib/statusStyles`.
- **Fix:** Pick one canonical source and update imports. Prefer domain helpers in `opportunityStages.ts` if stage labels/order live there.
- **Done when:** One import path is used for opportunity stage style helpers.

## SALES-32 — Verify CreateQuoteModal frontend linked-record validation

- **Severity:** Medium frontend
- **Assessment:** Needs verification/product decision.
- **Files:** `CreateQuoteModal.tsx`, quote schema/service tests.
- **Issue:** Audit says `canSubmit` only checks `customer_name`, while backend may reject invalid linked records. Backend currently requires customer name; contact/organization are optional unless provided or linked opportunity constraints apply.
- **Fix:** Mirror actual backend rules: require customer name; require contact only if product wants quotes always linked to CRM contacts; validate opportunity/contact/org consistency if user selects them.
- **Done when:** Frontend prevents only real backend-invalid quote submissions.

## SALES-33 — Re-throw create-organization hook errors

- **Severity:** Low/Medium frontend
- **Assessment:** Needs file verification.
- **Files:** `frontend/hooks/sales/useOrganizations.ts`, create organization modal.
- **Issue:** Audit says `createOrganization` catches and swallows errors after toast, so callers cannot distinguish success from failure.
- **Fix:** Re-throw after toast, or return a discriminated result `{ ok, error }` and update caller.
- **Done when:** Caller can reliably handle failed organization creation.

## SALES-34 — Move detail page data loading to React Query gradually

- **Severity:** Low cleanup with UX benefits
- **Assessment:** Valid broad refactor.
- **Files:** contact, organization, opportunity, quote detail pages.
- **Issue:** Detail pages use raw `apiFetch` + local state, so they lack request deduplication, cache sharing, background refetch, and consistent error/retry behavior.
- **Fix:** Migrate one page at a time to `useQuery`/`useMutation`, starting with contact and opportunity pages because they already show loading-flash issues.
- **Done when:** Detail pages share list/detail cache and refetch without UI flashes.

## SALES-35 — Add guarded stage-change request serialization

- **Severity:** Medium frontend
- **Assessment:** Valid extension of SALES-25.
- **Files:** opportunity detail page, opportunity board if stage dragging exists.
- **Issue:** Multiple stage updates can be fired rapidly from select/buttons/board interactions.
- **Fix:** Track an in-flight stage mutation per opportunity; ignore or queue later stage changes until the first resolves.
- **Done when:** Last user action wins predictably without overlapping PATCH requests.

## SALES-36 — Prefer server search for organization/contact pickers across sales forms

- **Severity:** Medium frontend scalability
- **Assessment:** Valid cross-cutting.
- **Files:** create contact, create opportunity, quote modal, reusable picker.
- **Issue:** Some forms use server-backed `LinkedRecordPicker`; others use fixed-page client filtering.
- **Fix:** Standardize on `LinkedRecordPicker` or equivalent debounced search picker for contacts/organizations/opportunities.
- **Done when:** Pickers scale to large tenants and do not silently omit records.

## SALES-37 — Add conflict handling around generated quote/order numbers

- **Severity:** Medium fallback
- **Assessment:** Valid alongside SALES-03/04.
- **Files:** quotes/orders services.
- **Issue:** Even after allocator work, DB unique constraints should be caught and returned as clean 409s.
- **Fix:** Catch `IntegrityError`, rollback, and return specific duplicate-number errors.
- **Done when:** Duplicate generated/manual numbers do not return generic 500s.

## SALES-38 — Verify route ordering for opportunity static routes

- **Severity:** Low/Medium
- **Assessment:** Valid guard.
- **Files:** `opportunities_routes.py`, route tests.
- **Issue:** Static routes like `/import` are declared after dynamic `/{opportunity_id}` routes. HTTP method differences may avoid current conflicts, but route ordering is fragile.
- **Fix:** Move static `/import`, `/export`, `/search`, `/pipeline-summary` before dynamic routes where possible and add route resolution tests.
- **Done when:** Static opportunity endpoints cannot be shadowed by dynamic IDs.

## SALES-39 — Normalize sales import transaction patterns across modules

- **Severity:** Medium
- **Assessment:** Valid cross-cutting.
- **Files:** leads, contacts, organizations, opportunities, quotes imports.
- **Issue:** Import services use mixed patterns: bulk insert, per-row service commits, final batch commits, and partial custom-field save patterns.
- **Fix:** Define a standard import contract: row validation, duplicate detection, per-row savepoint or batch transaction, summary accumulation, and one final commit when practical.
- **Done when:** Sales imports have consistent, documented transaction behavior.

## SALES-40 — Add regression tests for recycle-bin include-deleted behavior across sales modules

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** repository tests for contacts/organizations/opportunities/quotes.
- **Issue:** Opportunity include-deleted semantics are wrong; similar helpers should be checked to avoid repeated bug patterns.
- **Fix:** Add shared repository tests: active fetch, deleted fetch, include-deleted fetch, deleted-only restore path if implemented.
- **Done when:** Include-deleted behavior is consistent across sales repositories.

---

## Migration checklist

- SALES-03/04: add sequence/counter table or database sequence for quote/order numbers.
- SALES-08: no migration required unless existing naive timestamps need backfill/normalization.
- SALES-14: optional task scheduling change if reminder scan becomes per-tenant.
- SALES-18: no schema migration; export implementation change only.

## Test checklist

Backend:

- Opportunity attachment upload/delete succeeds and passes `current_user` correctly.
- Opportunity `include_deleted=True` semantics include active and deleted rows or deleted-only behavior is split into a separate helper.
- Concurrent quote/order creation generates unique numbers.
- Sales soft-delete timestamps are timezone-aware.
- Legacy `list_organizations` cannot return cross-tenant rows.
- Opportunity/quote custom fields commit atomically with parent records.
- Organization import avoids per-row commits and preserves duplicate behavior.
- Pipeline summary uses grouped aggregation and matches previous response shape.
- Reminder scans run in bounded chunks and tenant scope is explicit.
- Summary endpoints keep response shapes but reduce query count.
- Contact partial-name duplicate normalization works.

Frontend/manual:

- Create contact can find organizations beyond the first 50 records.
- Opportunity stage select is disabled/guarded while saving.
- Detail-page saves/refetches do not flash full loading skeletons.
- WhatsApp templates are cached through React Query.
- Organization website labels display correctly for `http://`, `https://`, and bare domains.
- Opportunity pipeline summary refreshes after any opportunity mutation.
- Quote modal validation matches backend linked-record requirements.
- Create organization errors propagate to modal callers.

## Explicit audit corrections

- Do not treat lead score timezone handling as fully broken; the current code normalizes naive `last_contacted_at` locally. The task is to centralize and test the behavior.
- Do not require CreateQuoteModal to demand `contact_id` unless product/backend rules actually make contact linking mandatory.
- Do not treat `bulk_insert_mappings` in contact imports as automatically wrong; document/replace it only if ORM events or listeners are required.
- Treat “all detail pages should use React Query” as a broad frontend refactor, not an urgent blocker.
