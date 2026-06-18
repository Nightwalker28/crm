# Documents Module Codex Task Addendum

_Last updated: 2026-06-18_

This addendum is intended to be merged into `docs/codex-production-readiness-tasks.md`. It converts the Documents Module production-readiness audit into Codex-ready implementation tasks.

## Implementation order

1. Security and correctness: DOC-01 to DOC-07, DOC-10, DOC-11, DOC-29.
2. Storage/database migrations: DOC-02, DOC-18, DOC-30.
3. Performance and memory: DOC-06, DOC-08, DOC-09, DOC-12, DOC-24, DOC-27.
4. Frontend/query behavior: DOC-20 to DOC-23.
5. Cleanup/deduplication: DOC-13 to DOC-17, DOC-25, DOC-26, DOC-28.

## DOC-01 — Lock document storage OAuth token refresh

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/services/document_services.py`, shared Redis/distributed-lock helper, tests.
- **Issue:** `_refresh_google_drive_access_token` and `_refresh_microsoft_onedrive_access_token` refresh the same connection with no cross-worker lock.
- **Fix:** Add a distributed lock keyed by `(tenant_id, user_id, provider)`. Re-read connection state after acquiring the lock so waiters can reuse a token refreshed by another worker. Redis is required for production correctness; local fallback is dev-only.
- **Acceptance:** Concurrent refresh attempts cannot clobber provider token state.

## DOC-02 — Replace global storage-path uniqueness with scoped constraints

- **Severity:** Critical/High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/models.py`, Alembic migration, tests.
- **Issue:** `Document.storage_path` and `DocumentVersion.storage_key` are globally unique, which is too broad for cloud provider item IDs.
- **Fix:** Remove global `unique=True`. Add scoped constraints/indexes matching the real contract, for example `(tenant_id, storage_provider, storage_path)` for documents and tenant/document-scoped storage-key uniqueness for versions if needed. Check/backfill duplicates before migration.
- **Acceptance:** Legitimate same provider IDs across tenants/providers do not fail as DB 500s.

## DOC-03 — Fix deleted-document repository filtering semantics

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, document service tests.
- **Issue:** `get_document(..., include_deleted=True)` filters `deleted_at IS NOT NULL`; the flag currently means “only deleted,” not “include deleted.”
- **Fix:** Make `include_deleted=True` omit the deleted filter. Add an explicit deleted-only helper if restore should only target deleted rows.
- **Acceptance:** Active fetch, deleted fetch, restore, and delete paths use the intended row set.

## DOC-04 — Simplify local document path resolution

- **Severity:** Medium, despite Critical audit label
- **Assessment:** Partially valid. The final `resolve()` containment guard is useful; the confusing part is accepting and stripping a `documents/` prefix.
- **Files:** `backend/app/modules/documents/services/storage_backends.py`, storage tests.
- **Issue:** `LocalDocumentStorage.resolve_path` strips `documents/` before resolving.
- **Fix:** Accept only canonical paths relative to `DOCUMENT_STORAGE_DIR`, such as `tenant-{id}/uuid.ext`. Reject absolute paths, `..`, null bytes, encoded traversal, and `documents/`-prefixed paths.
- **Acceptance:** Local storage paths cannot resolve outside the storage root and have one canonical format.

## DOC-05 — Define and enforce unlinked-document access

- **Severity:** Critical
- **Assessment:** Valid; product/security decision required.
- **Files:** document services/routes/schema/models as needed, tests.
- **Issue:** `_require_any_linked_record_access` succeeds when `document.links` is empty, making unlinked documents visible to any tenant user with documents permission.
- **Fix:** Define explicit document-level visibility for unlinked files: owner/uploader, admin, explicit visibility, or documented tenant-wide access. Prefer owner/admin unless tenant-wide visibility is intentional.
- **Acceptance:** Unlinked document visibility is explicit and tested.

## DOC-06 — Reduce full-byte upload memory retention

- **Severity:** High
- **Assessment:** Valid; staged fix acceptable.
- **Files:** `document_services.py`, `storage_backends.py`, tests.
- **Issue:** `read_document_upload` reads the whole file into memory and keeps bytes through quota, checksum, and cloud upload.
- **Fix:** Short term: avoid duplicate byte copies and keep strict max size. Medium term: stream to a temp file, compute signature/hash/quota from chunks, and pass file-like objects to storage backends.
- **Acceptance:** Upload memory use is bounded or explicitly limited by configuration and tests.

## DOC-07 — Remove blocking provider HTTP from async routes

- **Severity:** High
- **Assessment:** Valid.
- **Files:** document service/storage backends/routes, tests.
- **Issue:** Async upload/version routes call synchronous `requests` provider operations.
- **Fix:** Convert provider clients to `httpx.AsyncClient`, or make upload routes sync `def` so FastAPI runs them in a threadpool. Choose one consistent approach and preserve timeouts.
- **Acceptance:** Provider network I/O does not block the async event loop.

## DOC-08 — Optimize or intentionally defer document count queries

- **Severity:** Medium/High
- **Assessment:** Valid performance concern.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, tests.
- **Issue:** `list_documents` uses `count()` plus a separate paginated select.
- **Fix:** Use a window count/subquery if this endpoint is hot. If cursor pagination is the scalable path, document the offset/list endpoint as compatibility-only.
- **Acceptance:** Pagination totals remain correct and the query strategy is intentional.

## DOC-09 — Combine tenant storage usage aggregates

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/services/document_services.py`, tests.
- **Issue:** `_tenant_storage_used` runs two aggregate queries on every upload.
- **Fix:** Use one CTE or `UNION ALL` aggregate covering current-version rows and legacy rows while excluding deleted documents.
- **Acceptance:** Storage totals match current behavior with one aggregate query.

## DOC-10 — Make OAuth state decode fail closed

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `document_services.py`, OAuth callback routes/tests.
- **Issue:** `decode_drive_oauth_state` returns `None`; missed checks can become later `KeyError`/500 failures.
- **Fix:** Raise `HTTPException(400)` directly or add a required `decode_drive_oauth_state_or_400` helper and update all callbacks.
- **Acceptance:** Invalid/missing/wrong-provider state returns 400 before user lookup.

## DOC-11 — Use application UTC timestamp for soft delete

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `document_services.py`, tests.
- **Issue:** `soft_delete_document` assigns `func.now()` to `deleted_at`, which can make audit serialization observe stale/expression state before refresh.
- **Fix:** Use `_utcnow()` before commit.
- **Acceptance:** Delete audit `after_state.deleted_at` is populated with a timezone-aware timestamp.

## DOC-12 — Avoid full-file text decode for txt/rtf validation

- **Severity:** Medium
- **Assessment:** Valid, bounded by upload max.
- **Files:** document service tests.
- **Issue:** `_validate_document_signature` decodes full txt/rtf content.
- **Fix:** Decode a representative sample, for example `content[:8192]`, while preserving binary/polyglot and RTF magic checks.
- **Acceptance:** Text validation avoids full decode without accepting binary/polyglot files.

## DOC-13 — Remove redundant document refetch after create/version upload

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** `create_document` and `upload_document_version` commit/refresh, then call `get_document_or_404` again.
- **Fix:** Use one explicit response loader only when relationships are needed, or refresh/load required relationships directly.
- **Acceptance:** Response shape stays correct without redundant default refetch.

## DOC-14 — Verify client-share listing duplicate fetch

- **Severity:** Medium
- **Assessment:** Needs verification.
- **Files:** document service/routes/tests.
- **Issue:** `list_document_client_shares` fetches the document internally; the route may already fetch it.
- **Fix:** If duplicated, pass the loaded document to the share-list function or split permission check from share query. If not duplicated, mark skipped.
- **Acceptance:** No duplicate document fetch remains in the share-listing path.

## DOC-15 — Harden OAuth return-path normalization

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** `_safe_return_path` does not reject null bytes or encoded slash/backslash/traversal patterns.
- **Fix:** Reject control/null bytes and encoded traversal, or decode once before validation. Keep dashboard-relative paths and the length cap.
- **Acceptance:** Open-redirect/confusing encoded return paths fail closed.

## DOC-16 — Use one document content-type policy map

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service/schema tests.
- **Issue:** `ALLOWED_DOCUMENT_CONTENT_TYPES` and `DOCUMENT_CONTENT_TYPES_BY_EXTENSION` can drift.
- **Fix:** Derive allowed content types from one `DOCUMENT_TYPE_POLICY` or from the extension map.
- **Acceptance:** Adding a document type requires one policy update.

## DOC-17 — Clarify client-share dedup target semantics

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** document service tests.
- **Issue:** Exact AND matching on contact/org/null may be intentional, but it cannot merge a share with both contact and org when later sharing to one side only.
- **Fix:** Decide exact tuple versus target-overlap semantics. Implement a named helper and tests for contact-only, org-only, and contact+org cases. Do not switch to OR unless product behavior requires it.
- **Acceptance:** Share deduplication semantics are explicit and tested.

## DOC-18 — Add document template and active-share indexes

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** document models/migration.
- **Issue:** Template lists and active portal share lookups need composite/partial indexes.
- **Fix:** Add `(tenant_id, is_template)` partial index where `deleted_at IS NULL`, plus active share indexes such as `(tenant_id, contact_id)` and `(tenant_id, organization_id)` where `revoked_at IS NULL`.
- **Acceptance:** Template and active-share queries have targeted indexes.

## DOC-19 — Encode OAuth state iat/exp as NumericDate

- **Severity:** Low/Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** OAuth state uses datetime objects for JWT `iat`/`exp`.
- **Fix:** Use Unix timestamp ints with `int(now.timestamp())` and `int(exp.timestamp())`.
- **Acceptance:** State JWT claims are RFC-compatible NumericDate values.

## DOC-20 — Reduce redundant document query invalidations

- **Severity:** Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useDocuments.ts`.
- **Issue:** `useDocumentActions.invalidate` awaits multiple invalidations sequentially, and broad `["documents"]` invalidation already covers subkeys.
- **Fix:** Use the narrowest correct invalidation set. If multiple invalidations remain, run them with `Promise.all`.
- **Acceptance:** Mutations refresh needed document data without redundant rerender cycles.

## DOC-21 — Canonicalize document query keys

- **Severity:** Medium frontend
- **Assessment:** Partially valid. Current key normalizes several values, but a helper reduces mismatch risk.
- **Files:** `frontend/hooks/useDocuments.ts`.
- **Issue:** The list query key has many primitive positions; call-site differences can create unnecessary cache misses.
- **Fix:** Add `buildDocumentQueryParams` and `buildDocumentQueryKey` helpers, then use the same normalized object for URL construction and query key.
- **Acceptance:** Query key and URL use identical canonical values.

## DOC-22 — Memoize active client shares in document rows

- **Severity:** Low frontend
- **Assessment:** Valid but low ROI.
- **Files:** `frontend/components/documents/DocumentList.tsx`.
- **Issue:** `activeShares` is recomputed every render.
- **Fix:** Wrap in `useMemo` keyed on `document.client_shares`, or leave skipped if profiling shows no issue.
- **Acceptance:** No behavior change; row render work is reduced if implemented.

## DOC-23 — Verify download auth model for raw new-tab URLs

- **Severity:** Medium frontend/security
- **Assessment:** Needs verification.
- **Files:** `frontend/hooks/useDocuments.ts`, `frontend/components/documents/DocumentList.tsx`, document download routes.
- **Issue:** `window.open(documentVersionDownloadUrl(...))` only works if API auth is cookie-based; JWT-only auth would 401.
- **Fix:** Confirm auth transport. If bearer-only, fetch with `apiFetch`, create an object URL/blob, and trigger download; otherwise document the cookie requirement.
- **Acceptance:** Version/download buttons work under the production auth model.

## DOC-24 — Stream provider downloads instead of loading full bytes

- **Severity:** Low/Medium
- **Assessment:** Valid for larger files.
- **Files:** storage backends, document routes.
- **Issue:** Google Drive and OneDrive download methods return `response.content`, loading the whole file in memory.
- **Fix:** Use streaming provider responses and return `StreamingResponse` for cloud downloads where possible.
- **Acceptance:** Large cloud downloads do not require full file bytes in app memory.

## DOC-25 — Deduplicate list and cursor endpoint logic

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** `backend/app/modules/documents/routes/document_routes.py`, repository/service list helpers.
- **Issue:** `GET /documents` and `GET /documents/cursor` duplicate filters and can diverge; cursor lacks response model/sort parity.
- **Fix:** Extract shared filter/list parameter handling. Add a cursor response model if schema exists, or create one. Decide whether cursor supports sorting or always uses IDs.
- **Acceptance:** List/cursor behavior remains intentional and shared where possible.

## DOC-26 — Remove fragile `order_by(None)` from cursor query

- **Severity:** Low
- **Assessment:** Valid low-risk cleanup.
- **Files:** `backend/app/modules/documents/repositories/documents_repository.py`, tests.
- **Issue:** `list_documents_cursor` uses `.order_by(None).order_by(Document.id.desc())`.
- **Fix:** Build the cursor query without default ordering before applying `Document.id.desc()`, or document why clearing is necessary.
- **Acceptance:** Cursor ordering is deterministic without fragile order clearing.

## DOC-27 — Reduce heavy audit state on downloads

- **Severity:** Low
- **Assessment:** Valid.
- **Files:** document service/activity log tests.
- **Issue:** `log_document_download` serializes the full document, including relationships, just for audit state.
- **Fix:** Log a slim after-state with document ID, title, current version, provider, and size.
- **Acceptance:** Download audit remains useful without loading/serializing full relationship graphs.

## DOC-28 — Handle provider-upload DB failure cleanup

- **Severity:** Medium
- **Assessment:** Valid extension of storage consistency.
- **Files:** document service/storage backends.
- **Issue:** A file/provider object can be stored before DB commit; if DB commit fails, storage may be orphaned.
- **Fix:** Add best-effort cleanup/delete to the storage backend interface or record orphan cleanup jobs. At minimum, catch DB `IntegrityError`, rollback, and log orphan cleanup metadata.
- **Acceptance:** DB failures after storage upload do not silently leak storage forever.

## DOC-29 — Add clean IntegrityError handling for document/version writes

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** document service tests.
- **Issue:** Storage path/key uniqueness or version uniqueness conflicts can bubble as 500s.
- **Fix:** Wrap create/version commit paths in `try/except IntegrityError`, rollback, and return 409/400 with a useful message.
- **Acceptance:** User-fixable document write conflicts return clean 4xx.

## DOC-30 — Keep local-storage collision handling explicit

- **Severity:** Low
- **Assessment:** Valid housekeeping.
- **Files:** storage backend tests.
- **Issue:** Local filenames use `uuid4().hex`; collisions are extremely unlikely but not impossible.
- **Fix:** Use exclusive create (`xb`) or retry on existing filename before write.
- **Acceptance:** Local storage save is collision-safe without relying only on probability.

## Migration checklist additions

- DOC-02: replace global document/version storage uniqueness with scoped indexes/constraints after duplicate checks.
- DOC-18: add document template and active client-share partial/composite indexes.

## Test checklist additions

Backend:

- Document OAuth token refresh concurrency lock.
- Document deleted/include-deleted filtering and restore behavior.
- Document local storage canonical path and traversal rejection.
- Document unlinked access model.
- Document storage usage aggregate totals.
- Document OAuth state invalid-token handling and NumericDate claims.
- Document write conflict handling returns 4xx.

Frontend/manual:

- Documents mutations invalidate correct query keys without redundant sequential invalidations.
- Documents query key and URL params use the same canonical values.
- Document version/download buttons work with the production auth transport.

## Explicit audit wording corrections

- Do not blindly switch document client-share matching from AND to OR. First decide whether share identity is an exact `(contact_id, organization_id)` tuple or target-overlap matching, then implement tests.
- Do not overstate local document path traversal. The existing final containment guard is useful; the required cleanup is canonical path acceptance and removal of confusing prefix stripping.
