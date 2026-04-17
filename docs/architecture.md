# Architecture Notes

This file captures the current intended technical patterns and constraints so new work follows the same architecture instead of reintroducing one-off behavior.

## High-Level Direction

- Backend is modular by domain area.
- Frontend uses dashboard pages, hooks, and shared UI primitives.
- Shared platform concerns should live in reusable backend/frontend infrastructure instead of being reimplemented per module.

## Backend Patterns

### Permissions

- Use module-level access checks and action-level permission checks at the route layer.
- Separate module assignment from action permissions:
  - team/module mapping should determine whether a team can access a module
  - role/module permissions should determine what actions a role can perform inside an accessible module
- Action permissions currently include:
  - `view`
  - `create`
  - `edit`
  - `delete`
  - `restore`
  - `export`
  - `configure`
- Module-level access currently exists as a broad gate and still has department-based legacy coupling.
- The transition direction is:
  - admin-role users bypass module-assignment restrictions for enabled operational modules
  - team-module permissions become the primary source of module assignment
  - department-module permissions remain only as a compatibility fallback until the transition is complete
- Action-level enforcement is partially rolled out and should be expanded rather than replaced.

### Soft Delete and Recovery

- Core operational records should use soft delete semantics.
- Recycle behavior is intended to be one unified admin area with module-specific tables/filters.

### Activity Logging

- Important write actions should be logged with actor/module/entity/action metadata.
- Logging is explicit in service/route flows rather than assumed by the ORM.

### Search / Import / Export

- Shared helpers exist for search, CSV parsing, uploads, and downloads.
- Module-specific logic should be adapter/config driven, not duplicated.
- Shared helpers should be extended rather than bypassed when new modules are wired in.
- Import/export should evolve toward one reusable framework with module adapters for:
  - allowed file types
  - required columns
  - duplicate handling
  - row mapping
  - serializer/export columns

### Custom Fields

- Custom-field definitions are stored centrally by module.
- Custom-field values are stored relationally, not in JSON columns on the core business tables.
- Runtime API shapes may still expose a `custom_fields`-style dictionary, but persistence is relational.
- Custom-field definitions are cached and invalidated on definition changes.

### Caching

- Cache abstraction exists and can use Redis or local in-process fallback.
- Redis support exists, but runtime validation and failure-path hardening are still open work.
- Redis is the preferred cache/session/reference-data acceleration layer in the current architecture.
- Elasticsearch is not the default choice for the current platform needs because the main open need is caching and fast key/value or short-lived derived data, not distributed search indexing as the primary bottleneck.

### Auth and Google Integration

- Google OAuth should request only identity scopes unless a specific product workflow explicitly depends on broader scopes.
- If broader Google workflows are removed from the product, their scope requests, token persistence, and dependent service code should be removed rather than left partially dormant.
- Manual-capable users created by admins should have a reliable password-setup flow:
  - admin user creation should generate a setup link
  - manual sign-in for an account without a password should return a setup-required response, not a dead-end generic failure

### Finance / IO

- The system should use the generic insertion-order model only.
- Campaign-era finance fields and compatibility paths should not be reintroduced.

### Files / Uploads

- User-facing image/file uploads such as company logo and profile image should use explicit upload flows rather than assuming users will always paste remote URLs.
- Upload metadata should remain tied to the owning record and stay compatible with soft-delete/audit expectations where relevant.

### Time and Timezones

- Store timestamps in a normalized backend-friendly format and convert to the user’s configured timezone at the presentation layer.
- User profile timezone should be treated as the source of truth for UI-facing time rendering unless a module has a stronger domain-specific rule.

### PostgreSQL Optimization Direction

- Use PostgreSQL-native capabilities deliberately instead of treating Postgres like a generic SQL box.
- Favor proper indexes for high-traffic filters, joins, and restore/list paths.
- Favor targeted composite indexes where query patterns are stable and justified by actual workload.
- Use Postgres text-search/trigram features for ranked search where they fit instead of inventing parallel search logic.
- Push visible-column optimization deeper into ORM/select behavior on heavy endpoints rather than only trimming serialized payloads.
- Prefer batching and relationship loading strategies that avoid N+1 query patterns on list/detail pages.
- Validate migrations and cleanup steps carefully because Postgres makes it easy to evolve schemas, but rollback/data-safety still needs discipline.
- Reach for materialized/derived read optimizations only when simpler indexing/query fixes are insufficient.

## Frontend Patterns

### Lists / Tables

- Prefer the shared table shell and a consistent list-page structure.
- Persist view configuration per user where supported.
- Move from single table-preference records toward saved module views that can hold:
  - visible columns
  - column order
  - sort state
  - filter state
  - default-view selection
- Saved-view management should be route-based, with a compact selector on the module page and a separate shared manage-view screen for naming, columns, sort, and filter conditions.
- Filter conditions should use one shared config model across modules:
  - `all_conditions`: list of field/operator/value rules that must all pass
  - `any_conditions`: list of field/operator/value rules where any may pass
  - optional free-text search layered on top
- Inline quick filters on module pages should use the same shared condition model as saved views instead of inventing a second filter grammar.
- Module-specific list/search backends should accept the shared saved-view filter payload and map it through module-specific allowed-field definitions rather than each module inventing its own ad hoc filter shape.
- Send `fields` to the backend on list endpoints so payload shaping can follow visible columns.
- Current payload shaping is serializer-level in many places; deeper ORM select/load optimization is still open.
- Treat `docs/shared-platform-primitives.md` as the onboarding checklist for future module list/dashboard-style surfaces.

### Forms

- Required fields should use the shared required-mark pattern.
- Linked entities should use dropdown/search selectors instead of unconstrained free text where the relation is canonical.
- Company-managed reference data should be pulled from the relevant source of truth instead of duplicated locally.

### Detail Pages

- For existing records, prefer detail pages with summary/history/editing over modal-only editing.

## Known Open Technical Work

- Push visible-column preferences into ORM select/load behavior for heavy list endpoints.
- Complete browser/runtime verification for newer admin/detail/module pages and dialogs.
- Harden Redis-backed cache behavior in the real container/runtime environment.
- Expand action-level permission coverage route by route.
- Introduce true tenant/company row-level ownership in a later hardening phase.
- Add proper upload handling for company/profile imagery rather than URL-only inputs.
- Expand import/export coverage and consistency across the main business modules.
- Ensure user timezone settings are honored in UI-facing time rendering.
- Complete the transition from department-based module assignment to team-based module assignment.
- Remove unneeded Google Docs/Drive integration code if those product capabilities are no longer active.

## Things To Avoid

- Reintroducing free-text fields where the platform rule is a linked relationship.
- Reintroducing campaign-specific finance contracts.
- Storing custom fields back into business-table JSON columns.
- Adding module-specific one-off search/import/export implementations when shared utilities already exist.
- Adding new list-page visual patterns when a shared table presentation is appropriate.
