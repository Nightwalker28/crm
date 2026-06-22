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
