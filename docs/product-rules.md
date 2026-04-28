# Product Rules

This file captures stable business and UX rules for the platform. These should be treated as source-of-truth product constraints unless explicitly changed here.

## Platform Positioning

- The product is a CRM + ERP system.
- The product should be modular: modules should be enableable/disableable without breaking unrelated modules.
- The platform is intended to support enterprise-grade reliability, security, and recoverability.

## Core Governance Rules

- Deletes should be non-destructive by default.
- Deleted records should go to recycle/recovery flows, not be permanently removed in standard operations.
- Important write actions should be logged in the activity/audit system.
- Permissions should be enforceable per action, not only per module.
- Core records and core fields should be protected from destructive user customization.
- Role permissions, tenant-wide module enablement, and team/department module availability should be separate concerns.
- Module enablement should be tenant-specific so one tenant can disable a whole module without affecting another tenant.
- Enabled modules can be restricted to specific departments and teams from the admin Modules area.
- Module action levels should be controlled by role/module action permissions after tenant/team/department availability allows the module to open.
- Admin-role users should have full access to enabled operational modules for their tenant, but disabled tenant modules should remain unavailable.

## UI and UX Rules

- Main operational list pages should use one shared table-based presentation where a table is the right default.
- Users should be able to choose which columns they see on major list pages.
- Users should also be able to control column ordering/sort presentation for their main dashboard views where practical, including cases like showing last name before first name.
- The preferred long-term model is named saved views per module rather than one rigid table preference per module.
- The system should ship with a default view for major modules, and users should be able to create their own named personal views on top of that.
- Saved views should be able to store visible fields, field order, sort behavior, and module-specific filter state over time.
- Saved views should support reusable condition builders with `all`/`any` logic and operators such as `is`, `is not`, `contains`, `in`, `not in`, `greater than`, and `less than`.
- Saved-view creation and editing should happen on a dedicated manage-view route rather than living as a large inline section on every module page.
- Module pages should keep only a compact place to switch/change the active view.
- Normal module search should combine with the selected saved-view conditions rather than acting as a disconnected separate mechanism.
- The dashboard shell should provide one shared global search / command palette for cross-module record lookup instead of each module inventing its own shell-level search entry point.
- Required fields in create/edit forms should be visually marked with `*`.
- Quick creation can use dialogs where appropriate.
- Once records exist, the preferred interaction is a record page with summary/history/editing rather than modal-only editing.
- Shared record-page collaboration features such as activity timelines and notes/comments should land across the current CRM detail-page set together, not one module at a time.
- Profile access should come from the sidebar identity block at the bottom.
- Main module pages should support inline multi-condition filtering in addition to saved-view management.
- Inline and saved-view filtering should support grouped `AND` and `OR` conditions together, not only one group at a time.

## Linked Data Rules

- Opportunity `client` should always be a linked sales contact, not arbitrary free text.
- Insertion order customer linking should use sales contacts as the primary linked entity.
- If a linked contact belongs to an organization, that organization should be backfilled where relevant.
- Currency should not be free text where the company controls allowed currencies.
- Company operating currencies should be managed from the Company section and reused anywhere the system asks for currency.
- Active custom fields must work inside the module they belong to, including create/edit, detail, table views, saved views, and filters.

## Communication Rules

- WhatsApp starts as a manual click-to-chat integration. The CRM may prepare links, templates, logs, and reminders, but users send the message in WhatsApp themselves until an explicit provider integration is added.
- WhatsApp access must be controlled as its own module through tenant enablement, department/team availability, and role/action permissions.
- WhatsApp activity initiated from a CRM record should be logged to the record activity timeline and should update a last-contacted-on-WhatsApp marker where the record supports it.
- Message templates are a global tenant-scoped platform capability. They should be reusable across modules and channels, editable by users with the right permissions, and support controlled CRM variable placeholders.
- CRM-generated reminder rules for WhatsApp should create or suggest tasks first; automated WhatsApp sending is not part of the initial workflow.
- Slack and Microsoft Teams alerts should start as simple company/tenant webhook notifications driven by CRM events. OAuth, marketplace apps, bidirectional chat sync, and chat-style internal messaging are deferred.
- Contextual record comments, mentions, activity timelines, and notification preferences should be prioritized over building a standalone internal chat system.

## Finance / Insertion Order Rules

- Finance insertion orders use the generic insertion-order model, not the old campaign-specific finance model.
- Manual create/edit is the primary IO workflow.
- Import/export should be adapter-style module workflows, not the core domain model.
- The old campaign-specific finance compatibility path is intentionally removed.

## Customization Rules

- Admins can define custom fields on supported modules.
- Core fields cannot be deleted through customization tools.
- Core records should not be destructively altered through the field builder.
- User-created modules are deferred until custom fields, permissions, recycle, activity logging, and configuration are stable enough to support them safely.

## Company / Tenant Rules

- One primary company profile is supported in the current increment.
- Multi-company within a tenant is deferred.
- Full tenant/company row-level ownership is not yet implemented and remains a later hardening phase.
- Company-managed reference data such as operating currencies should be defined centrally and reused across modules.
- Company and user profiles should support uploaded logos/images rather than relying only on raw URL entry where file upload is the expected product behavior.
- User timezone should be stored in the user profile and used to display time-based data in the user’s local timezone instead of raw server/database time where the UI is user-facing.
- Google sign-in should request only the minimum scopes needed for authentication unless a specific product workflow explicitly requires more.
- Mailbox sync should be opt-in per provider account and should not be silently granted through normal sign-in.
- Gmail inbox reading should stay disabled by default because Gmail read scopes are restricted; Gmail sending can use the narrower `gmail.send` scope when users explicitly connect mail.

## Import / Export Rules

- Main business modules should have real import/export workflows, not just placeholder or partial support.
- Users should have one per-user notification center for operational updates; background import/export jobs are the first required notification source, not the last.
- Import/export behavior should reuse shared platform helpers where possible, with module-specific mapping/validation layered on top.
- Imports should be multi-step:
  - parse file and preview headers
  - auto-match source headers to target platform fields
  - allow the user to correct the mapping
  - force a duplicate-handling decision
  - return a post-import summary
- Auto-matching should use shared normalization and alias rules so obvious header variants are matched without manual effort.
- Duplicate handling should consistently offer:
  - skip duplicate records
  - overwrite duplicate records
  - merge duplicate records
- Import completion should show:
  - total rows in the sheet
  - successfully processed rows
  - newly created rows
  - skipped rows
  - overwritten rows
  - merged rows
  - failed rows with reasons and record context where practical
- Large imports and exports should run in the background instead of holding an interactive request open for long-running jobs.
- Background import/export jobs should expose status, summary, and result/error artifacts so users can come back later and retrieve the outcome.
- Exports should consistently offer:
  - export all records
  - export selected records, even across multiple pages
  - export the currently displayed filtered result set

## Current Predefined Role Expectations

- Admin: broad configuration and management access.
- Superuser: elevated operational access without necessarily full platform-control equivalence.
- User: limited operational access based on permissions granted by role/module rules.
