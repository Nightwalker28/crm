# User Management Codex Task Plan

_Last updated: 2026-06-25_

This document converts the user-management audit into Codex-ready implementation tasks after checking the current repository. It covers backend user/auth/SSO/MFA/admin/profile/domain services and frontend users/auth/settings components.

## Verification summary

Confirmed in the current codebase:

- `RefreshToken.created_at` and `UserSetupToken.created_at` use naive `datetime.utcnow` defaults while surrounding token/timestamp columns are timezone-aware.
- `User.email` has both `unique=True` and `UniqueConstraint('tenant_id', 'email')`, which conflicts with multi-tenant same-email semantics.
- `authenticate_manual_user` creates and returns a setup link when `password_hash` is missing, before any explicit brute-force/rate-limit branch.
- `create_user_setup_link` calls setup-token cleanup on every generation, and setup-token cleanup has no consumed/expires composite index.
- OIDC SSO callback/test helpers use blocking `requests` calls in sync service functions used by auth routes; the callback path resolves metadata, exchanges tokens, and loads JWKS synchronously.
- `test_sso_settings` rolls back on broad exception and then reuses the same session to re-query/write `last_test_result`.
- `update_sso_settings` calls `_verified_custom_email_domains_or_legacy` in both branches of an if/else.
- `get_user_accessible_modules` filters to enabled tenant modules, then forces `is_enabled=True` in the returned schema.
- `update_team` mutates the team, syncs team module permissions, bulk-updates users, then commits without a rollback guard.
- `_sync_team_module_permissions_from_department` silently dedupes duplicate `TeamModulePermission` rows despite a unique constraint.
- `list_user_update_options` cache key has no schema/version component.
- `search_users_cursor` strips search/sort order with `order_by(None).order_by(User.id.desc())`, so cursor search loses relevance/default ordering.
- `list_saved_views` commits a default system view and re-queries all views when no default exists.
- `_normalize_saved_view_config` normalizes nested user-provided values but does not cap serialized size or nesting depth.
- `SAVED_VIEW_MODULES = TABLE_PREFERENCE_MODULES` aliases the same set object.
- Tenant-domain DNS fallback invokes `dig` via `subprocess.run`; arguments are list-based, not shell-string injection, but it is still a process fallback in request flow.
- `UserManagementTable`’s state-key sync effect depends on live `filters`, `sortKey`, and `sortDirection`.
- `useUserManagement` loads `currentUserId` from session storage after first render, causing a first-render `isSelf=false` state.

Corrections to the audit:

- `generate_totp_code` already passes SHA-1 as the third positional `hmac.new` argument, which works. The cleanup should make `digestmod=hashlib.sha1` explicit for readability, not fix a confirmed runtime TypeError.
- Backup-code timing mitigation is a low-priority hardening item. The DB lookup by hash necessarily branches; make the code path less distinguishable, but do not overstate it as a direct exploit.
- `_verify_dns` uses `subprocess.run([...])` with an argv list, so classic shell injection is not present. The remaining issue is enforcing normalization and avoiding process fallback in constrained runtimes.
- `fetchUsers` at module scope is stable; no fix is required unless `usePagedList` later starts treating a changing fetcher identity as a dependency.
- Login MFA loading concern appears mostly theoretical if `startMfaSetup` already clears its loading in `finally`; keep as a small regression-test item.

## Recommended implementation order

1. Security/correctness: UM-01 to UM-09.
2. Transaction/session/cache reliability: UM-10 to UM-18.
3. Backend performance/cleanup: UM-19 to UM-26.
4. Frontend state and UX fixes: UM-27 to UM-40.

---

## UM-01 — Fix token timestamp columns to timezone-aware server defaults

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/user_management/models.py`, migration.
- **Issue:** `RefreshToken.created_at` and `UserSetupToken.created_at` use `Column(DateTime, default=datetime.utcnow)`, producing naive datetimes while related token fields use timezone-aware columns.
- **Fix:** Change to `DateTime(timezone=True), server_default=func.now(), nullable=False`. Also make `UserSetupToken.consumed_at` timezone-aware.
- **Done when:** Token timestamps are timezone-aware and DB-generated consistently.

## UM-02 — Remove global unique constraint from `User.email`

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `models.py`, migration, user creation/login tests.
- **Issue:** `User.email` has `unique=True` plus tenant-scoped unique constraint. The column-level unique index blocks the same email across different tenants.
- **Fix:** Remove `unique=True`, keep `UniqueConstraint('tenant_id', 'email')`, and migrate/drop the single-column unique index.
- **Done when:** Same email can exist in different tenants while duplicate email in the same tenant is still rejected.

## UM-03 — Stop generating password setup links on every failed manual login

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `services/auth.py`, login route/tests.
- **Issue:** `authenticate_manual_user` creates and embeds a fresh setup link in a 403 response whenever a matching user has no password hash.
- **Fix:** Do not return setup links from login. Return a generic `password_setup_required` response without token, or require admin-triggered resend. Add brute-force/rate-limiting before any passwordless-account branch if this behavior remains.
- **Done when:** Failed login cannot generate unlimited setup tokens or enumerate setup state.

## UM-04 — Add rate limiting for manual login/setup-link branch

- **Severity:** Critical/High
- **Assessment:** Valid extension.
- **Files:** auth routes/services, rate-limit utility/tests.
- **Issue:** The passwordless-user branch happens before any evident throttling in `authenticate_manual_user`.
- **Fix:** Apply the same login attempt throttle to invalid credentials and password-setup-required responses. Key by tenant/email/IP as appropriate.
- **Done when:** Repeated setup-required attempts are throttled and logged.

## UM-05 — Add setup-token cleanup index or move cleanup to scheduled job

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `models.py`, migration, `services/auth.py`.
- **Issue:** `_cleanup_stale_user_setup_tokens` runs on every setup link generation and filters by `consumed_at`/`expires_at` without a targeted composite index.
- **Fix:** Add indexes on `expires_at` and/or `(consumed_at, expires_at)`, or move cleanup to periodic Celery/maintenance job. Consider returning/logging cleanup count or making return type `None`.
- **Done when:** Setup-link generation does not trigger an expensive table scan under load.

## UM-06 — Make OIDC SSO HTTP calls async-safe

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `services/sso.py`, SSO routes/tests.
- **Issue:** OIDC metadata, JWKS, and token exchange use blocking `requests.get/post` in callback/test helpers.
- **Fix:** Use `httpx.AsyncClient` from async routes, or run sync network calls in an executor. Keep timeout behavior and structured errors.
- **Done when:** SSO callbacks do not block the event loop during external HTTP calls.

## UM-07 — Isolate SSO test result writes from failed test transactions

- **Severity:** Critical/High
- **Assessment:** Valid.
- **Files:** `services/sso.py`, DB session handling/tests.
- **Issue:** `test_sso_settings` calls `db.rollback()` on broad exception, then reuses the same session to re-query and commit `last_test_result`.
- **Fix:** Use a fresh session/session factory for result persistence, or restructure test helpers so rollback happens in a contained sub-transaction and result write is separate.
- **Done when:** SSO test failures reliably record `last_test_result` without depending on a possibly tainted session.

## UM-08 — Make TOTP HMAC digestmod explicit

- **Severity:** Medium cleanup
- **Assessment:** Partially valid.
- **Files:** `services/mfa.py`, MFA tests.
- **Issue:** `generate_totp_code` passes `hashlib.sha1` as a positional third argument to `hmac.new`, which is valid but less explicit.
- **Fix:** Rewrite to `hmac.new(key, msg, digestmod=hashlib.sha1).digest()` and keep RFC test vectors.
- **Done when:** TOTP generation is explicit and covered by tests.

## UM-09 — Harden MFA backup-code verification path

- **Severity:** Medium
- **Assessment:** Valid hardening.
- **Files:** `services/mfa.py`, tests.
- **Issue:** Valid backup-code path performs an update/commit and invalid path logs failure, so timing may differ.
- **Fix:** Keep hash comparison constant-time where applicable, avoid detailed timing distinctions as much as practical, and throttle MFA challenges.
- **Done when:** MFA backup-code attempts are rate-limited and the code path is hardened.

## UM-10 — Add rollback guard around team update and permission sync

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `services/admin_structure.py`, tests.
- **Issue:** `update_team` mutates team, syncs permissions, bulk-updates users, then commits without rollback guard.
- **Fix:** Wrap the full mutation in `try/except` with `db.rollback()` and re-raise. Consider moving bulk user update last and using a transaction context.
- **Done when:** Permission-sync/user-update failures leave no partial team state.

## UM-11 — Stop silently deduping team module permission duplicates

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `services/admin_structure.py`.
- **Issue:** `_sync_team_module_permissions_from_department` loads all team permissions and silently deletes duplicate module IDs despite a unique constraint.
- **Fix:** Remove dedupe loop or raise/log a data-integrity error if duplicates are detected. Let the unique constraint protect new writes.
- **Done when:** Unexpected duplicate permission rows are visible, not silently discarded.

## UM-12 — Version user update options cache key

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `services/admin_users.py`.
- **Issue:** `list_user_update_options` caches serialized schema payload under `user-update-options:{tenant_id}`. Future schema changes can read stale shape.
- **Fix:** Add a version prefix such as `user-update-options-v2:{tenant_id}` and bump when payload shape changes.
- **Done when:** Schema changes safely bust old cache values.

## UM-13 — Remove forced `is_enabled=True` from accessible module schemas

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `services/auth.py`, module access tests.
- **Issue:** `get_user_accessible_modules` filters by `is_module_enabled_for_tenant`, then forces `is_enabled=True` in the returned schema for admins and non-admins.
- **Fix:** Return `build_module_schema(...)` as-is after filtering. Do not override state unless the UI specifically needs a separate `accessible` flag.
- **Done when:** Returned module metadata accurately reflects module config.

## UM-14 — Fix cursor user search ordering

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `repositories/admin_users_repository.py`, cursor search tests.
- **Issue:** `search_users_cursor` applies search/filter/sort, then calls `order_by(None).order_by(User.id.desc())`, stripping relevance/default ordering.
- **Fix:** Either make cursor mode intentionally ID-only and document it, or preserve search ranking/sort while using a compatible cursor strategy.
- **Done when:** Cursor user search behaves predictably and does not silently lose relevance.

## UM-15 — Cap saved-view config size and nesting

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `services/profile.py`, saved-view routes/tests.
- **Issue:** `_normalize_saved_view_config` accepts nested dict/list values in condition `value`/`values` and sort/config data without a total size/depth cap.
- **Fix:** Reject configs above a serialized size limit, e.g. 64 KB, and add a maximum JSON nesting depth before persisting.
- **Done when:** A malicious/broken client cannot store unbounded saved-view JSON.

## UM-16 — Avoid extra re-query when assigning default saved view

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `services/profile.py`.
- **Issue:** When no saved view is default, `list_saved_views` sets the system view default, commits, and re-queries the full view list.
- **Fix:** Mark the in-memory `system_view` default and sort/serialize current list, or use `UPDATE ... RETURNING`/one query path.
- **Done when:** First saved-view load does not require two full list queries.

## UM-17 — Separate or document `SAVED_VIEW_MODULES` and `TABLE_PREFERENCE_MODULES`

- **Severity:** Low
- **Assessment:** Valid cleanup.
- **Files:** `services/profile.py`.
- **Issue:** `SAVED_VIEW_MODULES = TABLE_PREFERENCE_MODULES` aliases the same mutable set.
- **Fix:** Define independent sets or add an explicit comment/test proving they intentionally stay identical.
- **Done when:** Future module-list changes do not accidentally affect both behaviors.

## UM-18 — Restrict DNS `dig` fallback behavior

- **Severity:** Medium/Low
- **Assessment:** Partially valid.
- **Files:** `services/tenant_domains.py`.
- **Issue:** `_lookup_txt` shells out to `dig` with an argv list if `dns.resolver` is unavailable. This is not classic shell injection, but it introduces process-level fallback in request flow.
- **Fix:** Ensure callers always normalize hostnames before `_verify_dns`, add an assertion/guard inside `_lookup_txt`, and optionally disable the `dig` fallback outside explicit dev/runtime setting.
- **Done when:** DNS verification cannot run unnormalized hostnames and process fallback is intentional.

## UM-19 — Collapse duplicate allowed-domain assignment in SSO settings update

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `services/sso.py`.
- **Issue:** `update_sso_settings` calls `_verified_custom_email_domains_or_legacy` in both if/else branches.
- **Fix:** Replace the branch with one assignment.
- **Done when:** SSO settings update has one domain sync path.

## UM-20 — Clarify setup-token cleanup return value

- **Severity:** Low
- **Assessment:** Valid cleanup.
- **Files:** `services/auth.py`.
- **Issue:** `_cleanup_stale_user_setup_tokens` returns an int count but callers ignore it.
- **Fix:** Return `None`, or log/use the count in setup-link generation or maintenance jobs.
- **Done when:** Function signature reflects actual use.

## UM-21 — Add explicit tests for passwordless setup flow

- **Severity:** High
- **Assessment:** Valid extension.
- **Files:** backend auth tests.
- **Issue:** Passwordless users, auth mode, inactive status, and setup link generation intersect with sensitive login behavior.
- **Fix:** Add tests covering missing password hash, inactive user, manual-only/manual-or-google modes, no setup token in login response, and admin resend flow.
- **Done when:** Password setup behavior is locked down by tests.

## UM-22 — Add unique email migration safety checks

- **Severity:** High
- **Assessment:** Valid extension.
- **Files:** migration scripts/docs.
- **Issue:** Dropping global email uniqueness can expose existing code that assumes email globally identifies one user.
- **Fix:** Audit login and lookup paths. Require tenant context when looking up users by email except explicit global tenant-resolution flows.
- **Done when:** Multi-tenant same-email support does not break login/SSO resolution.

## UM-23 — Improve SSO failure recording transaction boundary

- **Severity:** Medium/High
- **Assessment:** Valid extension.
- **Files:** `services/sso.py`.
- **Issue:** `_record_sso_failure` rolls back, re-queries, commits failure, then logs activity with the same session.
- **Fix:** Use dedicated helper/session for failure recording or an outbox/safe log path that cannot mask original SSO error.
- **Done when:** SSO failure telemetry does not interfere with callback error handling.

## UM-24 — Add index for setup-token active-user lookup if needed

- **Severity:** Medium
- **Assessment:** Valid extension.
- **Files:** models/migration.
- **Issue:** `create_user_setup_link` deletes unconsumed tokens by `user_id` and `consumed_at IS NULL`.
- **Fix:** Add index `(user_id, consumed_at)` if query plans show it is needed.
- **Done when:** Setup-token replacement is indexed.

## UM-25 — Review admin user list field projection

- **Severity:** Medium
- **Assessment:** Needs route verification.
- **Files:** `routes/admin.py`.
- **Issue:** Audit says `_serialize_user_list_item` force-adds fields, causing `fields=` to return more than requested.
- **Fix:** Verify current route serializer. If force-adds exist, remove anything not required for response integrity; otherwise document as already fixed.
- **Done when:** User list field projection respects requested columns or has documented mandatory fields.

## UM-26 — Add query-count tests for admin user list/search

- **Severity:** Low/Medium
- **Assessment:** Valid extension.
- **Files:** backend tests.
- **Issue:** User list joins role/team, attaches tenant MFA policy, and serializes role/team names.
- **Fix:** Add regression tests around query count for list/search/cursor paths.
- **Done when:** User list performance is bounded.

## UM-27 — Fix UserManagementTable state-key sync dependencies

- **Severity:** Critical frontend
- **Assessment:** Valid.
- **Files:** `frontend/components/users/userManagementTable.tsx`.
- **Issue:** The `stateKey` effect depends on `filters`, `sortKey`, and `sortDirection`, then compares/sets those same values. Parent `onStateChange` can interact with this and cause sync loops or excess resets.
- **Fix:** Gate only on `stateKey` changes via `lastStateKeyRef`; use refs for current filters/sort or compute suppression without live state dependencies.
- **Done when:** Changing saved views resets table state once without looping.

## UM-28 — Load current user ID with lazy state initializer

- **Severity:** Critical frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/admin/useUserManagement.ts`.
- **Issue:** `currentUserId` starts as `null` until a client effect reads sessionStorage, so first render cannot mark self edits/actions correctly.
- **Fix:** Use `useState(() => typeof window === 'undefined' ? null : parseStoredUser(sessionStorage.getItem('lynk_user')))`.
- **Done when:** First client render has the current user ID where available.

## UM-29 — Remove redundant refetches in teams/departments refresh

- **Severity:** Medium frontend
- **Assessment:** Needs hook verification.
- **Files:** `frontend/hooks/admin/useTeamsAndDepartments.ts`.
- **Issue:** Audit says refresh calls both `invalidateQueries` and `refetchQueries` for same keys.
- **Fix:** Keep `invalidateQueries({ type: 'active' })` or explicit `refetchQueries`, not both.
- **Done when:** One refresh action causes one network refetch per active query.

## UM-30 — Preserve in-progress SSO client secret edits across settings refetch

- **Severity:** High/Medium frontend
- **Assessment:** Valid by pattern.
- **Files:** `frontend/app/dashboard/settings/users/page.tsx`.
- **Issue:** SSO draft state is reset from `ssoSettings`; `client_secret` resets to empty on refetch, clearing in-progress edits.
- **Fix:** Track client secret in separate local state or only reset draft when the settings record identity/version changes and the form is not dirty.
- **Done when:** Background SSO refetch does not wipe typed client secret.

## UM-31 — Add redirect-once guard to AuthCallbackClient

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/auth/callback/AuthCallbackClient.tsx`.
- **Issue:** Redirect effect depends on derived status/search params; query param mutation can fire redirect again.
- **Fix:** Add `redirectedRef` so `router.replace` runs at most once.
- **Done when:** Auth callback cannot double-redirect due to search-param updates.

## UM-32 — Guard role-permission default selection after initial load

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/admin/useRolePermissions.ts`.
- **Issue:** Role overview refetch after create/update can reset selected role if state guard is insufficient.
- **Fix:** Track whether initial selection has been made or whether the current selected role still exists before auto-selecting first role.
- **Done when:** Creating/updating roles does not unexpectedly jump selection.

## UM-33 — Reset approve-user dialog state on open/user change

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/components/users/approveUserDialog.tsx`.
- **Issue:** Role/team local state can persist across dialog invocations.
- **Fix:** Reset local selections in `useEffect` when `open` becomes true or target user changes.
- **Done when:** Opening approval dialog for a different user starts from correct defaults.

## UM-34 — Remove dead edit-user dialog reset effect or remove parent key dependency

- **Severity:** Low/Medium frontend
- **Assessment:** Valid cleanup.
- **Files:** `frontend/components/users/editUserDialog.tsx`, settings users page.
- **Issue:** Audit says dialog is keyed by user ID, so `[user]` reset effect may never handle a different user in the same instance.
- **Fix:** Either keep key and remove dead reset effect, or remove key and make the effect the single reset mechanism.
- **Done when:** Edit dialog reset strategy is clear and tested.

## UM-35 — Stabilize settings users page saved-view filters

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/settings/users/page.tsx`.
- **Issue:** `resolveSavedViewFilters` can create a new object; memo keyed on object identity can still churn.
- **Fix:** Memoize by serialized config or add deep-equality memo helper.
- **Done when:** Equivalent saved-view filters do not refetch/reset user table unnecessarily.

## UM-36 — Add abortable password-policy loading

- **Severity:** Low frontend
- **Assessment:** Valid cleanup.
- **Files:** `frontend/app/auth/setup-password/page.tsx`, `apiFetch` support.
- **Issue:** Mounted flag suppresses state update but does not cancel in-flight request.
- **Fix:** Use `AbortController` and pass signal to `apiFetch` if supported.
- **Done when:** Setup-password page cancels policy request on unmount.

## UM-37 — Exclude `filtersOpen` from active-filter memo

- **Severity:** Low frontend
- **Assessment:** Valid cleanup.
- **Files:** `frontend/components/users/userFilters.tsx`.
- **Issue:** Toggling filter panel open/closed recomputes active-filter state even though it should not affect whether filters are active.
- **Fix:** Depend only on search/teams/roles/statuses.
- **Done when:** Filter panel UI state does not affect active-filter computation.

## UM-38 — Keep user fetcher identity stable by contract

- **Severity:** Low frontend
- **Assessment:** Mostly already fine.
- **Files:** `UserManagementTable.tsx`, `usePagedList.ts`.
- **Issue:** `fetchUsers` is module-scoped and stable today. Future changes could inline it and make hook dependencies noisy.
- **Fix:** Document/freeze this pattern or wrap fetcher in `useCallback` only if `usePagedList` depends on it.
- **Done when:** User list fetching does not refetch due to fetcher identity churn.

## UM-39 — Add MFA setup loading regression test

- **Severity:** Low/Medium frontend
- **Assessment:** Mostly theoretical.
- **Files:** `frontend/app/auth/login/page.tsx`.
- **Issue:** Audit notes possible loading-state split between manual sign-in and MFA setup.
- **Fix:** Add tests ensuring failed MFA setup clears all loading flags and shows a recoverable error.
- **Done when:** MFA setup errors cannot leave login page stuck loading.

## UM-40 — Ensure SSO draft reset logic is dirty-aware

- **Severity:** Medium frontend
- **Assessment:** Valid extension.
- **Files:** settings users page.
- **Issue:** Any query refetch can overwrite local draft fields if the form has unsaved edits.
- **Fix:** Track dirty state and only sync server settings into draft when opening/resetting the form, not during active edits.
- **Done when:** Admins can edit SSO settings without background query churn wiping fields.

---

## Migration checklist

- Drop global unique index/constraint on `users.email` while preserving `uq_users_tenant_email`.
- Change token timestamp columns to `DateTime(timezone=True)` with `server_default=func.now()`.
- Add setup-token cleanup indexes: at minimum `expires_at`; consider `(consumed_at, expires_at)` and `(user_id, consumed_at)`.

## Test checklist

Backend:

- Same email can exist in two tenants, but not twice in one tenant.
- Passwordless manual login does not return setup token and is rate-limited.
- Admin-created user still receives setup link through admin flow.
- Setup-token cleanup queries use indexes or are moved to scheduled task.
- SSO callback/test external HTTP calls are async-safe and timeout-tested.
- SSO failure/test result recording survives exceptions without corrupting session state.
- Team department change rolls back cleanly if permission sync or user update fails.
- Saved-view config rejects oversized/deep JSON.
- User cursor search ordering semantics are tested.

Frontend/manual:

- Current user row is marked `(You)` on first client render.
- Switching saved views in user table does not loop/reset repeatedly.
- SSO client secret field is not cleared by background refetch.
- Auth callback redirects once.
- Approve/edit dialogs reset according to one clear strategy.
- Role permission selection does not jump after role changes.

## Explicit audit corrections

- `hmac.new(..., hashlib.sha1)` is valid today; make it explicit with `digestmod=` for clarity.
- DNS `dig` fallback uses an argv list, so do not label it shell-string injection. Treat it as normalization/runtime-hardening.
- Module-scope `fetchUsers` is stable; only change it if `usePagedList` dependency behavior requires it.
- MFA setup loading issue should be covered by regression tests unless current code proves a stuck state.
