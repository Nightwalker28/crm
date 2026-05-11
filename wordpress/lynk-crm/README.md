# Lynk CRM Connector

First-pass WordPress plugin for Lynk website integrations.

## Setup

1. In Lynk, open **Integrations** and create an API key with:
   - `catalog:read`
   - `orders:write` if WordPress should submit orders
2. In WordPress, copy this folder to `wp-content/plugins/lynk-crm`.
3. Activate **Lynk CRM Connector**.
4. Go to **Settings > Lynk CRM**.
5. Set the API base URL, for example:
   - `https://crm.example.com/api/v1`
6. Paste the integration API key and test the connection.

## Shortcodes

Render public Lynk catalog items:

```text
[lynk_catalog]
```

Render only products or services:

```text
[lynk_catalog type="product"]
[lynk_catalog type="service"]
```

Render a simple order form for a catalog slug:

```text
[lynk_order_form slug="starter-package" item_type="product"]
```

Submitted orders are sent to Lynk as website integration orders. In Lynk, open
**Integrations > Website APIs** and convert captured website orders into POS
invoices when they are ready for finance handling.
