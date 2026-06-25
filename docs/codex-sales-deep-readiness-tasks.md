# Sales Module Deep Codex Task Plan

_Last updated: 2026-06-25_

This is the deeper sales audit pass. It supplements `docs/codex-sales-readiness-tasks.md` rather than replacing it, because the earlier file already covers the first-pass sales issues. This document folds in the new detailed audit and adds similar issues found in nearby sales models, repositories, services, routes, and frontend files.

## Verification summary

Confirmed/high-merit findings:

- Sales models use many default `lazy="joined"` relationships on list-heavy entities: contacts, leads, quotes, quote-open events, orders, and opportunities.
- `SalesContact.assigned_to` uses `ondelete="RESTRICT"`, unlike most other assignee FKs that use `SET NULL`.
- `SalesOrganization` has no `updated_at`; timestamp types are inconsistent across sales models.
- Opportunity attachments are stored as `Text` JSON with no DB-level JSON validation.
- Sales custom fields are held in an in-memory `_custom_field_cache`; serialization requires explicit hydration.
- Contacts, organizations, opportunities, leads, and quotes all have variations of count+fetch pagination and unbounded `list_all_*` paths.
- Repository/service query-builder duplication exists for contacts and organizations and likely stale service query builders should be deleted.
- Opportunity `include_deleted=True` is still inverted to deleted-only behavior.
- Organization import duplicate checks are missing `tenant_id` in the preloaded duplicate queries; this can cause cross-tenant false duplicate detection.
- Contact, organization, opportunity, lead, and quote write services repeat the parent-record commit followed by custom-field commit pattern.
- Several sales soft-delete paths still use `datetime.utcnow()`.
- Reminder scans query contacts/opportunities across all tenants.
- Follow-up logging commits primary record changes before optional task side effects.
- Frontend detail pages repeat full-skeleton refresh behavior after saves.
- Opportunity board/list summary cache invalidation and query-key stability need cleanup.

Corrections to the pasted audit:

- `organizations_repository.ORGANIZATION_SORT_FIELDS` already contains `customer_group_id`; this one is not currently missing.
- `organizations_repository.list_cursor` does apply explicit `ORDER BY org_id DESC` before limiting. Keep a regression test, but do not treat it as currently unordered.
- `view_public_quote_proposal` already guards `request.client` according to the audit text; no fix needed there.
- Some list/full-response N+1 risks are future traps only because current list routes use list-item schemas. Add tests rather than assuming current breakage.
- `SalesQuoteOpenEvent` model already allows `sent` in its DB check constraint. The inconsistency is with public event constants/service behavior, not the model constraint.

## Recommended implementation order

1. Data correctness and tenancy: SALES-DEEP-01 to SALES-DEEP-10.
2. Transaction consistency and side effects: SALES-DEEP-11 to SALES-DEEP-22.
3. Repository/query performance: SALES-DEEP-23 to SALES-DEEP-34.
4. Route/API cleanup: SALES-DEEP-35 to SALES-DEEP-43.
5. Frontend reliability and UX: SALES-DEEP-44 to SALES-DEEP-58.

---

## SALES-DEEP-01 — Normalize sales relationship loading strategy

- **Severity:** High/Medium
- **Files:** `backend/app/modules/sales/models.py`, repository query tests.
- **Issue:** Contacts, leads, quotes, quote open events, orders, and opportunities use `lazy="joined"` for multiple relationships. List queries silently carry extra joins.
- **Fix:** Change default relationships to `selectin` or `select`, then explicitly eager-load relationships only in detail/list serializers that need them.
- **Done when:** Base list queries no longer auto-join unrelated user/contact/org/quote tables.

## SALES-DEEP-02 — Change or guard `SalesContact.assigned_to` delete behavior

- **Severity:** High/Medium
- **Files:** `models.py`, user deletion service, migration.
- **Issue:** `SalesContact.assigned_to` uses `ondelete="RESTRICT"`, so user deletion can fail at the DB layer with a low-quality error.
- **Fix:** Prefer `SET NULL` plus nullable business logic, or add an explicit pre-delete check that reports linked contacts before deletion.
- **Done when:** User deletion has predictable behavior around assigned contacts.

## SALES-DEEP-03 — Add `updated_at` to sales organizations

- **Severity:** Medium
- **Files:** `models.py`, migration, schemas/routes/frontend.
- **Issue:** Organizations expose `created_time` only, so recency sorting and audit display cannot use last modification time.
- **Fix:** Add `updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())`; expose it in schemas/list columns if desired.
- **Done when:** Organization updates maintain a last-modified timestamp.

## SALES-DEEP-04 — Standardize sales timestamp column types

- **Severity:** Medium/Low
- **Files:** `models.py`, migration notes.
- **Issue:** Similar sales models mix `DateTime(timezone=True)` and `TIMESTAMP(timezone=True)` for created/deleted fields.
- **Fix:** Pick one style for SQLAlchemy models and standardize new migrations. Avoid unnecessary data migration unless the DB type differs materially.
- **Done when:** Timestamp declarations are consistent across sales models.

## SALES-DEEP-05 — Store opportunity attachments in a typed JSON column

- **Severity:** Medium/High
- **Files:** `models.py`, opportunity schema/service/migration.
- **Issue:** `SalesOpportunity.attachments` is `Text` containing serialized JSON; malformed writes can corrupt attachment state.
- **Fix:** Use PostgreSQL JSONB/SQLAlchemy JSON where available, or add robust service/model validation and migration cleanup.
- **Done when:** Attachment metadata cannot be persisted as malformed JSON.

## SALES-DEEP-06 — Document and guard custom-field cache behavior

- **Severity:** Medium
- **Files:** `models.py`, custom-field hydration helpers, serializers.
- **Issue:** `custom_data`/`custom_fields` are properties backed by `_custom_field_cache`, not persisted columns. If a record is serialized without hydration, custom fields silently disappear.
- **Fix:** Document this contract and add tests. Consider returning `{}` or raising in debug/test mode if a model with configured fields is serialized without hydration.
- **Done when:** Custom-field hydration requirements are explicit and regression-tested.

## SALES-DEEP-07 — Clarify SalesLeadScore staleness fields

- **Severity:** Low/Medium
- **Files:** `models.py`, `leads_services.py`.
- **Issue:** `SalesLeadScore` has `created_at`, `updated_at`, and `calculated_at`; `calculated_at` is maintained only by `recalculate_lead_score`.
- **Fix:** Treat `updated_at` as generic row update time and `calculated_at` as score calculation time. Add tests that all score updates go through `recalculate_lead_score`, or remove the redundant field.
- **Done when:** Lead score freshness semantics are unambiguous.

## SALES-DEEP-08 — Tighten quote open event hash columns

- **Severity:** Low
- **Files:** `models.py`, migration.
- **Issue:** `ip_hash` and `user_agent_hash` are `Text`, but SHA-256 hex hashes are 64 chars.
- **Fix:** Change to `String(64)` or add validation to prevent accidental raw IP/user-agent storage.
- **Done when:** Hash columns communicate fixed hash length and reject raw values.

## SALES-DEEP-09 — Improve organization search document coverage

- **Severity:** Low
- **Files:** `models.py`, migration.
- **Issue:** Organization `search_doc` omits `primary_phone` and billing address fields.
- **Fix:** Add phone/address fields if users expect search by phone/address. Rebuild computed/search indexes as required.
- **Done when:** Organization search matches expected CRM fields.

## SALES-DEEP-10 — Fix organization import cross-tenant duplicate checks

- **Severity:** High
- **Files:** `organizations_services.py`, import tests.
- **Issue:** `import_organizations_from_csv` duplicate preloads query `SalesOrganization.org_name.in_(org_names)` and `deleted_at IS NULL` but omit `tenant_id`.
- **Fix:** Add `SalesOrganization.tenant_id == current_user.tenant_id` to all duplicate preload queries. Add cross-tenant duplicate regression tests.
- **Done when:** Another tenant's organization name cannot block this tenant's import.

## SALES-DEEP-11 — Make custom-field writes atomic across all sales services

- **Severity:** High
- **Files:** `contacts_services.py`, `organizations_services.py`, `opportunities_services.py`, `leads_services.py`, `quotes_services.py`.
- **Issue:** Multiple sales create/update paths commit the parent row, then save custom fields, then commit again.
- **Fix:** Use `flush()` to obtain IDs, save custom fields, then commit once. Roll back parent and custom fields together.
- **Done when:** Parent record and custom fields commit atomically in contacts, orgs, opportunities, leads, and quotes.

## SALES-DEEP-12 — Add rollback guards around sales write transactions

- **Severity:** High
- **Files:** all sales service write paths.
- **Issue:** Several write paths commit without consistent `IntegrityError`/exception rollback handling.
- **Fix:** Add shared transaction helpers or explicit rollback guards. Return clear 4xx errors for known conflicts.
- **Done when:** Failed sales writes never leave dirty sessions or partial side effects.

## SALES-DEEP-13 — Replace `datetime.utcnow()` in sales soft deletes

- **Severity:** Medium/High
- **Files:** contact/org/opportunity/lead/quote services.
- **Issue:** Soft-delete paths still use naive UTC timestamps.
- **Fix:** Use `datetime.now(timezone.utc)` consistently.
- **Done when:** Deleted timestamps are timezone-aware throughout sales.

## SALES-DEEP-14 — Load raw organizations for update/restore paths

- **Severity:** Medium
- **Files:** `organizations_services.py`.
- **Issue:** `update_organization` and `restore_organization` call hydrated `get_organization`, causing custom-field queries just to mutate/check state.
- **Fix:** Add raw repository lookup for write paths; hydrate only the final response if needed.
- **Done when:** Organization update/restore avoids unnecessary custom-field hydration.

## SALES-DEEP-15 — Preserve explicit organization assignees

- **Severity:** Medium
- **Files:** `organizations_services.py`.
- **Issue:** `_apply_org_payload` sets `assigned_to = current_user.id` whenever `current_user` exists, even on replace/update paths.
- **Fix:** Respect explicit payload assignment, preserve existing assignment on replacement unless product wants reassignment, and default only on create.
- **Done when:** Duplicate replacement does not silently change owner.

## SALES-DEEP-16 — Fix contact import name duplicate false positives

- **Severity:** Medium
- **Files:** `contacts_services.py`, import tests.
- **Issue:** Contact import preloads first names and last names with separate `IN` sets, creating a cross-product candidate set. The final map is keyed by full normalized name, but early duplicate confirmation can still be over-broad.
- **Fix:** Query by normalized full-name expression or compare exact `(first,last)` pairs. Document name duplicate rules.
- **Done when:** Import duplicate prompts are not triggered by unrelated first/last combinations.

## SALES-DEEP-17 — Remove contact email pre-check TOCTOU race

- **Severity:** Medium
- **Files:** `contacts_services.py`.
- **Issue:** `update_sales_contact` pre-checks duplicate email and also catches `IntegrityError`, leaving a race window.
- **Fix:** Keep DB constraint/`IntegrityError` handling as authority. Use pre-check only for friendlier messages if protected by lock or accepted as advisory.
- **Done when:** Concurrent updates cannot bypass duplicate safety.

## SALES-DEEP-18 — Batch organization/opportunity/lead/quote imports

- **Severity:** High
- **Files:** import functions for orgs/opportunities/leads/quotes.
- **Issue:** Several imports call normal create/update services per row, causing per-row commits and hydration.
- **Fix:** Use import-specific lower-level helpers with `flush()` and one final commit, or per-row savepoints with batched finalization.
- **Done when:** Large imports avoid N commits while preserving row-level failure summaries.

## SALES-DEEP-19 — Cache opportunity operating-currency lookups per request

- **Severity:** Medium
- **Files:** `opportunities_services.py`.
- **Issue:** `_normalize_currency` calls company currency/settings lookup on every create/update.
- **Fix:** Cache currencies per request/session or pass preloaded currencies into bulk import paths.
- **Done when:** Opportunity bulk imports/updates do not repeat identical settings queries.

## SALES-DEEP-20 — Make opportunity stage validation single-source

- **Severity:** Low/Medium
- **Files:** opportunity schema/service/routes/frontend shared config.
- **Issue:** Stage validation exists in service and route schema/frontend constants. Drift risk exists between backend `OPPORTUNITY_STAGE_SET` and frontend `OPPORTUNITY_STAGE_ORDER`.
- **Fix:** Pick canonical backend validation and expose stage metadata via endpoint, or add tests asserting backend/frontend constants stay aligned.
- **Done when:** Adding a stage has one clear update path.

## SALES-DEEP-21 — Make quote response/audit status changes transactional

- **Severity:** High
- **Files:** `quotes_services.py`, activity log tests.
- **Issue:** Quote proposal response/status changes commit before activity logging. If logging fails, the financial/customer status change remains without audit trail.
- **Fix:** Wrap status update and activity log in one transaction or durable outbox.
- **Done when:** Quote accept/decline state and audit log cannot split silently.

## SALES-DEEP-22 — Clarify internal-only quote proposal event types

- **Severity:** Medium
- **Files:** quote proposal service/constants/tests.
- **Issue:** The model allows `sent`, but public proposal event constants may only cover opened/viewed/downloaded.
- **Fix:** Document `sent` as internal-only or include it in a separate internal event type set. Add tests.
- **Done when:** Internal and public proposal event paths have explicit allowed event sets.

## SALES-DEEP-23 — Avoid lazy re-query in public quote proposal lookup

- **Severity:** Medium
- **Files:** `quotes_services.py`.
- **Issue:** Public proposal lookup joins quote for tenant validation, then may access `proposal.quote` and trigger another query.
- **Fix:** Return/query tuple with joined quote or eager-load the relationship.
- **Done when:** Public quote proposal lookup does not duplicate quote fetch.

## SALES-DEEP-24 — Validate quote import linked IDs

- **Severity:** High/Medium
- **Files:** `quotes_services.py`, import tests.
- **Issue:** Quote CSV imports can set `contact_id`, `organization_id`, or `opportunity_id` without checking tenant ownership/existence.
- **Fix:** Batch-validate linked IDs before creation/update, like other sales imports.
- **Done when:** Quote imports cannot link to missing or cross-tenant records.

## SALES-DEEP-25 — Fix quote/order number generation races

- **Severity:** High
- **Files:** `quotes_services.py`, `orders_services.py`, migrations/tests.
- **Issue:** Quote and order numbers use date prefix plus count/LIKE scan, which is non-atomic.
- **Fix:** Use tenant/date counter table, sequence, or atomic upsert allocator. Add unique constraints and retry.
- **Done when:** Concurrent quote/order creation cannot collide.

## SALES-DEEP-26 — Fix `convert_quote_to_order` duplicate flag logic

- **Severity:** High
- **Files:** `orders_services.py`, tests.
- **Issue:** Audit reports `allow_duplicate=True` path raises, making the flag useless/inverted.
- **Fix:** Logic should be: if existing order and `not allow_duplicate`, raise; otherwise proceed according to product policy.
- **Done when:** Duplicate conversion behavior matches the flag name.

## SALES-DEEP-27 — Skip linked-record validation for unrelated order patches

- **Severity:** Medium
- **Files:** `orders_services.py`, route tests.
- **Issue:** Status-only order updates can revalidate quote/contact/org/opportunity links unnecessarily.
- **Fix:** On partial updates, validate only changed linked fields.
- **Done when:** Status/owner updates do not run unrelated FK checks.

## SALES-DEEP-28 — Add order status transition guard

- **Severity:** Medium
- **Files:** `orders_services.py`, schema tests.
- **Issue:** Orders can move between lifecycle states without an explicit state machine; cancelled orders may be reactivated unintentionally.
- **Fix:** Define allowed transitions for draft/confirmed/fulfilled/cancelled and enforce in service.
- **Done when:** Invalid order status transitions return clean errors.

## SALES-DEEP-29 — Prune unnecessary hydration in summary endpoints

- **Severity:** Medium/High
- **Files:** `summary_services.py`, summary response tests.
- **Issue:** Summary builders hydrate custom fields on related objects even when response schemas do not expose those custom fields.
- **Fix:** Hydrate only records whose schema includes `custom_fields`. Remove hydration for related opportunities/quotes where only compact summaries are returned.
- **Done when:** Summary endpoint query count drops without response shape changes.

## SALES-DEEP-30 — Refactor related insertion-order matching

- **Severity:** Medium
- **Files:** `summary_services.py`.
- **Issue:** `_get_related_insertion_orders` uses many nested branches for contact/org/name combinations.
- **Fix:** Build condition list programmatically and combine once; add tests for each contact/org/name combination.
- **Done when:** IO matching is easier to review and regression-test.

## SALES-DEEP-31 — Fetch quote proposal events only when needed

- **Severity:** Low/Medium
- **Files:** `summary_services.py`.
- **Issue:** Quote summary fetches proposal events even when no proposal exists.
- **Fix:** Call `list_quote_proposal_events` only if latest proposal exists.
- **Done when:** Quote summary avoids unnecessary event queries.

## SALES-DEEP-32 — Make follow-up logging and task creation atomic

- **Severity:** High
- **Files:** `followups.py`, tests.
- **Issue:** Contact/lead/opportunity follow-up logging commits last-contacted/activity before optional follow-up task creation.
- **Fix:** Move commit after all side effects or use a savepoint/outbox. Return partial-failure info only if product allows best-effort tasks.
- **Done when:** Follow-up update, activity, and requested task creation cannot split silently.

## SALES-DEEP-33 — Define quote follow-up behavior

- **Severity:** Medium
- **Files:** `models.py`, `followups.py`, schemas/frontend.
- **Issue:** Quote follow-ups do not update quote `last_contacted_at` because quote model has no such field.
- **Fix:** Either add quote follow-up timestamps or document quote follow-ups as activity-log-only.
- **Done when:** Quote follow-up behavior matches product expectations.

## SALES-DEEP-34 — Scope reminder scans by tenant and chunk work

- **Severity:** Critical
- **Files:** `reminder_scans.py`, scheduler/Celery tests.
- **Issue:** `_stale_contacts` and `_inactive_opportunities` query all tenants.
- **Fix:** Run per tenant or iterate tenants explicitly. Add `tenant_id` filters, chunk/cursor pagination, and per-row failure collection.
- **Done when:** Reminder scan behavior is tenant-scoped, bounded, and failure-aware.

## SALES-DEEP-35 — Make automated reminder task creation transactional

- **Severity:** High/Medium
- **Files:** `reminder_scans.py`, `tasks_services.py` integration tests.
- **Issue:** Reminder scan creates a task, then notifications/logs. If later side effects fail, the task remains without full context.
- **Fix:** Use a savepoint/outbox or make notifications/logs best-effort with logged failures.
- **Done when:** Automated reminder task creation has clear all-or-best-effort semantics.

## SALES-DEEP-36 — Use stable reminder dedupe keys

- **Severity:** Medium
- **Files:** `reminder_scans.py`.
- **Issue:** Reminder dedupe checks exact title, which changes when contact/deal display name changes.
- **Fix:** Deduplicate by `source_module_key`, `source_entity_id`, and reminder type/prefix rather than full title.
- **Done when:** Renaming a contact/deal does not create duplicate reminder tasks.

## SALES-DEEP-37 — Remove broad `ValueError` catches in sales routes

- **Severity:** Medium
- **Files:** contacts/org import/create routes.
- **Issue:** Some routes wrap handlers in broad `ValueError` catches while services mostly raise `HTTPException`.
- **Fix:** Remove dead catches or catch only known parsing/config errors with precise status codes.
- **Done when:** Route errors are not swallowed into generic 400s.

## SALES-DEEP-38 — Fix contact organization-search permission boundary

- **Severity:** Medium
- **Files:** `contacts_routes.py`, permissions tests.
- **Issue:** `/contacts/organization-search` queries organizations but is guarded by contact permissions.
- **Fix:** Require organization view permission, or document this endpoint as a contact-form helper and restrict output fields.
- **Done when:** Users cannot enumerate organizations through unintended permissions.

## SALES-DEEP-39 — Normalize organization create/search route shape

- **Severity:** Medium
- **Files:** `organizations_routes.py`, frontend hooks.
- **Issue:** Create uses `POST /organizations/create` while most modules use `POST /module`; search by name path can be fragile around route order.
- **Fix:** Add `POST /sales/organizations`; keep old route deprecated. Prefer query-param search over `/search/{name}`.
- **Done when:** Organization routes are consistent and route-order safe.

## SALES-DEEP-40 — Avoid double organization fetch in edit route

- **Severity:** Medium
- **Files:** `organizations_routes.py`, `organizations_services.py`.
- **Issue:** Edit route loads organization for before-state, then `update_organization` loads/hydrates again.
- **Fix:** Pass the already-loaded raw organization into update service or add update-by-instance helper.
- **Done when:** Organization updates avoid redundant fetch/hydration.

## SALES-DEEP-41 — Do not bypass disabled-field policy with opportunity default assignee

- **Severity:** High/Medium
- **Files:** `opportunities_routes.py`, service tests.
- **Issue:** Create route defaults `assigned_to` after payload sanitization, potentially reintroducing a disabled field.
- **Fix:** Default assignee before disabled-field sanitization or move defaulting into service with explicit exemption.
- **Done when:** Disabled field policy cannot be bypassed by route defaults.

## SALES-DEEP-42 — Keep opportunity static route order guarded

- **Severity:** Low/Medium
- **Files:** `opportunities_routes.py`, route tests.
- **Issue:** Static routes such as `/pipeline-summary` must remain before dynamic ID routes.
- **Fix:** Add route resolution tests and comments near static/dynamic route sections.
- **Done when:** Future route additions cannot shadow static opportunity endpoints.

## SALES-DEEP-43 — Add small inline quote export path or document background-only policy

- **Severity:** Medium
- **Files:** `quotes_routes.py`, export UX.
- **Issue:** Quote export is always backgrounded while imports may run inline/background, creating inconsistent UX.
- **Fix:** Add small inline export or explicitly document quotes as always async due proposal/file size assumptions.
- **Done when:** Quote export behavior is intentional and consistent.

## SALES-DEEP-44 — Propagate create-organization errors to callers

- **Severity:** High/Medium frontend
- **Files:** `frontend/hooks/sales/useOrganizations.ts`, create modal.
- **Issue:** `createOrganization` catches errors, logs/toasts, and returns undefined, so modal callers cannot know failure vs success.
- **Fix:** Re-throw after setting local state, or return a typed result. Let the modal show inline error.
- **Done when:** Failed organization creation is observable by caller.

## SALES-DEEP-45 — Standardize sales hook fetcher signatures and API column filtering

- **Severity:** Medium frontend
- **Files:** `useContacts.ts`, `useLeads.ts`, `useQuotes.ts`, `useOrganizations.ts`, `useOrders.ts`, shared utility.
- **Issue:** Hooks pass `(filters, visibleColumns)` in inconsistent order and duplicate custom-column filtering. `useOrders` currently ignores visible columns entirely.
- **Fix:** Add shared `getApiColumns(visibleColumns)` and standardize fetcher signatures to match `usePagedList`.
- **Done when:** Hook fetcher argument order and `fields=` behavior are consistent.

## SALES-DEEP-46 — Invalidate opportunity pipeline summary from hook mutations

- **Severity:** High/Medium frontend
- **Files:** `frontend/hooks/sales/useOpportunities.ts`.
- **Issue:** `refreshLists` invalidates only `sales-opportunities`; stage/list mutations can leave pipeline summary stale.
- **Fix:** Invalidate `['sales-opportunities-pipeline-summary']` from create/update/delete/stage mutations.
- **Done when:** Pipeline summary updates after all opportunity mutations.

## SALES-DEEP-47 — Stabilize and type opportunity pipeline summary query

- **Severity:** Medium frontend
- **Files:** `frontend/app/dashboard/sales/opportunities/page.tsx`.
- **Issue:** Query key uses `activeFilters` object directly and `fetchPipelineSummary` accepts `unknown`.
- **Fix:** Use stable serialized filter key or querystring key; type filters as `SavedViewFilters`.
- **Done when:** Equivalent filters share cache and TypeScript catches filter-shape drift.

## SALES-DEEP-48 — Clarify opportunity board pagination semantics

- **Severity:** Medium frontend/product
- **Files:** opportunities page/board.
- **Issue:** Pipeline board receives current page opportunities only, so kanban is not a full pipeline unless all records are loaded.
- **Fix:** Add UI note “showing current page” or switch board to cursor/infinite loading by stage.
- **Done when:** Users understand board scope or board loads complete stage data.

## SALES-DEEP-49 — Guard opportunity detail stage updates and split loading states

- **Severity:** High/Medium frontend
- **Files:** `opportunities/[opportunityId]/page.tsx`.
- **Issue:** Stage changes can race with save/other stage changes, and `loadSummary` sets full `loading=true` on every refresh.
- **Fix:** Add in-flight guard/ref and split `initialLoading` from `refreshing`.
- **Done when:** Stage changes serialize and post-save refresh does not destroy form UI.

## SALES-DEEP-50 — Move contact WhatsApp templates to React Query and fix popup flow

- **Severity:** High/Medium frontend
- **Files:** `contacts/[contactId]/page.tsx`.
- **Issue:** Templates load via manual `useEffect`, and async `window.open` after API response may be blocked by popup blockers.
- **Fix:** Use React Query for templates. Open a placeholder window synchronously on click, then assign URL after API returns, or render a direct link.
- **Done when:** Template loading is cached and WhatsApp launch works reliably.

## SALES-DEEP-51 — Avoid stale organization ID writes from contact detail save

- **Severity:** Medium frontend
- **Files:** `contacts/[contactId]/page.tsx`.
- **Issue:** Save payload always includes loaded `organization_id`, which can overwrite concurrent reassignment.
- **Fix:** Include organization ID only if editable/changed, or add an org picker and track dirty state.
- **Done when:** Saving unrelated contact fields does not reset organization assignment.

## SALES-DEEP-52 — Improve org detail refresh and assignment UX

- **Severity:** Medium frontend
- **Files:** `organizations/[orgId]/page.tsx`.
- **Issue:** Org detail likely shares full-loading refresh pattern; assigned user is not editable; customer group parsing should reject empty/invalid values.
- **Fix:** Split initial/refresh loading, add assigned-user picker or document alternate flow, and harden customer group parsing.
- **Done when:** Org detail save flows are stable and explicit.

## SALES-DEEP-53 — Align quote detail field config with quote number writes

- **Severity:** Medium frontend/backend
- **Files:** `quotes/[quoteId]/page.tsx`, quote route/service field config.
- **Issue:** Quote detail always sends `quote_number` via always-include. If field config disables it, backend may reject or policy is unclear.
- **Fix:** Decide whether quote number is system-required immutable/writable; update frontend and backend field config accordingly.
- **Done when:** Quote number update policy is consistent.

## SALES-DEEP-54 — Verify public quote proposal link target

- **Severity:** Medium frontend
- **Files:** `quotes/[quoteId]/page.tsx`, API URL helper.
- **Issue:** Proposal path is relative and rendered through `apiUrl(...)`. It may point to API base instead of frontend/public path depending on helper behavior.
- **Fix:** Verify URL generation. Use explicit frontend base for public/client links if needed.
- **Done when:** Generated quote proposal links open the intended public/frontend route.

## SALES-DEEP-55 — Reset convert-lead dialog state on reopen

- **Severity:** Medium frontend
- **Files:** `components/leads/ConvertLeadDialog.tsx`.
- **Issue:** Conversion result can persist across close/reopen because local state is not reset on open change.
- **Fix:** Reset `result` and transient state in `useEffect` when opened or in close handler.
- **Done when:** Reopening conversion dialog starts clean.

## SALES-DEEP-56 — Replace create-contact manual org dropdown with linked picker

- **Severity:** High/Medium frontend
- **Files:** `components/contacts/createContactModal.tsx`, `hooks/sales/useCreateContact.ts`.
- **Issue:** Modal fetches first 50 orgs and uses custom mouse dropdown. Permission behavior differs from organization search/picker flows.
- **Fix:** Use `LinkedRecordPicker` or a server-search picker with proper permissions, keyboard handling, and pagination.
- **Done when:** Contact create org selection scales and is accessible.

## SALES-DEEP-57 — Improve CreateQuoteModal linked display and numeric parsing

- **Severity:** Medium frontend
- **Files:** `components/quotes/CreateQuoteModal.tsx`.
- **Issue:** Selecting an opportunity can show `Contact #id` instead of a name; string IDs converted with `Number()` can become `NaN` if state is corrupted.
- **Fix:** Fetch/display contact name or use “Linked via deal”; centralize safe number parsing.
- **Done when:** Quote modal linked fields show meaningful labels and never submit `NaN`.

## SALES-DEEP-58 — Canonicalize opportunity stage helpers

- **Severity:** Low/Medium frontend
- **Files:** `components/opportunities/opportunityStages.ts`, tables/board, backend stage config.
- **Issue:** Stage style helper has multiple import paths and frontend/backend stage lists can drift.
- **Fix:** Use one import path for styles and add a shared metadata endpoint or parity tests for stages.
- **Done when:** Stage metadata is consistent across frontend/backend.

---

## Migration checklist

- Add `updated_at` to `sales_organizations` if product wants recency sort/display.
- Change opportunity `attachments` from `Text` to JSON/JSONB after validating existing rows.
- Add/adjust quote/order number allocator tables or sequences.
- Consider `String(64)` for quote open-event hash columns.
- Consider relationship loader changes carefully; no DB migration, but query behavior changes.
- Add composite/search indexes only after EXPLAIN confirms query benefit.

## Test checklist

Backend:

- Cross-tenant organization CSV duplicates do not block import.
- Parent+custom-field writes roll back together for contacts/orgs/opps/leads/quotes.
- Opportunity `include_deleted=True` semantics are corrected; restore uses deleted-only lookup explicitly.
- Reminder scans are tenant-scoped and chunked.
- Follow-up log + task creation is atomic or explicitly best-effort with logged failures.
- Quote/order number generation is race-safe.
- Quote import validates linked record tenant ownership.
- Summary endpoints preserve response shapes with fewer hydration queries.
- Route permission tests cover contact organization-search and disabled-field defaulting.

Frontend/manual:

- Opportunity pipeline summary invalidates after stage changes and uses stable query key.
- Opportunity board either shows current-page scope or loads all relevant stage records.
- Detail pages refresh without full skeleton flashes after save.
- WhatsApp action opens reliably despite async API call.
- Create contact org picker works beyond 50 orgs and supports keyboard navigation.
- Organization creation errors surface to the modal.
- Quote proposal links point to the correct public/frontend route.
- Convert lead dialog resets when reopened.

## Explicit audit corrections

- `organizations_repository` already supports `customer_group_id` sort; do not add it again.
- `organizations_repository.list_cursor` already orders by `org_id DESC` before limiting; add a test if desired.
- Public quote proposal client host access is already guarded; no fix needed for that specific claim.
- `SalesQuoteOpenEvent` DB check already includes `sent`; the cleanup is around public/internal event constants and documentation.
- List routes currently use list-item schemas in the places noted; keep regression tests to prevent future heavy-response drift rather than treating every case as currently broken.
