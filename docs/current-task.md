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

Build shareable client pages for proposals, pricing, and documents without payment links yet.

Recently landed in the Documents slice:

1. linked-record authorization on record-linked document list, upload, download, and delete paths
2. activity/audit entries for upload, linked upload, download, soft-delete, and restore
3. unified recycle-bin listing and restore for deleted documents
4. tenant document quota status in the backend and Documents UI
5. stronger PDF, Office, and OpenDocument validation before persistence
6. a storage-provider seam and `storage_provider` metadata, with local storage as the only active provider

Recently landed in the Google Drive provider slice:

1. a per-user Google Drive connect flow with explicit Drive OAuth consent and scoped token storage
2. document uploads can use a connected Google Drive account through the existing storage backend contract
3. authenticated API downloads remain the only download surface, including Drive-backed documents
4. S3/R2-style object stores and Microsoft OneDrive remain later provider slices

Recently landed in the follow-up slice:

1. last-contacted tracking for contacts and opportunities
2. quick manual follow-up actions for WhatsApp, email, and call without automated provider sending
3. follow-up reminders as source-linked Tasks instead of a separate reminder store
4. contact and opportunity detail-page follow-up panels
5. source-linked task panels on contact and opportunity detail pages

Recently landed in the activity timeline slice:

1. source-linked task create, update, and delete events mirror onto the linked CRM record timeline
2. keep manual follow-up communication logs in the record timeline
3. source-linked sent mail validates the linked CRM record and logs `mail.sent` to the linked record timeline
4. messages, invoices, and other modules should follow the same pattern later as they expose stable source links

Recently landed in the task/reminder slice:

1. due-date alert scanning runs through Celery beat and emits one `task.due_today` alert per open due task per UTC day
2. no-reply contact scanning creates source-linked Tasks for stale contacted contacts
3. inactive open-deal scanning creates source-linked Tasks for stale opportunities
4. reminder automation keeps using the Tasks module and record timeline instead of introducing a separate reminder store

Active client portal and personalized pricing sequence:

1. add customer groups for contacts and organizations so CRM users can classify wholesale, retailer, VIP, friends/family, and default customers
2. add client-side login accounts manually linked to a contact or organization
3. keep unauthenticated/public views on normal prices only
4. use authenticated client identity to resolve customer group and personalized pricing/discount rules
5. create tenant-scoped client page records linked to proposals/pricing/documents where possible
6. expose signed public links with expiry for non-sensitive previews, plus accept/request-changes actions
7. keep payment links out of this slice

After shareable client pages are complete, resume CRM growth in this order:

1. website and WordPress integration: let customer websites pull approved catalog/service/pricing/media data from Lynk through a public integration API and later a WordPress plugin
2. custom client domains: `clients.company.com` CNAME support plus client-facing branding
3. money features: invoice generator, then Stripe and PayPal payment links

## Immediate Notes

- WhatsApp is deliberately paused as sufficient for now; keep it to manual click-to-chat and do not add reply handling or provider webhooks in this phase.
- The Slack/Teams webhook foundation is landed enough to stop being the active slice: CRM events, notification channels, test sends, best-effort delivery, and admin delivery history now exist.
- Keep richer scheduled `task.due_today` scanning as follow-up instead of blocking the mail provider slice.
- Keep optional `comment.mentioned` CRM events and Slack/email mention alerts as follow-up; the current comments slice already supports access-limited mention suggestions plus in-app notifications.
- Add notification preferences and smart notification rules later, after the mailbox provider work is stable.
- Per-user IMAP/SMTP hardening is complete enough to stop being the active slice; real Gmail smoke testing and Celery background mailbox reconciliation remain follow-up.
- Documents must be tenant-scoped and permission-gated at the route layer. Linked document operations must validate the target record exists inside the same tenant.
- Document downloads must go through authenticated API routes instead of direct static file serving.
- Deleted documents should appear in the unified recycle bin and restore without physically deleting the file.
- Local document storage remains the default provider. Google Drive is the first external provider and must use a separate connect flow from normal Google sign-in; S3/R2 and OneDrive stay deferred.
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
- Website and WordPress integrations should come after the current CRM operating loop. Public catalog/service data can use a scoped read API, but customer-specific discounts/pricing must require signed/authenticated access, expiry, tenant scoping, and rate limits.
- Module enablement must be tenant-specific: one tenant can disable a whole module, such as finance insertion orders, without disabling that module for another tenant.
- Module availability must combine tenant-wide enablement with department/team module access. Roles & Permissions still handle action-level capabilities inside modules a user is allowed to open.
- Auth and host-based tenant resolution are already in place; the remaining backend work is still row ownership and query scoping across existing modules.
- Single-tenant mode still needs to work without extra tenant setup, so the default tenant bootstrap path must stay intact.
- Timezone handling should remain: store normalized values, render in the user timezone by default, and document that as a platform rule instead of repeating it per feature.
