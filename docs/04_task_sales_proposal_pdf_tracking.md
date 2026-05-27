# Task: Sales Proposal PDF Tracking

## Purpose

Upgrade quotes into a lightweight proposal flow with generated documents and engagement tracking.

## What this task will accomplish

- Generate a proposal document from a quote.
- Store proposal document metadata.
- Track proposal send/open/download events.
- Show proposal lifecycle on the quote detail page.

## Backend files to inspect and modify

- `backend/app/modules/sales/models.py`
- `backend/app/modules/sales/schema.py`
- `backend/app/modules/sales/services/quotes_services.py`
- `backend/app/modules/sales/routes/quotes_routes.py`
- `backend/app/modules/sales/services/summary_services.py`
- `backend/app/modules/documents/*`
- `backend/app/core/celery_app.py` if PDF generation is async
- `backend/alembic/versions/*`
- Backend tests for quotes/proposals

## Frontend files to inspect and modify

- `frontend/app/dashboard/sales/quotes/[quoteId]/page.tsx`
- `frontend/components/quotes/*`
- `frontend/hooks/sales/*quotes*`

## Database changes

Create a migration for:

- `sales_quote_documents`
  - `id`
  - `tenant_id`
  - `quote_id`
  - `document_id` nullable if linked to existing documents module
  - `template_name`
  - `status`
  - `generated_at`
  - `sent_at`
  - `sent_to`
  - `created_by_id`
  - `created_at`
  - `updated_at`

- `sales_quote_open_events`
  - `id`
  - `tenant_id`
  - `quote_id`
  - `quote_document_id`
  - `event_type`: `opened`, `downloaded`, `viewed`
  - `recipient_email`
  - `ip_hash` nullable
  - `user_agent_hash` nullable
  - `occurred_at`

## Implementation notes

Start with one default proposal template generated from quote fields. Avoid building a full template designer in this task.

Use existing document storage if possible. If not, store generated output metadata now and leave storage abstraction for the documents-versioning task.

## API changes

Add endpoints under existing quote routes if consistent:

- `POST /quotes/{quote_id}/proposal/generate`
- `POST /quotes/{quote_id}/proposal/send`
- `GET /quotes/{quote_id}/proposal/events`
- Public/signed endpoint for proposal view/open tracking

## UI changes

On quote detail:

- Generate proposal button
- Send proposal button
- Proposal status card
- Event timeline showing generated/sent/opened/downloaded

## Validation

- Proposal can be generated from an existing quote.
- Generated proposal links back to quote.
- Sending records sent status.
- Open/download events are recorded.
- Quote detail UI displays proposal status and event history.
- Permissions prevent unauthorized access.

## Do not implement

- Full contract signing
- E-signature workflow
- AI proposal drafting
