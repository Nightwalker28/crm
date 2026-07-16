# MAAD CRM Frontend Revamp Audit

This is the execution checklist for [`MAAD_CRM_FRONTEND_REVAMP_SPEC.md`](./MAAD_CRM_FRONTEND_REVAMP_SPEC.md). A phase is complete only when its routes also satisfy the shared templates, application states, responsive behavior, accessibility requirements, tests, and migration-note requirement in sections 6 and 10–20 of the specification.

Status meanings:

- **Implemented:** current code covers the phase item and its applicable acceptance criteria.
- **Partial:** the main workflow exists, but one or more applicable acceptance criteria remain open.
- **Not started:** the revamp work has not been audited or implemented.
- **Out of sequence:** useful work exists, but earlier phase gates remain open.

## Phase status

| Phase | Item | Status | Confirmed coverage | Remaining work |
| --- | --- | --- | --- | --- |
| 1 | Tokens and app shell | Partial | Shared theme variables, dashboard shell, grouped/collapsible sidebar, breadcrumbs, command palette | Complete a route-by-route token/ad-hoc-style audit and permission-denied state review |
| 1 | Shared controls and states | Partial | Shared buttons, fields, cards, tables, skeletons, empty states, page headers, list toolbar, record form layout | Route-local loading/error/not-found coverage is inconsistent; density preference and filtered-empty handling are not universal |
| 2 | Leads | Implemented | Shared list, routed create/detail/edit/convert flow, tabs, responsive browser contract | Add route-local boundaries as part of the cross-cutting state pass |
| 2 | Contacts | Implemented | Shared list, routed create/detail/edit flow, tabs, related records, responsive browser contract | Add route-local boundaries as part of the cross-cutting state pass |
| 2 | Accounts | Implemented | Shared list, routed create/detail/edit flow, tabs, related commercial records, responsive browser contract | Add route-local boundaries as part of the cross-cutting state pass |
| 2 | Opportunities | Implemented | Shared list, table/kanban, optimistic stage movement with rollback, routed create/detail/edit, responsive browser contract | Add route-local boundaries as part of the cross-cutting state pass |
| 3 | Quotes | Implemented | Shared saved-view list and toolbar, distinct dataset/filtered empty states, routed itemized create/detail/edit, route boundaries, responsive layouts, focused browser contract | Authenticated browser execution requires configured E2E MFA credentials |
| 3 | Orders | Implemented | Shared saved-view list and toolbar, distinct dataset/filtered empty states, routed itemized create/detail/edit, server-recalculated item updates, route boundaries, responsive layouts, focused browser contract | Authenticated browser execution requires configured E2E MFA credentials |
| 3 | Invoices | Implemented | Shared saved-view list and toolbar, routed itemized create/detail/edit/print, server-calculated totals, distinct empty states, route boundaries, responsive layouts, focused browser contract | Authenticated browser execution requires configured E2E MFA credentials |
| 3 | Payments | Implemented | Dedicated guarded route, saved views, search/filter/sort, selection, pagination, loading/error/empty states, atomic payment recording, responsive browser contract | Authenticated browser execution requires configured E2E MFA credentials |
| 4 | Users, Authentication, Domains, Permissions, Field config, View manager | Not started | Existing product screens remain available | Audit and migrate in the specification order |
| 5 | Module builder, Automation builder, Dashboard edit mode | Not started | Existing product screens remain available | Audit and migrate in the specification order |
| 6 | Calendar | Not started | Existing calendar functionality remains available | Migrate before continuing later Phase 6 items |
| 6 | Tasks | Out of sequence | List, board, calendar, optimistic status movement, quick review | Revisit after Calendar for route states and full-page complex editing criteria |
| 6 | Support, Reports, Integrations | Not started | Existing product screens remain available | Audit and migrate in order |

## Cross-cutting acceptance audit

| Requirement | Status | Evidence or gap |
| --- | --- | --- |
| Shared tokens and primitives | Partial | New work uses shared tokens and controls; older transaction/settings routes still contain ad-hoc neutral/red/green styling |
| Full-page complex creation | Implemented for Phase 2 and transaction creation | Leads, contacts, accounts, deals, quotes, orders, and invoices use routed creation |
| Routed detail/edit workflows | Implemented for Phase 2 and Phase 3 | Core CRM and transaction records use routed detail/edit workflows; remaining phases are still unaudited |
| Loading, refreshing, empty, filtered-empty, error, not-found, permission states | Partial | Phase 3 lists now distinguish dataset and filtered empty states and have route boundaries; earlier and later phases still need the cross-cutting state pass |
| Keyboard and accessibility behavior | Partial | Labels, semantic controls, focus primitives, and keyboard alternatives exist in migrated flows; a complete WCAG 2.2 AA pass remains open |
| Responsive core workflows | Partial | Phase 2 and transaction creation have narrow-viewport browser contracts; administration/builders/secondary modules remain unaudited |
| Pagination and resilient server state | Implemented on migrated operational lists | React Query and paged list primitives preserve data during refresh; Payments uses server-side filtering and pagination |
| Tenant and permission preservation | Implemented for audited Phase 1–3 routes | Existing module/action guards remain in place; Payments reuses `finance_pos` view/edit permission and tenant-scoped invoice locking |
| Critical interaction tests | Partial | Phase 2, transaction creation/editing, Tasks, and Payments have focused Playwright contracts; authenticated execution requires E2E MFA credentials |
| Migration notes | Partial | Phase 3 retired `QuotesHeader`, `OrdersHeader`, and `PosInvoiceDialog`; future slices must record their own removed legacy components here |

## Corrected execution order

1. Complete Phase 4 in order: Users, Authentication, Domains, Permissions, Field config, View manager.
2. Complete Phase 5 in order: Module builder, Automation builder, Dashboard edit mode.
3. Complete Phase 6 starting with Calendar, then revisit Tasks, followed by Support, Reports, and Integrations.
4. Run the final cross-cutting responsive, accessibility, state, performance, and visual-consistency pass before declaring the revamp complete.
