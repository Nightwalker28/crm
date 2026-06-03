# Phase 4 — Client Portal Rework

## Goal

Rebuild the client dashboard/portal into a useful customer-facing product area.

The current client dashboard should be treated as not production-ready and functionally incomplete.

## Product purpose

The client portal should let a customer/client:

- See their profile/company details.
- View products/services available to them.
- See their own pricing.
- Place orders or request services.
- View order history.
- Raise support tickets.
- Reply to support tickets.
- Ask quick questions.
- View shared documents.
- View quotes/contracts.
- Approve or reject quotes/contracts if enabled.
- See bookings/appointments if relevant.

## Explicitly out of scope

- Public marketplace/ecommerce platform for everyone.
- Full payment gateway integration in the first rework.
- Advanced customer analytics.
- Complex ERP/accounting features.
- Deployment/CI work.

## Task 4.1 — Define client portal information architecture

### Objective

Create the client portal structure before coding more isolated pages.

### Suggested portal sections

- Home/overview.
- Products and services.
- Orders.
- Support tickets.
- Messages/quick questions.
- Documents.
- Quotes/contracts.
- Bookings/appointments.
- Profile/company settings.

### Acceptance criteria

- Navigation is clear and client-facing, not internal CRM-facing.
- Each section has a defined purpose.
- Internal CRM modules are not blindly exposed to clients.
- Data is scoped to the authenticated client/tenant relationship.

## Task 4.2 — Client portal auth and access model

### Objective

Ensure client users can only access their own records.

### Requirements

- Separate client portal auth from internal CRM user auth.
- Client user belongs to a tenant/customer account/contact.
- Client users can have roles if needed:
  - owner/admin
  - buyer/requester
  - support-only
  - document-viewer
- Portal access can be enabled/disabled per client.
- Invite/setup flow is clear.

### Acceptance criteria

- Client users cannot access internal dashboard routes.
- Client users cannot access other client records.
- Internal users can manage portal access for a client.
- Portal auth failures are handled cleanly.

## Task 4.3 — Client portal products/services catalog

### Objective

Let clients see products/services that are published and available to them.

### Requirements

- Only published products/services are visible.
- Product/service data can support client-specific pricing.
- Product/service details page.
- Availability/status display.
- Add-to-order/request flow.
- Order request confirmation.

### Pricing model notes

Support these eventually:

- default price
- tenant/company-specific price
- customer/account-specific price
- contract price later

Start with default price plus optional client/account-specific override if that fits the current model.

### Acceptance criteria

- Client sees only allowed products/services.
- Client sees the correct price for their account.
- Client can start an order/request from the portal.
- Internal CRM can identify source as client portal.

## Task 4.4 — Client portal ordering flow

### Objective

Allow clients to place product/service orders or requests.

### Flow

1. Client selects product/service.
2. Client enters quantity/details.
3. Client submits order/request.
4. CRM creates sales order or website/client order record.
5. Internal user can review/process.
6. Client can track status.

### Order statuses

- submitted
- under_review
- confirmed
- in_progress
- completed
- cancelled
- rejected

### Acceptance criteria

- Client can submit order/request.
- Order appears in internal CRM.
- Client can view order status/history.
- Order activity is logged.
- Permissions and tenant scoping are enforced.

## Task 4.5 — Client portal support tickets

### Objective

Let clients raise and follow support tickets.

### Requirements

Client side:

- Create ticket.
- Select category.
- Select priority.
- Add description.
- Attach files if supported.
- View ticket status.
- Reply to ticket.
- Close/reopen if allowed.

Internal side:

- View client-created tickets.
- Assign owner/team.
- Reply to client.
- Change status/priority.
- Link ticket to client account/contact/order/document.

### Acceptance criteria

- Client can create and reply to support tickets.
- Internal users can respond.
- Ticket thread is visible to both sides with correct scoping.
- Ticket activity timeline is updated.

## Task 4.6 — Client portal quick questions/messages

### Objective

Provide a lightweight way for clients to ask non-ticket questions.

### Start simple

- Client submits question/message.
- Internal CRM creates message record or support ticket based on configuration.
- Internal user can reply.
- Client sees response.

### Acceptance criteria

- Client can ask quick question.
- Internal user can respond.
- Message is linked to client account/contact.
- Optional setting can auto-convert question to support ticket.

## Task 4.7 — Client portal documents

### Objective

Let clients access shared documents safely.

### Requirements

- Internal users can share document with client portal.
- Client can view/download shared documents.
- Access can expire if needed later.
- Download/view action is logged.
- Client cannot access unshared documents.

### Acceptance criteria

- Client sees only documents shared with them.
- Document access is tenant/client scoped.
- Document downloads are audited.
- Internal user can revoke portal access to a document.

## Task 4.8 — Client portal quotes and contracts

### Objective

Allow clients to view and eventually approve/reject quotes/contracts.

### Requirements

- View quote details.
- View contract details.
- Download PDF/document if available.
- Approve/reject quote if enabled.
- Add comment/reason on reject.
- Activity is recorded internally.

### Acceptance criteria

- Client can view assigned quotes/contracts.
- Client cannot view unrelated quotes/contracts.
- Approval/rejection updates internal CRM state.
- Internal users can see portal approval activity.

## Task 4.9 — Client portal bookings/appointments

### Objective

Show client-relevant bookings and appointments.

### Requirements

- List upcoming bookings.
- Show booking details.
- Allow cancel/reschedule if enabled.
- Link booking to contact/account/opportunity if applicable.

### Acceptance criteria

- Client can see relevant bookings.
- Timezones are displayed clearly.
- Cancellation/reschedule actions are permission/config controlled.

## Task 4.10 — Client portal audit and activity

### Objective

Record important portal actions.

### Events

- portal.login
- portal.order.submitted
- portal.ticket.created
- portal.ticket.replied
- portal.message.sent
- portal.document.viewed
- portal.document.downloaded
- portal.quote.approved
- portal.quote.rejected
- portal.booking.cancelled
- portal.booking.rescheduled

### Acceptance criteria

- Internal users can see client portal activity related to CRM records.
- Sensitive portal auth details are not leaked.
