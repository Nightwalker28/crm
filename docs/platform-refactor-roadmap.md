# Platform Refactor Roadmap

Overall completion: 52%

Current phase:
- Phase 1 complete: Finance IO refactor and immediate UX cleanup
- Phase 1.5 complete: Shared UI consistency pass for creation modals and Teams/Departments styling
- Phase 2 complete: company record, user profile, and record detail navigation for contacts and organizations
- Phase 3 in progress: recycle-bin, activity log, and action-level permission foundation

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
- Added linked-customer support to insertion orders so IOs can search and attach an existing organization or create a lightweight customer record inline.

In progress:
- Verify the new contact and organization detail pages plus the related summary endpoints in the runtime.
- Verify the new recycle-bin and activity-log backend slice in the runtime.
- Design and implement the next action-level permission layer on top of the existing module access checks.

Next up:
- Expand recycle-bin behavior and activity logging beyond contacts and organizations into finance and the remaining writable modules.
- Add an activity log UI and recycle-bin UI for admin workflows.
- Add stricter action-level permissions beyond module-level access.
- Custom-field framework for existing modules.
- Broader record detail pages for other modules as they are refactored.
- Company table and broader company-management workflows.

Deferred items:
- True tenant/company ownership at the data-model level for finance records.
- Module enable/disable controls.
- Custom module builder.

Risks and migration notes:
- The current increment preserves legacy finance campaign fields for backward compatibility; they should not be treated as the long-term primary contract anymore.
- Existing upload/import behavior remains supported, but manual CRUD is now intended to be the canonical insertion-order workflow.
- The platform-wide tenant/company model is not implemented in this increment yet, so this remains phaseable rather than complete.
- Action-level permissions are not enforced yet; this increment still relies on the existing module-access layer while the audit and recycle primitives are being introduced.
