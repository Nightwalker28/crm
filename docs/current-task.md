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

Execute the UI-audit CRM feature work as shared platform patterns across every applicable module, and complete each slice to production-grade before moving on:

1. finish each audit feature as a reusable cross-module capability, not an opportunity-only one-off
2. shared record-page activity timelines are now landed across contacts, organizations, and opportunities
3. shared record notes/comments are now landed across contacts, organizations, and opportunities
4. shared global search / command palette is now landed in the dashboard shell for cross-module CRM record lookup
5. shared skeleton loading states and pagination/refetch polish are now landed across the main shared module surfaces
6. current active slice: finish and harden the first task/collaboration foundation now that the initial backend module, frontend feature entry point, assignment flow, and notification wiring are landed, then stage calendar and mailbox integrations behind that foundation
7. keep the tenant-isolation rollout moving underneath that UI work, especially for shared admin/config/activity/notification data
8. keep platform docs aligned so the active frontend roadmap, architecture rules, and implementation scope stay in sync

## Immediate Notes

- The audit-driven CRM features should be treated as platform primitives for all modules where they make product sense, not as isolated fixes inside one module.
- Do not leave features half-landed across modules: when a shared record-page capability is started, finish the applicable module coverage, backend support, and architecture/docs updates in the same slice.
- The current record-page modules are contacts, organizations, and opportunities; new shared detail-page capabilities should land across that set unless a module-specific constraint blocks it.
- Shared record notes/comments are now part of the current CRM detail-page baseline beside the shared activity timeline.
- Shared global search / command palette is now part of the dashboard-shell baseline and should stay permission-aware and tenant-scoped as more modules join it.
- Shared module tables and pipeline views now use a common initial-loading skeleton plus non-blocking background refresh treatment instead of collapsing back to full loading states.
- Shared dialog sizing now lives in the shared dialog primitive, and the remaining work in this slice is the leftover visual consistency cleanup on top of that baseline.
- The saved-view management route, CRM detail-page headers, and stale pre-launch copy on the landed dashboard/sales/finance/opportunity surfaces are now aligned with the shared UI patterns.
- Shared module configuration now has a tenant-scoped path for enablement and duplicate-mode settings, so one tenant no longer has to inherit another tenant's module toggles.
- Roles, departments, teams, their admin routes, and the current accessible-module/data-transfer-job route paths have now been checked and scoped so they no longer depend on one global shared row set.
- The current backend tenant-isolation rollout and the shared export rebuild are complete enough to stop treating them as the active slice; the next focus is collaboration and integrations on top of that corrected tenant-scoped baseline.
- The first collaboration increment should treat tasks as a real backend module so permissions, activity, notifications, and future automation hooks can scale cleanly, while the frontend can expose tasks as a feature woven into the dashboard shell and related work surfaces.
- Task assignment should support self, individual users, teams, and multiple assignee targets where the data model allows it, and assigned-task events should feed both the in-app notification center and browser notification hooks.
- The first end-to-end tasks slice is now in the codebase with a backend `tasks` module, `/dashboard/tasks`, assignment to users and teams, in-app notifications, and browser-notification bridging; the next work in this slice is hardening, deeper verification, and any missing task lifecycle gaps before calendar work starts.
- Calendar and mailbox integrations should be staged behind the task foundation so tasks, reminders, due dates, and later automation rules can reuse one shared collaboration model instead of inventing disconnected integration payloads.
- Auth and host-based tenant resolution are already in place; the remaining backend work is still row ownership and query scoping across existing modules.
- Single-tenant mode still needs to work without extra tenant setup, so the default tenant bootstrap path must stay intact.
- Timezone handling should remain: store normalized values, render in the user timezone by default, and document that as a platform rule instead of repeating it per feature.
