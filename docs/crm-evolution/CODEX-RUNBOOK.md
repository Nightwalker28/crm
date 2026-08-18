# Codex Runbook — CRM Evolution

Use this file to execute the roadmap safely. Do not give Codex the whole roadmap and ask it to “implement everything.” Each phase is intentionally bounded.

## 1. Before every phase

Codex must:

1. Read `/AGENTS.md`.
2. Read the scoped `AGENTS.md` files for every area it expects to touch.
3. Read the relevant `.codex/skills/` instructions.
4. Read `/docs/crm-evolution/README.md`.
5. Read only the numbered specification for the requested workstream plus directly referenced dependencies.
6. Inspect the current implementation and nearby tests before proposing changes.
7. Verify every path/class/table mentioned in the specification because the repository may have changed since this plan was written.
8. Reuse existing primitives/contracts/services where possible.
9. State what is already implemented, the confirmed gap, and a minimal implementation plan before editing.
10. Define the behavior-level acceptance checks for the requested slice.
11. Implement only the requested phase. A phase label is not evidence that all described work is missing.

## 2. Required completion report

Every Codex phase must finish with:

- summary of behavior changed;
- files changed;
- migrations added/changed;
- API contracts added/changed;
- tests added/changed;
- exact checks run and their result;
- tenant/permission review;
- backward-compatibility notes;
- deferred work;
- risks/open decisions.

For UX work, also report:

- the user journey changed;
- desktop, narrow/mobile, keyboard, focus, loading, empty, validation, and error behavior verified;
- whether the result was runtime-tested or only statically inspected;
- any before/after usability measurement available.

Run the repository close-out checks required by `AGENTS.md`, including `./scripts/codex-check.sh` when appropriate.

## 3. Global stop rules

Stop the phase rather than silently broadening scope if implementation would require:

- replacing FastAPI/SQLAlchemy architecture;
- a second parallel permission system;
- a second parallel event system;
- arbitrary tenant code execution;
- removing existing click-to-chat WhatsApp;
- deleting canonical `/new` or `/edit` routes;
- weakening tenant isolation;
- making provider-specific logic a core CRM entity dependency;
- a migration that cannot safely preserve existing data without an explicit migration plan;
- a provider-dependent feature whose routing, consent, retention, pricing/policy, or fallback decision is still undefined;
- a broad rollout whose pilot has not passed its behavior-level acceptance gate.

If a safe compatibility layer is required, document why, keep it bounded, and include its removal criteria.

## 4. Phase launch prompts

Copy one prompt at a time into Codex. Do not automatically continue to the next prompt after completing the current acceptance gate.

### Wave 0A — guardrails and Lead journey baseline

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/10-dx-ci-api-contracts.md

Inspect current check scripts, CI, migrations, OpenAPI generation, tenant/permission tests, and existing Lead browser coverage.
Implement only verified gaps from Phase 1 of 10-dx-ci-api-contracts.md.
Add or update a behavior baseline for: filter Leads -> create through the current path -> open the Lead -> perform a next action.
Do not add API code generation, redesign module metadata, or change production UX in this slice.
Run the specified verification and report using CODEX-RUNBOOK.md.
```

### Wave 0B — adaptive UX primitives

```text
Read:
/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md

Inspect existing form, Sheet/Dialog/Drawer primitives, list toolbars, record pages, mutation helpers, responsive behavior, and tests.
Implement only Phase 1 from 00-product-ux-foundation.md: interaction-surface primitives and behavioral contracts.
Compose existing accessible primitives; do not add a UI library without a demonstrated missing capability.
Prove focus entry/trap/return, Escape and explicit close, dirty-close confirmation, pending duplicate-submit prevention, reduced motion, and desktop/mobile behavior.
Do not connect the surface to Lead or any other module yet.
Keep canonical /new and /edit routes working.
```

### Wave 0C — minimal layout resolver and runtime contract

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md

Inspect field definitions, module field enablement, custom fields, permissions, and existing user preference models.
Implement only backend Phase 1 and the minimum frontend runtime renderer from 09-customization-metadata.md.
Deliver: validated definitions, resolver, system fallback, versioning, Lead quick_create and detail seeds, runtime resolved endpoint, and bounded Quick Create/read-only Details renderer proofs.
Do not build the tenant admin layout builder in this slice.
Do not add team/role overrides, user preferences, new custom-field families, or custom actions.
Do not implement arbitrary code/expression support.
Do not remove current module field configuration or custom-field systems; integrate with them.
```

### Wave 0D — layout API contract pilot

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/10-dx-ci-api-contracts.md
/docs/crm-evolution/09-customization-metadata.md

Inspect the completed layout API and the current apiFetch/auth-refresh/retry boundary.
Implement only Phase 2 of 10-dx-ci-api-contracts.md as a layout-family pilot.
Keep generated types behind domain-friendly adapters/hooks and preserve the rule that write operations are not automatically retried.
Define deterministic generation, artifact ownership, repair command, and CI drift behavior.
Do not migrate unrelated frontend APIs or redesign module metadata.
```

### Wave 1A — Lead Quick Create pilot

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md
/docs/crm-evolution/09-customization-metadata.md

Implement the Lead Quick Create pilot defined in Phase 2 of 00-product-ux-foundation.md using the resolved quick_create layout.
Preserve /dashboard/sales/leads/new as the full create route.
Create from the list without losing current view/filter context.
Support Create, Create & open, and More details where the specification requires them.
Reuse the normal Lead create mutation/domain validation; do not add a parallel quick-create endpoint unless repository evidence requires a narrow contract change.
Prove validation recovery, unsaved-data safety, permission behavior, and malicious cross-tenant relationship rejection.
```

### Wave 1B — Lead layout administration and preview

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md

Implement only backend Phase 2 and the corresponding bounded admin UI needed to manage and preview the proven Lead quick_create layout.
Support validation/preview, publish or save according to the chosen model, reset to system default, warnings distinct from blocking errors, and desktop/mobile preview.
Provide a non-drag alternative for reordering.
Do not add role/team overrides, user preferences, broad custom-field expansion, or other modules.
```

### Wave 1C — Lead Record Workspace

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/01-record-workspace.md
/docs/crm-evolution/09-customization-metadata.md

Audit the existing Lead header, actions, tabs, follow-up, tasks, notes, files, detail fields, and audit behavior first.
Implement only confirmed gaps in the Lead phase of 01-record-workspace.md.
Extract reusable composition primitives around useful existing behavior; do not rebuild working domain panels or create an unbounded aggregate endpoint.
Integrate the resolved Lead detail layout using frontend Phase 3 of 09-customization-metadata.md; the required resolver, seed, and bounded read-only renderer must already exist from Wave 0C.
Do not migrate Contact, Organization, or Opportunity until the Lead workspace passes acceptance criteria.
Keep audit history separate from relationship activity.
```

### Wave 1D — Lead activity projection

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/02-communications-activity.md

Inventory the current Lead-linked follow-up, task, note/comment, meeting, mail, WhatsApp, and audit sources and their indexes/permissions.
Implement the smallest normalized activity projection that supports the Lead workspace and sources with reliable explicit linkage.
Keep source-domain tables authoritative, use deterministic cursor pagination, and keep immutable audit history separate.
Do not invent inferred permanent associations or a second event/activity store.
```

### Wave 1E — deterministic mail-record associations

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/03-email-integration.md
/docs/crm-evolution/02-communications-activity.md

Verify existing mail/calendar correctness and inventory mailbox, provider, thread, retry/idempotency, permission, and record-link behavior.
Implement only backend Phase 1 of 03-email-integration.md: deterministic message/thread association persistence and permission-safe management needed for Lead context.
Mail association persistence belongs to 03; Activity consumes it through an adapter.
Do not add the contextual composer/send flow, create provider logic in sales components, infer ambiguous links, or expand mailbox scopes.
```

### Wave 1F — contextual Lead email send

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/03-email-integration.md
/docs/crm-evolution/02-communications-activity.md

After the association contract passes acceptance, implement only backend Phase 2 plus frontend Phase 1 of 03-email-integration.md for Lead contextual send and its bounded composer.
Reuse the existing mail provider/account/template/attachment/job infrastructure.
Require explicit source context, persist retry-safe provider identity/status/linkage, and distinguish validation, disconnected credentials, provider rejection, and transient failure.
Project sent mail through the 02 Activity adapter without duplicating association storage.
Do not implement inbound/thread sync, other CRM records, or provider-specific logic in sales components.
```

### Wave 2A — Contact and Organization rollout

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md
/docs/crm-evolution/01-record-workspace.md
/docs/crm-evolution/09-customization-metadata.md

Roll the proven Quick Create and workspace primitives to Contact and Organization only.
Seed and resolve each module layout before rendering it.
Add contextual Organization -> Contact and Contact/Organization -> Opportunity entry points without asking for known context again.
Server-validate all linked IDs, tenant ownership, and link permissions.
Do not include Opportunity workspace rollout or complex transaction Quick Create.
```

### Wave 2B — Opportunity participant compatibility model

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/05-relationships-data-model.md

Implement only Phase 1 of 05-relationships-data-model.md.
Inventory every current Opportunity contact reader/writer first.
Add and backfill the compatibility association model, serialize primary and participant contacts, and preserve legacy primary-contact behavior.
Test clean migration, populated backfill, invalid references, tenant isolation, uniqueness, and soft-delete/history behavior.
Do not add participant mutation APIs or change downstream conversion, quotes/orders, or communication recipient UI.
```

### Wave 2C — Opportunity participant role APIs

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/05-relationships-data-model.md

After the compatibility model passes acceptance, implement only Phase 2 of 05-relationships-data-model.md.
Add explicit add/remove participant, role-change, and primary-contact operations with tenant, visibility, link-permission, audit, concurrency, and recoverability behavior.
Keep the role catalog in the sales domain and preserve legacy primary-contact compatibility.
Do not begin participant UI, downstream propagation, or communication recipient selection.
```

### Wave 2D — Opportunity Quick Create and workspace

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md
/docs/crm-evolution/01-record-workspace.md
/docs/crm-evolution/05-relationships-data-model.md
/docs/crm-evolution/09-customization-metadata.md

Roll the proven Quick Create/workspace pattern to Opportunity using the explicit participant model and resolved layouts.
Implement frontend Phases 1–2 of 05-relationships-data-model.md in this slice: participant display plus permission-safe participant management with contextual pickers.
Keep complex/full Opportunity entry available and do not infer recipient or relationship choices when multiple participants exist.
Do not begin pipeline schema migration or provider integration in this slice.
```

### Wave 2E — pipeline compatibility, then Kanban

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/04-pipelines-kanban.md

Inventory every current stage comparison across APIs, conversion, reports, automation, import/export, dashboards, and frontend styling.
Implement exactly one next incomplete pipeline phase.
Land models/backfill/compatibility and migrate dependent business logic before opening the Kanban phase.
When Kanban is requested, reuse the same saved-view/filter/query population as List and provide a keyboard/non-drag stage-change alternative.
Never use editable labels as semantic business-state identifiers.
```

### Wave 3A — core CRM activity and email rollout

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/02-communications-activity.md
/docs/crm-evolution/03-email-integration.md
/docs/crm-evolution/05-relationships-data-model.md

After the target workspace passes acceptance, extend the proven Activity and contextual email contracts to exactly one requested module per run: Contact first, then Organization, then Opportunity.
Reuse the existing projection and mail association services; do not create module-specific persistence or provider logic.
For Opportunity recipients, use explicit participant roles/candidates and require deliberate selection when ambiguous.
Keep source-domain permissions, tenant scoping, cursor behavior, audit separation, mailbox scopes, and retry/idempotency behavior unchanged.
Do not begin inbound email sync or provider expansion unless that exact phase is separately requested.
```

### Wave 3B — WhatsApp external-mode contract

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/06-whatsapp-business.md
/docs/crm-evolution/02-communications-activity.md

Inspect the existing backend WhatsApp module and frontend CommunicationActions before editing.
Do not remove or regress the existing wa.me click-to-chat workflow.
Implement only Phase 1 of 06-whatsapp-business.md: truthful external-mode semantics, capability/default resolution, and regression tests.
Do not add Meta account configuration, message sending, inbound webhooks, templates, or user mode preferences.
```

### Wave 3C — telephony fallback and manual logs

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/07-telephony.md
/docs/crm-evolution/02-communications-activity.md

Implement only Phase 1 of 07-telephony.md using a provider-neutral domain boundary.
Keep tel: fallback behavior, add truthful manual/external call-log semantics only where the current domain supports them, and project eligible logs into Activity.
Do not select or integrate a provider and do not implement inbound routing or recordings.
```

### Wave 3D — explicitly approved provider phase

```text
Read the applicable provider workstream and current official provider documentation.
Implement exactly the explicitly requested Meta or telephony phase; do not infer provider approval from completion of fallback work.
Before editing, document the selected provider, tenant policy/default behavior, explicit fallback, callback verification, idempotency, secret storage, routing, consent/retention, and current pricing/policy assumptions that affect the implementation.
Stop and request a product decision if any required routing, consent, retention, or fallback behavior is undefined.
```

### Wave 4A — webhooks

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/08-webhooks-events.md

Inspect the existing CRM event/automation infrastructure first.
Implement exactly one next incomplete phase of 08-webhooks-events.md.
Begin with the safe/versioned event inventory; do not create subscriptions or delivery workers until the event contract is approved.
Implement outbound webhooks as a consumer of existing events rather than a parallel event bus.
For delivery/replay phases include SSRF/DNS/redirect controls, signing, bounded retry, logical-delivery idempotency, replay-attempt identity, retention, and tenant-isolation tests.
```

### Wave 4B — one advanced customization or DX phase

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md
/docs/crm-evolution/10-dx-ci-api-contracts.md

Implement exactly one remaining advanced phase selected from these specifications.
For layouts, implement role/team overrides before user preference overlays and state deterministic precedence.
For contract adoption or module metadata, migrate one API/consumer family at a time.
Do not combine unrelated metadata, API generation, and customization changes into one PR.
```

## 5. Recommended PR boundaries

Prefer one PR per meaningful phase, for example:

1. `quality: establish CRM evolution guardrails and Lead journey baseline`
2. `ux: add adaptive Quick Create surface primitives`
3. `platform: add record layout resolver and Lead system fallback`
4. `dx: pilot generated contracts for record layouts`
5. `sales: add Lead Quick Create`
6. `platform: add Lead layout administration and preview`
7. `sales: compose the Lead Record Workspace`
8. `activity: add the Lead relationship activity projection`
9. `mail: add deterministic record associations`
10. `mail: add Lead contextual email send`
11. `sales: roll Quick Create and workspaces to Contact and Organization`
12. `sales: add Opportunity participant compatibility model`
13. `sales: add Opportunity participant role APIs`
14. `sales: roll Quick Create and workspace behavior to Opportunity`
15. `sales: add configurable pipeline compatibility`
16. `sales: add accessible Kanban saved-view mode`
17. `activity: roll relationship activity to one core CRM module`
18. `mail: roll contextual email to one core CRM module`
19. `whatsapp: formalize external click-to-chat capabilities`
20. `telephony: add fallback and manual call-log semantics`
21. `platform: add one secure outbound-webhook phase`

Do not use these titles as a substitute for inspecting actual scope.

## 6. Codex review checklist

Before asking for merge, answer yes/no with evidence:

- Is tenant scoping present on every new tenant-owned read/write?
- Are backend permissions enforced independently of UI visibility?
- Are audit and business activity still distinct?
- Are existing deep-link/full-page flows preserved?
- Can Quick Create fail safely without losing list/record context?
- Are system-required fields impossible to hide from required creation flows?
- Can user layout overrides expose a field the user is not permitted to see? The answer must be no.
- Does WhatsApp external-link mode still work after Meta support?
- Are provider callbacks/webhooks idempotent and verified?
- Are migrations/backfills tested?
- Were current repository checks run?
