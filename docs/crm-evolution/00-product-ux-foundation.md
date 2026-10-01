# 00 — Product UX Foundation: Adaptive Surfaces, Quick Create, Contextual Actions

## 1. Objective

Establish a reusable 2026 CRM interaction architecture before redesigning individual modules. Preserve complete full-page forms while adding faster contextual workflows for routine actions.

Primary outcomes:

- semantic `QuickCreateSurface` behavior;
- progressive-disclosure creation;
- contextual relationship defaults;
- safe inline editing for frequent properties;
- consistent modal vs quick surface vs full-page rules;
- responsive/mobile behavior;
- a Lead pilot followed by Contact/Organization/Opportunity rollout.

## 2. Why this exists

The current CRM has good full-page creation foundations, but common create actions frequently navigate away from the user’s current list/record context. For example, Leads list creation routes to `/dashboard/sales/leads/new`, and the full Lead form captures identity, contact, qualification, ownership, follow-up, tags, notes, and custom fields.

That full form is valuable for detailed entry. It should not be the only path for capturing a basic record.

Frappe’s Quick Entry validates the product principle that simple CRM capture can happen before entering the full record. MAAD/Lynk deliberately improves on that with an adaptive/contextual surface rather than copying a universal centered dialog.

## 3. Current behavior to inspect

Confirmed starting points include:

- `frontend/app/dashboard/sales/leads/page.tsx`
- `frontend/app/dashboard/sales/leads/new/page.tsx`
- `frontend/components/leads/LeadRecordFormPage.tsx`
- `frontend/components/leads/LeadFormFields.tsx`
- `frontend/components/forms/RecordFormLayout.tsx`
- equivalent Contact/Organization/Opportunity list/new/form components;
- existing `Dialog`, `Sheet`, popover, responsive, form, toast, and focus-management primitives;
- existing module field/custom field hooks;
- existing saved-view/filter state;
- existing API mutation/query invalidation patterns.

Do not assume a new UI dependency is required. Reuse existing component primitives where they satisfy accessibility and behavior requirements.

## 4. Desired behavior

### 4.1 Interaction matrix

Use these defaults:

| Intent | Surface |
|---|---|
| change stage/owner/priority/date/tag | inline/popover |
| confirm deletion/merge/irreversible action | modal |
| quick Lead/Contact/Organization | Quick Create |
| quick Opportunity | larger Quick Create |
| create related record from record context | contextual Quick Create |
| full entity data entry | canonical `/new` page |
| advanced editing | canonical `/edit` page |
| Quote/Order/Contract/IO/invoice-like transactional work | full page |

### 4.2 Adaptive Quick Create

Desktop: side panel that preserves visible list/record context.  
Mobile/narrow: full-height/full-screen sheet.  
The component contract is semantic; do not encode “right drawer” into domain APIs.

### 4.3 Creation outcomes

Where appropriate provide:

- **Create**: save and stay in current context; close surface; refresh/inject record.
- **Create & open**: save and open record workspace.
- **More details**: move to full creation route.

If preserving partially entered values across “More details” can be done safely without storing secrets in URLs, implement a short-lived client-side draft handoff. Otherwise keep the behavior simple and documented rather than inventing insecure serialization.

### 4.4 Contextual defaults

A Quick Create invocation may pass a typed context:

```ts
type QuickCreateContext = {
  sourceModuleKey?: string;
  sourceEntityId?: string | number;
  defaults?: Record<string, unknown>;
  relationshipIntent?: string;
}
```

Do not trust these values for authorization. The server validates that linked records exist in the same tenant and that the user may create/link them.

## 5. Architecture

Separate:

1. **surface shell** — accessibility, responsive presentation, close behavior;
2. **layout resolution** — which fields/sections appear;
3. **form state/validation** — domain-specific fields and client validation;
4. **mutation** — calls the same backend create API as full create where practical;
5. **post-create outcome** — stay/open/return record;
6. **context defaults** — prefill relationships without duplicating mutation logic.

Conceptual frontend boundaries:

```text
QuickCreateSurface
  └─ ResolvedQuickCreateForm
       ├─ layout resolver
       ├─ domain field renderer
       ├─ custom fields
       ├─ validation
       └─ shared create mutation
```

Do not build a universal generic CRUD form that erases domain behavior. Metadata chooses presentation; domain components/services still own business-specific validation and transformations.

## 6. Backend changes

Phase 1 should require minimal backend changes unless current create APIs cannot accept contextual relationships cleanly.

When changes are required:

- keep explicit domain endpoints;
- validate linked IDs under current tenant;
- enforce create/link permissions;
- return stable created-record identity;
- return field-level validation information where feasible so Quick Create can focus the correct input;
- do not create a separate “quick create API” if it would duplicate normal creation rules.

## 7. Database changes

No database change is required merely to render a Quick Create surface.

The layout metadata database work belongs to `09-customization-metadata.md` and should be implemented before broad rollout.

## 8. API contracts

Prefer sharing the normal creation contract. If quick creation has fewer fields, omission/default semantics must be explicit and compatible with full creation.

Do not make frontend-only “required” assumptions that disagree with the backend.

## 9. Frontend changes — phased

### Phase 1 — interaction primitives

Build/reuse:

- `QuickCreateSurface` semantic wrapper;
- responsive desktop/mobile behavior;
- accessible title/description/focus trap/return focus;
- escape/close behavior with dirty-state confirmation when required;
- visible/unobscured focus, reduced-motion behavior, and WCAG 2.2 target sizing;
- standardized footer actions;
- loading/error/field-validation region;
- mutation pending state that prevents duplicate submit;
- optional `QuickEditPopover`/inline-edit convention, not necessarily a universal component.

Acceptance gate: behavior tests prove keyboard/focus behavior, reduced motion, and responsive desktop/narrow rendering without any sales-module migration. Visual inspection or a component existing in source is not sufficient acceptance.

### Phase 2 — Lead pilot

Replace the Lead list’s primary create interaction with Quick Create while keeping `/dashboard/sales/leads/new` working.

Quick fields come from the resolved `quick_create` layout. Seed a sensible default roughly equivalent to:

- first name;
- last name;
- primary email (required if current domain requires it);
- phone;
- company;
- owner;
- status/source only when selected by layout policy.

Do not hardcode “these seven fields forever.”

Requirements:

- opening Quick Create preserves list search/filter/saved-view/pagination state;
- `Create` closes and refreshes list without resetting view state;
- `Create & open` opens new Lead workspace/detail route;
- `More details` opens canonical `/new`;
- custom fields can participate when included by layout and supported by renderer;
- duplicate/error responses are clear;
- close with unsaved data is protected.

### Phase 3 — Contact, Organization, Opportunity + contextual creation

Apply the proven primitive to:

- Contact;
- Organization;
- quick Opportunity.

Add context-aware entry points from relevant record pages.

Examples:

```text
Organization → + Contact
  organization prefilled and visibly locked/adjustable according to intent
```

```text
Contact → + Opportunity
  contact and organization prefilled
```

```text
Opportunity → + Task
  source module/entity pre-linked
```

Do not add Quick Create to complex transaction documents simply for visual consistency.

### Phase 4 — frequent inline edits

After Record Workspace primitives exist, migrate high-frequency safe edits such as:

- owner;
- status/stage;
- priority;
- expected close/due date;
- probability;
- tags.

Each inline edit must:

- use backend permission/business validation;
- expose pending state;
- roll back optimistic UI on failure;
- show validation/errors close to the control;
- not silently discard concurrent updates if concurrency checks exist/are introduced.

Keep full `/edit` as Advanced Edit.

## 10. Permission model

Quick Create visibility follows create permission for the target module. Contextual relationship selectors/defaults follow both target creation rights and permission to view/link the source/related record.

Inline edit requires the same backend edit permission/business checks as full edit.

Do not assume a hidden button is sufficient authorization.

## 11. Tenant isolation

Tests must cover malicious cross-tenant IDs in contextual defaults/link fields. A tenant A user must not create a tenant A record linked to tenant B Contact/Organization/Opportunity/Task/etc.

## 12. Background jobs/events

Creation and inline edit should trigger the same domain events/automation behavior as canonical create/edit. Do not create a second event path for Quick Create.

## 13. Error/loading/empty states

Define:

- layout loading skeleton;
- no-config fallback to seeded/system layout;
- field validation;
- create API failure;
- stale related-record selection;
- permission revoked while surface is open;
- network failure with entered values retained;
- user closes while request is pending;
- integration-specific fields unavailable.

## 14. Migration/backward compatibility

- Keep all current routes.
- Keep current forms usable.
- Add Quick Create incrementally per module.
- Existing bookmarks/deep links continue to work.
- Do not change backend requiredness just to make the quick form shorter; instead choose fields/defaults that can create a valid record.

## 15. Tests

Frontend:

- surface accessibility/focus;
- desktop/mobile render behavior;
- dirty close guard;
- Create vs Create & open;
- list state preservation;
- layout field order/visibility;
- contextual defaults;
- permission-disabled actions;
- optimistic inline rollback.

Backend/API:

- create permissions;
- relationship tenant validation;
- required fields;
- equivalent business rules across Quick Create and full create.

Playwright smoke:

1. filter Leads;
2. open Quick Create;
3. create Lead;
4. confirm filter remains and record appears or is reachable;
5. create/open route works.

## 16. Acceptance criteria

- A user can create a basic Lead without leaving the Leads list.
- Full Lead creation remains available.
- Quick Create is adaptive on mobile.
- Contextual related creation does not ask for relationships the CRM already knows.
- Quick Create fields are layout-driven after the layout foundation lands.
- Complex transactional workflows remain full-page.
- Inline edits never weaken server authorization.

## 17. Out of scope

- replacing all forms with metadata-generated generic forms;
- redesigning Email/WhatsApp/telephony internals;
- removing dedicated edit pages;
- arbitrary workflow scripting;
- Quick Create for every module.

## 18. Risks

- duplicate form logic between quick/full surfaces;
- over-customized Quick Create becoming a full form in a panel;
- losing list state on query invalidation/router changes;
- inconsistent required-field rules;
- contextual IDs becoming an authorization bypass;
- overlay focus/scroll issues on mobile.

Mitigate by shared domain field/mutation code, layout complexity warnings, and explicit API tests.

## 19. UX guardrails for administrators

The layout builder should show guidance when a Quick Create layout becomes too large, for example more than ~8 visible fields or multiple long-text/file sections. This is guidance, not an arbitrary hard failure unless technical limits require one.

Offer preview modes for desktop and mobile.

## 20. Codex implementation instruction

Implement one phase at a time. Inspect existing primitives first. Do not introduce a new UI library solely to get a drawer. Do not remove or rewrite the canonical form pages. Before finishing, verify permissions, tenant linkage, accessibility, dirty-state handling, responsive behavior, and current repository checks.
