# Cross-Cutting Refactors

## Purpose

Harden shared platform patterns so new modules remain consistent, permission-safe, and auditable.

## What this task will accomplish

- Centralize permission policy checks where practical.
- Standardize activity logging.
- Standardize CRM event publishing.
- Ensure new modules follow the module-template pattern.
- Improve tests around cross-module flows.

## Areas to inspect

- `backend/app/modules/user_management/*`
- `backend/app/modules/platform/*`
- `backend/app/api/v1/router.py`
- Existing route dependencies and permission helpers
- Existing `log_activity` usage
- Existing CRM event routes/services
- Existing frontend route/module configs
- `docs/module-template/README.md`

## Refactor 1: Permission policy service

Create or consolidate a single service/helper that answers:

- Can user view module?
- Can user create/update/delete record?
- Can user perform special action such as convert, export, assign, or configure?

Validation:

- Existing routes continue to pass.
- New modules can use the same permission helper.
- Tests cover at least allowed, denied, and tenant mismatch cases.

## Refactor 2: Activity logging helper

Standardize create/update/delete/restore/convert events.

Validation:

- New lead scoring, quote-to-order, support case, and contract actions log activity consistently.
- Activity log failures should not crash the main business operation unless required.

## Refactor 3: CRM event publishing helper

Standardize event names and payloads.

Suggested naming:

- `lead.created`
- `lead.updated`
- `lead.converted`
- `opportunity.stage_changed`
- `quote.created`
- `quote.status_changed`
- `order.created`
- `case.created`
- `case.status_changed`
- `contract.status_changed`

Validation:

- Automation rules can consume events consistently.
- Events include tenant id, actor id, entity type, entity id, and payload.

## Refactor 4: Module registration checklist

For every new module, verify:

- Backend router registered.
- Module appears in seed/module registry if required.
- Frontend route exists.
- Sidebar/module config is correct.
- Permission key is consistent.
- Saved views/table preferences work if expected.

## Refactor 5: Test coverage

Add/extend tests for:

- Lead scoring recalculation.
- Automation rule execution.
- Proposal generation/tracking.
- Quote-to-order conversion.
- Booking link timezone/overlap behavior.
- Support case lifecycle.
- Realtime auth/fallback behavior.
- Contract status transitions.

## Do not implement

- AI-related abstractions
- Telephony-related abstractions
- Campaign/public lead-capture abstractions
- Sandbox/demo environment tooling
