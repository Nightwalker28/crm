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

Start the WhatsApp collaboration integration as a tenant-aware module and shared template platform capability:

1. register WhatsApp as its own backend module so tenant enablement, department/team availability, and role/action permissions can control access like tasks, calendar, and mail
2. build Phase 1 click-to-chat MVP on contact profiles: WhatsApp button, pre-filled template message, manual activity logging, last-contacted-on-WhatsApp timestamp, and optional follow-up task reminder
3. introduce global message templates as a reusable tenant-scoped platform primitive, not a WhatsApp-only helper, so multiple modules can expose editable templates with CRM variables
4. seed the first WhatsApp template set for quote follow-up, payment reminder, delivery confirmation, meeting reminder, and service reminder
5. keep Phase 2 focused on template management and variable rendering before adding automated sending or provider webhooks
6. keep Phase 3 reminder rules manual-send only at first: Celery/scheduler may create suggested tasks, but users remain responsible for sending WhatsApp messages
7. do not request or store WhatsApp provider credentials in the first slice; click-to-chat uses user-controlled WhatsApp URLs and logs only the user's CRM action
8. keep platform docs aligned as this integration becomes a shared collaboration/integration primitive

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
- The first end-to-end tasks slice is now in the codebase with a backend `tasks` module, `/dashboard/tasks`, assignment to users and teams, in-app notifications, and browser-notification bridging; the next collaboration slice now shifts onto calendar foundations on top of that task baseline.
- Calendar should start as a real tenant-aware collaboration module with one internal calendar per user, optional sharing/invite paths for users and teams, and source-linking back to tasks and future module events instead of being a disconnected side feature.
- Calendar sync should be modeled as provider-aware account linkage so the current Google auth path can drive sync where available, future Microsoft / Entra auth can plug into the same shape, and manual-login users simply stay on the internal calendar until they connect an external provider later.
- Mailbox integration is parked after the first foundation because Google mailbox scopes need a separate verification/compliance plan before product work continues.
- Each user should be able to connect their own Google Gmail or Microsoft Outlook inbox through the mail module. Google uses the existing Google OAuth client, while Microsoft requires Entra app settings before the Microsoft Graph mail flow can complete.
- Gmail read/reply-from-inbox features require restricted Google scopes; default Google mail should avoid inbox sync and use send-only scope unless restricted-scope verification is intentionally planned. Microsoft Graph can support delegated read/send with least-privilege `Mail.Read` and `Mail.Send`.
- Production-grade calendar and mail sync should move toward the shared background-job architecture: immediate sync on user writes where possible, queued provider sync work, and periodic reconciliation jobs instead of relying only on interactive requests.
- WhatsApp integration should start as a click-to-chat/manual-send module, not a provider-sync module. It must still use normal module enablement, role/action permissions, activity logging, and task reminder primitives from the start.
- Message templates should be a global tenant-scoped platform capability that can be used by WhatsApp first and later reused by mail, tasks, finance, sales, and other modules. Templates should support user-created and editable tenant templates with controlled CRM variable placeholders.
- Module enablement must be tenant-specific: one tenant can disable a whole module, such as finance insertion orders, without disabling that module for another tenant.
- Module availability must combine tenant-wide enablement with department/team module access. Roles & Permissions still handle action-level capabilities inside modules a user is allowed to open.
- Auth and host-based tenant resolution are already in place; the remaining backend work is still row ownership and query scoping across existing modules.
- Single-tenant mode still needs to work without extra tenant setup, so the default tenant bootstrap path must stay intact.
- Timezone handling should remain: store normalized values, render in the user timezone by default, and document that as a platform rule instead of repeating it per feature.
