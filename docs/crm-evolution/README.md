# CRM Evolution — Master Roadmap

Status: implementation planning source of truth  
Target repository: `Nightwalker28/crm`  
Architecture: Next.js/React + FastAPI + SQLAlchemy/PostgreSQL + Redis/Celery  
Reference product: Frappe CRM (product/workflow ideas only; do not copy framework or source)

## 1. Purpose

This package converts the comparative Frappe CRM research and the later MAAD/Lynk UX decisions into independently executable Codex workstreams.

The goal is not to clone Frappe. Preserve the existing modular multi-tenant architecture and broader CRM/ERP scope while adopting the strongest ideas that make day-to-day CRM work faster:

- the CRM record is the primary work surface;
- quick work happens without losing context;
- complex work still gets a full focused page;
- communications live with the customer/deal relationship;
- fields, layouts, pipelines, and views are configurable without arbitrary tenant code;
- relationships are explicit and reusable rather than inferred repeatedly;
- integrations are provider-neutral and optional;
- audit history stays separate from salesperson-facing activity;
- permissions and tenant isolation remain backend-enforced.

## 2. Decision precedence

When this roadmap conflicts with an older Frappe-derived recommendation, use this order:

1. **Current repository `AGENTS.md` and scoped agent/skill instructions.**
2. **The 2026 MAAD/Lynk UX architecture in `00-product-ux-foundation.md`.**
3. **This master roadmap and numbered workstream specifications.**
4. Frappe CRM patterns as reference evidence.

In particular, do **not** interpret “Frappe uses Quick Entry dialogs” as “replace every `/new` page with a modal.” The chosen product direction is adaptive and context-first.

## 3. Product principles

### 3.1 Record-centric workflow

A salesperson opening a Lead, Contact, Organization, or Opportunity should be able to answer and act on the relationship without repeatedly navigating to Mail, Tasks, Calendar, Documents, WhatsApp, or unrelated module pages.

A successful workspace answers:

- Who is this?
- Which organization are they connected to?
- Who else is involved?
- What are we selling?
- What is the current stage and value?
- Who owns it?
- What happened last?
- What emails, WhatsApp conversations, calls, meetings, notes, and tasks exist?
- What files/quotes/orders/support records are related?
- What should happen next?

### 3.2 Context first, not container first

Do not standardize on “modal,” “drawer,” or “page” as the universal creation pattern. Select the interaction surface by task complexity and context.

| Task | Default surface |
|---|---|
| One/few field edits | Inline edit or popover |
| Small confirmation/destructive decision | Modal dialog |
| Quick Lead/Contact/Organization creation | Adaptive Quick Create surface |
| Quick Opportunity | Larger adaptive Quick Create surface |
| Related-record creation from an existing record | Contextual Quick Create surface |
| Detailed Lead/Contact/Organization entry | Canonical full page |
| Detailed Opportunity, Quote, Order, Contract, IO, invoice-like workflow | Full page/workspace |
| Multi-step configuration | Full page/focused workflow |

On desktop, Quick Create normally appears as a contextual side panel. On narrow/mobile layouts it becomes a full-height/full-screen sheet. Implement a semantic primitive such as `QuickCreateSurface`, not a component whose API permanently assumes “right drawer.”

### 3.3 Progressive disclosure

Quick Create should capture the minimum information needed to establish a usable record, normally around 5–8 fields. Keep canonical `/new` routes for complete data entry, deep links, bookmarks, new tabs, accessibility, and complex custom fields.

Quick Create should support, where appropriate:

- `Create` — save and return to the current context;
- `Create & open` — save and open the resulting Record Workspace;
- `More details` — continue on the full canonical creation page while preserving entered values where practical.

### 3.4 Never ask for known context again

Examples:

- Organization → Create Contact: organization is already selected.
- Contact/Organization → Create Opportunity: known relationships are prefilled.
- Opportunity → Create Quote: opportunity/customer context is prefilled.
- Any record → Create Task/Meeting/Note: source record is pre-linked.

Context defaults are server-validated hints, never a substitute for authorization.

### 3.5 Full pages remain first-class

Existing `/new` and `/edit` pages are not legacy to delete. They remain the complete/advanced workflow. Quick Create and inline editing are additional entry points sharing the same domain validation/mutation contracts.

## 4. Architecture principle

Retain the current architecture:

```text
Next.js / React
      ↓
FastAPI domain APIs
      ↓
Domain services / repositories
      ↓
PostgreSQL

Redis + Celery
External provider adapters
CRM events / automation infrastructure
```

Do not migrate to Frappe Framework. Do not replace explicit SQLAlchemy domain models with a universal metadata database, and do not replace domain APIs with generic CRUD.

## 5. Stable workspace shell vs configurable data layout

The Record Workspace has a product-owned shell and tenant/user-configurable data regions.

### Stable product shell

Keep these capabilities stable and permission-aware:

- record header/identity;
- primary workflow actions;
- Activity;
- Email;
- WhatsApp;
- Calls;
- Tasks/meetings/follow-ups;
- Files;
- Audit history.

An administrator should not accidentally remove Activity or Audit from the product by dragging fields around.

### Configurable layout surfaces

Layout metadata controls:

- `quick_create`;
- `detail`;
- `full_form`.

It can control constrained properties such as sections, field order, main/sidebar placement, width, visibility, collapse state, and safe defaults. It must not contain JSX, HTML, CSS, Python, JavaScript, or executable expressions.

Resolution order is:

```text
system/domain constraints
        ↓
permissions + module/field enablement
        ↓
tenant default layout
        ↓
optional role/team override
        ↓
user preference override
        ↓
resolved render layout
```

A lower layer may personalize presentation but can never reveal a forbidden field, make a system-required field disappear from a required creation flow, or bypass read-only constraints.

## 6. WhatsApp product decision — preserve both modes

The existing click-to-chat behavior is a supported product mode and must not be removed when Meta WhatsApp Cloud API support is added.

Target modes:

1. `external_link` — current/fallback workflow, opens WhatsApp using `wa.me`; no claim that conversation content is synchronized into CRM.
2. `meta_cloud_api` — optional configured provider for in-CRM sending/receiving, delivery state, templates, conversation history, and activity linkage. This can incur provider/Meta costs.
3. `ask_each_time` — when both are available, let the user choose for the action.

Tenant administrators configure which modes are enabled/default. A user preference may select their preferred mode when tenant policy permits. Even with Meta configured, `external_link` remains available unless an administrator explicitly disables it by policy.

Do not hardcode pricing or messaging-policy windows into static product assumptions. At implementation time, Codex must verify current official Meta requirements and model policy-sensitive behavior as configuration/provider capability where feasible.

## 7. Non-goals

Codex must not:

- rewrite FastAPI/SQLAlchemy/PostgreSQL/Celery architecture;
- copy Frappe source code;
- introduce arbitrary tenant-supplied Python/JavaScript;
- remove canonical `/new` or `/edit` routes merely because Quick Create exists;
- convert every form to a modal/drawer;
- break current `wa.me` WhatsApp behavior;
- create a duplicate WhatsApp domain rather than evolving/reusing the existing module;
- weaken tenant scoping or backend permissions;
- delete broader CRM/ERP modules to resemble Frappe;
- mix immutable audit history into the salesperson activity feed;
- put Gmail/Meta/Twilio-specific business logic directly into Lead/Opportunity React pages;
- build one giant cross-roadmap PR.

## 8. Workstreams

| File | Outcome |
|---|---|
| `00-product-ux-foundation.md` | Adaptive surfaces, Quick Create, contextual defaults, inline-edit conventions |
| `01-record-workspace.md` | Reusable record-centric Lead workspace, then Contact/Organization/Opportunity |
| `02-communications-activity.md` | Unified human/business activity projection separate from audit |
| `03-email-integration.md` | Contextual in-app email using existing mail providers and thread linkage |
| `04-pipelines-kanban.md` | Tenant-configurable pipelines/stages and list/Kanban parity |
| `05-relationships-data-model.md` | Richer explicit relationship graph and multi-contact Opportunities |
| `06-whatsapp-business.md` | Preserve click-to-chat + optionally add Meta Cloud API/in-CRM conversations |
| `07-telephony.md` | Provider-neutral calling, logs, caller context, optional recordings |
| `08-webhooks-events.md` | Secure outbound webhooks based on existing CRM event infrastructure |
| `09-customization-metadata.md` | Field types, layout resolver/builder, tenant/team/role/user layout customization |
| `10-dx-ci-api-contracts.md` | Guardrails, generated frontend contracts, module metadata consolidation |

## 9. Revised execution order

The newer UX decisions are higher priority than the original research sequence.

### Wave 0 — safety and UX foundations

1. Read/implement only the immediate guardrail portions of `10-dx-ci-api-contracts.md`.
2. Implement `00-product-ux-foundation.md` primitives and conventions.
3. Implement **Phase 1–2 only** of `09-customization-metadata.md` so Quick Create/detail layouts have a real resolver instead of becoming another hardcoded frontend layer.

### Wave 1 — core CRM work surface

4. Complete Quick Create rollout for Lead, Contact, Organization, and quick Opportunity.
5. Implement `01-record-workspace.md`, beginning with Lead.
6. Complete detail-layout integration and safe user layout personalization from `09-customization-metadata.md`.

### Wave 2 — communication core

7. Implement `02-communications-activity.md`.
8. Implement `03-email-integration.md`.

### Wave 3 — sales workflow and relationships

9. Implement `04-pipelines-kanban.md`.
10. Implement `05-relationships-data-model.md`.

### Wave 4 — omnichannel

11. Implement `06-whatsapp-business.md` without removing external click-to-chat.
12. Implement `07-telephony.md`.

### Wave 5 — platform expansion

13. Implement `08-webhooks-events.md`.
14. Finish advanced portions of `09-customization-metadata.md` and `10-dx-ci-api-contracts.md`.

## 10. Shared implementation rules

### Inspect before modifying

Read root `AGENTS.md`, then scoped `backend/AGENTS.md` / `frontend/AGENTS.md` and relevant `.codex/skills/`. Verify every referenced path against current `main`; names in these documents are architectural guidance unless marked as confirmed current code.

### Reuse before replacing

Before creating a new event model, permission helper, HTTP client, retry mechanism, preference model, provider status model, attachment model, activity entity, or UI primitive, search for an existing equivalent and extend it when safe.

### Tenant isolation

Every tenant-owned query and mutation must be tenant-scoped. Tests must prove tenant A cannot read or mutate tenant B configuration, activity, communications, layouts, pipelines, webhooks, or relationships.

### Permissions

UI hiding is not authorization. APIs must enforce action permissions and field-sensitive access where applicable.

### Migrations

Every schema change must document and test:

- clean installation;
- upgrade from current supported schema;
- data backfill;
- indexes and constraints;
- compatibility period;
- rollback limitations.

### Incremental slices

One workstream can contain multiple phases. Implement one phase at a time. Do not automatically continue into the next numbered file.

## 11. Cross-workstream UX requirements

Every affected surface must define:

- loading state;
- empty state;
- validation state;
- permission-denied state;
- integration-disconnected state where relevant;
- provider failure/retry state where relevant;
- mobile/narrow viewport behavior;
- keyboard/focus behavior for overlays;
- unsaved-change behavior for long forms;
- optimistic update rollback where used.

## 12. Cross-workstream tests

### Backend

- unit/service tests;
- API tests;
- authorization tests;
- tenant-isolation tests;
- validation tests;
- idempotency/provider failure tests where applicable.

### Database

- clean migration;
- upgrade migration;
- populated-data backfill;
- indexes for high-volume activity/communication queries.

### Frontend

- lint/type/build;
- component/domain tests where useful;
- responsive states;
- critical Playwright smoke flows.

### Integration examples

```text
Lead quick create → record workspace → contextual email → inbound reply → Lead activity
```

```text
Organization → contextual Contact create → contextual Opportunity create → Kanban stage move
```

```text
WhatsApp external mode → wa.me remains usable
Meta mode → inbound message → Contact match → conversation → Activity
```

```text
Incoming call → record match → CallLog → Activity
```

## 13. Definition of done for the initiative

The initiative is successful when users can do routine CRM work from the relationship context with minimal navigation, while complex workflows still have focused full-page surfaces; administrators can define sensible default layouts; users can personalize safe presentation details; communications are linked deterministically; integrations remain optional/provider-neutral; and the existing multi-tenant/permission architecture is stronger rather than bypassed.
