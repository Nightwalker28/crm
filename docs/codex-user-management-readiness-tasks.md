# User Management Codex Task Plan

_Last updated: 2026-06-26_

This document converts the user-management audit into Codex-ready implementation tasks after checking the current repository. It covers backend user/auth/SSO/MFA/admin/profile/domain services and frontend users/auth/settings components.

## Verification summary

Confirmed in the current codebase:

- `search_users_cursor` strips search/sort order with `order_by(None).order_by(User.id.desc())`, so cursor search loses relevance/default ordering.
- `list_saved_views` commits a default system view and re-queries all views when no default exists.
- `_normalize_saved_view_config` normalizes nested user-provided values but does not cap serialized size or nesting depth.
- `SAVED_VIEW_MODULES = TABLE_PREFERENCE_MODULES` aliases the same set object.
- Tenant-domain DNS fallback invokes `dig` via `subprocess.run`; arguments are list-based, not shell-string injection, but it is still a process fallback in request flow.
- `UserManagementTable`’s state-key sync effect depends on live `filters`, `sortKey`, and `sortDirection`.
- `useUserManagement` loads `currentUserId` from session storage after first render, causing a first-render `isSelf=false` state.

Corrections to the audit:

- Backup-code timing mitigation is a low-priority hardening item. The DB lookup by hash necessarily branches; make the code path less distinguishable, but do not overstate it as a direct exploit.
- `_verify_dns` uses `subprocess.run([...])` with an argv list, so classic shell injection is not present. The remaining issue is enforcing normalization and avoiding process fallback in constrained runtimes.
- `fetchUsers` at module scope is stable; no fix is required unless `usePagedList` later starts treating a changing fetcher identity as a dependency.
- Login MFA loading concern appears mostly theoretical if `startMfaSetup` already clears its loading in `finally`; keep as a small regression-test item.

## Recommended implementation order

1. Security/correctness: complete.
2. Transaction/session/cache reliability: UM-14 to UM-18.
3. Backend performance/cleanup: UM-25 to UM-26.
4. Frontend state and UX fixes: UM-27 to UM-40.

## Completed tasks

## UM-01 — Fix token timestamp columns to timezone-aware server defaults

- **Severity:** Critical
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/models.py`, migration.
- **Result:** `RefreshToken.created_at` and `UserSetupToken.created_at` now use timezone-aware, non-null, DB-generated `func.now()` defaults. `UserSetupToken.consumed_at` is timezone-aware. Migration `20260711_token_timestamps` converts existing columns as UTC on PostgreSQL.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_setup_tokens`, `docker compose exec -T backend alembic upgrade head`, `docker compose exec -T backend alembic current`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-02 — Remove global unique constraint from `User.email`

- **Severity:** Critical
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/models.py`, `backend/app/modules/user_management/routes/signin.py`, migration, user creation/login tests.
- **Result:** `User.email` no longer declares global uniqueness in model metadata. Migration `20260712_user_email_scope` defensively removes single-column unique constraints/indexes on `users.email`, preserves the non-unique email lookup index, and keeps `uq_users_tenant_email` as the uniqueness boundary. Tenant-discovery login now refuses ambiguous shared-email matches instead of selecting the first active tenant.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_user_email_uniqueness tests.test_api_routes.APIRouteTests.test_manual_login_tenant_resolution_prefers_verified_custom_domain tests.test_api_routes.APIRouteTests.test_manual_login_tenant_resolution_rejects_ambiguous_shared_email`, `docker compose exec -T backend alembic downgrade 20260711_token_timestamps`, `docker compose exec -T backend alembic upgrade head`, `docker compose exec -T backend alembic current`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-03 — Stop generating password setup links on every failed manual login

- **Severity:** Critical
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/auth.py`, `backend/tests/test_auth_manual_login.py`.
- **Result:** Passwordless manual-login failures now return only a stable `password_setup_required` code and message. They do not call `create_user_setup_link`, do not include a setup URL, and do not create `UserSetupToken` rows. Admin-created manual users still receive setup links through the explicit admin flow.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_manual_login tests.test_admin_users.CreateUserTests.test_create_user_returns_setup_link_for_manual_users`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-04 — Add rate limiting for manual login/setup-link branch

- **Severity:** Critical/High
- **Completed:** 2026-06-26.
- **Files:** `backend/app/core/config.py`, `backend/app/modules/user_management/services/auth.py`, `backend/app/modules/user_management/routes/signin.py`, `backend/tests/test_auth_manual_login.py`, `backend/tests/test_api_routes.py`, `backend/tests/test_config.py`.
- **Result:** Manual CRM login now checks a Redis/cache-backed failed-attempt limiter before password verification, records both invalid-credential and `password_setup_required` failures, keys attempts by tenant/email and tenant/IP, and clears attempts after a successful password login. The passwordless branch remains token-free from `UM-03`.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_manual_login tests.test_api_routes.APIRouteTests.test_manual_login_failure_logs_without_secret_payload tests.test_api_routes.APIRouteTests.test_manual_login_setup_required_records_failed_attempt_without_setup_link tests.test_config.ConfigTests.test_startup_validation_requires_redis_for_production_manual_login_rate_limits`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-05 — Add setup-token cleanup index or move cleanup to scheduled job

- **Severity:** High/Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/models.py`, `backend/alembic/versions/20260713_setup_token_indexes.py`, `backend/tests/test_auth_setup_tokens.py`.
- **Result:** `user_setup_tokens` now has dedicated indexes for stale cleanup by `expires_at`, cleanup by `(consumed_at, expires_at)`, and active-token replacement by `(user_id, consumed_at)`. Setup-link generation keeps the existing cleanup behavior, but the delete predicates now have targeted indexes instead of scanning the token table under load.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_setup_tokens`, `docker compose exec -T backend alembic downgrade 20260712_user_email_scope`, `docker compose exec -T backend alembic upgrade head`, `docker compose exec -T backend alembic current`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-06 — Make OIDC SSO HTTP calls async-safe

- **Severity:** Critical
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/routes/signin.py`, `backend/tests/test_api_routes.py`.
- **Result:** The OIDC callback endpoint is now async and offloads the existing synchronous SSO callback flow through `run_in_threadpool`, so provider metadata discovery, token exchange, JWKS loading, sync SQLAlchemy work, token creation, and audit logging cannot block the event loop. The SSO configuration test route remains a sync admin route, so its provider checks continue to execute in FastAPI's worker threadpool.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_api_routes.APIRouteTests.test_oidc_callback_endpoint_runs_sync_sso_work_in_threadpool tests.test_sso`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-07 — Isolate SSO test result writes from failed test transactions

- **Severity:** Critical/High
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/sso.py`, `backend/tests/test_sso.py`.
- **Result:** `test_sso_settings` now persists `last_test_result`, status, failed-login reason, and the `sso.config.tested` activity log through a fresh session bound to the same engine after failed test rollback. A test-only injectable session factory verifies failure results no longer depend on reusing the rolled-back request session.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sso`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-08 — Make TOTP HMAC digestmod explicit

- **Severity:** Medium cleanup
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/mfa.py`, `backend/tests/test_mfa.py`.
- **Result:** `generate_totp_code` now passes `digestmod=hashlib.sha1` explicitly, with an RFC SHA-1 vector locking the generated TOTP value.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_mfa`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-09 — Harden MFA backup-code verification path

- **Severity:** Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/core/config.py`, `backend/app/modules/user_management/services/mfa.py`, `backend/tests/test_mfa.py`, `backend/tests/test_config.py`.
- **Result:** MFA challenges now check a cache-backed failed-attempt limiter before verification, record failed TOTP and backup-code attempts, clear counters on successful challenges, and require Redis in production when challenge throttling is enabled. Backup-code verification now compares candidate hashes with `hmac.compare_digest` across the user's unconsumed backup codes before consuming a match.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_mfa tests.test_config.ConfigTests.test_startup_validation_requires_redis_for_production_mfa_challenge_rate_limits`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-10 — Add rollback guard around team update and permission sync

- **Severity:** High
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/admin_structure.py`, `backend/tests/test_admin_structure.py`.
- **Result:** `update_team` now wraps team mutation, permission sync, bulk user department updates, and commit in a rollback guard. Sync or update failures roll the session back before propagating, preventing partial team/user state.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_structure`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-11 — Stop silently deduping team module permission duplicates

- **Severity:** Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/admin_structure.py`, `backend/tests/test_admin_structure.py`.
- **Result:** `_sync_team_module_permissions_from_department` now raises a data-integrity error when duplicate team/module permission rows are encountered instead of silently deleting extras. The `UM-10` rollback guard keeps team updates atomic when this condition is hit.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_structure`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-12 — Version user update options cache key

- **Severity:** High/Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/admin_users.py`, `backend/tests/test_admin_users.py`.
- **Result:** The user update options cache key now includes a schema version prefix (`user-update-options-v2`) so future payload changes do not read old cached shapes.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_admin_users.CreateUserTests.test_user_update_options_cache_key_is_schema_versioned tests.test_admin_users.CreateUserTests.test_list_user_update_options_uses_cache`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-13 — Remove forced `is_enabled=True` from accessible module schemas

- **Severity:** Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/auth.py`, `backend/tests/test_auth_module_access.py`.
- **Result:** `get_user_accessible_modules` now returns `build_module_schema(...)` as-is after tenant/module-access filtering and no longer forces `is_enabled=True` onto returned schemas.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_module_access`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-19 — Collapse duplicate allowed-domain assignment in SSO settings update

- **Severity:** Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/sso.py`, `backend/tests/test_sso.py`.
- **Result:** `update_sso_settings` now uses one domain-sync assignment path for allowed email domains while preserving verified custom-domain behavior.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sso`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-20 — Clarify setup-token cleanup return value

- **Severity:** Low
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/auth.py`, `backend/tests/test_auth_setup_tokens.py`.
- **Result:** `_cleanup_stale_user_setup_tokens` now returns `None`, matching its actual side-effect-only usage from setup-link generation.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_setup_tokens`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-21 — Add explicit tests for passwordless setup flow

- **Severity:** High
- **Completed:** 2026-06-26.
- **Files:** `backend/tests/test_auth_manual_login.py`, `backend/tests/test_admin_users.py`.
- **Result:** Passwordless manual-only, manual-or-google, and inactive manual login paths are covered to ensure login does not return setup links or mint setup tokens. The explicit admin-created manual-user setup link remains covered by the admin-user test.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_manual_login tests.test_admin_users.CreateUserTests.test_create_user_returns_setup_link_for_manual_users`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-22 — Add unique email migration safety checks

- **Severity:** High
- **Completed:** 2026-06-26.
- **Files:** `backend/tests/test_user_email_uniqueness.py`, `backend/tests/test_api_routes.py`, `backend/tests/test_sso.py`.
- **Result:** Same-email cross-tenant behavior is covered at the DB/model layer, manual login is verified to resolve by explicit tenant scope, ambiguous tenant-discovery login refuses shared emails, and SSO resolution remains pinned to the verified custom-domain tenant.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_user_email_uniqueness tests.test_api_routes.APIRouteTests.test_manual_login_tenant_resolution_rejects_ambiguous_shared_email tests.test_sso.SsoServiceTests.test_resolve_sso_settings_for_email_uses_verified_domain_tenant`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-23 — Improve SSO failure recording transaction boundary

- **Severity:** Medium/High
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/services/sso.py`, `backend/tests/test_sso.py`.
- **Result:** `_record_sso_failure` now rolls back the failed callback session, then records failure reason and activity through a fresh session bound to the same engine. A regression test verifies callback failure telemetry no longer depends on the rolled-back request session.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_sso`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

## UM-24 — Add index for setup-token active-user lookup if needed

- **Severity:** Medium
- **Completed:** 2026-06-26.
- **Files:** `backend/app/modules/user_management/models.py`, `backend/alembic/versions/20260713_setup_token_indexes.py`, `backend/tests/test_auth_setup_tokens.py`.
- **Result:** The setup-token active-user replacement query is covered by `ix_user_setup_tokens_user_consumed` on `(user_id, consumed_at)`, added with the setup-token index migration.
- **Verification:** `docker compose exec -T backend python -m unittest tests.test_auth_setup_tokens`, `docker compose exec -T backend alembic upgrade head`, `docker compose exec -T backend alembic current`, `docker compose exec -T backend python -m compileall app tests`, `git diff --check`.

---

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

- No pending schema-only checklist items.

## Test checklist

Backend:

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

- DNS `dig` fallback uses an argv list, so do not label it shell-string injection. Treat it as normalization/runtime-hardening.
- Module-scope `fetchUsers` is stable; only change it if `usePagedList` dependency behavior requires it.
- MFA setup loading issue should be covered by regression tests unless current code proves a stuck state.
