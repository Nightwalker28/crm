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

Complete the current business-module CSV import/export surface consistently across contacts, organizations, opportunities, and insertion orders now that saved-view correctness and list refresh behavior have been stabilized.

## Current Priorities

1. Finish CSV import/export consistency across contacts, organizations, opportunities, and insertion orders using the shared platform helpers and current module headers.
2. Add proper upload support for company and personal profile/logo imagery rather than relying only on URLs.
3. Make user-facing time-based data respect the user profile timezone in the UI.
4. Push list-column preferences and view-driven field usage deeper into the query layer for the heaviest list endpoints.
6. Harden Redis-backed caching operationally and verify failure paths.
7. Expand action-level permission enforcement beyond the currently refactored core modules.

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
