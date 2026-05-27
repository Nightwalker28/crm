# Task: Contracts and E-Sign Lifecycle

## Purpose

Add contract management as a first-class CRM module, with a provider-agnostic e-signature abstraction.

## What this task will accomplish

- Add contract records.
- Link contracts to organizations, contacts, opportunities, quotes, orders, and documents.
- Track contract lifecycle status.
- Add signer/party records.
- Add event history for contract milestones.
- Add placeholder provider abstraction for future e-sign integration.

## Backend files to create or modify

- Create `backend/app/modules/contracts/__init__.py`
- Create `backend/app/modules/contracts/models.py`
- Create `backend/app/modules/contracts/schema.py`
- Create `backend/app/modules/contracts/services/contracts_services.py`
- Create `backend/app/modules/contracts/routes/contracts_routes.py`
- Create `backend/app/modules/contracts/routes/router.py` if consistent
- Update `backend/app/api/v1/router.py`
- Integrate with `backend/app/modules/documents/*`
- Create Alembic migration
- Create backend tests

## Frontend files to create or modify

- Create `frontend/app/dashboard/contracts/page.tsx`
- Create `frontend/app/dashboard/contracts/[contractId]/page.tsx`
- Create `frontend/hooks/contracts/useContracts.ts`
- Create `frontend/components/contracts/*`
- Update `frontend/lib/routes.ts`
- Update `frontend/lib/moduleViewConfigs.ts`
- Update sidebar/module config if required

## Database changes

Create a migration for:

- `contracts`
  - `id`
  - `tenant_id`
  - `contract_number`
  - `title`
  - `status`
  - `organization_id` nullable
  - `contact_id` nullable
  - `opportunity_id` nullable
  - `quote_id` nullable
  - `order_id` nullable
  - `document_id` nullable
  - `effective_date` nullable
  - `expiration_date` nullable
  - `renewal_date` nullable
  - `value_amount` nullable
  - `currency` nullable
  - `owner_id` nullable
  - `created_by_id`
  - `created_at`
  - `updated_at`

- `contract_parties`
  - `id`
  - `tenant_id`
  - `contract_id`
  - `name`
  - `email`
  - `role`
  - `created_at`

- `contract_signers`
  - `id`
  - `tenant_id`
  - `contract_id`
  - `party_id` nullable
  - `name`
  - `email`
  - `signing_order`
  - `status`
  - `signed_at` nullable
  - `created_at`

- `contract_events`
  - `id`
  - `tenant_id`
  - `contract_id`
  - `event_type`
  - `payload_json`
  - `created_by_id` nullable
  - `created_at`

## API changes

- Contract CRUD
- Contract status transitions
- Add/list signers
- Add/list events
- Link document to contract

## UI changes

- Contract list page.
- Contract detail page.
- Status timeline.
- Signer/party table.
- Related document panel.

## Validation

- Contract can be created and linked to CRM records.
- Status changes are recorded as events.
- Signer records can be added and updated.
- Permissions and tenant isolation are enforced.

## Do not implement

- Specific paid e-sign provider integration unless already present
- AI contract review
