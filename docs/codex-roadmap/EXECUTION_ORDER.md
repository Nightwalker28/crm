# Codex Roadmap Execution Order

This file is the short working order for Codex.

Deployment, GitHub CI/CD, Kubernetes, Docker Swarm, Jenkins, and migration-test automation are intentionally skipped for now.

## Immediate build focus

Work in this order unless the user asks otherwise.

## 1. Product foundation and module cleanup

Reference: `phase-01-product-foundation.md`

Do first:

1. Define tier-1 module registry.
2. Fix sidebar, module, and route behavior.
3. Remove stale or dead navigation references.
4. Standardize tier-1 list pages.
5. Standardize tier-1 detail pages.
6. Audit backend permissions for tier-1 module actions.
7. Add `docs/module-maturity.md`.

Reason: everything else depends on knowing which modules are real, stable, visible, and permission-protected.

## 2. Backup and restore system

Reference: `phase-02-backup-restore.md`

Do next:

1. Build platform/admin backup service.
2. Add platform backup admin UI.
3. Add tenant backup settings model.
4. Add tenant backup run history.
5. Add tenant export artifact format.
6. Add local download first.
7. Add Google Drive and OneDrive destinations later.
8. Add module-level restore/import before whole-tenant restore.

Reason: backups are both a product feature and a safety feature. Build local/simple first, then cloud destinations.

## 3. Automation workflow rebuild

Reference: `phase-03-automation-workflows.md`

Do next:

1. Create automation domain model.
2. Create trigger registry.
3. Create condition builder model.
4. Create action registry.
5. Add module-level automation pages.
6. Add non-JSON automation builder UI.
7. Add execution engine.
8. Add run history/debugging.
9. Add initial cross-module automations.

Highest-value examples:

- Lead converted creates or links contact, account, and opportunity.
- Quote accepted creates sales order.
- Booking created links lead/contact and creates follow-up task.
- Support ticket created assigns/notifies support team.

## 4. Client portal rework

Reference: `phase-04-client-portal-rework.md`

Do next:

1. Define portal information architecture.
2. Fix portal auth/access model.
3. Add client product/service catalog.
4. Add client ordering flow.
5. Add client support tickets.
6. Add quick questions/messages.
7. Add shared documents.
8. Add quotes/contracts visibility and approval.
9. Add bookings/appointments.
10. Add portal audit events.

Product rule: the client portal must not be a generic dashboard. It must let clients view products/prices, order, create tickets, ask questions, view documents, and interact with quotes/contracts/bookings.

## 5. Identity, SSO, MFA, and encryption

Reference: `phase-05-identity-security-encryption.md`

Do next:

1. Add MFA/TOTP foundation.
2. Add admin MFA controls.
3. Add tenant OIDC SSO.
4. Add SSO testing/diagnostics.
5. Add sensitive credential encryption service.
6. Prepare for key rotation.
7. Add security/audit events.
8. Add data classification docs.

Protect first:

- OAuth refresh/access tokens.
- API keys.
- Webhook signing values.
- SSO client credentials.
- Backup destination credentials.
- TOTP secrets.

Do not encrypt normal searchable CRM fields until search/filter impact is understood.

## 6. Hardening unfinished modules

Reference: `phase-06-unfinished-modules.md`

Treat as unfinished:

- Calendar.
- Mail.
- Booking links.
- Client portal.
- Integrations.

Do next:

1. Clean integration registry.
2. Finish public catalog/order integration work.
3. Harden calendar.
4. Harden booking links.
5. Harden mail.
6. Harden client portal after rework.
7. Harden public API/integration security.
8. Add module health/status panels.

## 7. UI/UX system cleanup

Reference: `phase-07-ui-ux-system.md`

Do after the structure is clearer:

1. Shared CRM page patterns.
2. Shared record detail layout.
3. Table/list UX standard.
4. Shared filter/condition builder behavior.
5. Sidebar/navigation UX pass.
6. Client portal UX system.
7. Form UX standard.
8. Activity timeline component.

## Later, not now

Do not prioritize these until core product workflows are stable:

- Forecasting.
- Manager dashboards.
- Advanced reporting schema.
- Advanced integration marketplace.
- Full ERP expansion.
- Inventory, warehouse, accounting, HR, purchasing.
- Kubernetes or Swarm.
- Complex CI/CD.

## General Codex implementation rules

- Keep PRs/commits small.
- Prefer service-layer business logic.
- Do not put important workflow logic only in frontend components.
- Enforce permissions in backend.
- Keep tenant scoping explicit.
- Add migrations only when models change.
- Add tests for changed backend behavior where feasible.
- Reuse shared UI components.
- Avoid raw JSON user interfaces for non-technical admin features.
