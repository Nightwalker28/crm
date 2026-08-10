---
name: feature-slice
description: Use when planning or implementing a new product slice so the work lands coherently across product, backend, frontend, permissions, activity, and verification.
---

# Feature Slice Workflow

Use this for new capabilities or meaningful expansions, not tiny bugfixes.

## Before coding

Define:
- the user-facing outcome
- the smallest complete slice worth shipping
- which existing platform primitives should be reused
- which modules are affected
- what is intentionally out of scope for this slice

Inspect first:
- nearby routes, services, models, tests, hooks, pages, and shared primitives
- existing permission/module patterns
- existing activity, notification, import/export, or background-job patterns if relevant

## Slice design rules

A good Lynk slice should:
- be tenant-aware from the start
- enforce the correct module and action permissions
- use shared primitives where the capability is platform-wide
- preserve soft-delete/recovery expectations where applicable
- write activity/audit history for important writes where the domain supports it
- avoid reopening deferred future work just because it is adjacent
- avoid landing only the backend or only one UI surface when the product rule requires full applicable coverage

## Completion standard

A slice is complete only when the relevant parts are addressed:
- schema/model changes
- route and service behavior
- frontend surface
- permissions
- linked-record validation
- activity/audit behavior
- failure states
- tests/checks
- current-focus or roadmap updates when status materially changes

## Anti-patterns

Avoid:
- one-off implementations when a shared primitive already exists
- "temporary" free-text fields where a linked relationship is the real source of truth
- half-shipping a shared capability in one module and promising to copy it later
- broad refactors disguised as a feature
- silently broadening scope into adjacent roadmap items
