# Task: Sales Quote to Order

## Purpose

Allow accepted quotes to become order records so the CRM can track post-quote revenue flow.

## What this task will accomplish

- Add sales order and order item models.
- Add conversion from quote to order.
- Prevent duplicate quote conversion unless explicitly allowed by business rules.
- Add order list/detail UI.
- Add activity/audit events for conversion.

## Backend files to inspect and modify

- `backend/app/modules/sales/models.py`
- `backend/app/modules/sales/schema.py`
- `backend/app/modules/sales/routes/quotes_routes.py`
- `backend/app/modules/sales/services/quotes_services.py`
- Create `backend/app/modules/sales/services/orders_services.py`
- Create `backend/app/modules/sales/routes/orders_routes.py`
- `backend/app/api/v1/router.py`
- `backend/alembic/versions/*`
- Backend tests for quote conversion/orders

## Frontend files to inspect and modify

- `frontend/app/dashboard/sales/quotes/[quoteId]/page.tsx`
- Create `frontend/app/dashboard/sales/orders/page.tsx`
- Create `frontend/app/dashboard/sales/orders/[orderId]/page.tsx`
- `frontend/lib/routes.ts`
- `frontend/lib/moduleViewConfigs.ts`
- Create `frontend/hooks/sales/useOrders.ts`
- Create `frontend/components/orders/*`

## Database changes

Create a migration for:

- `sales_orders`
  - `id`
  - `tenant_id`
  - `order_number`
  - `quote_id` nullable but unique when present
  - `organization_id` nullable
  - `contact_id` nullable
  - `opportunity_id` nullable
  - `status`
  - `currency`
  - `subtotal`
  - `tax_total`
  - `discount_total`
  - `grand_total`
  - `owner_id`
  - `created_by_id`
  - `created_at`
  - `updated_at`

- `sales_order_items`
  - `id`
  - `tenant_id`
  - `order_id`
  - `name`
  - `description`
  - `quantity`
  - `unit_price`
  - `discount_amount`
  - `tax_amount`
  - `line_total`
  - `sort_order`

- `sales_quote_order_links` optional if one-to-many history is needed

## API changes

- `POST /quotes/{quote_id}/convert-to-order`
- `GET /orders`
- `POST /orders`
- `GET /orders/{order_id}`
- `PATCH /orders/{order_id}`

## UI changes

- Add convert button on accepted quote detail.
- Add order list page.
- Add order detail page.
- Add related order link on quote detail after conversion.

## Validation

- Accepted quote converts to order.
- Draft/rejected quote cannot convert unless explicitly allowed.
- Quote values/items copy correctly.
- Duplicate conversion is blocked.
- Activity log records conversion.
- Order routes are permission-gated.
