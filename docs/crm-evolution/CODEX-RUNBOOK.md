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
9. State a minimal implementation plan before editing.
10. Implement only the requested phase.

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
- a migration that cannot safely preserve existing data without an explicit migration plan.

If a safe compatibility layer is required, document why, keep it bounded, and include its removal criteria.

## 4. Phase launch prompts

Copy one prompt at a time into Codex.

### Wave 0A — engineering guardrails

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/10-dx-ci-api-contracts.md

Inspect current CI, API client/contracts, module metadata, and test infrastructure.
Implement only Phase 1 (guardrails / contract baseline) from 10-dx-ci-api-contracts.md.
Do not begin module metadata redesign or unrelated refactors.
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
Do not migrate all modules yet.
Keep canonical /new and /edit routes working.
```

### Wave 0C — layout metadata foundation

```text
Read:
/AGENTS.md
/backend/AGENTS.md
/frontend/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md

Implement only Phases 1 and 2 of 09-customization-metadata.md: layout data model/resolver plus tenant default management/preview.
Do not implement arbitrary code/expression support.
Do not remove current module field configuration or custom-field systems; integrate with them.
```

### Wave 1A — Lead Quick Create pilot

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md
/docs/crm-evolution/09-customization-metadata.md

Implement the Lead Quick Create pilot defined in Phase 2 of 00-product-ux-foundation.md using the resolved quick_create layout.
Preserve /dashboard/sales/leads/new as the full create route.
Create from the list without losing current view/filter context.
Support Create, Create & open, and More details where the specification requires them.
```

### Wave 1B — contextual Quick Create rollout

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/00-product-ux-foundation.md
/docs/crm-evolution/09-customization-metadata.md

Implement only Phase 3 of 00-product-ux-foundation.md.
Roll the established Quick Create primitive to Contact, Organization, and quick Opportunity creation and add contextual prefill/linkage flows.
Do not turn Quotes, Orders, Contracts, IOs, or other complex transactions into Quick Create forms.
```

### Wave 1C — Record Workspace

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/01-record-workspace.md
/docs/crm-evolution/09-customization-metadata.md

Implement only the Lead phase in 01-record-workspace.md.
Build reusable workspace primitives, but do not migrate Contact/Organization/Opportunity until the Lead workspace passes acceptance criteria.
Keep audit history separate from relationship activity.
```

### Wave 1D — user layout personalization

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md

Implement the next incomplete layout-personalization phase only.
User overrides may change safe presentation preferences (visibility/order/collapse where allowed) but may never bypass permissions, system-required fields, tenant policy, or read-only rules.
Provide reset-to-default behavior.
```

### Wave 2A — unified activity

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/02-communications-activity.md

Inspect existing activity, follow-up, task, comment, audit, mail, and WhatsApp records first.
Implement the normalized relationship-activity projection without replacing source-of-truth domain tables.
Do not merge audit history into the business activity feed.
```

### Wave 2B — contextual email

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/03-email-integration.md
/docs/crm-evolution/02-communications-activity.md

Implement the next email phase using the existing mail module/provider infrastructure.
Do not create Gmail/Microsoft provider logic inside sales record components.
Ensure deterministic record/thread associations and activity projection integration.
```

### Wave 3A — pipelines and Kanban

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/04-pipelines-kanban.md

Implement only the next incomplete pipeline phase.
Preserve existing stage data through explicit migration/backfill/compatibility behavior.
Do not use editable labels as semantic business-state identifiers.
```

### Wave 3B — richer relationships

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/05-relationships-data-model.md

Implement only the next incomplete relationship-model phase.
Preserve existing primary-contact behavior during migration and do not infer destructive relationship changes.
```

### Wave 4A — WhatsApp dual-mode integration

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
Implement only the next incomplete WhatsApp phase.
Meta Cloud API is an optional additional provider/mode, not a replacement.
When provider policies, pricing assumptions, template rules, or messaging-window rules matter, verify the current official Meta documentation before coding.
```

### Wave 4B — telephony

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/07-telephony.md
/docs/crm-evolution/02-communications-activity.md

Implement only the next incomplete telephony phase using a provider-neutral domain boundary.
Keep tel: fallback behavior where integrated calling is unavailable.
```

### Wave 5A — webhooks

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/08-webhooks-events.md

Inspect the existing CRM event/automation infrastructure first.
Implement secure outbound webhooks as a consumer of existing events rather than a parallel event bus.
Include SSRF, signing, retry, idempotency, and tenant-isolation tests.
```

### Wave 5B — advanced customization/DX

```text
Read:
/AGENTS.md
/docs/crm-evolution/README.md
/docs/crm-evolution/09-customization-metadata.md
/docs/crm-evolution/10-dx-ci-api-contracts.md

Implement exactly one remaining advanced phase selected from these specifications.
Do not combine unrelated metadata, API generation, and customization changes into one PR.
```

## 5. Recommended PR boundaries

Prefer one PR per meaningful phase, for example:

1. `ux: add adaptive quick-create surface primitives`
2. `platform: add record layout definitions and resolver`
3. `sales: add Lead quick create`
4. `sales: add contextual contact/org/opportunity quick create`
5. `sales: add Lead record workspace`
6. `platform: add personal record-layout preferences`
7. `activity: add unified record activity projection`
8. `mail: add contextual record composer and thread linkage`
9. `sales: add configurable pipelines`
10. `sales: add Kanban saved-view mode`
11. `sales: add opportunity contact roles`
12. `whatsapp: add selectable external/meta modes`
13. `whatsapp: add Meta inbound/outbound conversation sync`

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
