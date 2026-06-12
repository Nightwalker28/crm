# Security Data Classification

This document defines how Lynk classifies sensitive data and when developers must use application-level encryption. It is intentionally practical: if a new field can grant access to an account, provider, tenant, customer asset, or private integration, treat it as sensitive until reviewed.

## Classification Levels

| Class | Examples | Current handling | Required default for new fields |
| --- | --- | --- | --- |
| Secret credentials | OAuth access tokens, OAuth refresh tokens, SSO client secrets, TOTP secrets, IMAP/SMTP passwords, raw integration API keys, webhook signing secrets | Encrypt recoverable secrets with `APP_ENCRYPTION_SECRET`; hash non-recoverable API/session tokens where possible | Encrypt if the app must read it later; hash if only verification is needed |
| Sensitive operational data | Private documents, email message content, calendar event details, backup destinations, customer-specific terms/pricing, internal notes, audit history | Stored as tenant-scoped application data; not broadly encrypted field-by-field yet | Tenant-scope all access, avoid public exposure, and consider encryption when the field contains credentials, legal/financial data, regulated data, or high-volume private communications |
| Normal CRM data | Leads, contacts, organizations, opportunities, tasks, support cases, product and service configuration | Stored as tenant-scoped CRM records | Keep tenant-scoped and permission-gated; do not encrypt by default unless the field becomes a credential or regulated/private artifact |
| Public/client-visible data | Public catalog items, public website integration responses, client portal page snapshots, signed-link-visible document metadata | Exposed only through intended public, client, or signed-link flows | Keep deliberately scoped, avoid private pricing/documents unless authenticated or signed, and never include internal credentials |

## Encrypted Now

The current application-level encryption path is `app.core.secrets.encrypt_sensitive_value` and the model helper is `app.core.encrypted_fields.set_encrypted_model_value`. Encrypted records should store both ciphertext and key version so key rotation can re-encrypt without schema redesign.

Current encrypted secret targets are:

| Secret type | Model / fields | Notes |
| --- | --- | --- |
| MFA TOTP secret | `User.encrypted_totp_secret`, `User.mfa_secret_key_version` | Required for authenticator-app MFA verification. Backup codes are not recoverable plaintext. |
| Tenant SSO client secret | `TenantSsoSettings.encrypted_client_secret`, `TenantSsoSettings.client_secret_key_version` | UI and activity logs expose only whether a secret exists. |
| Mail OAuth tokens | `UserMailConnection.access_token`, `refresh_token` and key-version fields | Applies to connected Gmail/Microsoft mail accounts. |
| Mail IMAP/SMTP password | `UserMailConnection.encrypted_password`, `encrypted_password_key_version` | Legacy encrypted values are migrated on read/rotation. |
| Calendar OAuth tokens | `UserCalendarConnection.access_token`, `refresh_token` and key-version fields | Applies to Google/Microsoft calendar connections. |
| Document storage OAuth tokens | `DocumentStorageConnection.access_token`, `refresh_token` and key-version fields | Applies to Google Drive/OneDrive document storage connections. |

Integration API keys are a special case: the raw key is shown once, then only a hash and prefix are stored. Session refresh tokens are also stored as token identifiers/hashes rather than recoverable credentials.

## Not Field-Encrypted Yet

These records are sensitive but currently rely on tenant scoping, permissions, route-level controls, signed access, and audit logging rather than field-level encryption:

- Email message bodies and attachments.
- Calendar event titles, descriptions, participants, and sync metadata.
- Documents and generated files stored by the document module.
- Client portal pages, quote/order snapshots, and customer-visible activity.
- Backup destination metadata that is not a provider credential.
- CRM records that may contain personal or commercial information, such as contacts, opportunities, contracts, invoices, support cases, and comments.
- Activity logs and automation run payloads after sensitive-value redaction.

Do not put secrets, passwords, OAuth tokens, MFA codes, raw API keys, setup tokens, or webhook secrets into these payloads. If a workflow needs to persist one of those values, add it to the encrypted secret path first.

## Future Encryption Candidates

Consider field-level or file-level encryption for these areas when the product requirements justify the operational cost:

- Document binaries and exported backups.
- Email bodies and attachments for tenants that require stricter privacy controls.
- Calendar descriptions and participant details.
- Client portal private documents and signed-page payload snapshots.
- Finance, contract, and invoice fields containing banking, tax, legal, or regulated data.
- Webhook secrets and external integration credentials as those integrations are added.
- Backup destination credentials for S3/R2 or other future storage providers.

## Decision Path For New Fields

1. If the value can authenticate, authorize, sign, decrypt, impersonate, or connect to another system, store it encrypted or hashed.
2. If Lynk must display or send the original value later, use recoverable application encryption with a key-version column.
3. If Lynk only needs to compare or verify the value, store a hash and a safe prefix or metadata.
4. If the value is private business data rather than a credential, enforce tenant scoping, permissions, audit logging, and public-surface checks first.
5. If the field may contain regulated, legal, financial, or high-volume private communications data, document the decision and consider encryption before launch.
6. Never include raw secrets in API responses, frontend state beyond the active form submission, activity logs, automation payloads, exception messages, or background job logs.

## Rotation And Migration

New encrypted fields should be added to `SECRET_FIELD_TARGETS` in `app.core.secret_rotation` so they can participate in dry-run and live re-encryption. Each target should include:

- A stable secret type name.
- The model and ciphertext field.
- The key-version field.
- The tenant field when the model is tenant-owned.
- A legacy decryptor only when migrating an existing encrypted format.

When adding a new sensitive credential, include focused tests that prove the raw value is not present in serialized responses or activity logs.
