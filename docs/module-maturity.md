# Module Maturity Checklist

This checklist tracks current module readiness against the tier-1 definition in `docs/codex-roadmap/README.md`.

Status values:

- `Complete`: broadly usable for this phase.
- `Partial`: usable, but missing one or more expected tier-1 capabilities.
- `Experimental`: early or intentionally limited surface.
- `Not applicable`: not expected for this module.

## Tier-1 Modules

| Module | Tier | Status | List page | Detail page | Permissions | Activity timeline | Automation support | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Leads | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Shared list and record activity exist; automation entry points and broader permission tests still need hardening. |
| Accounts / Organizations | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Shared list/detail patterns exist; related-record and automation coverage remains incomplete. |
| Contacts | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Detail page includes communication and activity tooling; lifecycle automation and permission test coverage need expansion. |
| Opportunities / Deals | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Pipeline and detail workflows exist; automation and cross-module action tests need broader coverage. |
| Quotes | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Quote detail, proposal, conversion, and activity flows exist; automation/audit coverage is still not complete. |
| Sales orders | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Detail page now uses shared record activity; restore/export and broader permission coverage remain limited. |
| Products | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Catalog list/detail pages exist; activity/notes/tasks now use shared panels, but automation remains limited. |
| Services | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Mirrors product catalog maturity; service-specific automation and test coverage are still partial. |
| Documents | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | List, upload, versions, authenticated downloads, and record linking exist; dedicated detail page and automation support are incomplete. |
| Client portal | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Admin list/page management and public/client boundaries exist; record-level history and automated lifecycle coverage need more work. |
| Support cases | Tier 1 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | List/detail and case events exist; shared activity panels are wired, but restore/export and automation are incomplete. |
| Calendar booking | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Booking type management and public booking links exist; timeline/history and automation coverage need hardening. |
| Mail | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Mail context, send, sync, and record linking exist; detail/history and broader restricted-scope hardening are still in progress. |
| Integrations | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Settings integration surface exists; provider lifecycle history, automation hooks, and tests need broader coverage. |
| Users, roles, teams, permissions | Tier 1 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Core settings pages and backend permission policy exist; auditability and route-level regression coverage should keep expanding. |

## Phase 1 Tracked Supporting Modules

| Module | Tier | Status | List page | Detail page | Permissions | Activity timeline | Automation support | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Insertion orders | Tier 2 | Partial | Complete | Partial | Partial | Complete | Partial | Partial | Included in Phase 1 cleanup; detail page now exposes shared activity panels, but maturity is still below tier-1. |
| POS | Tier 2 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | POS invoices are still dialog/list centered with print route support; dedicated detail page remains outstanding. |
| Reports | Tier 2 | Partial | Complete | Not applicable | Partial | Not applicable | Partial | Partial | Reporting surface exists with backend permission checks; coverage depends on source module permissions and needs more tests. |
| Tasks | Tier 2 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Task list/dialog workflow and source linking exist; dedicated detail route and full record history are incomplete. |
| Custom modules | Experimental | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Runtime records have list/detail/edit flows; shared comments/documents/activity are intentionally limited until dynamic record references mature. |
| Settings pages | Tier 2 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Settings modules are functional but vary by page; admin/config audit coverage is still uneven. |
| Contracts | Tier 2 | Partial | Complete | Partial | Partial | Partial | Partial | Partial | Registered sales-adjacent module with list/detail flows; not part of the tier-1 completion bar. |

## Open Maturity Gaps

- Dedicated detail pages are still missing or incomplete for POS, documents, tasks, and several settings surfaces.
- Automation support is mostly an entry point rather than full module-specific lifecycle automation.
- Permission enforcement exists across most core routes, but Phase 1.5 should continue expanding route/service regression tests for high-risk actions.
- Activity timelines are strongest on sales records and recently wired detail pages; dynamic custom modules and some settings/admin actions still need broader history coverage.
- Frontend smoke coverage is not yet a consistent automated check for every tier-1 list/detail workflow.
