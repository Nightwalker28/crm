# 07 — Telephony and Call Context

## 1. Objective

Add optional provider-neutral in-CRM calling and call history while keeping normal `tel:` behavior available when no telephony provider is configured.

## 2. Why this exists

Calls should be part of the customer/deal relationship rather than an unrelated external action. Integrated calling can add caller context, call state, notes, duration, recordings where lawful/configured, and Activity linkage, but it must remain optional and provider-neutral.

## 3. Current behavior

Inspect:

- `CommunicationActions` and all `tel:` actions;
- current follow-up/call activity labels;
- Contact/Lead phone fields and normalization;
- task/follow-up behavior;
- integration settings/secrets patterns;
- existing event/audit infrastructure.

Do not assume Twilio or another provider is already present.

## 4. Desired behavior

When no provider is configured:

```text
Call → tel: fallback
```

When an integrated provider is configured and permitted:

```text
Call
 ↓
in-record/in-browser call surface
 ↓
provider connection/status
 ↓
CallLog
 ↓
notes/outcome/follow-up
 ↓
Activity
```

Incoming:

```text
provider webhook/event
 ↓
verify + normalize phone
 ↓
match permitted tenant records
 ↓
resolve ownership/team context
 ↓
surface caller context
 ↓
CallLog + Activity
```

## 5. Existing code to inspect

Reuse existing integration-account secret storage, tenant scoping, activity/event mechanisms, task/follow-up creation, and phone normalization where appropriate. Do not put Twilio-specific objects in core sales models.

## 6. Architecture

Provider boundary:

```python
class TelephonyProvider(Protocol):
    def capabilities(...): ...
    def create_client_token(...): ...
    def start_call(...): ...
    def parse_status_callback(...): ...
    def parse_incoming_call(...): ...
```

Domain concepts:

```text
TelephonyAccount
TelephonyAgent
CallLog
CallRecording (optional metadata/reference)
```

Use generic provider fields rather than naming domain models `TwilioCall`.

## 7. Backend changes — phased

### Phase 1 — call log domain and fallback semantics

- formalize CallLog/outcome model if absent;
- allow manual/external call logging from CRM;
- preserve `tel:` fallback;
- project call logs into Activity.

### Phase 2 — provider/account boundary

- tenant-scoped provider config;
- encrypted secrets using existing patterns;
- provider capability/status API;
- first adapter (Twilio only if selected after implementation-time evaluation).

### Phase 3 — outbound integrated call

- short-lived browser/client credentials;
- initiate/track call;
- verified status callbacks;
- idempotent state transitions;
- duration/outcome/notes/follow-up.

### Phase 4 — inbound call context

Entry gate: document and approve the product routing policy (for example assigned owner, team queue, availability, escalation, and no-match handling) before implementation. Stop rather than inventing routing behavior inside the provider adapter.

- verify incoming provider callback;
- normalize caller number;
- deterministic tenant/account lookup;
- candidate CRM record match;
- show caller context only to authorized assigned/available users according to product routing policy.

### Phase 5 — recordings/transcripts if approved

Recordings are optional. Implement only with explicit tenant configuration, access control, retention policy, provider capability, and legal/compliance review. Do not make recording default.

## 8. Database changes

CallLog should include tenant, provider/account identity where applicable, direction, normalized numbers, provider call ID, timestamps/status/duration, actor/agent, outcome, source record association, and recording reference only when present.

Unique provider-call constraints must be scoped appropriately. Add activity lookup indexes.

## 9. API contracts

- telephony capabilities/status;
- manual/external call log;
- create client token/connection info;
- initiate call;
- call detail/update notes/outcome;
- verified provider callback endpoints;
- record call history.

Never expose provider master secrets to frontend.

## 10. Frontend changes — phased

- capability-aware Call action: integrated vs external `tel:`;
- adaptive call panel with state (connecting/ringing/active/ended/failed);
- microphone permission handling;
- duration and target identity;
- post-call notes/outcome/follow-up;
- incoming call notification/context surface;
- call history in Activity and specialized detail if useful.

If integrated calling fails, offer external fallback explicitly rather than automatically causing a second call attempt.

## 11. Permission model

Separate provider configuration, call initiation, call-history view, recording access, and reassociation permissions. Recording access should be stricter than basic call-log visibility if implemented.

## 12. Tenant-isolation requirements

Provider account callbacks must resolve to the correct tenant before caller matching. Phone number matches must never search across tenants and return another tenant’s identity.

## 13. Background jobs/events

Use Celery for asynchronous post-processing/reconciliation if needed. Provider callback processing must be idempotent. Emit stable call events to existing CRM event infrastructure for automation only after reliable state transitions.

## 14. Error/loading/empty states

- no provider configured;
- microphone denied;
- provider disconnected;
- target phone invalid;
- call failed/busy/no answer;
- callback duplication/out-of-order statuses;
- ambiguous caller match;
- recording unavailable/not permitted;
- browser does not support provider capability.

## 15. Migration/backward compatibility

Keep `tel:` action usable where tenant/user policy permits. Existing manually logged follow-ups should remain intact. Do not retroactively label old generic follow-up records as provider calls without evidence.

## 16. Tests

- manual call log;
- provider capability resolution;
- tenant/account isolation;
- callback verification and deduplication;
- state transition ordering;
- phone normalization;
- ambiguous match;
- recording permission;
- Activity projection;
- frontend fallback/integrated state.

## 17. Acceptance criteria

Tenants without telephony integration retain normal calling. Configured tenants can initiate and track calls from CRM context, with call logs and outcomes linked to records. Incoming calls can surface safe CRM context. Provider details stay behind an adapter boundary.

## 18. Out of scope

- mandatory recordings;
- provider-specific objects in sales domain;
- global phone directory search;
- auto-dial campaigns;
- transcription/AI summaries unless separately approved.

## 19. Risks

- callback spoofing;
- cross-tenant caller leakage;
- browser media permissions;
- provider status ordering;
- recording consent/retention law;
- accidental double calls through fallback.

## 20. Codex implementation instructions

Implement manual/logging/fallback semantics before integrated calls. Provider selection requires an explicit phase request; completion of fallback work does not imply approval. Select and implement one provider only behind the neutral interface. Verify current provider documentation when coding. Do not begin inbound routing until its product policy is approved, and do not enable recording by default. Include callback-verification, tenant-isolation, and idempotency tests before considering provider phases complete.
