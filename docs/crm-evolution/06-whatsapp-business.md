# 06 — WhatsApp: Preserve External Click-to-Chat + Optional Meta Cloud API

## 1. Objective

Evolve the existing WhatsApp capability into a provider/mode-aware CRM experience **without removing the current external WhatsApp workflow**.

Users/tenants must be able to continue opening WhatsApp externally. Meta WhatsApp Cloud API is an optional additional paid/provider-backed mode for tenants that want in-CRM conversations, delivery status, templates, inbound messages, and automation.

## 2. Why this exists

The current repository already has two valuable foundations:

1. `CommunicationActions` can open WhatsApp externally from a phone number.
2. `backend/app/modules/whatsapp/` already contains a `WhatsAppInteraction` domain and a service that normalizes contact phone numbers, renders WhatsApp templates, builds an external WhatsApp Web URL, records the interaction, can create a follow-up task, and logs activity.

Do not discard this working/free-external workflow merely because Meta API support is added.

## 3. Current behavior

Inspect in full:

- `frontend/components/recordActivity/CommunicationActions.tsx`;
- every caller supplying `onWhatsAppClick`;
- `backend/app/modules/whatsapp/models.py`;
- `backend/app/modules/whatsapp/schema.py`;
- `backend/app/modules/whatsapp/routes/`;
- `backend/app/modules/whatsapp/services/whatsapp_services.py`;
- WhatsApp repositories/tests/migrations;
- message templates;
- task/follow-up integration;
- platform activity log usage;
- Contact phone normalization/country behavior.

Document all existing external-link paths before changing behavior.

## 4. Desired behavior

### Supported modes

```text
external_link
meta_cloud_api
ask_each_time
```

`external_link` remains a first-class supported mode.

When only external mode is available:

```text
WhatsApp → prepare/open external WhatsApp → optional existing CRM interaction/follow-up record
```

When Meta is configured:

```text
WhatsApp action
  ├─ Send/Open externally
  ├─ Send from CRM via Meta
  └─ Ask each time (user preference/default behavior)
```

Tenant policy decides enabled modes. User preference can choose the preferred method when allowed.

### Important truthfulness rule

For external click-to-chat, the CRM cannot claim that the external WhatsApp message was actually sent/read or synchronize the conversation unless a provider/API supplies that evidence. Keep “prepared/opened external WhatsApp” semantics distinct from provider-confirmed `sent`, `delivered`, or `read` states.

## 5. Existing code to inspect

The existing WhatsApp module should be evolved rather than replaced. Before creating `MessagingAccount`, `WhatsAppConversation`, or new message tables, determine which current `WhatsAppInteraction` fields can remain, which should become an external-mode interaction subtype/projection, and whether a migration/generalization is safer than parallel tables.

## 6. Architecture

Introduce a provider-neutral boundary inside the WhatsApp/messaging domain, not inside Lead/Contact components.

Conceptually:

```python
class WhatsAppProvider(Protocol):
    provider_key: str
    def capabilities(...): ...
    def send_text(...): ...
    def send_template(...): ...
    def parse_webhook(...): ...
```

External-link mode is not necessarily a remote provider adapter; it is a supported delivery/action mode that prepares a URL and records only evidence the CRM actually has.

Meta Cloud API is the first connected API provider.

Potential domain concepts, adapted to existing models:

```text
WhatsAppAccount / MessagingAccount
- tenant_id
- provider_key
- enabled
- encrypted credentials/reference
- phone/business identifiers
- status/capabilities

WhatsAppConversation
- tenant_id
- provider/account
- normalized external party
- explicit CRM associations

WhatsAppMessage
- tenant_id
- conversation_id
- provider_message_id
- direction
- message_type
- body/template metadata
- status
- sent/delivered/read/failed timestamps
- actor
- explicit record association

WhatsAppPreference/Policy
- tenant enabled modes/default
- optional user preferred mode
```

Prefer names consistent with existing `backend/app/modules/whatsapp` unless repository conventions justify a broader messaging abstraction.

## 7. Backend changes — phased

### Phase 1 — preserve and formalize current external mode

Before Meta work:

- add tests proving existing external flows remain intact;
- clarify statuses/terminology so click/open preparation is not mislabeled provider-delivered;
- unify the frontend direct external action and backend template/interaction path where sensible without regressing simple `wa.me` fallback;
- expose a provider/mode capability endpoint for UI decisions;
- define the tenant capability/allowed-mode contract with backward-compatible effective default = existing external behavior.

No Meta credentials are required for this phase.

### Phase 2 — Meta account/configuration adapter

- add tenant-scoped Meta account configuration using existing secrets/encryption patterns;
- validate/test connection through backend only;
- expose non-secret connection/capability status;
- create provider abstraction and Meta adapter;
- do not change default external mode automatically when account connects.

At implementation time, inspect current official Meta WhatsApp Cloud API documentation for authentication, webhook verification, supported message/template types, business policy rules, conversation/pricing implications, and versioning. Do not freeze transient pricing values into schema/UI copy.

### Phase 3 — outbound Meta messaging

- send approved text/template/media types supported by product scope;
- persist provider message ID before/with retry-safe workflow;
- explicit Contact/Lead/Opportunity/Organization association;
- delivery state lifecycle;
- template selection/variables;
- consent/policy checks required by current provider rules;
- idempotency so Celery/API retries do not duplicate messages.

### Phase 4 — inbound webhook and conversations

- verify Meta webhook challenge/signature according to current official API;
- reject unverified callbacks;
- store raw provider payload only when necessary and with retention/redaction policy;
- deduplicate by provider identifiers;
- normalize inbound message/status events;
- resolve account/phone/conversation;
- match CRM records deterministically;
- when multiple matches are possible, preserve as unlinked/needs-association rather than guessing;
- project linked messages into relationship Activity.

### Phase 5 — mode preference and advanced workflow

- tenant setting UI/policy management for the allowed-mode/default contract established in Phase 1;
- user setting: preferred mode = external / Meta / ask each time, constrained by tenant policy;
- split-button/menu behavior when multiple modes are enabled;
- remember preference without making external fallback inaccessible when policy permits;
- optional automation/template tooling after core reliability is proven.

Phase 1 owns tenant capability/default resolution. Phase 5 adds tenant management UX and the narrower user preference overlay; it must not introduce a second mode-policy model.

## 8. Database changes

Migration strategy must preserve `whatsapp_interactions` history.

Options Codex must evaluate after inspecting current code:

1. keep `WhatsAppInteraction` for external/prepared interactions and add conversation/message tables for provider-backed messages; or
2. safely generalize it with a mode/type while adding normalized message tables.

Do not rewrite history into fake provider messages. Existing rows should continue to mean what they originally meant.

Add tenant/provider/message indexes and unique constraints on provider message IDs per account/provider.

## 9. API contracts

Needed contracts may include:

- `GET` WhatsApp capabilities/modes for current tenant/user;
- external prepare/open interaction using existing route where possible;
- Meta account admin settings/test connection;
- send message/template;
- list record conversations/messages;
- inbound webhook endpoints;
- update user preferred mode;
- association/reconciliation actions.

Never return provider secrets/access tokens to frontend.

## 10. Frontend changes — phased

### Phase 1 — capability-aware WhatsApp action

Replace one implicit behavior with an explicit resolved action while preserving exact external behavior by default.

Examples:

- only external enabled → button opens/prepares external WhatsApp exactly as today;
- only Meta enabled → in-CRM composer/conversation;
- both enabled + default external → primary action external, menu offers “Send from CRM”;
- both enabled + default Meta → primary action CRM, menu offers “Open in WhatsApp”;
- `ask_each_time` → action menu/small chooser every time.

### Phase 2 — settings

Tenant integrations settings explains:

- External WhatsApp: opens WhatsApp app/web; CRM does not receive conversation delivery/read state.
- Meta WhatsApp Cloud API: connected business integration; provider charges/policies may apply; verify current provider terms.

Do not use marketing copy that implies Meta is free.

### Phase 3 — in-record conversation

Inside Record Workspace provide a dedicated WhatsApp conversation view for Meta-backed history, linked from Activity. A chat UI may group messages by conversation/day/status but must remain accessible and responsive.

### Phase 4 — user preference

Allow user to select preferred method under profile/preferences when tenant enables both. Include “Ask each time” and “Reset to workspace default.”

## 11. Permission model

Separate permissions/capabilities for:

- using external WhatsApp action;
- sending through connected Meta account;
- viewing WhatsApp conversation history;
- managing Meta credentials/settings;
- creating templates/automations;
- reassociating a conversation.

Tenant admin configuration does not grant every user message-history access automatically.

## 12. Tenant-isolation requirements

Every account, interaction, conversation, message, association, and webhook lookup must be tenant/account scoped. Provider identifiers alone are not tenant authorization.

## 13. Background jobs/events

Use Celery where provider send/retry/status processing benefits from it. Requirements:

- bounded retry policy;
- idempotency key/provider ID handling;
- dead/failure visibility;
- webhook deduplication;
- existing CRM event/automation integration;
- no duplicate sends after worker restart.

## 14. Error/loading/empty states

External mode:

- missing/invalid phone;
- country code ambiguity;
- popup blocked;
- template render failure;
- follow-up task permission failure.

Meta mode:

- not configured;
- disconnected/expired credential;
- provider policy/template rejection;
- message outside provider-supported constraints;
- transient provider failure;
- delivery failure;
- ambiguous record match;
- no conversation yet.

UI must not silently fall back from a failed Meta send to external send because that could cause duplicate/unsanctioned outreach. Offer the fallback as an explicit user action.

## 15. Migration/backward compatibility

This is a hard requirement:

- current external click-to-chat remains working;
- existing `WhatsAppInteraction` history remains readable;
- connecting Meta does not switch all users automatically unless administrator deliberately chooses that default;
- disabling/removing Meta reverts safely to allowed external mode;
- old links/routes remain supported or explicitly redirected without data loss.

## 16. Tests

### External regression suite

- current `CommunicationActions` external behavior;
- existing template/render URL flow;
- phone normalization;
- existing interaction record;
- follow-up task creation;
- activity log;
- no provider delivery/read claims.

### Meta suite

- account tenant scoping;
- encrypted credential handling;
- send idempotency;
- webhook verification;
- inbound deduplication;
- status lifecycle;
- ambiguous association;
- permission checks;
- Activity projection.

### UX suite

- mode resolution;
- external only;
- Meta only;
- both/defaults;
- ask each time;
- user preference constrained by tenant policy;
- mobile conversation/composer;
- explicit fallback after Meta failure.

## 17. Acceptance criteria

- Existing external WhatsApp remains usable with no Meta account.
- A tenant can optionally configure Meta Cloud API.
- Tenant can enable both modes and choose a default.
- User can choose/prefer a mode when policy allows.
- Meta-backed messages can appear as real in-CRM conversations/activity with provider-confirmed statuses.
- External interactions are represented truthfully as prepared/opened external workflow, not fake synchronized messages.
- No provider-specific logic is embedded in core sales record components.

## 18. Out of scope

- removing `wa.me`/WhatsApp Web flow;
- forcing all tenants to purchase/configure Meta;
- hardcoding current provider pricing into source/schema;
- claiming external messages were delivered/read;
- adding unofficial automation that violates provider policy;
- broad campaign/broadcast marketing until consent/template/reliability controls are explicitly designed.

## 19. Risks

- accidentally replacing the free/external workflow;
- duplicate sends during retries;
- Meta policy/API version changes;
- ambiguous phone/contact matches;
- treating “opened external URL” as “sent message”;
- provider credentials leaking;
- user preferences overriding tenant compliance policy.

## 20. Codex implementation instructions

Before Meta code, write regression tests around the existing external flow. Evolve `backend/app/modules/whatsapp` rather than creating a disconnected parallel domain. Implement phases sequentially. Verify current official Meta documentation when entering provider phases. Do not alter tenant defaults to Meta automatically and never remove external mode as a side effect of provider integration.
