# Platform Refactor Roadmap

Overall completion: 99%

Current phase:
- Phase 1 complete: Finance IO refactor and immediate UX cleanup
- Phase 1.5 complete: Shared UI consistency pass for creation modals and Teams/Departments styling
- Phase 2 complete: company record, user profile, and record detail navigation for contacts and organizations
- Phase 3 complete: recycle-bin, activity log, and action-level permission foundation
- Phase 4 complete: custom fields for existing modules
- Phase 4.5 complete: legacy finance cleanup and shared module utility framework
- Phase 5 in progress: uniform list tables, per-user table preferences, and cache hardening
- Phase 6 in progress: module wiring completion and module availability controls

Completed items:
- Added a generic insertion-order backend contract alongside the legacy finance import flow.
- Added manual list/create/update/delete APIs for insertion orders.
- Preserved legacy finance fields and added a migration path that backfills generic fields from historical records.
- Added finance soft-delete scaffolding with `deleted_at` so active records can be removed non-destructively.
- Reworked the finance frontend to use generic insertion-order search, status filtering, and manual create/edit flows.
- Added required-field markers to the new insertion-order form.
- Kept the legacy file import flow available as a secondary path and relabeled it as legacy import.
- Added required-field markers to the create modals for contacts, organizations, users, departments, and teams.
- Fixed contact creation UX so the modal requires the same field the backend requires: primary email.
- Unified Teams and Departments into the same card-based management style instead of mixing cards and the old table layout.
- Added editable user self-profile fields and routes.
- Added a primary company profile model, API surface, and dashboard page.
- Added dashboard entry points for Profile and Company.
- Extended the user edit modal to manage sign-in mode and active/inactive status.
- Replaced modal-only editing for contacts and organizations with record detail pages that support inline editing.
- Added contact and organization summary/history views with related opportunities, related insertion orders, and inferred services.
- Moved profile access to the sidebar identity block instead of a separate nav item.
- Fixed the user edit dialog so admins can change sign-in mode and active or inactive status per user.
- Reworked contact and organization list navigation so records open into detail pages without invalid nested links.
- Added initial sales recycle-bin behavior by changing contact and organization deletes to soft deletes.
- Added restore endpoints for recycled contacts and organizations.
- Added the first shared activity-log model, service, migration, and admin read API.
- Added audit events for contact and organization create, update, delete, and restore actions.
- Added audit events for generic finance insertion-order create, update, and soft-delete actions.
- Added linked-customer support to insertion orders so IOs can search and attach an existing sales contact, while still backfilling the related organization link when the contact belongs to one.
- Added a first-pass Roles & Permissions section with three predefined templates: Admin, Superuser, and User.
- Added per-role, per-module action permissions for view, create, edit, delete, restore, export, and configure.
- Started enforcing action-level permissions on finance insertion orders, sales contacts, and sales organizations write actions.
- Corrected action-level permission wiring so read, create, edit, delete, restore, and export routes now map to the intended action flags instead of mismatched checks.
- Extended recycle-bin and audit coverage to sales opportunities with soft delete, restore, and activity events.
- Added a unified recycle-bin admin UI and activity-log admin UI.
- Added a first custom-field framework with module-scoped field definitions and JSON-backed custom values on finance insertion orders, sales contacts, sales organizations, and sales opportunities.
- Added a custom-fields admin page so admins can create and disable module-specific custom fields.
- Added runtime custom-field rendering to contact create/detail flows, organization create/detail flows, and insertion-order create/edit flows.
- Removed the public legacy finance search endpoints and replaced the finance upload contract with a generic CSV-based insertion-order import flow.
- Dropped the legacy finance campaign-era columns from the live schema and cleaned the finance model back down to the generic insertion-order contract.
- Updated the sales-to-finance automation path so it creates generic insertion orders directly instead of building old campaign-shaped finance rows.
- Extracted the first shared module CSV utility for reusable upload parsing and header validation.
- Extracted shared module search and export helpers and refactored contact and organization services to use them.
- Added relational custom field value storage and started persisting custom-field writes into linked value rows for insertion orders, contacts, organizations, and opportunities.
- Added a migration that backfills relational custom field values from the existing JSON bridge columns.
- Switched contact, organization, opportunity, and insertion-order reads and update merges to hydrate custom fields from the relational value store first, with JSON only as a guarded fallback during transition.
- Extended the shared module search utility into sales opportunities so search behavior is no longer implemented three different ways across the main sales modules.
- Extended the shared module search utility into admin user search and generic finance insertion-order search so the core list/search surfaces now share one ranked-search primitive.
- Removed the dead legacy finance search and persistence helpers that still referenced deleted campaign-era columns, reducing the chance of reintroducing broken legacy paths later.
- Added shared upload-byte validation and shared binary download response helpers so contacts and organizations no longer duplicate CSV upload checks or attachment/export response header handling.
- Refactored the contact and organization import/export routes to use the shared module file helpers instead of hand-rolled route-level validation and response construction.
- Removed the JSON `custom_data` bridge columns from the finance and sales tables after backfilling the relational custom field values.
- Converted ORM-side `custom_data` handling into an in-memory cache so service and API shapes stay stable while persistence remains fully relational.
- Added local cached custom-field definition reads with explicit invalidation on create and update so definitions are no longer reloaded from Postgres on every request.
- Added a persisted per-user table preference model and API for list pages.
- Standardized organizations onto the shared table language and added per-user visible-column controls for contacts, organizations, and users.
- Added a shared module table shell so contacts, organizations, and users now use the same list container height and base styling.
- Fixed the organizations page runtime regression caused by the missing `isLoading` hook binding.
- Added `fields`-aware list requests from the contacts, organizations, and users dashboards so visible-column preferences are now sent to the backend.
- Added backend payload shaping for contact and organization list APIs so hidden columns are no longer serialized into list responses by default.
- Added conservative user list payload shaping support that keeps the edit modal safe by preserving the row fields the current user-management flow still depends on.
- Extended the same per-user visible-column controls and shared table styling to the finance insertion-order list so the main operational module lists now follow one table language.
- Added finance insertion-order list payload shaping so the finance dashboard also sends a `fields` contract and trims non-visible list fields while still preserving the edit-critical values the dialog currently depends on.
- Replaced the custom-field definition cache internals with a cache backend that can use Redis when configured and falls back to a local in-process cache when Redis is unavailable.
- Added Redis service wiring to the development stack and backend configuration so definition caching can move off a single-process cache without breaking local development when Redis is absent.
- Wired the backend-only sales opportunities module into the frontend with a full list page, create/edit dialog, visible-column preferences, search, delete, and finance handoff action.
- Added backend list payload shaping for sales opportunities so the new opportunity page follows the same `fields` contract as the other operational list modules.
- Added a real global module availability flag on the `modules` table with an admin API and migration-backed persistence.
- Added an admin Modules page so admins can enable or disable modules without editing seed data or permissions by hand.
- Updated accessible-module resolution so disabled modules are filtered out of `/users/me/modules`.
- Switched business-module navigation in the sidebar to the backend-provided accessible module list, so enabled/disabled state and permissions now affect what users can actually open.
- Fixed the shared switch component so Radix-only props such as `onCheckedChange` are no longer leaked into DOM buttons on the Modules page.
- Added company-managed operating currencies to the company profile model, API, migration, and dashboard page.
- Wired insertion-order currency selection to the company-configured currency list instead of a free-text input.
- Wired opportunity currency selection to the same company-configured currency list instead of a free-text input.
- Changed opportunity creation/editing so the client is selected from linked sales contacts rather than typed as arbitrary free text.
- Extended contact search list payloads so opportunity/client pickers can backfill linked organization context from the chosen contact.
- Fixed the opportunity search helper regression so opportunity list/search queries still return ranked results instead of breaking on a missing return path.
- Improved opportunity save error handling so backend validation details surface in the frontend instead of collapsing into a generic status error.

In progress:
- Push list-column preferences deeper into the query layer so modules can avoid selecting fields that are not needed for the current view, not just avoid serializing them.
- Continue unifying any remaining main module index pages onto one shared table-based presentation where a table is the correct default.
- Harden the new Redis-backed cache operationally now that the cache abstraction and fallback behavior are in place.
- Keep extending the new module availability controls so they cover broader admin/module configuration use cases than simple global enabled or disabled state.
- Keep standardizing module forms so linked-record selectors and company-managed reference data replace remaining free-text fields where those relationships are the real source of truth.

Next up:
- Push those list preferences all the way into ORM select/load behavior over time so modules can avoid loading fields that are not needed for the active view.
- Add runtime verification and failure-path hardening for the Redis-backed cache layer now that the abstraction is in place.
- Continue standardizing any remaining main module index pages onto one shared table-based visual language where that layout makes sense.
- Extend module availability from a global enabled or disabled flag into richer module configuration once the current control model is stable.
- Continue converting remaining business forms to shared linked dropdowns and company-managed reference data where those constraints are platform rules rather than per-module ad hoc inputs.
- Future roadmap candidates can continue from the deferred items and post-completion hardening work.

Deferred items:
- True tenant/company ownership at the data-model level for finance records.
- ORM-level selective field loading for list pages should be treated as a later performance-hardening phase after the current module wiring and availability work lands.
- Module enable/disable controls.
- Full custom module builder.
- User-created modules stay deferred until the shared module utility layer and relational custom-field architecture are stable enough to support them safely.

Risks and migration notes:
- Backward compatibility for the original campaign-centric finance model is now intentionally being removed; the next finance migration should be treated as a cleanup and simplification step, not a compatibility layer.
- Existing upload/import behavior is being replaced with a generic insertion-order import path; that change should be paired with a one-time operational snapshot before destructive finance schema cleanup.
- The platform-wide tenant/company model is not implemented in this increment yet, so this remains phaseable rather than complete.
- Action-level permissions now exist but are only partially enforced; module-level access remains the broad gate while the per-action rollout continues.
- Recycle-bin direction is now fixed as one unified admin area with module-specific tables and filters, rather than separate recycle pages for every module.
- The custom-field runtime is now fully relational at the database layer; remaining custom-field work is now about hardening and extension rather than bridge removal.
- Table-column customization and definition caching are the next UX/performance slice and should be treated as optimization and consistency work, not schema-correctness work.
- Redis-backed caching now exists for definition reads, but it still needs runtime validation in the actual container stack before it should be treated as production-ready.
- The new table-preference layer now controls presentation, persistence, and API payload shaping, but it does not yet change ORM select lists or relationship loading.
- Custom modules stay deferred until custom fields, module configuration, recycle, activity, and action permissions are stable.
