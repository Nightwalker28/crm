# 03 — Contextual Email Integration

## 1. Objective

Make email a first-class relationship action inside Lead/Contact/Organization/Opportunity workspaces using the existing mail module/provider infrastructure, with deterministic thread/record linkage and unified Activity integration.

## 2. Why this exists

The repository already contains a mail module and a dashboard Mail experience, while record-level communication actions can still fall back to `mailto:`. The CRM should let users communicate without leaving customer/deal context when a mailbox is connected, while preserving appropriate fallbacks when it is not.

## 3. Current behavior

Inspect:

- `backend/app/modules/mail/` in full;
- `frontend/app/dashboard/mail/` and compose flow;
- provider/account models for Gmail, Microsoft/Graph, IMAP/SMTP;
- mailbox sync/Celery tasks;
- attachments/document integration;
- `frontend/components/recordActivity/CommunicationActions.tsx`;
- existing message templates;
- record linkage in sales/contact models.

Document confirmed provider capabilities before changing the UI.

## 4. Desired behavior

From a supported CRM record:

```text
Email
  ↓
contextual composer
  ↓
connected mailbox/provider
  ↓
send through existing provider adapter
  ↓
persist provider message/thread identity + explicit CRM linkage
  ↓
appear in relationship Activity
  ↓
inbound/replies stay associated deterministically
```

The full Mail module remains useful for inbox-oriented work. Record-context email is an additional entry point, not a replacement Mail client.

## 5. Existing code to inspect

Reuse existing:

- OAuth/provider token handling;
- provider send/sync helpers;
- message persistence/thread models;
- retry/background jobs;
- template system;
- attachment abstractions;
- integration settings/status UI;
- permission helpers.

Do not create `LeadGmailService` or equivalent domain/provider coupling.

## 6. Architecture

Add a CRM association layer around existing messages/threads if one does not already exist.

Conceptually:

```text
CRM Record
   └─ Communication Composer
        └─ Mail domain service
             └─ MailProvider adapter
                  ├─ Gmail
                  ├─ Microsoft Graph
                  └─ IMAP/SMTP capabilities

MailMessage/Thread
   └─ explicit RecordAssociation(s)
        └─ Activity projection
```

A message may need multiple safe associations (for example Contact + Opportunity) but associations must be explicit and permission-aware.

This workstream owns mail/message/thread association persistence and its invariants. `02-communications-activity.md` consumes those associations through a mail activity adapter; it must not create a competing mail-link model.

## 7. Backend changes

### Phase 1 — association contract

- inventory current provider/thread IDs;
- create/reuse explicit CRM message/thread association model;
- add service methods to associate/disassociate where permitted;
- enforce same-tenant record linkage;
- define primary contextual record where useful without losing additional associations.

### Phase 2 — contextual send

- expose a send contract accepting mailbox/account, recipients, subject/body, attachments, template, and explicit source record context;
- provider service sends; domain persists IDs/status/linkage;
- failure responses distinguish validation, disconnected credentials, provider rejection, rate limit/transient failure.

### Phase 3 — inbound/thread sync

- on provider sync/webhook/poll, match provider thread/message IDs first;
- propagate existing explicit thread associations to new replies when safe;
- use participant/email inference only as a candidate/resolution aid, not a silent Opportunity association when ambiguous;
- expose ambiguous/unlinked inbound messages for user association rather than guessing.

## 8. Database changes

Potential association table (adapt to existing models):

```text
MailRecordAssociation
- id
- tenant_id
- message_id or thread_id
- module_key
- entity_id
- association_type/context
- created_by
- created_at
```

Add unique/index constraints supporting thread/entity lookup and preventing duplicate links. If current mail records already have equivalent linkage, extend it instead.

## 9. API contracts

Support:

- connected mailbox choices/capabilities;
- contextual send;
- record email threads/messages;
- reply/reply-all when provider/domain supports it;
- association management where permitted.

Do not expose provider refresh tokens/secrets to frontend.

## 10. Frontend changes — phased

### Phase 1 — contextual composer surface

Use the adaptive surface rules from `00`:

- desktop contextual panel/large surface;
- mobile full-screen;
- From/mailbox selector;
- To, Cc, Bcc;
- subject;
- body editor compatible with current mail capabilities;
- attachments;
- template insertion;
- Send and clear pending/error states.

When launched from Contact/Lead, prefill recipient. When launched from Opportunity/Organization, use known recipients but require deliberate recipient selection if multiple contacts make the target ambiguous.

### Phase 2 — thread viewer/reply

Show relevant threads in Activity and/or Email specialized region. Reply in context without leaving the record.

### Phase 3 — association/reconciliation UI

Provide safe “Link to record”/“Move association” tools for ambiguous inbound mail, subject to permissions.

## 11. Permission model

Separate permissions for:

- viewing CRM record;
- viewing mail content/account;
- sending mail;
- using templates;
- linking message to another record.

A user must not gain mailbox visibility merely by opening a record associated by another user unless product policy explicitly grants it.

## 12. Tenant-isolation requirements

Mailbox/account, messages, associations, recipients selected from CRM, and attachments must remain tenant-scoped. Test malicious association IDs across tenants.

## 13. Background jobs/events

Use existing Celery/sync paths. Ensure retries are idempotent and do not duplicate outbound sends. Persist provider IDs/idempotency metadata before/around retries according to provider semantics.

Emit/consume existing CRM events where appropriate for `email.sent`, `email.received`, association changes, and automation triggers without building a parallel event bus.

## 14. Error/loading/empty states

- no mailbox connected → explain and offer settings/fallback path;
- mailbox credentials expired → reconnect action;
- provider temporary failure → retry guidance without duplicate send;
- attachment failure;
- ambiguous recipients;
- no email threads yet;
- message body unavailable/redacted due permission;
- inbound message cannot be confidently associated.

## 15. Migration/backward compatibility

Keep Mail module routes and `mailto:` fallback where no connected provider is available or tenant chooses external email behavior. Do not require every tenant to configure Gmail/Microsoft to use CRM.

Backfill associations only when evidence is deterministic; do not mass-link historical mail based solely on loose sender matching.

## 16. Tests

- each existing provider adapter path;
- contextual send/linkage;
- reply/thread association inheritance;
- ambiguous inbound behavior;
- token expiration/provider failure;
- idempotent retry/no duplicate sends;
- permission and tenant isolation;
- attachment authorization;
- Activity projection;
- Playwright: Lead → Email → send → appears in record activity.

## 17. Acceptance criteria

Users with a connected mailbox can send/reply in CRM record context and see email history associated with the relationship. Inbound association is deterministic or explicitly resolved, never silently guessed into the wrong deal. Existing Mail module and fallback behavior continue to work.

## 18. Out of scope

- replacing the full Mail inbox;
- provider logic inside sales React components;
- broad automatic access to every user inbox;
- AI email generation unless separately approved;
- arbitrary historical association guessing.

## 19. Risks

- duplicate outbound sends on retries;
- token/provider complexity;
- permission leakage across shared relationships;
- inaccurate email-to-deal association;
- overloading Activity with full email content.

## 20. Codex implementation instructions

Inventory the existing mail module before designing any new model. Reuse provider/account/message/thread infrastructure. Land association contracts before changing record UI. Implement one provider-neutral vertical slice first, then verify all currently supported provider capabilities and fallbacks. Do not change permission scope or broad inbox access implicitly.
