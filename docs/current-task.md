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

Turn saved module views into the real global list-view system by adding a dedicated manage-view route, reusable condition filters with AND/OR logic, and applying that model across the current main modules before moving back to import/export, uploads, and timezone-aware presentation.

## Current Priorities

1. Replace the inline saved-view action bar with a dedicated global manage-view route and keep only a compact view selector/changer on module pages.
2. Add reusable saved-view condition filters with `all`/`any` logic and operators such as `is`, `is not`, `contains`, `in`, `not in`, `greater than`, and `less than`.
3. Apply the shared saved-view condition model across the current main modules so normal searching combines with saved conditions cleanly.
4. Fix saved-view default selection so a user-set default survives reloads and route transitions.
5. Make active module custom fields appear as real selectable module-view columns instead of existing only in create/edit/detail forms.
6. Continue expanding real import/export functionality across the current business modules using the shared platform helpers.
7. Add proper upload support for company and personal profile/logo imagery rather than relying only on URLs.
8. Make user-facing time-based data respect the user profile timezone in the UI.
9. Push list-column preferences and view-driven field usage deeper into the query layer for the heaviest list endpoints.
10. Harden Redis-backed caching operationally and verify failure paths.
11. Expand action-level permission enforcement beyond the currently refactored core modules.

## Acceptance Direction

- Users should be able to create and manage named module views from a dedicated route instead of being limited to one inline selector workflow.
- Saved views should support reusable condition builders with `all`/`any` logic and common operators.
- Normal search on a module page should work together with the selected saved-view conditions.
- A user-defined default view should actually become the selected default after refresh or reopening the module.
- Active custom fields for a module should be usable in that module's saved-view column selection and appear in the module tables.
- Saved views should become the foundation for richer dashboard behavior later.
- Main business modules should move toward complete, usable import/export flows rather than partial support.
- Profile/company imagery should support proper upload flows.
- User-facing timestamps should render in the user’s configured timezone.
- Heavy list endpoints should avoid loading unnecessary data where practical.
- Cache behavior should be safe whether Redis is present or unavailable.
- Sensitive write operations should be protected by action-level permissions, not only module access.

## Immediate Notes

- The roadmap has been normalized, but some newer surfaces still need full browser-side smoke testing.
- Platform hardening still matters, but the current focus is on high-value workflow completeness and configurability gaps.
