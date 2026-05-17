# MAAD-CRM Codex Fix Plan — Consolidated Issue List

This file consolidates the uploaded issue notes into one Codex-ready backlog. Duplicate or overlapping reports are merged into a single action item, but all unique issues from the uploaded text are represented.

## How Codex should use this file

1. Fix items by priority: **P0 → P1 → P2 → P3 → P4**.
2. Keep commits small and grouped by module/file.
3. Do not remove an issue just because it appears to be “minor”; implement, document, or explicitly mark as intentionally accepted.
4. For each completed item, add or update tests where reasonable.
5. After each priority group, run backend tests, frontend type checks, linting, and a smoke test of affected pages.

---

# P0 — Security, access control, and data protection

These should be fixed first because they can expose data, weaken auth, allow abuse, or cause unsafe file handling.

| ID | Area | File(s) | Issue | Required fix / expected behavior |
|---|---|---|---|---|
| P0-01 | Documents | `backend/app/modules/documents/services/storage_backends.py` | Document path resolution checks the path against `DOCUMENT_STORAGE_DIR` while constructing from `UPLOADS_DIR`, allowing boundary confusion. | Use one trusted root consistently. Prefer storing server-generated filenames only, reconstruct paths server-side, and reject any path outside the allowed upload root.<br>Done 2026-05-17: local document saves now store tenant-relative server-generated paths under `DOCUMENT_STORAGE_DIR`; legacy `documents/...` rows still resolve through the same root and traversal/absolute escapes are rejected. |
| P0-02 | Documents | `backend/app/modules/documents/services/document_services.py` | `_validate_document_signature` only checks PDF header/footer and does not validate magic bytes for non-PDF files or content type mismatch. | Add magic-byte validation for all allowed file types, confirm declared MIME type matches detected type, and reject suspicious polyglot files.<br>Done 2026-05-17: upload validation now returns detected MIME by extension, rejects declared MIME mismatches, keeps non-PDF signature checks, and blocks allowed-type magic bytes under the wrong extension. |
| P0-03 | Client portal | `backend/app/modules/client_portal/routes.py` | `_request_metadata` stores unbounded `user-agent` and raw client host in JSON. Large headers can bloat DB rows. | Truncate user-agent, for example 500 chars. Validate/normalize IP address. Never store arbitrarily large request metadata.<br>Done 2026-05-17: request metadata now truncates user-agent to 500 chars, normalizes valid IP literals, and drops malformed client hosts before persistence. |
| P0-04 | Client auth | `setup_client_password` service | Client portal password setup has no password strength enforcement. | Apply the same password policy used by main auth before hashing/storing the password.<br>Done 2026-05-17: client password setup now relies on the shared password hasher policy and maps weak-password failures to a controlled 400 response before storing. |
| P0-05 | Client auth | `authenticate_client_account` service / route | Client login has no application-level brute-force protection. | Add failed-attempt tracking, exponential backoff, lockout, or rate limiting for `/client-auth/login`.<br>Done 2026-05-17: `/client-auth/login` now uses cache-backed tenant/email and tenant/IP failed-attempt counters, returns 429 after repeated failures, records auth failures, and clears counters after success. |
| P0-06 | Public client pages | `public_client_pages_router` | Public accept/request-changes endpoints can be spammed by anyone with a valid page token. | Rate-limit by IP + page token. Prevent flooding `client_page_actions`.<br>Done 2026-05-17: public accept/request-changes routes now check a cache-backed token/IP action limit before writes and record successful action attempts to throttle repeated submissions. |
| P0-07 | Public client document downloads | `frontend/hooks/useClientPortal.ts` and backend download route | `publicClientPageDocumentUrl` exposes a raw public-token URL; anyone with it can download documents if backend only checks page token. | Backend must verify document access against the intended client/contact/org and require client auth where appropriate. Frontend should fetch blob with client JWT and create an object URL instead of linking directly.<br>Done 2026-05-17: public document downloads now require a client JWT whose account matches the page contact/org; the public client page fetches document blobs with that token and opens object URLs instead of exposing raw download links. |
| P0-08 | Custom modules access | `backend/app/modules/custom_modules.py` | `_require_module_action` lets admins bypass all permission checks by role level before checking whether the module is enabled for tenant. | Always check tenant module enablement first. Admin bypass may skip action assignment checks only after module-enabled check passes.<br>Done 2026-05-17: verified current `_require_module_action` checks tenant module enablement before admin role bypass, covered by the disabled-module admin regression test. |
| P0-09 | CRM events/webhooks | `backend/app/modules/crm_events.py` | `format_event_message` dumps nearly the entire payload for unknown event types, possibly leaking sensitive fields to Slack/Teams webhooks. | Use explicit allowlists by event type. Generic fallback should include only safe fields like `event_type` and `entity_id`.<br>Done 2026-05-17: unknown webhook event messages now include only event type, entity type, entity ID, and action, with regression coverage proving sensitive fallback payload fields are not emitted. |
| P0-10 | Mail OAuth | `backend/app/modules/mail_services.py` | Google OAuth callback/upsert accepts whatever account email Google returns, so a compromised flow could swap linked account email. | Validate returned account email against the expected/stored connection or require explicit relink flow when account email changes.<br>Done 2026-05-17: Google mail upsert now rejects first-time OAuth connects whose returned email does not match the signed-in user, while preserving the existing stored-account swap rejection. |
| P0-11 | Mail secrets | `backend/app/modules/mail_services.py` | `decrypt_secret` fallback to `JWT_SECRET` has no re-encryption path after successful fallback decrypt. Rotating `MAIL_CREDENTIAL_SECRET` can strand old credentials. | Implement key-versioning or re-encrypt-on-read migration path. Log safe migration info, not secrets.<br>Done 2026-05-17: verified rotated mailbox credentials re-encrypt on read through `decrypt_secret_with_rotation`; added safe migration logging with tenant/user/provider/connection identifiers only. |
| P0-12 | Mail source context | `backend/app/modules/mail_services.py` | `_resolve_mail_source_context` exposes record existence by returning different 400 behavior from `get_record_reference`. | Return a generic authorization/validation response and avoid exposing whether a record ID exists.<br>Done 2026-05-17: source resolution failures now return the same generic 400 response for inaccessible, missing, invalid, or unsupported source records. |
| P0-13 | Calendar Google integration | `backend/app/modules/calendar_services.py` | `_ensure_google_app_calendar` stores provider calendar IDs from Google without validating format. | Validate external calendar ID string shape/length before storing. Reject or ignore invalid values.<br>Done 2026-05-17: verified Google app calendar IDs are pattern-validated before storage and added regression coverage for rejecting invalid provider IDs. |
| P0-14 | Mail frontend | `frontend/app/dashboard/mail/page.tsx` | IMAP password remains in React state for the session/form lifetime. | Clear `mailPassword` in a `finally` block immediately after connect attempt, regardless of success/failure.<br>Done 2026-05-17: verified `handleConnectImapSmtp` clears `imapForm.password` in `finally` after every connect attempt. |
| P0-15 | Finance downloads | `backend/app/modules/finance/services/io_search_api.py` | `_resolve_io_download_path` fallback joins `IO_SEARCH_UPLOAD_DIR / record.file_name`; if `file_name` contains `/` or absolute components it can path-traverse. Also invalid path returns 400 instead of access-denied. | Sanitize fallback filename with `Path(record.file_name).name`; enforce root boundary; return 403 `Access denied` on traversal.<br>Done 2026-05-17: fallback download filenames are sanitized with `Path(...).name`, returned filenames are sanitized, and root-boundary traversal failures now return 403 `Access denied.` |
| P0-16 | Finance IO sequence | `backend/app/modules/finance/services/io_search_services.py` | IO number import sequence/duplicate detection can race under parallel imports; dead `_get_max_io_sequence` is unsafe if reused. | Use DB sequence/constraints with `INSERT ... ON CONFLICT` or SERIALIZABLE transaction. Remove dead `_get_max_io_sequence`.<br>Done 2026-05-17: removed dead max-sequence helper, kept IO allocation on `finance_io_number_seq`, added active-row unique index on `(tenant_id, module_id, io_number)`, and mapped create/import unique races to duplicate failures. Compile passed; Alembic graph has the new head, but live upgrade is blocked by the database referencing missing revision `20260531_module_settings_cleanup`. |
| P0-17 | Website integrations | `backend/app/modules/website_integrations/services/website_integration_services.py` | Rate limiting is per-process if cache is local memory, so multiple workers bypass limits. | Require Redis/distributed cache for production rate limiting; add startup warning if local cache + rate limiting + multi-worker.<br>Done 2026-05-17: startup validation now requires `REDIS_URL` for production website integration rate limiting, and the multi-worker local-cache warning explicitly calls out per-worker rate-limit bypass risk. |
| P0-18 | Website integrations | `website_integration_services.py` | `_hash_payload` uses `jsonable_encoder`; Decimal values can collapse distinct values like `1.10` and `1.1`. | Serialize Decimals as exact strings before hashing. Use deterministic JSON separators and sorted keys.<br>Done 2026-05-17: payload hashing now recursively serializes `Decimal` values as exact strings before sorted/separator-stable JSON hashing. |
| P0-19 | Website integrations | `_resolve_public_catalog_item_for_order` / `_apply_stock_decrement` | Product lock is acquired before stock decrement, but stock write may use stale object state; service stock tracking would be unsafe if added. | Move lock-and-read into `_apply_stock_decrement` or re-fetch product with `with_for_update()` there. |
| P0-20 | Mentions | `backend/app/modules/record_comments.py` | Mention validation can leak deleted/missing user existence details through 400 responses. | Avoid detailed existence leakage. Validate visible mentionable users in one query and return generic invalid mention errors. |

---

# P1 — Correctness, data integrity, and broken behavior

These are likely to create wrong data, skipped syncs, duplicate records, ghost rows, misleading user responses, or broken UI state.

| ID | Area | File(s) | Issue | Required fix / expected behavior |
|---|---|---|---|---|
| P1-01 | User creation | `backend/app/modules/user_management/services/admin_users.py` | `create_user` commits the user before creating the setup link. If setup link creation fails, user is orphaned without token. | Use `db.flush()` to get ID, create setup token in same transaction, then single commit + refresh. |
| P1-02 | User validation | `admin_users.py` | Role/team validation fires separate queries and update paths duplicate validation. | Batch where practical; avoid redundant role/team lookups. |
| P1-03 | User update | `admin_users.py` / schemas | `update_user` validates `is_active == pending` after DB fetch. | Move to schema validator so invalid payloads fail before DB round-trip. |
| P1-04 | User search route | `backend/app/modules/user_management/routes/admin.py` | Route still supports legacy `filters + filter_logic` fallback while frontend sends `filters_all/filters_any`; logic is fragile. | Drop legacy fallback or isolate compatibility logic clearly. Use only `filters_all/filters_any` for current frontend. |
| P1-05 | IMAP sync | `backend/app/modules/mail_services.py` | `sync_imap_smtp_inbox` cursor logic can skip new messages because UID boundary and ordering are inconsistent. | Always sort UIDs ascending, filter out boundary UID explicitly, and apply one consistent ordering for cursor/full sync. |
| P1-06 | Sent mail storage | `mail_services.py` | `_append_sent_imap_message` silently swallows all exceptions. | Log append failures and return/record warning state without failing the SMTP send unless required. |
| P1-07 | Mail disconnect | `mail_services.py` | `disconnect_mail_connection` creates a ghost disconnected row if provider was never connected. | Return early or raise 404 when no connection exists. Do not create phantom rows. |
| P1-08 | Mail send logging | `mail_services.py` | `send_mail_message` commits sent mail row before `_log_mail_source_activity`; if logging fails, caller gets 500 even though mail was sent. | Treat activity logging failure as non-fatal: log server-side and keep send success response. |
| P1-09 | Mail token refresh transaction | `mail_services.py` | `_refresh_google_mail_token` commits inside callers that may already be mid-transaction. | Use `db.flush()` in token refresh helpers and let outer request own commit/rollback. Apply to Microsoft too if same pattern exists. |
| P1-10 | Calendar task event creation | `calendar_services.py` | `_list_duplicate_task_events` and `get_calendar_event_from_task` perform redundant duplicate queries; dedup logic only exists in one path. | Use one canonical duplicate-detection path. Remove redundant query. |
| P1-11 | Calendar task delete | `calendar_services.py` | `delete_calendar_event_from_task` deletes all duplicates but returns only the first deleted record; route serializes deleted object. | Return a safe deletion summary or the pre-delete serialized event. Do not serialize deleted ORM row. |
| P1-12 | Calendar invite response | `calendar_services.py` | `respond_to_calendar_invite` has confusing owner/participant logic and error message; possible bypass concern around team participants. | Explicitly check current user participant entry and `is_owner`. Owners should not respond to their own invite. Return clear error. |
| P1-13 | Calendar notifications | `calendar_services.py` | `_notify_new_participants` commits separately after event commit, causing partial state if notification insert fails. | Insert notifications before the single event commit, or make notification failure non-fatal and logged. |
| P1-14 | Calendar external sync bootstrap | `frontend/components/CalendarSyncBridge.tsx` | Session key includes `last_synced_at`; after sync, key changes and can retrigger bootstrap sync. | Build stable session key from provider/status/error state, not `last_synced_at`, or persist failed/completed session flags. |
| P1-15 | Calendar sync error handling | `CalendarSyncBridge.tsx` | `void syncCalendar().catch(() => {})` swallows errors; repeated failures retry every page load. | Log failure and persist session-level failed flag so bridge does not spam retries. |
| P1-16 | Client portal group resolution | `client_portal_services.py` | `resolve_client_customer_group(db=None, account=account)` can silently return `None` if relationship not eager-loaded. | Pass real DB session or eager-load `contact.customer_group` and `organization.customer_group`. |
| P1-17 | Optional client auth | `client_portal_routes.py` | `_optional_client_account` propagates 401 for stale/tampered token on public pages instead of treating user as unauthenticated. | For optional auth routes, catch auth failure and return `None`. Keep strict auth on protected routes. |
| P1-18 | Custom module seed access | `custom_modules.py` | `_seed_access` inserts permissions without checking existing rows; can duplicate if constraints missing or create flow repeats. | Use upsert/insert-ignore or existence checks. Ensure DB constraints prevent duplicates. |
| P1-19 | Saved views | `frontend/hooks/useSavedViews.ts` | `sameAppliedConfig` ignores `all_conditions` and `any_conditions`, so switching views with same columns/search/sort but different conditions may not update draft config. | Compare condition arrays too, or remove optimization and rely on selected-view key guard. |
| P1-20 | Saved views | `useSavedViews.ts` | `lastAppliedViewKeyRef` includes `updated_at`; background save/refetch resets draft config and discards unsaved edits / causes flash. | Build view key from stable identity only, such as id/default/system flags. Do not reset drafts merely because `updated_at` changed. |
| P1-21 | Saved views | `useSavedViews.ts` | `setSelectedViewId` inside an effect that depends on `selectedViewId` can double-apply or loop when views change. | Remove `selectedViewId` from deps and track current value with a ref. |
| P1-22 | Saved views | `useSavedViews.ts` | `deleteCurrentView` always resets to `system-default`, causing a flash/wrong config if another default view should be selected. | After delete, select current default view from existing list when available; otherwise system default. |
| P1-23 | Saved views | `useSavedViews.ts` | `defaultConfig.visible_columns` array in effect deps can rerun effect and overwrite user draft changes if parent does not memoize. | Use stable string dep or memoize default config at call sites. |
| P1-24 | Finance hook/page | `frontend/app/dashboard/finance/insertion-orders/page.tsx` / `useInsertionOrders` | Hook receives `initialPage=1, pageSize=10` while also managing internal pagination; manual page changes may be ignored/reinitialized. | Either fully own pagination in hook or parent, not both. Ensure page changes affect query. |
| P1-25 | Activity logs | `backend/app/modules/activity_logs.py` | `entity_id` is string column but callers pass ints/strings inconsistently. | Normalize `entity_id` to string at model/service boundary, preferably with validator. |
| P1-26 | Calendar dialog state | `calendar/page.tsx` | `dialogKey` uses `activeEvent?.updated_at`; every save remounts the dialog and can reset form state after failed edits. | Key by event id/new state and refresh form inside dialog effect only when intended. |
| P1-27 | Finance POS invoice | `backend/app/modules/finance/models.py` | `FinancePosInvoice.created_by` relationship actually points through `user_id`; name is misleading and serializer uses `created_by`. | Rename to `assigned_user` or rename column to `created_by_user_id`; update serializer accordingly. |
| P1-28 | Integration settings page | `frontend/app/dashboard/settings/integrations/page.tsx` | Manual `loadWebsiteIntegrations`, `loadChannels`, `loadEvents` cause no caching and `loadEvents` fires twice on first render. | Migrate to React Query for API keys/orders/channels/events and use `eventFilters` as query key. |

---

# P2 — Performance and scalability

These should be addressed before the system grows because many create N+1 queries, memory spikes, repeated network calls, or unnecessary re-renders.

| ID | Area | File(s) | Issue | Required fix / expected behavior |
|---|---|---|---|---|
| P2-01 | User management | `admin_users.py` | `list_all_users` / `search_users` outerjoin team/role for sorting but still use relationships that can lazy-load during serialization. | Use `contains_eager(User.team)` and `contains_eager(User.role)` when already joining. |
| P2-02 | User model | `user_management/models.py` | `team_name` / `role_name` properties trigger lazy loads and can fail on detached sessions. | Remove properties or avoid relying on them for serialization; populate names from explicit joins/service layer. |
| P2-03 | User list count | `admin_users.py` | `query.count()` plus paged query creates expensive double query with joins. | Use optimized count/window/subquery strategy and indexes. |
| P2-04 | User indexes | `user_management/models.py` | Missing helpful composite indexes for common tenant/team/role filter patterns. | Add indexes such as `users(tenant_id, is_active)`, `users(tenant_id, team_id)`, `users(tenant_id, role_id)` where supported. |
| P2-05 | User update options | `admin_users.py` | `list_user_update_options` loads roles/teams on every page load. | Cache for about 5 minutes and invalidate on role/team create/update/delete. |
| P2-06 | Calendar serialization | `calendar_services.py` | List routes serialize events in loop while accessing lazy `owner` and `participants`. | Add `selectinload(CalendarEvent.owner)` and participant loads to all event list queries. |
| P2-07 | Calendar context | `calendar_services.py` | `build_calendar_context` loads all tenant users into memory. | Limit/paginate users, for example `.limit(500)`, or provide searchable picker endpoint. |
| P2-08 | Calendar participant updates | `calendar_services.py` | `_apply_event_participants` flushes + refreshes, then caller commits + refreshes again. | Remove inner refresh; caller owns commit and single refresh. |
| P2-09 | Calendar query strategy | `calendar_services.py` | `list_calendar_events` uses multiple `.any()` correlated subqueries while `list_pending_invites` uses joins. | Rewrite visibility filters using explicit join + `distinct()` where appropriate. |
| P2-10 | Calendar external sync | `calendar_services.py` | `_sync_external_events_for_event` performs synchronous HTTP calls in create/update requests. | Move external sync to Celery/background job. Return request promptly. |
| P2-11 | Calendar app calendar | `calendar_services.py` | `_ensure_google_app_calendar` may call Google on every write even when provider calendar ID already exists/stale session object. | Check stored calendar ID before calling function; skip HTTP call if provider_calendar_id exists. |
| P2-12 | Calendar full sync | `calendar_services.py` | `sync_current_user_calendar` loads all non-deleted user events and syncs serially with many HTTP calls. | Enqueue background sync job with job ID/progress. Add batching/concurrency limits. |
| P2-13 | Calendar team notifications | `calendar_services.py` | `_notify_new_participants` queries team members inline and loops notification inserts. | Bulk-fetch users and bulk-insert notifications. |
| P2-14 | Calendar participants normalization | `calendar_services.py` | `_normalize_participants` queries DB once per user/team participant. | Bulk-fetch all referenced user IDs and team IDs upfront. |
| P2-15 | Calendar route re-query | `calendar_routes.py` / services | `get_calendar_event_or_404` called twice for update/delete. | Return refreshed already-loaded object from service instead of re-querying. |
| P2-16 | Calendar activity logging | `calendar_routes.py` | Activity logging calls `serialize_calendar_event` multiple times per update. | Capture before/after state once; avoid redundant serialization. |
| P2-17 | Mail message list | `mail_services.py` | `list_mail_messages` loads all messages up to limit and lacks pagination cursor. | Add cursor pagination, e.g. `before_id` or `before_received_at`. |
| P2-18 | Gmail sync | `mail_services.py` | `sync_google_inbox` lists IDs then calls one HTTP GET per message. | Use Gmail batch/partial fields where possible. |
| P2-19 | Mail search | `mail_services.py` | `list_mail_messages` checks `search.strip()` repeatedly and can apply ranked search to short/empty terms. | Strip once at top; only ranked-search meaningful terms. |
| P2-20 | Mail OAuth helpers | `mail_services.py` | Google/Microsoft refresh, upsert, callback, and sync error-handling code are duplicated. | Extract shared helpers for token refresh, upsert, callback handler, and `_mark_connection_error`. |
| P2-21 | IMAP connection tests | `mail_services.py` | IMAP connect has no timeout; unreachable hosts can block request thread. | Pass timeout to `imaplib.IMAP4_SSL` and `IMAP4` constructors; keep SMTP timeout too. |
| P2-22 | Mail body extraction | `mail_services.py` | `_extract_email_text` does not robustly handle `multipart/alternative`; may miss text if HTML appears first. | Collect text/plain parts and return longest/preferred plain part; explicitly handle alternatives. |
| P2-23 | Mail recipients parsing | `mail_services.py` | `_parse_recipients` does not unfold multiline/folded headers before `getaddresses`. | Use header registry or decode/unfold header before parsing. |
| P2-24 | Mail context | `mail_services.py` | `build_mail_context` duplicates serialization to compute `sync_available`. | Derive sync availability from already-serialized connections. |
| P2-25 | Frontend mail messages | `useMailMessages` | Different folder inputs can produce different cache keys but same fetch, e.g. undefined vs empty string. | Normalize folder at hook boundary. |
| P2-26 | Frontend mail folder cache | `useMailMessages` | Folder changes create separate query keys with no dedupe for overlapping inbox/all data. | Normalize and optionally seed list caches from existing mail data. |
| P2-27 | Calendar page rendering | `calendar/page.tsx` | 42 cells filter events repeatedly; selected day filter repeats over full events list. | Pre-group events into `Map<YYYY-MM-DD, CalendarEvent[]>` once per events change. |
| P2-28 | Calendar detail queries | `calendar/page.tsx` | `eventDetailQuery` and linked query can fire repeatedly on navigation/search param changes. | Stabilize `taskId/eventId` with memo and add `staleTime`. |
| P2-29 | Calendar event cache | `calendar/page.tsx` / `useCalendar.ts` | Direct `fetchCalendarEvent` query bypasses list cache. | Seed individual event cache from list data or check list cache before fetch. |
| P2-30 | Calendar invalidation | `useCalendar.ts` | `invalidateCalendar` invalidates events/context/notifications/recycle-bin on every action. | Split invalidation: core calendar always, notifications only when relevant, recycle-bin only on delete. |
| P2-31 | Mail page state | `mail/page.tsx` | IMAP form has 10 separate state variables that change together. | Replace with one `ImapFormState` object. |
| P2-32 | Mail page search | `mail/page.tsx` / `useMailMessages` | Single-character search triggers backend ranked search. | Enable search query only when empty or length >= 2. |
| P2-33 | Notifications polling | `useNotifications.ts` | Polls every 60s and can re-render sidebar/badge broadly. | Use `select` for unread count; consider focus-based refresh instead of constant polling. |
| P2-34 | Browser notifications | `BrowserNotificationsBridge.tsx` | `seenIdsRef` initializes empty then loads from sessionStorage in effect, causing race/duplicate notifications. | Initialize synchronously or use layout effect/ref initializer. |
| P2-35 | Browser notifications | `BrowserNotificationsBridge.tsx` | Seen notification IDs accumulate forever in sessionStorage. | Cap set to last N IDs or store max ID cursor. |
| P2-36 | Notification center | `NotificationCenter.tsx` | `markAllRead` uses optimistic update and success invalidation, causing double update/flash. | Use either optimistic update with settled handling or server-truth invalidation, not both. |
| P2-37 | Generic paged list | `usePagedList.ts` | `visibleColumnsKey = visibleColumns.join(',')` is order-sensitive for cache keys. | Sort visible columns for query key only; preserve user-defined fetch/display order separately. |
| P2-38 | Generic paged list | `usePagedList.ts` | Deferred filters mixed with non-deferred page/pageSize can create mismatched query keys. | Defer all related params together or avoid mixing deferred and non-deferred values in one key. |
| P2-39 | Global command palette | `GlobalCommandPalette.tsx` | `quickLinks` recomputes because `modules` array reference is unstable. | Return stable modules reference from hook or deep-equality guard state updates. |
| P2-40 | Global command palette | `GlobalCommandPalette.tsx` | Closing via Escape/Dialog close may not clear query, so reopened palette shows stale results. | Ensure all close paths clear query and relevant search state. |
| P2-41 | Pagination config | `Pagination.tsx` | `gcTime: Infinity` never invalidates page size config. | Use finite cache, e.g. 24h, or add config version/hash. |
| P2-42 | Pagination config | `Pagination.tsx` | Fetcher catches errors and returns fallback, so React Query never retries; fallback can persist all session. | Let error propagate and use `placeholderData` for fallback. |
| P2-43 | Job poller | `useJobPoller.ts` | `failureMessage` is captured by interval closure instead of ref. | Store `failureMessage` in ref like `onComplete`. |
| P2-44 | Job poller | `useJobPoller.ts` | Polling effect restarts on status changes and relies on fragile cancellation logic. | Restart only on `jobId`; track status with ref or simplify interval lifecycle. |
| P2-45 | React Query provider | `providers.tsx` | Global `refetchOnMount: false` + `staleTime: 30s` can keep critical data stale when components remount. | Remove global opt-out or tune by query; use shorter stale time for critical data. |
| P2-46 | Mentions | `list_mentionable_record_users` | Loads all active users and checks permissions per user. | Push search filter to DB and batch permission check via joins. |
| P2-47 | Recycle bin | `recycle_bin.py` / calendar delete listing | Calendar recycle branch serializes with `item.owner`, causing lazy load per row. | Eager-load owner in `list_deleted_calendar_events`. |
| P2-48 | Data transfer exports | `data_transfer_jobs.py` | Organization zip export builds entire archive bytes in memory before persisting. | Stream zip to temp file and move into result path. |
| P2-49 | Data transfer jobs | `data_transfer_jobs.py` | Import/export jobs can commit partial data with limited progress checkpoints. | Use savepoints/transaction strategy per module and robust final failure marking. |
| P2-50 | Custom fields | `custom_fields.py` | `save_custom_field_values` deletes all values and reinserts on every save. | Diff existing vs incoming and only mutate changed values. |
| P2-51 | Custom field cache | `custom_fields.py` | Prefix invalidation can be expensive if called without tenant/module. | Always pass tenant and module when known; avoid broad Redis scans. |
| P2-52 | Client pages list | `client_portal_services.py` | `_client_page_action_summary` performs 2 queries per page during listing. | Aggregate action counts/status in bulk for all pages. |
| P2-53 | Client portal normalization | `client_portal_services.py` | Pricing/proposal/brand normalization happens on writes and again on serialization. | Normalize on write only; serialization should trust stored normalized data. |
| P2-54 | Customer groups | `client_portal_services.py` | `ensure_default_customer_groups` runs on every list/read. | Seed defaults once at tenant creation/first login or use tenant flag to skip repeated checks. |
| P2-55 | Global search | `global_search.py` | Each module runs separate ranked query with no overall timeout/cap. | Add hard cap/timeouts; consider shared FTS index or async/concurrent search. |
| P2-56 | Finance models | `backend/app/modules/finance/models.py` | Finance IO relationships use `lazy='joined'`, adding joins on every list call. | Change to selective/eager loading via `selectinload` only where needed, or `noload` by default. |
| P2-57 | Finance import | `io_search_api.py` / import service | Bulk import collects all valid rows in memory before DB writes. | Process CSV in chunks, e.g. 500 rows, with transaction strategy. |
| P2-58 | Finance export | `io_search_api.py` | `yield_per` helps DB iteration but CSV bytes helper likely materializes whole export in memory. | Use `StreamingResponse` with generator. |
| P2-59 | Finance list sort | `insertionOrderList.tsx` | Client-side sort only sorts current page while backend already sorts full result. | Move sorting to backend params or label as “current page only”; preferably backend sort. |
| P2-60 | Finance POS dialog | `PosInvoiceDialog.tsx` | Single form state causes totals/footer to rerender on unrelated field changes. | Split header metadata state from pricing/totals state. |
| P2-61 | POS print | `PosInvoicePrintPage.tsx` | Fetches invoice and company profile via plain effect every load with no cache. | Use React Query; long stale time for company profile; session cache invoice. |
| P2-62 | Tenant middleware | `backend/app/main.py` | Tenant resolution queries DB on every HTTP request. | Cache tenant context by domain/subdomain for 30–60s, excluding health/static routes. |
| P2-63 | Module cache | `useAccessibleModules.ts` and callers | SessionStorage key `lynk_modules:v2` invalidation is repeated in many files. | Export one `invalidateModuleCache()` helper and call it everywhere. |
| P2-64 | CSS asset | `globals.css` | Inline SVG noise texture is embedded as data URI and reused in many components. | Move to `/public/noise.svg` so browser can cache it. |
| P2-65 | Catalog records | `CatalogRecordsPage.tsx` | `visibleColumns` fallback can recreate array references and trigger dependencies. | Memoize fallback visible columns. |

---

# P3 — UX, accessibility, frontend state, and interaction polish

These are visible quality issues or accessibility improvements.

| ID | Area | File(s) | Issue | Required fix / expected behavior |
|---|---|---|---|---|
| P3-01 | User table | `frontend/components/users/userManagementTable.tsx` | `fetchUsers` manually builds URLs instead of shared `usePagedList`, duplicating 60+ lines. | Migrate to `usePagedList`; use `/admin/users/search` consistently. |
| P3-02 | User table | `userManagementTable.tsx` | Option maps/teamIds/roleIds are recomputed inside async fetcher. | Resolve selected IDs in component/query state and pass IDs directly. |
| P3-03 | User table | `userManagementTable.tsx` | `filtersEqual` compares arrays with `join('|')`, so order changes look different. | Sort before compare or use set comparison. |
| P3-04 | User table | `userManagementTable.tsx` | Initial props/stateKey effect causes double render/fetch on mount. | Initialize state from props in `useState` initializer; use effect only for real stateKey resets. |
| P3-05 | User table | `userManagementTable.tsx` | `onStateChange` fires for prop-driven saved-view load, risking overwriting saved view state. | Track user-initiated vs prop-driven changes with a separate ref. |
| P3-06 | User table | `userManagementTable.tsx` | Query refetches on visibleColumns array reference changes. | Use stable serialized key for query key. |
| P3-07 | User table roles | `userManagementTable.tsx` | Role pill styles hardcode role names even though roles are tenant-configurable. | Derive style from role level or accept/document fallback; recommended level-based styling. |
| P3-08 | Mail buttons | `mail/page.tsx` | Connect Gmail/Microsoft buttons do not show loading spinner during OAuth redirect. | Show disabled/spinner state when `isConnectingMail` is active. |
| P3-09 | Mail IMAP preset | `mail/page.tsx` | Gmail IMAP/SMTP preset does not populate SMTP username if account email is empty. | Populate based on current email when available; otherwise fill all preset host/port/security values and handle username predictably. |
| P3-10 | Mail header actions | `mail/page.tsx` | Sync/connect/reconnect button conditions are hard to follow and can show confusing states. | Refactor provider action state into clear derived state: connect, reconnect-for-send, sync, disabled. |
| P3-11 | Mail search params | `mail/page.tsx` | Effect depends on whole `searchParams` object. | Derive exact `mailConnectStatus` param and depend on that. |
| P3-12 | Mail compose provider | `mail/page.tsx` | `toggleCompose` calculates provider availability inline and can use stale provider state. | Derive `defaultComposeProvider` with `useMemo`. |
| P3-13 | Calendar pending invites | `calendar/page.tsx` | Pending invites appear both in selected day events and Pending Invites panel. | Filter duplicates or display pending invites in one place only. |
| P3-14 | Calendar day create | `calendar/page.tsx` | Clicking `+` on a day cell also triggers day cell select due to propagation. | Stop propagation on the actual create button handler. |
| P3-15 | Calendar access check | `dashboard/layout.tsx` | Child page may mount/fetch while module access check later redirects. | Render null/skeleton during `isCheckingAccess`; prevent child fetches until access is resolved. |
| P3-16 | Notification center | `NotificationCenter.tsx` | Popover shows limited notifications and has no “View all” link. | Add link to activity log or dedicated notifications page. |
| P3-17 | Command palette focus | `GlobalCommandPalette.tsx` | Input focus via one `requestAnimationFrame` may fire before animation completes. | Focus on animation complete or use small delay. |
| P3-18 | Saved view editor | `SavedViewConditionEditor.tsx` | `crypto.randomUUID()` may fail in non-HTTPS dev contexts. | Add fallback ID generator. |
| P3-19 | Inline saved filters | `InlineSavedViewFilters.tsx` | `getConditionGroups` called twice per render. | Pass computed all/any conditions into editor and skip recompute. |
| P3-20 | Accessibility | `ModuleTableShell.tsx` | `aria-busy` on plain div has no semantic region/label. | Add `role='region'` and `aria-label='Data table'`. |
| P3-21 | Controlled state hook | `useControlledState.tsx` | `useLayoutEffect` for ref sync can create SSR warnings. | Use `useEffect` since no DOM measurement is needed. |
| P3-22 | Client layout splash | `ClientLayout.tsx` | Splash screen minimum is 3 seconds, too slow for fast connections. | Reduce to ~800ms or content-driven with 300ms anti-flash minimum. |
| P3-23 | Client layout dev artifact | `ClientLayout.tsx` | `DEV_ALWAYS_SHOW_SPLASH = false` comment indicates leftover debugging scaffold. | Remove dev artifact/comment or make it clearly development-only. |
| P3-24 | Finance IO dialog | `InsertionOrderDialog.tsx` | Customer dropdown closes on blur before keyboard/click selection and may be clipped inside scrollable dialog. | Use Popover/portal and focus-within handling. Minimum patch: longer delay + `onMouseDown.preventDefault`, but Popover preferred. |
| P3-25 | Record comments | `RecordCommentsPanel.tsx` | Mention regex fails on multiline input because `^` only matches string start. | Use multiline-aware pattern, e.g. line-start alternative or `m` flag. |
| P3-26 | Export controls | `ExportControls.tsx` | `downloadedExportJobRef` is not reset when export state resets. | Clear ref in `resetExportState`. |
| P3-27 | Insertion order dialog | `InsertionOrderDialog.tsx` | Duplicate report of dropdown closing on blur/keyboard navigation. | Covered by P3-24; ensure fix handles mouse, keyboard, and scroll clipping. |

---

# P4 — Refactoring, maintainability, consistency, and cleanup

These reduce confusion, duplicated code, and future bug risk.

| ID | Area | File(s) | Issue | Required fix / expected behavior |
|---|---|---|---|---|
| P4-01 | Calendar route permissions | `calendar_routes.py` | `create_calendar_event_from_task_route` has four independent permission dependencies; error may not say which one failed. | Accept as correct but document dual-module permission behavior or combine into clearer dependency. |
| P4-02 | Calendar service API | `calendar_services.py` | `get_calendar_event_or_404(bypass_visibility=True)` parameter exists but is not used by routes and could invite unsafe future use. | Remove parameter or replace with explicit admin-only function if needed. |
| P4-03 | Calendar hook exports | `useCalendar.ts` | Many raw async functions are exported unnecessarily. | Export only hooks and the few fetchers actually used outside the file. |
| P4-04 | Mail hook exports | `useMail.ts` | Raw async functions are exported as public API while page uses hooks. | Unexport raw fetchers unless externally needed. |
| P4-05 | Mail provider typing | `useMail.ts` | `connectMailProvider` accepts only Google/Microsoft while `MailProvider` includes `imap_smtp`; functionally OK but misleading and TS-confusing. | Rename/retighten types or split OAuth provider type from all mail provider type. |
| P4-06 | Mail recipient helpers | `mail_services.py` | Gmail/Microsoft send functions duplicate recipient formatting. | Consolidate API-recipient dict creation into helper. |
| P4-07 | Mail sync note | `mail_services.py` | `build_mail_context` sync note hardcodes Google/Microsoft and ignores IMAP wording. | Generate provider-aware sync note. |
| P4-08 | Calendar date helpers | `calendar/page.tsx` | `buildDayStart` / `buildDayEnd` recreate trivial Date objects. | Inline or memoize if kept. Low priority. |
| P4-09 | Mail constants | `mail/page.tsx` | `VARIABLE_TOKENS.map` and `FOLDERS.map` recreate arrays in JSX; source constants are stable. | Leave as acceptable or memoize render fragments for consistency. |
| P4-10 | Activity/comment types | `RecordActivityTimeline.tsx`, `RecordCommentsPanel.tsx` | Local types duplicate similar shared shapes. | Move to shared `types/activity.ts` and `types/comments.ts` if useful. |
| P4-11 | Paged list errors | `usePagedList.ts` | Default error message logic is hardcoded unless caller provides full function. | Add `fallbackErrorMessage` option. |
| P4-12 | Calendar/task pickers | `CalendarParticipantPicker.tsx`, `TaskAssigneePicker.tsx` | Components are nearly identical. | Extract generic `UserTeamPicker`. |
| P4-13 | Custom field table rendering | `insertionOrderList.tsx`, `OpportunitiesTable.tsx`, `OrganizationsTable.tsx`, `contactList.tsx` | Custom field cell rendering is copy-pasted. | Extract `renderCustomFieldCell` or `CustomFieldCell`. |
| P4-14 | Finance router prefix | `router.py` / finance router file | Finance router prefix is passed inline unlike other routers. | Move `/finance` prefix into finance router definition for consistency. |
| P4-15 | IO dead code | `io_search_services.py` | `_get_max_io_sequence` is dead; `parse_human_date` has unreachable return. | Delete dead function and unreachable return. |
| P4-16 | Website integration settings state | `settings/integrations/page.tsx` | Manual loading/saving state will be removed by P1/P2 React Query migration. | After migration, delete unused state/load functions. |

---

# Duplicate / merged issue map

These items appeared more than once or overlapped heavily. They are intentionally represented once above:

- Calendar visibility `.any()` / explicit join issue: merged into **P2-09**.
- Calendar serialization N+1 / recycle owner lazy-loading: split into **P2-06** and **P2-47** because they affect different list paths.
- Calendar invalidation too broad: merged into **P2-30**.
- Mail standalone exports duplicated: represented in **P4-04**.
- IMAP form state repeated as 9/10 states: represented in **P2-31**.
- Calendar selected-day/grid filtering repeated: represented in **P2-27**.
- `CalendarSyncBridge` dependencies/session key/retry behavior: split into **P1-14**, **P1-15**, and **P2-34** where applicable.
- `NotificationCenter` optimistic update/invalidation reported twice: represented in **P2-36**.
- `usePagedList` visible columns key/order issue reported twice: represented in **P2-37**.
- `useSavedViews` `updated_at`/`lastAppliedViewKeyRef` issue reported twice: represented in **P1-20**.
- Insertion order dropdown blur issue reported twice: represented in **P3-24** and noted as duplicate in **P3-27**.

---

# Acceptance checklist for Codex

## Backend checklist

- [ ] All file path resolution uses a single trusted root and rejects traversal.
- [ ] Uploaded document MIME/signature checks validate actual bytes for every allowed type.
- [ ] Client auth password setup uses the main password policy.
- [ ] Client login and public client page actions are rate-limited.
- [ ] Public document download access checks verify the intended client/account relationship.
- [ ] Custom module access checks tenant module enablement before admin bypass.
- [ ] Mail OAuth account email changes are handled safely.
- [ ] Mail credential secret fallback has a migration/re-encryption path.
- [ ] Mail IMAP sync no longer skips messages at cursor boundary.
- [ ] Calendar task-event duplicate/delete flows return safe, correct data.
- [ ] External Google calendar sync is moved out of hot request paths where specified.
- [ ] N+1 query paths are eager-loaded or rewritten.
- [ ] Large imports/exports are chunked or streamed.
- [ ] Tenant resolution is cached.
- [ ] All changed services have tests for success and failure paths.

## Frontend checklist

- [ ] Saved-view state changes do not overwrite drafts on background save/refetch.
- [ ] Calendar sync bridge does not repeatedly retry failed bootstrap syncs in the same session.
- [ ] Mail IMAP password is cleared after connect attempt.
- [ ] Calendar page no longer duplicates pending invites or propagates day `+` clicks.
- [ ] User table filter equality is order-insensitive.
- [ ] Query keys use stable serialized values where arrays are involved.
- [ ] Notification mark-all-read has one consistent update strategy.
- [ ] Dropdowns/popovers support mouse and keyboard selection.
- [ ] Accessibility fix added to table shell region.
- [ ] TypeScript passes without widening provider types incorrectly.

## Test / verification commands

Codex should run the project’s actual commands. If names differ, use the closest equivalents.

```bash
# Backend
pytest
ruff check backend
mypy backend || true

# Frontend
npm run typecheck
npm run lint
npm run test -- --runInBand || true
npm run build
```

## Manual smoke test areas

- User management list/search/filter/saved views.
- Mail: connect Google/Microsoft, connect IMAP/SMTP, sync inbox, send mail, disconnect.
- Calendar: create/update/delete event, invite response, task-linked calendar event, Google sync.
- Client portal: login, password setup, public page accept/request changes, document download.
- Documents upload/download for allowed and disallowed file types.
- Finance: insertion order CSV import/export, file download, POS invoice print.
- Website integrations: API key/order/event lists, rate-limit behavior.
- Notifications: browser popup, mark all read, view older notifications.

---

# Source files reviewed

- `Pasted text.txt`
- `Pasted text (2).txt`
- `Pasted text (3).txt`
- `Pasted text (4).txt`
- `Pasted text (5).txt`
- `Pasted text (6).txt`
- `Pasted text (7).txt`
