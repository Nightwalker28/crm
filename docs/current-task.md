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

Finish the tenant-isolation rollout for the modules that already exist, and lock the platform rules into docs so future work starts from the correct defaults:

1. add `tenant_id` ownership to current business/platform tables that are still globally shared
2. scope existing services and routes by resolved request tenant instead of implicit global data
3. make tenant-aware company/profile/config/custom-field/activity/notification behavior the platform default
4. write tenant-aware and timezone-aware architecture rules so new modules inherit them from the start

## Immediate Notes

- Auth and host-based tenant resolution are already in place; the remaining work is row ownership and query scoping across existing modules.
- Single-tenant mode still needs to work without extra tenant setup, so the default tenant bootstrap path must stay intact.
- Timezone handling should remain: store normalized values, render in the user timezone by default, and document that as a platform rule instead of repeating it per feature.
