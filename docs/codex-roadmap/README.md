# Codex CRM/ERP Roadmap Overview

This roadmap is intentionally scoped for the current reality of the project:

- Solo developer workflow.
- Dev/build velocity is prioritized over production hardening for now.
- Deployment, GitHub CI/CD, Jenkins, Kubernetes, Docker Swarm, and migration-test automation are explicitly out of scope for this planning batch.
- The app currently targets Docker Compose on a desktop/server machine.
- The goal is to make the existing CRM/ERP platform coherent, usable, secure, and extensible before adding more unrelated modules.

## Core product direction

Build this as a CRM-first operating platform, closer to a lightweight custom Odoo-style system than a narrow contacts/deals CRM.

The project should prioritize:

1. Stabilizing existing modules.
2. Cleaning navigation, routing, and module behavior.
3. Making workflows understandable for non-technical users.
4. Reworking the client portal into a useful customer-facing area.
5. Adding backup/restore as a first-class product feature.
6. Adding MFA, tenant SSO, and sensitive credential encryption.
7. Treating calendar, mail, booking links, and client portal as unfinished modules that need real product work.

## Current non-goals

Do not spend this roadmap cycle on:

- Kubernetes.
- Docker Swarm.
- Jenkins.
- Complex GitHub Actions pipelines.
- Production deployment automation.
- Migration-test automation.
- Large observability stacks.
- Microservices.
- New ERP expansion modules like warehouse, payroll, full accounting, HR, or purchasing.

These can be revisited later after core CRM/product workflows are stable.

## Tier-1 modules to harden first

These modules should be treated as the priority product surface:

- Leads.
- Contacts.
- Organizations/accounts.
- Opportunities.
- Quotes.
- Sales orders.
- Products/services/catalog.
- Documents.
- Client portal.
- Support tickets.
- Calendar booking.
- Mail.
- Integrations.
- Users, roles, teams, and permissions.

## Definition of done for a tier-1 module

A tier-1 module is not considered complete until it has:

- Working list page.
- Working detail page.
- Create/edit/delete/restore flows where applicable.
- Backend-enforced permissions.
- Search, filters, sorting, pagination, and saved views where applicable.
- Related records panel where applicable.
- Activity timeline/history.
- Audit events for important changes.
- Automation entry point for that module.
- Basic backend tests for important service and route behavior.
- Basic frontend smoke coverage or at minimum a manually testable checklist.

## Recommended execution order

1. Product foundation and module cleanup.
2. Backup and restore system.
3. Automation workflow rebuild.
4. Client portal rework.
5. Identity, SSO, MFA, and encryption.
6. Calendar, mail, booking links, and client portal hardening.
7. UI/UX system cleanup.
8. Later: reporting, forecasting, manager dashboards, advanced webhooks, and ERP expansion.

## Codex working rule

When implementing tasks from this folder:

- Keep changes small and reviewable.
- Prefer one task or one tightly related task group per PR/commit.
- Do not introduce deployment, Kubernetes, CI/CD, or infra automation unless a task file explicitly says to.
- Preserve the modular monolith.
- Keep business logic in service layers, not page components or route handlers.
- Enforce permissions in the backend, not only in the frontend.
- Add migrations only when models change.
- Add tests when changing backend behavior.
- Reuse existing shared UI components before creating new one-off components.
