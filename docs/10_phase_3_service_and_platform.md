# Phase 3: Service and Platform Hardening

## Goal

Extend the CRM beyond sales into customer service while improving platform responsiveness and shared integration structure.

## What this phase changes

- Adds a support/case module.
- Adds realtime notification and background job status updates.
- Adds contract lifecycle management.
- Adds a central integrations registry.
- Applies cross-cutting permission, activity logging, event, module registration, and test hardening.

## Included task files

1. `11_task_support_cases_module.md`
2. `12_task_realtime_notifications_and_jobs.md`
3. `13_task_contracts_esign_lifecycle.md`
4. `14_task_integrations_registry.md`
5. `15_cross_cutting_refactors.md`

## Acceptance criteria for the whole phase

- Support cases can be created, assigned, commented on, and linked to customer records.
- Notifications/job status can update live with fallback polling.
- Contracts can be created, tracked, and linked to documents/customers.
- Integrations settings page can show provider/connection metadata.
- Shared permissions, activity logging, event publishing, and module registration patterns are hardened.

## Excluded

- AI/copilot functionality
- Telephony/call logging/dialer functionality
- Sandbox/demo environment tooling
- Campaign tracking
- Public lead-capture forms
