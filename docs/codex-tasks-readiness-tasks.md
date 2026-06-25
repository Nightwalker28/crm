# Tasks Module Codex Task Plan

_Last updated: 2026-06-22_

This document converts the tasks-functionality review into Codex-ready implementation tasks after checking the current repository. It covers task services, repository access, route behavior, models/indexes, due-task alerts, assignment options, and the frontend tasks page/dialog/table/picker.

## Verification summary

Confirmed in the current codebase:

- `create_task` and `update_task` commit, refresh, then immediately re-query via `get_task_or_404`.
- `create_task` flushes before syncing assignees and has no rollback guard around the full create body.
- `tasks_repository.get_task(include_deleted=True)` passes `only_deleted=True`, so it returns only deleted tasks rather than active + deleted.
- `tasks_services._build_task_query` duplicates repository query logic and is no longer used by list/get paths.
- `_normalize_assignees` validates each user/team with separate queries.
- `serialize_task` validates through `TaskResponse` and routes validate again.
- Assignment options load every tenant user/team without pagination or active-user filtering.
- `scan_due_task_alerts` performs a per-task duplicate event lookup.
- `_emit_task_alert_events` emits `task.due_today` on create/update without deduping.
- `list_deleted_tasks` bypasses the normal visibility filter and is tenant-wide.
- `Task` has only single-column status/due indexes and an active tenant partial index; common tenant+status and tenant+due filters lack composite indexes.
- `creator`, `updated_by`, and `assigned_by` use `lazy='joined'`, so base task queries get extra joins even when display names are not needed.
- `TaskDialog` initializes form state from props once; the page currently relies on a remounting key to keep it in sync.
- `useTasks` computes stable `filtersKey`/`sortKey` strings but does not use them in the React Query key.
- `useTasks` page fallback logic can make rendered page and internal page state diverge on filter/sort changes.
- Tasks page includes `activeTask.updated_at` in `dialogKey`, forcing full dialog remounts after saves.
- `fetchRecordTasks` is hardcoded to page size 10.
- `TaskAssigneePicker` memo can re-run because the parent passes `optionsQuery.data?.users ?? []` and `teams ?? []` arrays inline.

Partially valid or corrected items:

- The audit claim that assignees are already loaded after refresh is not always safe; returning the refreshed object directly only works if the relationship state is available. Prefer explicit selectin refresh/load or one intentional re-fetch, not both refresh and re-fetch.
- `TaskDialog` currently avoids stale prop state because the page forces remount with a key, but that is fragile and should be replaced with explicit form re-sync.
- `renderCell` inside `TasksTable` is a performance cleanup, not a correctness issue.
- Notification due-time formatting is a UX/timezone improvement; backend stores timezone-aware datetimes, but message text formats the raw value.

## Recommended implementation order

1. Correctness and access control: TASK-01 to TASK-07.
2. Backend performance and cleanup: TASK-08 to TASK-16.
3. Event/notification reliability: TASK-17 to TASK-20.
4. Frontend state/cache fixes: TASK-21 to TASK-30.
5. Low-risk cleanup/documentation: TASK-31 to TASK-34.

---

## TASK-01 — Make task create transaction rollback-safe

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/tasks/services/tasks_services.py`, tests.
- **Issue:** `create_task` flushes to get `task.id`, syncs assignees, updates metadata, and commits without a rollback guard. If assignee sync or commit fails, the session can remain dirty.
- **Fix:** Wrap the full create body in `try/except Exception`, rollback, then re-raise. Prefer `with db.begin_nested()` or a service transaction helper if callers already own a transaction. Remove the second `db.add(task)` because the object is already tracked.
- **Done when:** Any create failure rolls back task and assignee rows cleanly.

## TASK-02 — Remove redundant refresh plus re-query in task writes

- **Severity:** High
- **Assessment:** Valid with nuance.
- **Files:** `tasks_services.py`, route tests.
- **Issue:** `create_task` and `update_task` call `db.commit()`, `db.refresh(task)`, then `get_task_or_404`, adding a redundant round trip.
- **Fix:** Either return the refreshed task after ensuring assignees/user relationships are loaded, or replace refresh+manual state assumptions with one intentional post-commit query. Do not do both.
- **Done when:** Task writes perform the minimum necessary post-commit loading.

## TASK-03 — Fix task `include_deleted` repository semantics

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/tasks/repositories/tasks_repository.py`, service/restore tests.
- **Issue:** `get_task(include_deleted=True)` maps to `only_deleted=True`, so it fetches only deleted tasks. The public parameter name implies active + deleted.
- **Fix:** Make `include_deleted=True` omit deleted filters entirely. Add a separate `only_deleted` helper/param for restore/recycle-bin flows if needed.
- **Done when:** Include-deleted behavior is consistent with contacts/opportunities/support conventions.

## TASK-04 — Apply visibility RBAC to deleted task lists or gate route admin-only

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `tasks_repository.py`, recycle-bin route/tests.
- **Issue:** `list_deleted_tasks` filters only by tenant and deleted status, so non-admin users could see all deleted tenant tasks if route access allows it.
- **Fix:** Apply the same creator/assignee/team visibility filter used by `build_task_query`, or gate deleted-task list behind admin/restore permission.
- **Done when:** Deleted task visibility matches active task visibility or explicit admin policy.

## TASK-05 — Validate blank task titles before DB commit

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, schema/tests.
- **Issue:** `update_task` strips title to `None` when client sends whitespace. This may fail at DB NOT NULL instead of returning a clean validation error.
- **Fix:** Treat `title` separately: strip and reject if empty with 400/422. Do not set title to `None`.
- **Done when:** Whitespace title update returns a clear client error before commit.

## TASK-06 — Harden source context exception handling

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `tasks_routes.py`, tests.
- **Issue:** `_resolve_task_source_context` handles `HTTPException`, `PermissionError`, and `ValueError`, but unexpected exceptions from `get_record_reference` can bubble as 500s.
- **Fix:** Add a broad `except Exception` path that logs and either re-raises in strict mode or returns `None` in non-strict mode. Do not swallow database errors silently in strict create/update paths.
- **Done when:** Source context failures are surfaced intentionally.

## TASK-07 — Deduplicate due-today events emitted by create/update routes

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `tasks_routes.py`, `tasks_services.py`, tests.
- **Issue:** `_emit_task_alert_events` emits `task.due_today` every time a task is created/updated and is due today. The Celery scan path dedupes, but route emission does not.
- **Fix:** Reuse `_task_due_alert_exists` or a shared dedupe helper before route-level due-today emission.
- **Done when:** Saving the same due-today task multiple times emits at most one due-today event per day.

## TASK-08 — Delete dead duplicate task query builder from service layer

- **Severity:** Critical cleanup
- **Assessment:** Valid.
- **Files:** `tasks_services.py`.
- **Issue:** `_build_task_query` duplicates `tasks_repository.build_task_query` but is not used by current list/fetch paths.
- **Fix:** Remove `_build_task_query` and unused imports: `apply_filter_conditions`, `apply_ranked_search`, `searchable_text`, and any now-unused `or_`/`selectinload` imports if no longer needed elsewhere.
- **Done when:** Query logic has one canonical implementation in repository.

## TASK-09 — Batch assignee validation

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, tests.
- **Issue:** `_normalize_assignees` queries one user/team per assignee.
- **Fix:** Collect unique `user_id`s and `team_id`s first, batch-fetch users/teams with `IN`, validate from sets, then build normalized assignee rows.
- **Done when:** A task with many assignees performs O(1) validation queries per type.

## TASK-10 — Simplify `serialize_task` to avoid repeated Pydantic validation

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, `tasks_routes.py`, tests.
- **Issue:** `serialize_task` calls `TaskResponse.model_validate(...).model_dump(...)`, and route handlers then call `TaskResponse.model_validate(...)` again.
- **Fix:** Make `serialize_task` return a plain dict. Let route response validation happen once, or return `TaskResponse` directly and stop re-validating in routes.
- **Done when:** Each task response is serialized/validated once.

## TASK-11 — Paginate or filter task assignment options

- **Severity:** High/Medium
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, `tasks_routes.py`, `TaskDialog.tsx`.
- **Issue:** `list_task_assignment_options` loads all tenant users and teams. It does not filter inactive/deleted users if such fields exist.
- **Fix:** Add search/pagination to `/tasks/options`, limit results, and filter active users if the user model supports it. Keep initial selected assignees resolvable separately if needed.
- **Done when:** Large tenants do not load every user/team into the dialog.

## TASK-12 — Batch due-task alert dedupe in scan job

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, tests.
- **Issue:** `scan_due_task_alerts` calls `_task_due_alert_exists` once per due task.
- **Fix:** Query existing `task.due_today` events for all due task IDs in the day window once, build a set, and skip already-alerted tasks.
- **Done when:** Due scan avoids N duplicate-check queries.

## TASK-13 — Add composite task indexes for tenant/status and tenant/due date

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `backend/app/modules/tasks/models.py`, migration.
- **Issue:** Common filters combine tenant with status/due date, but the model only has single-column indexes plus `ix_tasks_active_tenant`.
- **Fix:** Add `Index('ix_tasks_tenant_status', 'tenant_id', 'status')` and `Index('ix_tasks_tenant_due_at', 'tenant_id', 'due_at')`. Confirm with EXPLAIN for list/due scan queries.
- **Done when:** Task list and due queries can use composite indexes.

## TASK-14 — Avoid joined user relationships on every task base query

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `models.py`, repository tests/query count tests.
- **Issue:** `creator`, `updated_by`, and `assigned_by` use `lazy='joined'`, adding joins to base task queries even when display names are not needed.
- **Fix:** Change to `lazy='selectin'` or `lazy='select'`, and explicitly load these relationships only in detail/list serializers that need names.
- **Done when:** Base task queries are not forced to join three user aliases by default.

## TASK-15 — Optimize notification recipient resolution for team assignees

- **Severity:** Medium
- **Assessment:** Valid extension.
- **Files:** `tasks_services.py`.
- **Issue:** `_resolve_notification_user_ids` loops team keys and queries members per team.
- **Fix:** Batch all team IDs into one query and combine with direct user IDs.
- **Done when:** Notification recipient resolution uses at most one team-member query.

## TASK-16 — Strip ordering from task count queries

- **Severity:** Medium
- **Assessment:** Valid by pattern.
- **Files:** `tasks_repository.py`.
- **Issue:** `list_tasks` calls `query.count()` after search/filter composition; count may inherit costly ordering/ranking depending on query shape.
- **Fix:** Use `query.order_by(None).count()` or a dedicated count query.
- **Done when:** Count query avoids unnecessary sort/rank work.

## TASK-17 — Make task assignment due-time notification timezone-safe

- **Severity:** Low/Medium UX
- **Assessment:** Valid.
- **Files:** `tasks_services.py`.
- **Issue:** `_notify_task_assignees` formats `task.due_at` directly with `strftime`, which can display raw UTC rather than recipient-local time.
- **Fix:** Either omit time and show date only, or pass recipient/user timezone to the formatter.
- **Done when:** Assignment notifications do not misleadingly display UTC as local time.

## TASK-18 — Confirm task alert event types are valid CRM event types

- **Severity:** Medium
- **Assessment:** Cross-module guard.
- **Files:** `crm_events.py`, `tasks_routes.py`, tests.
- **Issue:** Task routes emit `task.assigned` and `task.due_today`; previous platform audit found event type drift risk.
- **Fix:** Ensure both task event types are included in canonical CRM event type sets and Slack/alert sets where appropriate.
- **Done when:** Task alert events persist and deliver consistently.

## TASK-19 — Keep create/update notification side effects observable

- **Severity:** Medium
- **Assessment:** Valid by side-effect pattern.
- **Files:** `tasks_routes.py`, `tasks_services.py`.
- **Issue:** Task assignment notifications are created after task commit. If notification creation fails, the task exists but assignment notification may be absent.
- **Fix:** Decide whether notifications should be best-effort or queued. If best-effort, log failures. If guaranteed, enqueue notification jobs from a durable event/outbox.
- **Done when:** Notification failures are not silent.

## TASK-20 — Add tests for due alert scan across tenants

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `tasks_services.py`, Celery/task tests.
- **Issue:** Due scan intentionally scans all tenants. Dedup and notification user resolution must not cross tenant boundaries.
- **Fix:** Test two tenants with due tasks and existing events to prove dedupe and notification creation are tenant-scoped.
- **Done when:** Due alert scan is tenant-safe.

## TASK-21 — Use stable strings in `useTasks` React Query key

- **Severity:** Critical frontend cache correctness
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useTasks.ts`.
- **Issue:** `useTasks` computes `filtersKey` and `sortKey`, but query key uses raw `filters` and `sort` objects.
- **Fix:** Use `queryKey: ['tasks', page, pageSize, filtersKey, sortKey]` and pass the original values only to `queryFn`.
- **Done when:** Equivalent filters/sort do not create unnecessary cache keys/refetches.

## TASK-22 — Make task page reset state explicit on filter/sort changes

- **Severity:** High/Medium frontend
- **Assessment:** Valid.
- **Files:** `useTasks.ts`.
- **Issue:** Derived `page` falls back to 1 when keys differ, while `pageState.page` remains stale.
- **Fix:** Use an effect that updates `pageState` to page 1 when `filtersKey` or `sortKey` changes. Query and UI should use `pageState.page` directly.
- **Done when:** Rendered page and stored page state cannot diverge.

## TASK-23 — Re-sync TaskDialog form state when task prop changes

- **Severity:** Critical frontend fragility
- **Assessment:** Valid.
- **Files:** `frontend/components/tasks/TaskDialog.tsx`, `frontend/app/dashboard/tasks/page.tsx`.
- **Issue:** `useState(() => buildFormState(task))` runs only once per component instance. The page currently forces remount with a key, but this is fragile.
- **Fix:** Add `useEffect` that resets form and clears local errors when `task?.id`, `task?.updated_at`, or `open` changes as intended. Then simplify the page key.
- **Done when:** Dialog form state is correct without relying on forced remounts.

## TASK-24 — Remove `updated_at` from task dialog key

- **Severity:** High/Medium frontend UX
- **Assessment:** Valid.
- **Files:** `frontend/app/dashboard/tasks/page.tsx`.
- **Issue:** `dialogKey` includes `activeTask.updated_at`, so saving a task remounts the entire dialog, losing focus/scroll/local state.
- **Fix:** Key by open/closed plus task ID only, or remove key once TaskDialog has explicit form sync.
- **Done when:** Saving a task does not force full dialog remount.

## TASK-25 — Gate or cache linked calendar event query more deliberately

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** tasks page.
- **Issue:** `linkedCalendarEventQuery` runs for any active task, even if calendar actions are not relevant. It has finite stale time and can refetch often across dialog opens.
- **Fix:** Enable only when calendar integration/action is available, or set longer `staleTime`/cache policy. Invalidate explicitly after add/remove.
- **Done when:** Opening task dialogs does not cause unnecessary calendar-event lookups.

## TASK-26 — Avoid double close after task deletion

- **Severity:** Medium/Low
- **Assessment:** Valid.
- **Files:** `TaskDialog.tsx`, tasks page.
- **Issue:** `handleDelete` calls `await onDelete()` then `onClose()`. If parent `onDelete` later navigates/closes, this can double-close.
- **Fix:** Define ownership: either child closes after successful delete or parent closes in mutation success, not both. Guard with mounted/open state if needed.
- **Done when:** Delete flow closes once with no flicker.

## TASK-27 — Document completed_at re-completion semantics

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** `TaskDialog.tsx`.
- **Issue:** When switching to completed, dialog preserves existing `completed_at` if present. Reopen then complete again keeps the old completion timestamp.
- **Fix:** Decide product behavior. Either always set completion to now on transition into completed, or add a comment/test explaining preservation.
- **Done when:** Completion timestamp behavior is intentional.

## TASK-28 — Make record task fetch page size configurable

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useTasks.ts`, record activity/task widgets.
- **Issue:** `fetchRecordTasks` hardcodes `page_size=10`, so records with more linked tasks are silently truncated unless the caller handles total count.
- **Fix:** Accept optional `pageSize`, `page`, or return/use `total_count` to show a “show all tasks” link.
- **Done when:** Linked task widgets can handle more than 10 tasks.

## TASK-29 — Stabilize assignee option arrays passed to TaskAssigneePicker

- **Severity:** Low frontend performance
- **Assessment:** Valid.
- **Files:** `TaskDialog.tsx`, `TaskAssigneePicker.tsx`.
- **Issue:** Parent passes `optionsQuery.data?.users ?? []` and `teams ?? []`, creating new empty arrays when data is absent and causing memo churn.
- **Fix:** Define module-level `EMPTY_USERS`/`EMPTY_TEAMS` constants or memoize options before passing.
- **Done when:** `selectedEntries` memo reruns only when actual users/teams/value change.

## TASK-30 — Move or memoize `TasksTable.renderCell`

- **Severity:** Low frontend performance
- **Assessment:** Valid cleanup.
- **Files:** `TasksTable.tsx`.
- **Issue:** `renderCell` is recreated on every render.
- **Fix:** Move it outside the component if no closure state is needed, or wrap with `useCallback` if future memoized rows need stable refs.
- **Done when:** Table row memoization remains possible.

## TASK-31 — Add rollback guards around task update/delete/restore writes

- **Severity:** Medium
- **Assessment:** Valid by consistency.
- **Files:** `tasks_services.py`.
- **Issue:** Update/delete/restore commit directly without `IntegrityError` rollback wrappers.
- **Fix:** Add a shared commit helper or wrap each service write with rollback on `IntegrityError`/unexpected errors.
- **Done when:** Failed writes do not leave dirty sessions.

## TASK-32 — Verify active-user/team filters for assignees

- **Severity:** Medium
- **Assessment:** Needs model verification.
- **Files:** user/team models, `tasks_services.py`.
- **Issue:** Assignment options may include inactive/deleted users if such fields exist.
- **Fix:** Inspect user/team lifecycle fields and filter inactive/deleted records. If no such fields exist, document this as not applicable.
- **Done when:** Assignment options only include assignable principals.

## TASK-33 — Keep deleted-task include semantics consistent across recycle bin

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** tasks routes/recycle-bin tests.
- **Issue:** Restore paths need deleted-only lookup, while generic include-deleted should include both active and deleted.
- **Fix:** Use explicit helpers: `get_task(... include_deleted=True)` for both, `get_deleted_task_or_404` for restore.
- **Done when:** Call sites communicate their deleted-record intent clearly.

## TASK-34 — Add query-count tests for task list/detail serializers

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** backend tests.
- **Issue:** Task serialization touches creator/updater/assigned_by and assignees. Relationship loading changes can cause N+1 regressions.
- **Fix:** Add query-count or eager-loading regression tests for task list and detail serialization.
- **Done when:** Serializer performance stays bounded after relationship loader changes.

---

## Migration checklist

- TASK-13: add `ix_tasks_tenant_status` and `ix_tasks_tenant_due_at`.
- TASK-14: relationship loader change does not require DB migration.
- TASK-03/TASK-33: no migration required; repository/service semantics only.

## Test checklist

Backend:

- Task create rolls back cleanly when assignee sync fails.
- Create/update no longer perform redundant refresh plus re-query.
- `include_deleted=True` can fetch active and deleted records, while restore uses deleted-only lookup.
- Deleted task listing respects visibility or admin policy.
- Whitespace-only task title update returns clean 4xx.
- Assignee validation uses batched user/team queries.
- Route-level due-today event emission is deduped.
- Due scan dedup is batched and tenant-scoped.
- Composite indexes are present after migration.

Frontend/manual:

- `useTasks` query key uses stable filter/sort strings.
- Page resets to page 1 explicitly when filters/sort change.
- Task dialog updates form when switching between tasks without relying on remount.
- Saving a task does not remount the dialog because of `updated_at` key changes.
- Calendar event query runs only when needed and refreshes after add/remove.
- Linked record task widgets can show more than 10 tasks or link to a full view.

## Explicit audit corrections

- Do not assume refresh alone has all relationships loaded unless explicitly loaded; remove redundant refresh+requery, but keep one reliable loading strategy.
- `TaskDialog` is currently protected by the parent key; the fix is to remove that fragile dependency, not to treat every current edit as broken.
- `TasksTable.renderCell` is a low-risk performance cleanup, not an immediate correctness bug.
- Due-time notification timezone handling is a UX accuracy improvement, not a storage bug.
