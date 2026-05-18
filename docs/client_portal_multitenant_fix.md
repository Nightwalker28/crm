# Client Portal Multi-Tenant Sign-In Fix

## Status

Implemented 2026-05-18:

- `/client-auth/login` can resolve tenant context from request tenant, shared page token, or tenant slug.
- `/client-auth/me` accepts a valid client token when request tenant context is absent, and still rejects tenant/domain mismatch when request tenant exists.
- Client setup accepts an optional tenant slug and rejects setup-token tenant mismatch before setting the password.
- Shared client page sign-in links URL-encode the redirect and login submits the extracted page token.
- Login redirects remain limited to internal `/client/...` paths.

Still pending:

- Production link generation should prefer tenant domains and fall back to shared-origin links with `?tenant=<tenant_slug>`.

## Issue

Client portal sign-in from shared pages can fail with:

```txt
Tenant context missing
```

The frontend posts only `email` and `password` to `/client-auth/login`, but the backend login route expects `request.state.tenant`. In cloud/auth tenant resolution mode, `request.state.tenant` may be empty, so client login fails before credential validation.

## Goal

Make client portal auth production-ready for multi-tenant deployments while preserving tenant isolation.

Support:

- local/single-tenant mode
- cloud domain tenant resolution
- cloud auth tenant resolution
- public shared client page login
- client setup links
- safe redirect handling
- cross-tenant token protection

## Main Fix

Use the shared client page token to resolve tenant context during client login.

Flow:

```txt
/client/login?redirect=/client/pages/<token>
  -> frontend extracts <token>
  -> POST /client-auth/login with page_token
  -> backend resolves page_token -> ClientPage -> tenant_id
  -> authenticate_client_account(tenant_id, email, password)
```

## Backend Changes

### Files

```txt
backend/app/modules/client_portal/schema.py
backend/app/modules/client_portal/routes/client_portal_routes.py
backend/app/modules/client_portal/services/client_portal_services.py
```

### 1. Extend client login payload

Add optional tenant context fields:

```py
class ClientLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    page_token: str | None = None
    tenant_slug: str | None = None
```

### 2. Resolve tenant for client auth

In `client_portal_routes.py`, add a helper that resolves tenant in this order:

1. `request.state.tenant`
2. `page_token -> get_public_client_page() -> page.tenant_id`
3. optional `tenant_slug -> Tenant.slug`
4. otherwise raise `400 Tenant context missing`

Do **not** authenticate client accounts globally by email. Always authenticate using the resolved `tenant_id`.

### 3. Update `/client-auth/login`

Replace direct `_tenant_from_request(request)` usage with the new resolver:

```py
tenant = _resolve_client_auth_tenant(
    db,
    request,
    page_token=payload.page_token,
    tenant_slug=payload.tenant_slug,
)
```

Keep this behavior:

```py
authenticate_client_account(
    db,
    tenant_id=tenant.id,
    email=email,
    password=payload.password,
)
```

### 4. Update `/client-auth/me`

Make it work when `request.state.tenant` is missing in auth tenant mode:

- read the bearer client token
- load the client account from token
- if `request.state.tenant` exists, require tenant match
- if no request tenant exists, trust the tenant embedded in the valid client token

Still reject token/domain mismatch.

### 5. Setup links

Optionally allow setup requests to include `tenant_slug`. If provided, validate that the setup token account belongs to that tenant.

## Frontend Changes

### Files

```txt
frontend/hooks/useClientPortal.ts
frontend/app/client/login/page.tsx
frontend/app/client/pages/[token]/page.tsx
frontend/app/client/setup/page.tsx
```

### 1. Update `clientLogin()` payload

```ts
export async function clientLogin(payload: {
  email: string;
  password: string;
  page_token?: string | null;
  tenant_slug?: string | null;
}) {
  return publicJson("/client-auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to sign in.");
}
```

### 2. Extract page token from redirect

In `frontend/app/client/login/page.tsx`:

```ts
function pageTokenFromRedirect(redirect: string) {
  const match = redirect.match(/^\/client\/pages\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
```

Then submit:

```ts
const result = await clientLogin({
  email,
  password,
  page_token: pageTokenFromRedirect(redirect),
  tenant_slug: searchParams.get("tenant") || searchParams.get("tenant_slug"),
});
```

### 3. Encode shared page login redirect

In `frontend/app/client/pages/[token]/page.tsx`, change the sign-in link to encode the redirect:

```tsx
<Link href={`/client/login?redirect=${encodeURIComponent(`/client/pages/${token}`)}`}>
```

### 4. Keep redirect safe

Only allow internal `/client/...` redirects after login. Reject external URLs and protocol-relative URLs.

## Production Link Generation Improvement

Current setup/public links use `settings.FRONTEND_ORIGIN`. For true multi-tenant production, update link generation so:

1. tenant domain is used when available, or
2. shared frontend origin is used with `?tenant=<tenant_slug>` fallback

Examples:

```txt
https://bluewave.example.com/client/pages/<token>
https://crm.example.com/client/pages/<token>?tenant=bluewave-logistics
https://crm.example.com/client/setup?token=<token>&tenant=bluewave-logistics
```

## Security Requirements

- Never authenticate client account by email alone.
- Always scope login by tenant ID.
- Client token tenant must match request tenant when request tenant exists.
- Page token can only resolve the tenant for its own page.
- Client account can only access a page if tenant and linked contact/org match.
- Rate limiting must remain tenant-aware.
- Login errors must not reveal whether an email exists in another tenant.

## Tests To Add

Backend:

- login succeeds with valid `page_token`
- login fails without tenant context in auth tenant mode
- login fails with another tenant's page token
- `/client-auth/me` works with valid token and no request tenant
- `/client-auth/me` rejects tenant/domain mismatch

Frontend:

- login extracts `page_token` from `/client/pages/<token>` redirect
- login submits `page_token`
- shared page sign-in link URL-encodes redirect
- unsafe redirects are rejected

## Acceptance Criteria

- Shared client page sign-in no longer shows `Tenant context missing`.
- Works in single-tenant, cloud domain, and cloud auth tenant modes.
- Tenant isolation is preserved.
- Client tokens cannot be reused across tenants.
- Public/setup links are suitable for production multi-tenant deployments.
