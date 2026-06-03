# Phase 3 — Automation Workflow Rebuild

## Goal

Rebuild automations into a non-technical, condition/filter-based workflow system that works across modules.

The automation system should not require normal users to write JSON.

## Product principle

Automation should be understandable as:

```text
When this happens,
if these conditions match,
do these actions.
```

## Explicitly out of scope

- Raw JSON-first automation UI for normal users.
- Complex visual node graph builder in the first version.
- AI automation authoring.
- External workflow engine dependency unless already justified.
- Deployment/CI work.

## Task 3.1 — Automation domain model

### Objective

Define a reusable automation model that supports triggers, conditions, actions, runs, and errors.

### Core concepts

- Automation rule.
- Trigger.
- Condition group.
- Condition row.
- Action.
- Run history.
- Run step/result.

### Suggested automation rule fields

- id
- tenant_id
- module_key
- name
- description
- trigger_key
- enabled
- condition_mode: all or any
- conditions
- actions
- created_by
- updated_by
- created_at
- updated_at

### Suggested run history fields

- id
- tenant_id
- automation_rule_id
- trigger_event_key
- source_module_key
- source_record_id
- status: pending, running, success, failed, skipped
- started_at
- completed_at
- error_message
- step_results

### Acceptance criteria

- Automation rules are tenant-scoped.
- Rules can be enabled/disabled.
- Rules can be connected to one module or global/cross-module.
- Run history is stored for debugging.

## Task 3.2 — Trigger registry

### Objective

Create a typed/central registry of supported triggers.

### Initial trigger examples

Leads:

- lead.created
- lead.updated
- lead.status_changed
- lead.converted
- lead.assigned

Opportunities:

- opportunity.created
- opportunity.stage_changed
- opportunity.won
- opportunity.lost

Quotes:

- quote.created
- quote.sent
- quote.accepted
- quote.rejected
- quote.expired

Orders:

- order.created
- order.status_changed
- order.completed
- order.cancelled

Bookings:

- booking.created
- booking.cancelled
- booking.rescheduled

Support:

- ticket.created
- ticket.status_changed
- ticket.priority_changed
- ticket.replied

Documents:

- document.uploaded
- document.shared
- document.signed_or_approved if applicable later

### Acceptance criteria

- Trigger keys are centralized.
- UI can list triggers by module.
- Backend validates trigger keys.
- Unsupported triggers cannot be saved.

## Task 3.3 — Condition builder

### Objective

Build a filter-style condition system that normal users can understand.

### Condition row shape

- field
- operator
- value

### Operators

- equals
- not equals
- contains
- does not contain
- greater than
- greater than or equal
- less than
- less than or equal
- is empty
- is not empty
- changed
- changed to
- changed from
- in list
- not in list

### UI behavior

- User chooses field from module field list.
- Operator list changes based on field type.
- Value input changes based on field type.
- Users can combine conditions with all/any.

### Acceptance criteria

- No raw JSON required for condition creation.
- Conditions are validated by backend.
- Invalid field/operator combinations are rejected.
- Condition builder can support custom fields later.

## Task 3.4 — Action registry

### Objective

Create a central list of supported automation actions.

### Initial action examples

Record actions:

- update field
- assign owner
- assign team
- change status/stage
- create task
- create note/comment
- link record

Workflow actions:

- convert lead
- create opportunity
- create quote
- create order
- create support ticket

Communication actions:

- send email template
- notify internal user
- notify team
- create client portal notification

Integration actions:

- trigger webhook later
- trigger provider sync later

### Acceptance criteria

- Action keys are centralized.
- Actions are validated by backend.
- UI shows only actions available for the selected trigger/module.
- Each action has a clear config form.

## Task 3.5 — Module-level automation pages

### Objective

Every important module should have its own automation section.

### Pages/entry points

- Leads automation.
- Opportunities automation.
- Quotes automation.
- Orders automation.
- Support automation.
- Documents automation.
- Client portal automation.
- Booking automation.
- Mail automation where applicable.

Also keep a global Automation Center for cross-module rules.

### Acceptance criteria

- User can reach automations from a module settings/action area.
- Module page filters automation rules to that module.
- Global automation center shows all rules.
- Permission checks protect automation management.

## Task 3.6 — Automation builder UI

### Objective

Create a clean rule builder for non-technical users.

### Builder sections

1. Rule name and description.
2. Trigger selector.
3. Condition builder.
4. Action builder.
5. Test/preview section.
6. Enable/disable toggle.

### Acceptance criteria

- User can create a rule without JSON.
- User can add multiple conditions.
- User can add multiple actions.
- User can save disabled draft rules.
- User can enable a valid rule.
- Invalid rules show actionable validation messages.

## Task 3.7 — Automation execution engine

### Objective

Run matching automation rules safely when events occur.

### Implementation notes

- Prefer service-layer event publishing from important workflows.
- Avoid executing heavy automation inline in request path if Celery is available.
- Add loop protection so automations cannot recursively trigger forever.
- Add idempotency where practical.
- Log each run.

### Acceptance criteria

- Trigger events can execute matching rules.
- Failed actions do not silently disappear.
- Run status is visible.
- Automation errors do not crash the originating user workflow.

## Task 3.8 — Automation run history and debugging

### Objective

Give admins a useful way to understand what automations did.

### UI should show

- Rule name.
- Trigger event.
- Source record.
- Status.
- Started/completed time.
- Actions attempted.
- Actions succeeded/failed.
- Error message.
- Retry/re-run option later.

### Acceptance criteria

- Admin can view automation history.
- Failed runs expose enough information to debug.
- Sensitive values/secrets are not leaked.

## Task 3.9 — Initial cross-module automations

### Objective

Support the most valuable cross-module rules first.

### Priority examples

- When lead is converted, create/link contact, organization, and opportunity.
- When quote is accepted, create sales order.
- When booking is created, link/create lead/contact and create follow-up task.
- When support ticket is created, assign support team and notify internal user.
- When document is uploaded/shared, create activity timeline entry and notify relevant users.

### Acceptance criteria

- At least three cross-module automations work end-to-end.
- Each creates activity/run history.
- Permissions and tenant scoping are respected.
