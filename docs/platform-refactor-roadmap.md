# Platform Refactor Roadmap

Overall completion: 86%

Current phase:
- Phase 1 complete: Finance IO refactor and immediate UX cleanup
- Phase 1.5 complete: Shared UI consistency pass for creation modals and Teams/Departments styling
- Phase 2 complete: company record, user profile, and record detail navigation for contacts and organizations
- Phase 3 in progress: recycle-bin, activity log, and action-level permission foundation
- Phase 4 in progress: custom fields for existing modules
- Phase 4.5 in progress: legacy finance cleanup and shared module utility framework

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

In progress:
- Verify the new contact and organization detail pages plus the related summary endpoints in the runtime.
- Verify the new recycle-bin and activity-log backend slice in the runtime.
- Expand action-level permission enforcement beyond the currently wired finance and sales routes into the remaining admin structure workflows.
- Broaden custom-field rendering into additional writable modules and list/detail surfaces after those modules are refactored.
- Continue extracting shared import/export/search utilities from the remaining module-specific implementations into reusable platform helpers.
- Complete the migration away from JSON-backed custom-field reads so relational custom field values become the primary source of truth.

Next up:
- Introduce shared platform primitives for pagination, search, export, and import, with module-specific adapters instead of duplicated per-module flows.
- Replace JSON custom fields fully with a relational extension model using shared custom field definitions plus linked custom field values.
- Expand recycle-bin behavior and activity logging into the remaining writable admin structure workflows.
- Add stronger role-based enforcement around company/profile/admin structure endpoints.
- Continue the custom-field framework into more modules and richer field-management controls after the relational custom-field refactor lands.
- Broader record detail pages for other modules as they are refactored.
- Company table and broader company-management workflows.
- Add role editing and role deletion safeguards once the permission matrix settles.
- Add custom-field management safeguards such as immutable keys, sort controls, and richer field editing.

Deferred items:
- True tenant/company ownership at the data-model level for finance records.
- Module enable/disable controls.
- Full custom module builder.
- User-created modules stay deferred until the shared module utility layer and relational custom-field architecture are stable enough to support them safely.

Risks and migration notes:
- Backward compatibility for the original campaign-centric finance model is now intentionally being removed; the next finance migration should be treated as a cleanup and simplification step, not a compatibility layer.
- Existing upload/import behavior is being replaced with a generic insertion-order import path; that change should be paired with a one-time operational snapshot before destructive finance schema cleanup.
- The platform-wide tenant/company model is not implemented in this increment yet, so this remains phaseable rather than complete.
- Action-level permissions now exist but are only partially enforced; module-level access remains the broad gate while the per-action rollout continues.
- Recycle-bin direction is now fixed as one unified admin area with module-specific tables and filters, rather than separate recycle pages for every module.
- The current custom-field slice is active for contacts, organizations, insertion orders, and opportunities, but it uses JSON-backed storage as a temporary bridge and should be replaced with relational custom field values before being treated as the long-term enterprise design.
- Custom modules stay deferred until custom fields, module configuration, recycle, activity, and action permissions are stable.
