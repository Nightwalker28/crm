---
name: security-review
description: Use for auth, permissions, tenant scoping, public surfaces, uploads, downloads, integrations, pricing, documents, or any high-risk review.
---

# Security Review

## Highest-priority Lynk risks

Check first for:
- cross-tenant data access
- missing module/action permission enforcement
- linked-record validation outside the current tenant
- CRM user auth being accepted in client/public flows or vice versa
- private pricing, documents, or terms leaking through public endpoints
- unsafe upload/download paths or weak file validation
- hardcoded secrets or sensitive data in logs
- duplicate/replay behavior in public writebacks
- overly broad external provider scopes

## Auth boundaries

Keep these separate:
- CRM dashboard users
- client portal accounts
- signed public links
- website/integration API keys
- external provider OAuth connections

Do not let one boundary silently stand in for another.

## Public and client-facing surfaces

- Public catalog APIs expose only active public catalog data.
- Personalized pricing resolves server-side from authenticated client identity or intentionally scoped snapshots.
- Public signed links must remain scoped and expiry-aware.
- Private documents stay behind authenticated API download routes unless explicitly designed otherwise.

## Data and files

- Tenant-owned data must stay tenant-scoped in queries and linked-record checks.
- File handling should validate extension, content type, lightweight signature/shape, size, quota, and path containment.
- Local media/document path resolution must not escape the intended storage root.

## Review output

When reviewing:
- cite the exact file/path and behavior
- distinguish confirmed issue from suspicion
- rank by impact
- propose the smallest safe fix
