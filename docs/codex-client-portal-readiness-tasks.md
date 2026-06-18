# Client Portal Codex Task Plan

_Last updated: 2026-06-18_

This document converts the Client Portal production-readiness review into Codex-ready implementation tasks after checking the current repository. Use it as a focused addendum to `docs/codex-production-readiness-tasks.md`.

## Verification summary

Most backend findings have merit in the current codebase:

- `ClientSetupPasswordRequest.password` allows one-character passwords.
- `ensure_default_customer_groups` is a read-then-insert seed path with no `IntegrityError`/upsert protection.
- `build_client_overview` loads full module lists and then counts/slices in Python.
- `action_summaries` loads every action for selected pages and slices to 3 per page in service code.
- Admin flat list routes return all client accounts/pages with no limit.
- Frontend client hooks clear the token on every 401 and several authenticated hooks use default retry behavior.

Some findings are partially valid rather than current functional breakages:

- Public page `request-changes` currently reaches the service as `request_changes` because the backend route hardcodes the service value. The mismatch is still a latent contract problem.
- `request.client` metadata handling is not a crash today, but the returned `None` host should be explicit.
- Decimal/NaN handling is mostly covered by Pydantic at route boundaries, but service-level guards are still useful because services accept raw dicts.

## Recommended implementation order

1. Security/correctness: CP-01, CP-02, CP-03, CP-04, CP-09, CP-19.
2. Performance and scalability: CP-05, CP-08, CP-14, CP-21.
3. Frontend auth/search UX: CP-10, CP-11, CP-17, CP-20, CP-23.
4. Cleanup/hardening: CP-06, CP-07, CP-12, CP-13, CP-15, CP-16, CP-18, CP-22.

---

## CP-01 — Enforce client password policy at schema and service boundary

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/schema.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `frontend/app/client/setup/page.tsx`, tests.
- **Issue:** `ClientSetupPasswordRequest.password` uses `Field(min_length=1)`, and `setup_client_password` delegates to `hash_password` without an explicit client-portal policy.
- **Fix:** Add a single policy constant, for example `CLIENT_PASSWORD_MIN_LENGTH = 8`, and enforce it in both Pydantic schema and `setup_client_password` before hashing. Keep `ClientLoginRequest.password` as `min_length=1` unless product wants login-side min-length rejection too.
- **Frontend:** Add setup-page hint and pre-submit validation.
- **Tests:** One-character setup password returns 422/400 and never calls hash/write logic.
- **Done when:** A setup token cannot create a trivial password.

## CP-02 — Make default customer group seeding race-safe

- **Severity:** Critical
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, `backend/app/modules/client_portal/repositories/client_portal_repository.py`, tests.
- **Issue:** `ensure_default_customer_groups` checks cache/DB, inserts missing keys, then commits. Concurrent workers can race and hit `uq_customer_groups_tenant_key`.
- **Fix:** Use PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` for seed rows, or wrap commit in `try/except IntegrityError` with rollback and re-read. Keep cache as optimization only, not correctness.
- **Done when:** Concurrent first access for a tenant does not produce a 500 or partial seed failure.

## CP-03 — Constrain support status action route

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/routes/client_portal_routes.py`, support service tests.
- **Issue:** `POST /client-support/cases/{case_id}/{action}` accepts arbitrary path strings and validates only inside service.
- **Fix:** Replace with explicit routes such as `/close` and `/reopen`, or use a FastAPI path enum/Literal constrained to supported actions.
- **Done when:** Unsupported support actions do not reach service logic as arbitrary strings.

## CP-04 — Standardize client page action names

- **Severity:** Medium/High
- **Assessment:** Partially valid. Current public backend route hardcodes `request_changes`, so the request-changes flow works today; the URL/frontend/API naming still mixes hyphen and underscore.
- **Files:** `backend/app/modules/client_portal/routes/client_portal_routes.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, `frontend/hooks/useClientPortal.ts`, frontend public page.
- **Issue:** DB constraint uses `request_changes`; public route and frontend use `request-changes` in the URL.
- **Fix:** Keep the external URL `/request-changes` if desired, but centralize an action normalizer that maps `request-changes` to `request_changes`. Use typed constants for stored action values and URL action values.
- **Tests:** Service accepts only canonical stored actions or documented aliases; API response always returns canonical `request_changes`.
- **Done when:** There is one canonical internal action vocabulary and one documented URL alias.

## CP-05 — Replace client overview full-list fetches with summary queries

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, relevant module repositories/services for summary helpers, tests.
- **Issue:** `build_client_overview` loads catalog, orders, support cases, messages, documents, quotes, and bookings, then counts/slices in Python.
- **Fix:** Add dedicated count/latest helpers for each overview metric. Fetch counts with `COUNT(*)` and next-action candidates with `LIMIT 1` ordered by the relevant timestamp/status.
- **Done when:** Overview response does not pull full lists just to compute metrics and five next actions.

## CP-06 — Make customer-group relationship resolution explicit

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** `backend/app/modules/client_portal/services/client_portal_services.py`, repository helpers, tests.
- **Issue:** `resolve_client_customer_group` checks `account.__dict__` for loaded relationships and falls back to DB/session lookups. If no session exists, it returns `None`, which can hide a lazy-load/detached-object problem.
- **Fix:** Prefer passing `db` explicitly for all code paths that need group resolution. If no DB/session exists and a linked customer exists, raise or return an explicit “unavailable” path rather than silently `None`.
- **Done when:** Missing loaded relationship/session cannot silently change pricing from personalized to public.

## CP-07 — Tighten customer-group seeded cache semantics

- **Severity:** Medium
- **Assessment:** Partially valid.
- **Files:** client portal service/cache tests.
- **Issue:** The cache key is namespaced but cache-hit behavior still performs a DB check. That is safe but reduces the value of caching.
- **Fix:** After CP-02 makes DB seeding idempotent, simplify cache to an optimization: either trust it for a short TTL where safe, or remove it entirely and rely on upsert seeding.
- **Done when:** Seeding behavior is simple, race-safe, and not dependent on cache correctness.

## CP-08 — Limit page-action summaries at the database layer

- **Severity:** High
- **Assessment:** Valid.
- **Files:** `backend/app/modules/client_portal/repositories/client_portal_repository.py`, `backend/app/modules/client_portal/services/client_portal_services.py`, tests.
- **Issue:** `action_summaries` fetches all actions for all page IDs, and the service keeps only three per page.
- **Fix:** Use a window function: `row_number() over (partition by client_page_id order by created_at desc, id desc)` and filter `row_number <= 3`. Keep a separate grouped count query or combine if practical.
- **Done when:** Recent action summaries fetch at most three action rows per page plus counts.

## CP-09 — Add service-level finite Decimal validation for pricing/order payloads

- **Severity:** Medium/High
- **Assessment:** Partially valid. Route schemas validate normal API calls, but services accept raw dicts.
- **Files:** `client_portal_services.py`, schema tests.
- **Issue:** `_normalize_pricing_items` and order/request flows convert raw values to `Decimal` and compare them without consistent finite checks.
- **Fix:** Add a helper like `_decimal_or_400(value, field, *, gt=None, ge=None)` that rejects invalid, NaN, Infinity, and wrong bounds. Use it for pricing item quantity/public price and catalog order quantity.
- **Done when:** Malformed direct service payloads return clean 400s, not `InvalidOperation`/500.

## CP-10 — Avoid clearing client token on every 401

- **Severity:** High frontend/auth
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`.
- **Issue:** `publicJson` and `publicBlob` call `clearClientToken()` on any 401 from any client endpoint.
- **Fix:** Clear token only for definitive auth/session endpoints, for example `/client-auth/me`, `/client-auth/login`, `/client-auth/setup`, or when backend returns a known invalid-token error code. Do not clear for unrelated transient 401s without confirming token invalidity.
- **Done when:** A single endpoint-specific 401 cannot unnecessarily log out a valid client session.

## CP-11 — Debounce client catalog search before query hook

- **Severity:** High frontend/perf
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`, client catalog page component.
- **Issue:** `useClientCatalog` query key includes raw search text, so callers that pass live input trigger one query per keystroke.
- **Fix:** Debounce in the page/component before calling `useClientCatalog`, or add a `useDebouncedValue` hook and pass the debounced search to the query hook.
- **Done when:** Typing in catalog search does not fire a request for every keystroke.

## CP-12 — Remove dynamic `_action_summary` ORM attribute

- **Severity:** Medium
- **Assessment:** Valid as fragility/maintainability.
- **Files:** `client_portal_services.py`, repository/service return types, tests.
- **Issue:** Page serializers can read `page._action_summary`, an arbitrary dynamic attribute on SQLAlchemy objects.
- **Fix:** Return a typed wrapper/dataclass, or pass `action_summary` explicitly into `serialize_client_page`.
- **Done when:** Action summaries are explicit typed data, not hidden ORM attributes.

## CP-13 — Make request metadata client host behavior explicit

- **Severity:** Low/Medium
- **Assessment:** Partially valid.
- **Files:** `client_portal_routes.py`, tests.
- **Issue:** `_request_metadata` handles missing/invalid `request.client`, but returns `client_host=None` silently.
- **Fix:** Keep no-crash behavior, but include a clear `client_host_status` or omit invalid hosts intentionally. Ensure tests cover `request.client is None`.
- **Done when:** Request metadata behavior is explicit for missing/invalid client host.

## CP-14 — Remove redundant order refresh after client catalog order creation

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, tests.
- **Issue:** `create_client_catalog_order` commits, refreshes `order`, then immediately discards it by calling `get_client_order_or_404`.
- **Fix:** Remove the intermediate `db.refresh(order)` before the selectinload refetch, or avoid the second fetch by loading required line items another way.
- **Done when:** Order creation performs only required post-commit DB round trips.

## CP-15 — Guard client account/page serialization against lazy-load surprises

- **Severity:** Medium
- **Assessment:** Valid as future-proofing.
- **Files:** `client_portal_services.py`, repository tests.
- **Issue:** `serialize_client_account` and `serialize_client_page` assume `contact`/`organization` are loaded. Repositories generally joinedload them, but future callers can trigger N+1 or detached-object errors.
- **Fix:** Add helper that checks SQLAlchemy inspection state without triggering lazy loads, or require serializers to receive display names from loaded query projections.
- **Done when:** Serialization cannot accidentally lazy-load per row or crash on detached objects.

## CP-16 — Keep DB action constraint canonical and document URL alias

- **Severity:** Medium
- **Assessment:** Partially valid; overlaps CP-04.
- **Files:** `models.py`, route/service tests.
- **Issue:** DB stores `request_changes`; external route uses `/request-changes`.
- **Fix:** Do not change DB constraint unless changing storage vocabulary. Add tests proving `/request-changes` stores `request_changes` and service normalizes aliases if exposed elsewhere.
- **Done when:** Route alias and DB value are documented/tested.

## CP-17 — Make browser download helpers safe in non-browser/test DOMs

- **Severity:** Medium frontend
- **Assessment:** Valid for `downloadClientDocument`; partially valid for `downloadPublicClientPageDocument` because it uses `window.open` rather than body append.
- **Files:** `frontend/hooks/useClientPortal.ts`, tests where practical.
- **Issue:** `downloadClientDocument` appends an anchor to `document.body` without a fallback. Public page download uses object URL/window.open and should also guard `window` availability.
- **Fix:** Use `const container = window.document.body ?? window.document.documentElement`; guard `typeof window !== "undefined"`; clean up object URLs in finally blocks.
- **Done when:** Download helpers do not crash under SSR/Jest-like environments.

## CP-18 — Trim public page brand accent before regex validation

- **Severity:** Low
- **Assessment:** Valid low-risk polish.
- **Files:** `frontend/app/client/pages/[token]/page.tsx`.
- **Issue:** `brandAccent` tests the raw string and falls back on values with harmless whitespace.
- **Fix:** `const trimmed = (value ?? "").trim(); return HEX_RE.test(trimmed) ? trimmed : fallback;`
- **Done when:** Whitespace around valid hex colors does not drop branding.

## CP-19 — Normalize public/setup token expiry datetimes consistently

- **Severity:** Medium
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, core DB/timezone config/tests.
- **Issue:** `get_public_client_page` and `setup_client_password` patch naive datetimes with UTC but do not normalize aware non-UTC values.
- **Fix:** Add a shared `_as_utc` helper like other modules use. Convert naive values to UTC and aware values via `.astimezone(timezone.utc)`. Long-term, ensure DB sessions use UTC.
- **Done when:** Expiry comparisons are correct for naive and aware datetimes.

## CP-20 — Standardize retry policy for authenticated client hooks

- **Severity:** Low/Medium frontend
- **Assessment:** Valid.
- **Files:** `frontend/hooks/useClientPortal.ts`.
- **Issue:** `useClientMe` and `useClientOverview` use `retry: false`; sibling authenticated hooks rely on React Query defaults.
- **Fix:** Create `clientQueryDefaults = { retry: false, staleTime: 30_000 }` and apply to authenticated client portal queries unless a specific endpoint needs retry.
- **Done when:** 401/client-auth failures do not incur useless retry latency.

## CP-21 — Limit or deprecate flat client account/page list routes

- **Severity:** Medium/High
- **Assessment:** Valid.
- **Files:** `client_portal_routes.py`, `client_portal_repository.py`, frontend admin hooks/pages.
- **Issue:** `GET /client-portal/accounts` and `GET /client-portal/pages` return all rows for a tenant. Cursor variants exist but flat routes remain unbounded.
- **Fix:** Prefer cursor routes in UI. Add hard `limit` query param with safe max to flat routes, or mark flat routes deprecated and remove call sites.
- **Done when:** No route can accidentally serialize thousands of client accounts/pages without a limit.

## CP-22 — Seed placeholder customer groups without misleading 0% discounts

- **Severity:** Low/Medium product correctness
- **Assessment:** Valid.
- **Files:** `client_portal_services.py`, seed migration/data tests if needed.
- **Issue:** Wholesale/retailer/VIP placeholders are seeded as `percent` with `0`, making them appear as personalized discount groups even though they do not change price.
- **Fix:** Seed placeholder groups with `discount_type="none"` and `discount_value=None`, or seed only the default group and let tenants create discount groups. Provide a migration/data correction for existing untouched zero-percent placeholder groups.
- **Done when:** Placeholder groups do not show misleading personalized 0% pricing.

## CP-23 — Add client-side setup password validation and hint

- **Severity:** Low/Medium frontend
- **Assessment:** Valid; pairs with CP-01.
- **Files:** `frontend/app/client/setup/page.tsx`.
- **Issue:** Setup form only checks required and password confirmation. Users see backend errors after submit.
- **Fix:** Add visible rule text, `minLength`, and explicit submit guard matching backend policy.
- **Done when:** User sees password requirements before submission.

---

## Migration checklist

- CP-02: no migration required if using upsert/IntegrityError handling; verify `uq_customer_groups_tenant_key` exists.
- CP-08: optional index review for `client_page_actions`: consider `(tenant_id, client_page_id, created_at DESC, id DESC)`.
- CP-21: no migration; API behavior/route change only.
- CP-22: optional data migration to update existing default placeholder groups from `percent/0` to `none/NULL` where they still match the original seed names and have not been customized.

## Test checklist

Backend:

- Setup password shorter than policy is rejected before hashing.
- Concurrent default group seeding succeeds without 500s.
- Public `/request-changes` stores canonical `request_changes`.
- Unsupported support case action is rejected at route/path boundary.
- Overview returns the same response shape with summary/count queries.
- Action summaries return max three recent actions per page.
- Decimal helper rejects NaN/Infinity/malformed values with 400.
- Expiry comparison handles naive and non-UTC aware datetimes.
- Flat list routes enforce a limit or UI uses cursor routes.

Frontend/manual:

- Client token is not cleared by a non-auth endpoint 401 unless backend confirms invalid token.
- Client catalog search is debounced.
- Authenticated client hooks do not retry 401s repeatedly.
- Setup page shows and enforces password minimum.
- Download helpers work in browser and do not crash in DOM-light tests.
- Brand accent accepts valid hex with whitespace.

## Explicit audit wording corrections

- The public `request-changes` flow is not currently broken at the backend route level because the route hardcodes `action="request_changes"` before calling the service. Treat this as a consistency/latent bug, not a confirmed current 400.
- The customer-group cache key already has a namespace prefix. The real problem is not collision; it is that cache is not a correctness mechanism for the seeding race.
- Decimal NaN/Infinity risk is mainly a service-boundary hardening issue because the public Pydantic schemas already cover normal route inputs.
