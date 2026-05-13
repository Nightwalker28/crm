# Pass 4 Follow-up

Run 4 kept backend contracts unchanged. These items need backend/API or broader product work before the UI should imply full support.

## CRM Details

- Contact lifecycle stage is not available in the current contact list/detail payloads. Add backend fields and saved-view/filter support before exposing lifecycle as a real CRM control.
- Contact owner assignment is available as an ID in some payloads but does not have a user display object or assignment workflow on the detail page.
- Contact list recency fields such as last contacted or last activity are not present in the list payload, so list-row recency badges need backend payload support.
- Account status/health is not present in organization detail data. Add explicit account health/status fields before showing health pills.
- Account open-deal total should come from a reliable API result. The current detail payload has related deals, but no authoritative open-pipeline aggregate.

## Customer Groups and Pricing

- Customer groups can now be listed, created, edited, activated/deactivated, and assigned to contacts/accounts through existing APIs.
- Group discount fields are editable, but broader pricing-rule modeling is still basic. Future work should clarify whether fixed discounts need currency handling, product/category-specific rules, or effective-date rules.

## Custom Modules

- Custom module single-record fetch/update exists and now supports a detail route.
- Activity timelines, notes, and document links reject dynamic custom module keys today. Supporting those tabs requires shared backend record-reference configuration for custom modules.
- Custom module deletes should move toward the same confirmation/recycle wording used by core modules.

## Finance

- Insertion orders have single-record fetch support and now have a detail page, but shared activity/notes are not wired for IO records.
- POS invoices can be marked paid through the general update API, but there is no dedicated mark-paid endpoint. A dedicated endpoint would reduce full-payload update risk.
- POS invoices still need a true detail page if the product wants more than edit dialog plus print page.

## Catalog

- Products and services have detail routes and update APIs. Inline active toggle is supported through the existing full update payload.
- A unified `/dashboard/catalog` tabbed management route is still a product/navigation decision because module access currently points at product/service module routes.

## Platform UX

- Some destructive actions still need confirmation dialogs while keeping normal user-facing actions labeled `Delete`.
- Some settings pages beyond General still need dirty-state tracking.
- Advanced saved-view condition builders and background import/export job status UI remain broader platform work.
