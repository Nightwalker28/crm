# Phase 5 — Identity, SSO, MFA, and Sensitive Data Encryption

## Goal

Strengthen identity and sensitive-data handling without overbuilding enterprise infrastructure too early.

This phase covers:

- MFA/TOTP.
- Tenant/company SSO.
- Sensitive credential encryption.
- Security/audit events.

## Explicitly out of scope

- Full compliance certification work.
- Complex enterprise IAM suite.
- Encrypting every CRM field blindly.
- Breaking search/filtering by encrypting normal searchable fields too early.
- Deployment/CI work.

## Task 5.1 — MFA/TOTP foundation

### Objective

Add app-level MFA using TOTP.

### Requirements

- User can enable MFA.
- User can scan QR code.
- User must verify code before MFA is activated.
- User receives backup/recovery codes.
- User can disable MFA after password/current MFA verification.
- Admin can require MFA for tenant/users later.

### Data model notes

Store:

- MFA enabled flag.
- Encrypted TOTP secret.
- Backup code hashes, not plaintext backup codes.
- Last MFA verification timestamp if needed.

### Acceptance criteria

- MFA setup works end-to-end.
- Login prompts for MFA when enabled.
- Backup codes work once and are then invalidated.
- MFA secrets are encrypted at rest.
- MFA actions create audit events.

## Task 5.2 — Admin MFA controls

### Objective

Allow tenant/company admins to enforce MFA policies.

### Requirements

- Require MFA for all users in tenant.
- Require MFA for admins only.
- View MFA status per user.
- Reset MFA for a user with confirmation.
- Audit all admin MFA actions.

### Acceptance criteria

- Tenant admin can enforce MFA policy.
- Users without MFA are prompted to configure it.
- Admin reset action is logged.
- Non-admins cannot change tenant MFA policy.

## Task 5.3 — Tenant SSO using OIDC first

### Objective

Allow companies/tenants to sign in with their own SSO provider.

Start with OIDC because it is usually simpler to implement and test than SAML.

### Tenant SSO settings

- enabled
- provider_type: oidc
- issuer_url
- authorization_endpoint if not discoverable
- token_endpoint if not discoverable
- userinfo_endpoint if not discoverable
- client_id
- encrypted_client_secret
- allowed_email_domains
- auto_provision_users
- default_role_id
- default_team_id
- attribute/email claim mapping
- status/last_test_result

### Login flow

1. User enters email or chooses company SSO.
2. App resolves tenant by email domain or tenant selection.
3. If tenant SSO is enabled, redirect to tenant IdP.
4. Callback validates state/nonce.
5. App maps IdP user to CRM tenant user.
6. If auto-provisioning is enabled, create user with default role/team.
7. Create normal CRM session.

### Acceptance criteria

- Tenant can configure OIDC SSO.
- App can redirect user to tenant IdP.
- Callback validates state and nonce.
- Existing users can sign in through SSO.
- Optional auto-provision creates users safely.
- SSO client secret is encrypted.

## Task 5.4 — SSO admin testing and diagnostics

### Objective

Make SSO setup debuggable for tenant admins.

### Requirements

- Test connection button.
- Show discovery/metadata errors.
- Show last successful login time.
- Show last failed login reason.
- Do not expose secrets in UI/logs.

### Acceptance criteria

- Admin can test SSO configuration.
- Configuration errors are understandable.
- Secret values are masked.
- SSO errors create audit/security events.

## Task 5.5 — Sensitive credential encryption service

### Objective

Create a reusable application-level encryption service for secrets and sensitive credentials.

### Must encrypt first

- OAuth refresh tokens.
- OAuth access tokens if stored.
- Provider tokens.
- API keys.
- Webhook secrets.
- SSO client secrets.
- Backup destination credentials.
- TOTP secrets.
- Client portal invite/setup tokens if stored in recoverable form.

### Do not encrypt blindly yet

Avoid encrypting these until product/search impact is understood:

- contact names
- company names
- normal email fields
- normal phone fields
- addresses
- notes
- searchable CRM fields

### Recommended design

- Master encryption key comes from environment variable.
- Use authenticated encryption.
- Store key version with encrypted values.
- Add future path for key rotation.

### Acceptance criteria

- Shared encryption/decryption utility exists.
- Existing sensitive-token storage paths use it.
- Missing/invalid encryption key fails safely in protected operations.
- Tests cover encrypt/decrypt and wrong-key failure.

## Task 5.6 — Key rotation preparation

### Objective

Prepare the system for future encryption key rotation.

### Requirements

- Encrypted records store key version.
- App supports current key and previous keys if configured.
- Add admin/internal command to re-encrypt selected secret types later.

### Acceptance criteria

- Encrypted values include key version metadata.
- Code does not hardcode a single irreversible key assumption.
- Rotation can be added later without full schema redesign.

## Task 5.7 — Security and audit events

### Objective

Record important identity/security actions.

### Events

- auth.login.success
- auth.login.failed
- auth.logout
- auth.refresh.failed
- mfa.enabled
- mfa.disabled
- mfa.challenge.failed
- mfa.backup_code.used
- mfa.admin_reset
- sso.enabled
- sso.disabled
- sso.login.success
- sso.login.failed
- sso.config.updated
- api_key.created
- api_key.rotated
- api_key.revoked
- integration.secret.updated

### Acceptance criteria

- Events are tenant-scoped where applicable.
- Events include actor/user when known.
- Events do not leak tokens, secrets, MFA codes, or passwords.

## Task 5.8 — Sensitive data classification notes

### Objective

Document what is encrypted now vs later.

### Implementation note

Create/update `docs/security-data-classification.md` with:

- secret credentials
- sensitive operational data
- normal CRM data
- public/client-visible data
- current encryption status
- future encryption candidates

### Acceptance criteria

- Developers know which fields must use encryption.
- Future sensitive fields have a clear decision path.
