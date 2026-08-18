# 05 — CRM Relationships and Data Model

## 1. Objective

Strengthen explicit relationships among Organizations, Contacts, Leads, Opportunities, communications, tasks, documents, quotes, orders, and support records so the workspace can represent real buying relationships without repeated inference.

## 2. Why this exists

A single `contact_id` on an Opportunity is not enough for many B2B deals. A deal can involve a champion, decision maker, technical evaluator, procurement, finance, and legal contacts. The CRM should preserve that context and use it to improve communication and creation workflows.

## 3. Current behavior

Inspect:

- SalesContact/Organization/Lead/Opportunity models and repositories;
- Lead conversion flow;
- Opportunity create/edit/summary APIs;
- Quote/Order/Contract/IO links;
- tasks/documents/support record linking;
- duplicate/merge behavior;
- delete/restore semantics;
- existing primary contact and organization assumptions.

Document current cardinalities before altering schema.

## 4. Desired behavior

Conceptual relationship graph:

```text
Organization
 ├─ Contacts
 ├─ Leads
 ├─ Opportunities
 │   ├─ OpportunityContacts
 │   ├─ Quotes
 │   ├─ Orders
 │   ├─ Tasks
 │   ├─ Documents
 │   └─ Communications
 ├─ Quotes
 ├─ Orders
 ├─ Support
 └─ Documents
```

Opportunity contact association:

```text
OpportunityContact
- opportunity_id
- contact_id
- role_key
- is_primary
- created_at/by
```

Initial role semantics may include decision maker, champion, technical, finance, procurement, legal, influencer, other. Keep the catalog a typed sales-domain configuration. Prefer future configurability over baking display labels permanently into code, but do not move relationship invariants into generic layout metadata.

## 5. Existing code to inspect

Search every reader/writer of Opportunity `contact_id`, organization linkage, lead conversion, quote generation, mail recipient selection, exports/imports, reports, and API schemas.

## 6. Architecture

Relationships are explicit domain data, not frontend convenience metadata.

Maintain a primary-contact compatibility concept during migration, but model additional contacts in an association table. Domain services own invariants such as at most one primary contact if that remains required.

Do not build a universal “any record links to any record” table as a replacement for core typed relationships. Generic links can complement typed domain relations when necessary, not erase them.

## 7. Backend changes — phased

Phases 1–2 are separate Wave 2 slices and both are prerequisites for advanced Opportunity workspace and contextual communication-recipient work. They intentionally occur before the broader pipeline/communication rollout even though this file is numbered `05`.

### Phase 1 — OpportunityContact compatibility model

- add association model/repository/service;
- backfill current `contact_id` as primary association;
- serialize primary + participant contacts;
- keep legacy `contact_id` behavior temporarily.

### Phase 2 — role and participant APIs

- add/remove participant;
- change role;
- mark primary;
- enforce same tenant and contact visibility/link permissions;
- preserve history/audit for meaningful relationship changes.

### Phase 3 — conversion and downstream propagation

Update Lead conversion and Quote/Order creation to carry explicit relationship context without blindly copying every contact.

### Phase 4 — relationship summaries

Expose optimized relationship context for Record Workspace without leaking unauthorized related modules.

## 8. Database changes

Add association indexes/uniqueness. Consider:

- unique `(opportunity_id, contact_id)`;
- partial/conditional uniqueness for one primary if supported/appropriate;
- tenant denormalization only if needed for safe/efficient scope, otherwise validate through parent relations consistently;
- soft-delete/history semantics matching repository conventions.

Backfill must fail loudly if existing Opportunity contact references are invalid rather than silently losing them.

## 9. API contracts

Opportunity summary/detail should expose:

- organization;
- primary contact;
- participant contacts with role;
- safe relationship actions/capabilities.

Create/update APIs should keep compatibility while clients migrate. New association management endpoints should be explicit and permission-protected.

## 10. Frontend changes — phased

### Phase 1 — participant display

Opportunity workspace shows primary and additional contacts with role badges.

### Phase 2 — participant management

Use contextual pickers/Quick Create where appropriate. Avoid navigating to Contacts simply to add a participant.

### Phase 3 — contextual recipient selection

Email/WhatsApp actions can use participants as candidates while still requiring deliberate selection where multiple recipients exist.

### Phase 4 — broader relationship rail

Organization/Contact workspaces expose related opportunities, quotes/orders, tasks, documents, and communications with permission-aware counts/lists and contextual creation actions.

## 11. Permission model

Viewing a record does not automatically grant visibility into every related module. Association APIs require permission to view the Opportunity and view/link the Contact; create-new Contact additionally requires Contact create permission.

## 12. Tenant-isolation requirements

Every association must connect records in the same tenant. Add API/service tests for cross-tenant contact IDs and corrupted/malicious association attempts.

## 13. Background jobs/events

Relationship changes should emit/reuse domain events only where valuable for audit/automation, e.g. participant added/removed/primary changed. Avoid noisy events for derived display data.

## 14. Error/loading/empty states

- no Organization;
- no additional contacts;
- related record permission-hidden;
- contact deleted/soft-deleted;
- duplicate participant;
- attempting to remove current primary without choosing replacement when invariant requires one;
- role no longer active/configured.

## 15. Migration/backward compatibility

Preserve legacy primary contact field/API during migration. Existing integrations/imports should continue until they adopt participant lists. Document final deprecation/removal criteria rather than removing `contact_id` immediately.

## 16. Tests

- backfill existing contact as primary;
- add/remove/role/primary invariants;
- tenant isolation;
- permissions;
- lead conversion;
- quote/order relationship propagation;
- deleted/merged contacts;
- serialization compatibility;
- contextual Quick Create/link flows.

## 17. Acceptance criteria

An Opportunity can represent multiple participants and roles without breaking existing single-contact clients. Record workspaces show useful related context. Contextual actions can use explicit relationships rather than repeated email/phone inference.

## 18. Out of scope

- universal graph database;
- automatically inferring stakeholder roles from message content;
- removing compatibility fields in the first migration;
- making every relationship type administrator-scriptable.

## 19. Risks

- dual-write drift during compatibility;
- downstream assumptions about one contact;
- permission leakage through relationship summaries;
- merge/delete semantics becoming unclear;
- over-generalizing relationship storage.

## 20. Codex implementation instructions

Inventory all `contact_id`/organization assumptions first. Land and backfill the association model before UI management. Keep legacy behavior synchronized during the compatibility period and add tests that compare old primary-contact outputs with new association outputs.
