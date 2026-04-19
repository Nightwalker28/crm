# Current Task

This file should stay short and reflect only the active work focus.

## Working Rule

Before making substantial code changes:

- read `docs/product-rules.md`
- read `docs/architecture.md`
- read `docs/verification-checklist.md`
- update this file first if the active scope has materially changed
- update the roadmap if the sequence or status has materially changed

## Current Focus

Stabilize the current dashboard runtime first, then finish the shared data-transfer UX around it: restore the broken backend load path, add a real per-user notification center starting with import/export job notifications, and finish the splash/loading treatment so it covers the full page cleanly.

## Current Priorities

1. Restore the broken backend route/module state so dashboard data loads again reliably.
2. Add a per-user notification center with persisted notifications and wire import/export background-job events into it first.
3. Make the splash/loading treatment cover the full viewport with a minimum 3 second display instead of only covering the inner dashboard container.
4. Finish the remaining audit/UI cleanup and verify the current import/export slice honestly instead of assuming it is complete.

## Acceptance Direction

- Google sign-in should only request the scopes the product actually uses.
- Manual-capable provisioned users should be able to reach password setup reliably on first login instead of being stuck on a generic failure.
- Admin users should see and access all enabled operational modules without being blocked by team or department placement.
- Module access should move toward team-level assignment, while role permissions stay focused on action/function restrictions.
- Users should be able to create and manage named module views from a dedicated route instead of being limited to one inline selector workflow.
- Saved views and inline module filtering should support reusable condition builders with grouped `all` and `any` logic and common operators.
- Normal search on a module page should work together with selected saved-view and inline conditions.
- A user-defined default view should actually become the selected default after refresh or reopening the module.
- The platform-provided default view should behave like a normal editable saved view and should be re-selectable as the default after another view has temporarily taken that role.
- Returning from a record edit into a list or saved-view table should show the updated data without requiring a hard browser refresh.
- Active custom fields for a module should be usable in that module's saved-view column selection, filters, and tables.
- Saved views should become the foundation for richer dashboard behavior later.
- Main business modules should move toward complete, usable import/export flows rather than partial support.
- Imports should allow users to preview source headers, auto-match them to platform fields, and correct that mapping before committing the import.
- Imports should consistently force an explicit duplicate-handling choice of skip, overwrite, or merge unless a later module-level default is configured.
- Imports should always return a usable completion summary that includes total rows, imported, new, skipped, overwritten, merged, failed rows, and row-level failure reasons where possible.
- Exports should support exporting all rows, only selected rows across pages, or the currently displayed result set.
- Large imports and exports should run as background jobs instead of holding open the request thread.
- Long-running data-transfer jobs should expose persisted status, progress/summary, and result artifacts that the user can retrieve after completion.
- Profile/company imagery should support proper upload flows.
- User-facing timestamps should render in the user’s configured timezone.
- Heavy list endpoints should avoid loading unnecessary data where practical.
- Cache behavior should be safe whether Redis is present or unavailable.
- Sensitive write operations should be protected by action-level permissions, not only module access.

## Immediate Notes

- The first auth/access cleanup slice is now in place:
  - Google OAuth scopes were reduced to identity-only
  - the dead Google Docs/Drive automation path was removed from the live code
  - manual-capable users without passwords now get a setup-required response
  - admin users now bypass legacy module-assignment restrictions for enabled modules
  - team-module permissions now exist with department fallback during transition
- Inline shared quick-filter UI is now wired into the current main module pages on top of the existing shared `all_conditions` / `any_conditions` backend filter engine.
- Active custom fields are now usable as real filter targets on the supported business modules, not only as form/detail/table fields.
- The roadmap has been normalized, but some newer surfaces still need full browser-side smoke testing.
- Import preview/header mapping, duplicate-mode control, and standardized post-import summaries are now in place across contacts, organizations, opportunities, and insertion orders.
- The next import/export slice should add background job execution before the export-mode rollout is finalized for very large datasets.
- A shared persisted data-transfer job foundation now exists in the backend, so large import/export execution can be routed through status-tracked jobs instead of only live request threads.
- Current background-import threshold defaults are `10000` rows or `5 MB`, whichever is reached first.
- The background-job architecture is now Celery with Redis as the broker; the old in-process background-task path should not be extended further.
- Large import requests now enqueue real Celery jobs after the preview/confirm step, and the shared import UI polls persisted job status until completion.
