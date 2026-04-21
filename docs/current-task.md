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
6. current active slice: resume the tenant-isolation rollout underneath the shared UI work, starting with shared admin/config/activity/notification data that still assumes one global row set
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
- The next active implementation focus should move back to tenant-aware data ownership and query scoping for shared admin/config/activity/notification paths that still behave like one global install.
- Auth and host-based tenant resolution are already in place; the remaining backend work is still row ownership and query scoping across existing modules.
- Single-tenant mode still needs to work without extra tenant setup, so the default tenant bootstrap path must stay intact.
- Timezone handling should remain: store normalized values, render in the user timezone by default, and document that as a platform rule instead of repeating it per feature.
