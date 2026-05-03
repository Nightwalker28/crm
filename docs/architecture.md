# Architecture Notes

This file captures the current intended technical patterns and constraints so new work follows the same architecture instead of reintroducing one-off behavior.

## High-Level Direction

- Backend is modular by domain area.
- Frontend uses dashboard pages, hooks, and shared UI primitives.
- Shared platform concerns should live in reusable backend/frontend infrastructure instead of being reimplemented per module.

## Backend Patterns

### Tenant Isolation

- Every business-owned or tenant-configurable record must carry explicit tenant ownership from the start.
- For the current platform, that means:
  - auth resolves a tenant from the request host in cloud mode
  - the resolved tenant or the current user tenant becomes the default scope for service queries
  - new module tables should include `tenant_id` unless the table is truly global platform metadata
- Route handlers should not rely on “current install” assumptions for data ownership.
- Service-layer queries should filter by tenant scope explicitly rather than assuming auth alone is enough.
- Linked-record validation must also stay inside the same tenant:
  - contacts linked to opportunities/IOs must belong to the same tenant
  - organizations linked to contacts/opportunities/IOs must belong to the same tenant
  - tenant-configured definitions such as custom fields and company settings must not leak across tenants
- Single-tenant/self-hosted mode still uses the same model:
  - one default tenant
  - all records belong to that tenant
  - cloud mode simply resolves different tenants by host/domain
- Future modules must be designed as tenant-aware on day one rather than retrofitted later.
- Verified deployment licenses are process-cached. Renewed or changed license tokens require an application restart, and tests that patch deployment-license settings must clear `get_verified_deployment_license`'s cache before asserting new behavior.

### Permissions

- Use module-level access checks and action-level permission checks at the route layer.
- Separate module availability from action permissions:
  - tenant module configuration determines whether a module is enabled for that tenant at all
  - department/team module permissions determine which org units can open that enabled module
  - role/module permissions determine what actions a role can perform inside a module the user is allowed to open
- Action permissions currently include:
  - `view`
  - `create`
  - `edit`
  - `delete`
  - `restore`
  - `export`
  - `configure`
- Module-level access is a broad gate composed of tenant enablement, department/team assignment, and role `view` permission.
- The transition direction is:
  - admin-role users bypass role/module and department/team restrictions for enabled operational modules in their tenant
  - tenant-disabled modules remain unavailable even to admin-role users
- Action-level enforcement is partially rolled out and should be expanded rather than replaced.

### Soft Delete and Recovery

- Core operational records should use soft delete semantics.
- Recycle behavior is intended to be one unified admin area with module-specific tables/filters.

### Activity Logging

- Important write actions should be logged with actor/module/entity/action metadata.
- Logging is explicit in service/route flows rather than assumed by the ORM.
- Activity logging should also be consumable as per-record timelines on record pages, not only as one global admin log.
- When a module has a real record detail page, timeline/history should be exposed there if the activity model already captures that entity cleanly.
- Per-record timeline APIs and UI should be shared primitives keyed by `module_key` and `entity_id` rather than bespoke per-module audit implementations.

### Record Notes / Comments

- Shared record notes/comments should use one tenant-scoped platform model and API rather than per-page local-only state or per-module note tables.
- Record-note access should follow the record module permissions:
  - `view` for reading notes
  - `edit` for creating or deleting notes
- Record-note create/delete actions should also write into the same per-record activity timeline so collaboration history stays in one place.
- Record-note mentions should only suggest and notify active users who can view the record's module; the backend must reject mentioned user IDs that do not pass that access check.

### Notifications

- User-facing operational notifications should use one shared persisted notification model and API instead of each background workflow inventing its own UI state.
- Background job systems such as import/export should write queued/completed/failed notifications into that shared center so users can leave and come back without losing status visibility.
- External chat alerts should be built on a shared CRM event layer rather than one-off webhook calls inside individual modules.
- The first Slack/Microsoft Teams integration should use tenant/company-scoped incoming webhook channels only. OAuth, marketplace app installation, bidirectional chat sync, and provider credential vaulting are deferred until the simple webhook path is proven useful.
- Event records should capture event type, entity type, entity ID, structured payload JSON, tenant/company ownership, and creation time so webhooks, activity timelines, notification preferences, and later smart rules can reuse the same source event.
- Notification-channel records should capture provider (`slack` or `teams`), webhook URL, channel display name, active status, and tenant/company ownership. Send-test behavior should validate the channel without requiring a full provider integration.
- Admins should be able to inspect recent CRM events and webhook delivery attempts, including failed delivery errors, so external alerts are auditable instead of invisible background side effects.
- Smart notification rules should sit after the basic event/channel layer and evaluate explicit structured conditions such as field/operator/value, not arbitrary user expressions.

### Message Templates

- Message templates are a shared platform module, not a WhatsApp-specific implementation detail.
- Templates must be tenant-scoped and should support system-seeded templates plus user-created templates.
- Template records should declare the channel they are intended for, the source module they can render against, and the allowed variable keys that the frontend can offer.
- Template rendering should use explicit variable maps from trusted CRM serializers rather than evaluating arbitrary user expressions.
- WhatsApp should consume this template platform first for click-to-chat links; mail, finance, sales, tasks, and reminder workflows can reuse the same model later.

### WhatsApp

- WhatsApp is a dedicated tenant-aware module with normal module availability and role/action permission enforcement.
- The first integration phase is click-to-chat only: the backend prepares a rendered message and records a manual-send log, while the browser opens a WhatsApp URL controlled by the user.
- WhatsApp actions linked to CRM records should write activity-log events keyed to the source module and entity ID so record timelines show the communication.
- Contact-level WhatsApp interactions should update contact metadata for last WhatsApp contact time.
- Follow-up reminders should use the existing tasks module instead of introducing a separate reminder store.
- Provider credentials, inbound message sync, webhooks, and automated sending are deferred until an explicit WhatsApp provider integration phase.

### Search / Import / Export

- Shared helpers exist for search, CSV parsing, uploads, and downloads.
- Module-specific logic should be adapter/config driven, not duplicated.
- Shared helpers should be extended rather than bypassed when new modules are wired in.
- The dashboard shell should expose one shared global search / command palette that calls a backend aggregate search API rather than stitching together frontend-only per-page searches.
- Global search results should be permission-aware and tenant-scoped, and should return direct record routes for the modules that already have detail pages.
- Import/export should evolve toward one reusable framework with module adapters for:
  - preview/parse step
  - source-header normalization
  - auto-match alias rules
  - user-correctable field mapping
  - allowed file types
  - required columns
  - duplicate handling
  - row mapping
  - serializer/export columns
- The intended import flow is:
  - preview upload and parse headers
  - suggest source-to-target mapping
  - confirm duplicate policy
  - execute import
  - return structured import summary
- CSV import upload validation should check both allowed extensions and known CSV/plain-text content types before parsing.
- The intended export flow is:
  - export all
  - export current filtered result set
  - export explicit selected record IDs across pagination
- Large import/export operations should move through a shared data-transfer job abstraction rather than running fully on the request thread.
- The preferred pattern is:
  - persist a job row with module, operation type, payload, status, and actor
  - return job status immediately for large workloads
  - enqueue the work to Celery
  - process the work in a dedicated worker
  - persist structured summary and downloadable result/error artifacts
- Celery with Redis as the broker is the chosen background-job architecture for the platform because scheduled tasks and other async workflows are expected to grow beyond import/export.
- Current threshold direction:
  - row count is the primary trigger because database work scales with rows
  - file size is the secondary trigger as a safety valve for unusually heavy files
  - current defaults are `10000` rows or `5 MB`, whichever is hit first

### Custom Fields

- Custom-field definitions are stored centrally by module.
- Custom-field values are stored relationally, not in JSON columns on the core business tables.
- Custom-field definitions and values should be tenant-scoped; custom-field configuration is tenant data, not global platform data.
- Runtime API shapes may still expose a `custom_fields`-style dictionary, but persistence is relational.
- Custom-field definitions are cached and invalidated on definition changes.

### Caching

- Cache abstraction exists and can use Redis or local in-process fallback.
- Redis support exists, but runtime validation and failure-path hardening are still open work.
- Redis is the preferred cache/session/reference-data acceleration layer in the current architecture.
- Elasticsearch is not the default choice for the current platform needs because the main open need is caching and fast key/value or short-lived derived data, not distributed search indexing as the primary bottleneck.

### Auth and Google Integration

- Google OAuth should request only identity scopes unless a specific product workflow explicitly depends on broader scopes.
- Mailbox provider access should use an explicit mail-connect workflow rather than being bundled into basic sign-in, so Gmail/Outlook scopes are only requested from users who opt into mailbox sync.
- Google Calendar sync should prefer `calendar.app.created` so the app manages only its own CRM calendar instead of asking for broad access to all user calendars.
- Gmail inbox read/sync requires restricted Google scopes and must remain behind an explicit environment flag plus verification plan; default Gmail mail integration should use send-only scope where possible.
- IMAP/SMTP mailbox connections are per-user mail connections, not tenant-wide provider credentials. Saved IMAP/SMTP passwords must be encrypted with `MAIL_CREDENTIAL_SECRET` when configured, falling back to `JWT_SECRET` only for local/dev compatibility.
- IMAP sync should use provider UIDs and store a cursor after the first sync so repeated manual syncs do not refetch the whole mailbox. SMTP send should persist the local sent message and best-effort append to the provider sent folder without failing the send if folder append is unavailable.
- If broader Google workflows are removed from the product, their scope requests, token persistence, and dependent service code should be removed rather than left partially dormant.
- Manual-capable users created by admins should have a reliable password-setup flow:
  - admin user creation should generate a setup link
  - manual sign-in for an account without a password should return a setup-required response, not a dead-end generic failure
- Consumed and long-expired password setup tokens should be removed by a bounded retention cleanup so token history does not grow forever while current setup-link invalidation stays immediate.
- Password strength policy should be enforced by the backend and exposed to the frontend through an API endpoint so setup UI copy does not drift from server validation.
- PBKDF2 password hashes store their iteration count in the hash string. Verification must use the stored count for backward compatibility, new hashes should use the configured `PBKDF2_ITERATIONS`, and successful manual logins should opportunistically rehash older lower-iteration hashes.

### Finance / IO

- The system should use the generic insertion-order model only.
- Campaign-era finance fields and compatibility paths should not be reintroduced.

### Files / Uploads

- User-facing image/file uploads such as company logo and profile image should use explicit upload flows rather than assuming users will always paste remote URLs.
- Upload metadata should remain tied to the owning record and stay compatible with soft-delete/audit expectations where relevant.
- Uploaded assets tied to tenant-owned records should be treated as tenant-owned operational data even if the storage path itself is generic.
- Local media cleanup should normalize `/media/...` and `media/...` paths while ignoring external URLs and enforcing that resolved files stay under the media root.
- The Documents module stores controlled business documents under backend-owned document storage rather than the public `/media` mount. Downloads must resolve the path under the document storage root and return through authenticated API routes.
- Record-linked documents should use a shared `document_links` table keyed by `module_key` and `entity_id`, with linked-record validation staying inside the current tenant.
- Document upload validation should enforce extension, content type, lightweight file signature checks, per-file size, and tenant storage quota before persistence.
- Document metadata stores a `storage_provider` so the local backend remains the default while S3-compatible, Google Drive, and Microsoft OneDrive providers can be added behind the same service contract.
- Deleted documents stay in metadata and local storage, appear in the unified recycle bin, and restore by clearing `deleted_at`; physical file deletion is not part of the normal user-facing delete path.

### Time and Timezones

- Store timestamps in a normalized backend-friendly format and convert to the user’s configured timezone at the presentation layer.
- User profile timezone should be treated as the source of truth for UI-facing time rendering unless a module has a stronger domain-specific rule.
- UTC remains the storage/default processing timezone for backend jobs, database timestamps, and server-side scheduling.
- Frontend rendering should use shared datetime helpers so new pages do not reintroduce browser-local or server-default time rendering.
- New list/detail pages should assume “render in user timezone” by default unless the feature explicitly requires a fixed canonical timezone display.

### PostgreSQL Optimization Direction

- Use PostgreSQL-native capabilities deliberately instead of treating Postgres like a generic SQL box.
- Database session dependencies should explicitly roll back on unhandled exceptions before closing the session.
- SQLAlchemy pool sizing must be deployment-tuned across all web, Celery, migration, and admin processes that share the same Postgres instance. Treat `DB_POOL_SIZE + DB_MAX_OVERFLOW` as a per-process upper bound, not a platform-wide cap.
- Favor proper indexes for high-traffic filters, joins, and restore/list paths.
- Favor targeted composite indexes where query patterns are stable and justified by actual workload.
- Use Postgres text-search/trigram features for ranked search where they fit instead of inventing parallel search logic.
- Trigram search should use a production-grade similarity threshold and should be skipped for very short search terms, which should fall back to substring matching only.
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
- Malformed saved-view or inline filter conditions should fail with a clear 400 instead of being silently dropped, because ignored filters can widen result sets unexpectedly.
- Numeric filter operators should only be enabled for fields backed by numeric database expressions. Text fields that happen to contain money-like strings must not be coerced with regex/casts for numeric comparison.
- Inline quick filters on module pages should use the same shared condition model as saved views instead of inventing a second filter grammar.
- Module-specific list/search backends should accept the shared saved-view filter payload and map it through module-specific allowed-field definitions rather than each module inventing its own ad hoc filter shape.
- Send `fields` to the backend on list endpoints so payload shaping can follow visible columns.
- Public pagination request validation should enforce a configured maximum page size, while frontend selectable page-size options are exposed by the backend config API. Internal bulk callers that need larger windows should construct `Pagination` explicitly instead of going through the HTTP dependency.
- Current payload shaping is serializer-level in many places; deeper ORM select/load optimization is still open.
- Treat `docs/shared-platform-primitives.md` as the onboarding checklist for future module list/dashboard-style surfaces.

### Forms

- Required fields should use the shared required-mark pattern.
- Linked entities should use dropdown/search selectors instead of unconstrained free text where the relation is canonical.
- Company-managed reference data should be pulled from the relevant source of truth instead of duplicated locally.

### Detail Pages

- For existing records, prefer detail pages with summary/history/editing over modal-only editing.
- Shared record-page capabilities such as summary cards, relationship panels, activity timelines, and notes should be implemented across all applicable detail-page modules in the same slice instead of landing in one module first and the rest later.
- The current baseline set for shared CRM detail-page capabilities is contacts, organizations, and opportunities.

## Known Open Technical Work

- Push visible-column preferences into ORM select/load behavior for heavy list endpoints.
- Complete browser/runtime verification for newer admin/detail/module pages and dialogs.
- Harden Redis-backed cache behavior in the real container/runtime environment.
- Expand action-level permission coverage route by route.
- Introduce true tenant/company row-level ownership in a later hardening phase.
- Finish the current tenant-isolation rollout across all existing module services, imports/exports, recycle flows, summaries, and admin configuration paths.
- Add proper upload handling for company/profile imagery rather than URL-only inputs.
- Expand import/export coverage and consistency across the main business modules.
- Add a shared persisted background-job layer for large imports/exports and integrate it into the import/export workflow.
- Ensure user timezone settings are honored in UI-facing time rendering.
- Keep timezone-aware rendering as a shared platform concern instead of per-page formatting.
- Keep module availability tenant-scoped while role permissions remain the source of truth for module access levels.
- Remove unneeded Google Docs/Drive integration code if those product capabilities are no longer active.

## Things To Avoid

- Reintroducing free-text fields where the platform rule is a linked relationship.
- Reintroducing campaign-specific finance contracts.
- Storing custom fields back into business-table JSON columns.
- Adding module-specific one-off search/import/export implementations when shared utilities already exist.
- Adding new list-page visual patterns when a shared table presentation is appropriate.
