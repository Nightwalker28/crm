# 09 — Customization Metadata and Record Layouts

## 1. Objective

Evolve the CRM from field-enable/disable customization into a safe, metadata-driven layout system where administrators define default Quick Create, Details, and Full Form layouts and users can personalize permitted presentation choices such as visibility, ordering, and collapsed sections.

This is a **high-priority foundation**, not a late cosmetic feature, because Quick Create and Record Workspace should consume the same resolved layout model rather than hardcoding another generation of screens.

## 2. Why this exists

The repository already has useful building blocks:

- module field configuration hooks;
- custom fields;
- settings pages for fields/module builder/modules;
- `UserTablePreference` with per-user visible columns;
- `UserDashboardLayout`;
- `UserSavedView`.

The next step is to make record presentation configurable while preserving domain rules, permissions, and reusable UI behavior.

## 3. Current behavior

Inspect:

- `frontend/hooks/useModuleFieldConfigs*`;
- `frontend/hooks/useModuleCustomFields*`;
- `frontend/app/dashboard/settings/fields/page.tsx`;
- `frontend/app/dashboard/settings/module-builder/page.tsx`;
- module management settings;
- `frontend/components/forms/RecordFormLayout.tsx`;
- Lead/Contact/Organization/Opportunity form/detail field renderers;
- `backend/app/modules/user_management/models.py` preference models;
- platform custom field/module definition models/services;
- permissions/field enablement conventions;
- saved view/table preference APIs.

Document where “enabled”, “required”, “read-only”, custom field type, and permission are currently defined.

## 4. Desired behavior

Three primary layout surfaces:

```text
quick_create
 detail
 full_form
```

Conceptual constrained metadata:

```ts
type RecordLayoutDefinition = {
  id: string | number
  moduleKey: string
  surface: "quick_create" | "detail" | "full_form"
  name: string
  scopeType: "tenant" | "role" | "team"
  scopeId?: string | number
  isDefault: boolean
  version: number
  sections: LayoutSection[]
}

type LayoutSection = {
  id: string
  label: string
  position: number
  region: "main" | "sidebar"
  collapsedByDefault?: boolean
  fields: LayoutField[]
}

type LayoutField = {
  fieldKey: string
  position: number
  width: "full" | "half"
  visible: boolean
  requiredOverride?: boolean
  readonly?: boolean
  defaultValue?: unknown
}
```

Actual schema should follow repository conventions and should normalize data relationally vs JSON only where that materially improves validation/versioning. Do not blindly copy this TypeScript shape into the database.

### User preference layer

Personal customization must be safe and narrower than admin configuration. A user may be allowed to:

- show/hide fields that policy marks user-customizable;
- reorder fields/sections;
- choose main/sidebar placement only when allowed;
- change collapsed/expanded defaults;
- reset to team/role/tenant default.

A user must **not** be able to:

- reveal a field they lack permission to view;
- hide a system-required field from a required creation surface;
- make a server-read-only field writable;
- override tenant compliance restrictions;
- inject HTML/CSS/JS/expressions.

## 5. Existing code to inspect

Prefer extending current field definitions and user preference infrastructure rather than creating parallel registries. Verify whether table/dashboard preference services already provide patterns for tenant+user ownership, optimistic saves, reset/default behavior, and JSON validation.

## 6. Architecture

### 6.1 Field definition vs layout

Keep concerns separate:

```text
Field Definition
  - key/type/domain requiredness
  - custom/system field identity
        │
        ├─ module enabled/disabled
        ├─ permissions
        └─ layout metadata
              ├─ Quick Create
              ├─ Detail
              └─ Full Form
```

Layout does not redefine the field’s underlying data type or domain behavior.

### 6.2 Resolution pipeline

Implement one server/service resolution rule:

```text
system field/domain constraints
          ↓
module/field enablement
          ↓
permission/read-only constraints
          ↓
tenant default layout
          ↓
matching role/team override (deterministic precedence)
          ↓
user preference overlay
          ↓
validated resolved layout
```

If both role and team overrides are supported, define and test a stable precedence. Do not let frontend merge them ad hoc.

### 6.3 Stable product shell

Layout metadata controls record data/details regions. It does not remove product-level capabilities such as Activity, Email, WhatsApp, Calls, Tasks, Files, or Audit unless a separate capability/module configuration explicitly governs them.

## 7. Backend changes — phased

### Phase 1 — layout definitions + resolver (Wave 0 priority)

Add/reuse models for tenant layout definitions and service to resolve a surface for `(tenant, user, module, surface)`.

Requirements:

- validated module key/surface;
- unique/default rules;
- stable section/field order;
- field keys validated against system + custom field definitions;
- impossible configuration rejected (e.g. hiding current system-required create field from every quick-create path);
- fallback generated from current form/detail behavior when no stored layout exists;
- version field for optimistic concurrency/migrations.

Seed default layouts for Lead first, then Contact/Organization/Opportunity before each module adopts the renderer.

### Phase 2 — tenant admin CRUD + preview (Wave 0 priority)

Admin/configure APIs:

- get effective/default layout;
- create/update layout;
- duplicate layout;
- reset to system default;
- validate/preview without publishing;
- publish/activate layout if draft/published model is adopted.

Return validation warnings separately from blocking errors. Example warning: Quick Create has many visible fields and may no longer be “quick.”

### Phase 3 — team/role overrides

Allow targeted defaults only after tenant default behavior is stable.

Rules:

- override only selected layout properties or store a complete derived layout with explicit base/version—choose one model and avoid ambiguous merge semantics;
- deterministic role vs team precedence;
- admin can preview effective layout for a sample role/team/user;
- deleting override falls back cleanly.

### Phase 4 — user preferences

Add a user-owned preference overlay, conceptually similar to current table/dashboard preferences.

Suggested user preference key:

```text
(user_id, module_key, surface)
```

Store only allowed presentation deltas where practical, not a complete copy of tenant layout. Include base layout version so stale preferences can be reconciled/reset when admin changes structure.

User APIs:

- get effective layout + source metadata;
- save allowed personal layout preferences;
- reset current surface;
- reset all personal record-layout preferences for module.

### Phase 5 — custom field type expansion

Extend supported custom field types based on current architecture and use cases:

- text;
- long text;
- integer;
- decimal;
- currency;
- boolean;
- date;
- datetime;
- email;
- phone;
- URL;
- select;
- multi-select;
- user reference;
- record reference;
- file.

Each type requires explicit validation, serialization, filtering/sorting support policy, import/export behavior, and renderer. Do not add types merely to list them in UI.

### Phase 6 — declarative custom actions (later)

Controlled actions may reference existing safe actions/automations:

```json
{
  "label": "Request approval",
  "visible_when": {"stage.semantic_type": "ongoing"},
  "action": {"type": "automation", "automation_key": "request_deal_approval"}
}
```

Use a constrained condition grammar. Do not execute arbitrary tenant JavaScript/Python.

## 8. Database changes

Exact schema must follow current repository patterns, but must support:

- tenant ownership;
- module/surface;
- scope type/id for defaults/overrides;
- versioning;
- ordered sections/fields or validated JSON structure;
- user preference overlays;
- timestamps/actor where auditability requires;
- indexes for `(tenant,module,surface)` and `(user,module,surface)`.

Migrations should seed/fallback rather than make current forms unusable before configurations exist.

## 9. API contracts

Separate admin management from runtime resolution.

Suggested runtime endpoint:

```text
GET /api/v1/record-layouts/{module_key}/{surface}/resolved
```

Response should include:

- resolved sections/fields;
- field display/type metadata needed by renderer;
- source/version info;
- `can_customize` flags;
- warnings if relevant;
- never permission-forbidden fields.

Admin endpoints can expose underlying definitions/overrides with configure permission.

User preference mutation endpoint accepts only permitted deltas and server revalidates them against current base layout and permission policy.

## 10. Frontend changes — phased

### Phase 1 — runtime renderer

Build a constrained renderer shared by the three surfaces where appropriate. Avoid a single giant generic form component; domain field adapters still handle specialized behavior.

The renderer must support:

- ordered sections;
- main/sidebar region;
- full/half width;
- hidden fields;
- collapsed sections;
- custom field renderers;
- read-only/display formatting;
- validation messages;
- responsive stacking.

### Phase 2 — admin layout builder

Create a visual builder in Settings with:

- module selector;
- surface tabs: Quick Create / Details / Full Form;
- visible canvas with sections;
- hidden/available field palette;
- drag reorder;
- move field between sections/regions;
- full/half width controls;
- collapsed-default control;
- required/read-only indicators;
- system-locked fields with explanation;
- desktop/mobile preview;
- validation/errors/warnings;
- save/publish/reset.

Quick Create shows guidance such as “Recommended 5–8 fields” and warns on long-text/files/many sections without arbitrarily blocking a valid tenant workflow.

### Phase 3 — Record Workspace Details

Replace hardcoded details ordering with resolved `detail` layout while retaining stable workspace shell.

### Phase 4 — Full Create/Edit

Adopt `full_form` layout where it can reuse current domain form field components without losing specialized validation. Preserve canonical routes.

### Phase 5 — personal customization UI

From a record/details or preferences menu, user can choose **Customize my layout** and change only allowed presentation properties.

Recommended experience:

```text
Customize Details
- drag fields to reorder
- hide/show allowed fields
- collapse sections
- reset to workspace default
```

Show “Managed by workspace” for locked fields/sections. Provide “Preview” and a clear reset action.

Do not expose full admin builder complexity to ordinary users.

## 11. Permission model

### Admin/configuration

Creating/changing tenant/team/role layouts requires appropriate module/platform configure permission.

### User personalization

Personal preference is presentation only. Server calculates allowed fields from effective permissions and policy before applying preference.

Rendering rule:

```text
field exists
AND field enabled
AND user may view it
AND effective layout says visible
AND user preference does not safely hide it
→ render
```

For required Quick Create fields, user preference cannot hide them.

## 12. Tenant-isolation requirements

Layouts and preferences are tenant-safe. User preference APIs must verify current user owns preference and module belongs/is enabled for their tenant. Team/role scope IDs must belong to same tenant.

Tests must attempt cross-tenant layout IDs, team IDs, role IDs, custom field keys, and preference updates.

## 13. Background jobs/events

Layout changes do not need heavy background processing. Emit audit/configuration events through existing platform logging. If many user preferences need reconciliation after a base layout migration, prefer lazy reconciliation on resolution unless a bounded migration is clearly safer.

## 14. Error/loading/empty states

Runtime:

- layout request loading;
- stored layout invalid due stale field → resolver safely omits/quarantines and logs warning;
- no config → system fallback;
- permission changes → forbidden field disappears;
- custom field deleted → builder shows missing reference and requires cleanup.

Builder:

- unsaved changes;
- concurrent admin update/version conflict;
- system-required field moved/hidden invalidly;
- Quick Create complexity warning;
- no custom fields;
- role/team deleted;
- preview differs due permissions.

User customization:

- base layout changed since preference saved;
- reset to workspace default;
- user tries to reveal locked/forbidden field → server rejects.

## 15. Migration/backward compatibility

- existing forms/details remain fallback renderers until module layout adoption;
- seed/default layouts mirror current behavior first;
- migrate module-by-module;
- current `useModuleFieldConfigs` and custom field behavior remain authoritative inputs rather than being deleted;
- user table/dashboard/saved-view preferences remain unchanged;
- personal record-layout preferences are additive.

## 16. Tests

Backend:

- resolver precedence;
- system-required field protection;
- permission intersection;
- tenant/team/role/user isolation;
- stale field handling;
- base version + user override reconciliation;
- admin configure permission;
- custom field validation.

Frontend:

- drag/drop/reorder;
- hide/show;
- main/sidebar placement;
- desktop/mobile preview;
- system-locked field behavior;
- warnings;
- user simplified customization;
- reset behavior;
- runtime form/detail order.

Playwright:

1. admin changes Lead Quick Create order;
2. user sees new order;
3. user personalizes permitted Details order;
4. user cannot expose admin/permission-hidden field;
5. reset restores effective tenant/team/role default.

## 17. Acceptance criteria

- Quick Create, Details, and Full Form have independent configurable layouts.
- Tenant admins control defaults.
- Role/team overrides can be introduced without ambiguity.
- Users can personalize allowed presentation/order/visibility and reset preferences.
- No layout can bypass permissions/domain-required/read-only constraints.
- Custom fields participate naturally.
- Record Workspace shell remains stable.
- Existing routes/forms continue to work during migration.

## 18. Out of scope

- arbitrary HTML/CSS/JS/Python;
- letting users redesign workflow-critical Activity/Audit shell;
- universal no-code database/schema replacement;
- arbitrary SQL/formulas without a separate safe expression design;
- user overrides of tenant compliance rules.

## 19. Risks

- metadata becoming a second business-rule engine;
- complicated role/team/user merge semantics;
- stale user preferences after admin layout changes;
- generic renderer losing domain-specific UX;
- admins creating overly long Quick Create layouts;
- permissions enforced only in frontend.

Mitigation: one server resolver, constrained schema, domain adapters, base versions, clear precedence, warnings, and strong tests.

## 20. Codex implementation instructions

Treat Phases 1–2 as early roadmap work and implement them before broad Quick Create rollout. Inspect existing field and user preference services first. Build one resolver; do not merge layouts independently in multiple React components. Seed a Lead layout matching current behavior, then prove Quick Create + Details integration before expanding. Implement user personalization only after tenant defaults are stable, and keep personal capabilities deliberately narrower than admin configuration.
