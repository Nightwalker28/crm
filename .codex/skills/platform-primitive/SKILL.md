---
name: platform-primitive
description: Use when adding or changing a capability that may belong in shared platform infrastructure rather than one module.
---

# Platform Primitive Check

Before adding module-specific code, ask whether the capability is really a shared platform concern.

## Likely shared primitives

Examples already present in Lynk:
- activity timelines
- record notes/comments
- notifications
- message templates
- global search
- saved views
- list/table infrastructure
- import/export workflows
- background data-transfer jobs
- document linking
- datetime rendering helpers
- pagination/filtering helpers

## Prefer a shared primitive when

- multiple modules need the same behavior
- the behavior is part of a platform rule, not unique business logic
- future modules are likely to need it
- duplicated implementations would drift or create security gaps

## Shared primitive expectations

A shared primitive should:
- be tenant-scoped where relevant
- expose one consistent contract
- be permission-aware
- support the current applicable module set
- avoid leaking module-specific assumptions into the shared layer
- be documented through code structure and concise instructions, not repeated per-module copies

## When module-specific code is acceptable

Use module-specific code when:
- the behavior is truly unique to that domain
- abstraction would hide important business differences
- there is only one real consumer and no platform rule behind it

## Review question

Before finalizing, answer:
"Am I extending Lynk's platform, or just making one screen work?"

If it is a platform concern, design it once and wire it consistently.
