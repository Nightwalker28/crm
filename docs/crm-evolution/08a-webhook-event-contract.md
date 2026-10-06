# 08a — Webhook event inventory and external contract

The inventory and contract `08-webhooks-events.md` Phase 1 requires before subscriptions or a
delivery worker exist. Taken 2026-09-30 against `20260821_crm_event_public_id`. The code form
of this contract is `backend/app/modules/platform/services/webhook_events.py`; this page
explains it. **Phase 2 (subscriptions) opens only after the owner approves this contract.**

## 1. The event source already exists

There is no new event bus. `crm_events` (`platform/models.py` `CrmEvent`) is the stream,
written by `emit_crm_event` / `safe_emit_crm_event` / `safe_publish_crm_event` in
`platform/services/crm_events.py`. Two consumers read it today:

1. **Automations.** `emit_crm_event` enqueues `process_crm_event` for every event;
   `automation_rules.process_crm_event_automations` matches rules by `trigger_event`.
2. **Slack/Teams alerts.** `NotificationChannel` + `CrmEventDelivery`: for the five types in
   `SLACK_ALERT_EVENT_TYPES`, a delivery row per active channel is written in the event's
   transaction and sent by `process_crm_event_delivery_task`.

Webhooks will be a third consumer beside these, with their own subscription and delivery
tables (Phase 2–3). `CrmEventDelivery` is not reused: it is keyed to a notification channel,
has no attempt identity and no retry schedule, and changing it would change the alert path.

## 2. What is emitted today

Events are emitted by HTTP write paths, after the domain commit, best-effort (a failure
rolls back the event only). Paths that write records without going through these routes
emit nothing: CSV imports, bookings creating contacts, POS/finance flows creating contacts,
and automation actions. A webhook receiver sees what the table below emits, not every change.

| Internal type | Entity type | Emitted by | External type |
|---|---|---|---|
| `lead.created` | `sales_lead` | `leads_routes` create | `lead.created` |
| `lead.created` | `sales_contact` | `contacts_routes` create (named so for the Slack alert) | `contact.created` |
| `lead.updated` | `sales_lead` | `leads_routes` update | `lead.updated` |
| `lead.converted` | `sales_lead` | `leads_routes` convert | `lead.converted` |
| `deal.assigned` | `sales_opportunity` | `opportunities_routes` create/update with an owner | `opportunity.assigned` |
| `opportunity.stage_changed` | `sales_opportunity` | `opportunities_routes` stage move | `opportunity.stage_changed` |
| `opportunity.won` / `.lost` | `sales_opportunity` | same, on entering that semantic type | `opportunity.won` / `.lost` |
| `opportunity.participant_added` / `_removed` / `.primary_contact_changed` | `sales_opportunity` | `opportunity_contacts_services` | same names |
| `quote.created` | `sales_quote` | `quotes_routes` create | `quote.created` |
| `quote.status_changed` | `sales_quote` | `quotes_routes` update; client portal accept/reject | `quote.status_changed` |
| `order.created` | `sales_order` | `orders_routes` create; `quotes_routes` convert; the website order API | `order.created` |
| `task.assigned` | `task` | `tasks_routes` on added assignees | `task.assigned` |
| `task.due_today` | `task` | `tasks_routes` and the reminder job, once per task per day | `task.due_today` |

**Removed 2026-10-05 (13 §7 Step 5).** `invoice.overdue` belonged to insertion orders, which
were retired with contracts and support cases; it left the catalogue with them. Invoices emit
`finance.invoice_overdue` internally; whether it joins this catalogue is F10's call.

**Advertised but never emitted.** `automation_registry.AUTOMATION_TRIGGERS` lists 20 more
triggers that nothing emits: `lead.status_changed`, `lead.assigned`, `opportunity.created`,
`quote.sent/accepted/rejected/expired`, `order.status_changed/completed/cancelled`,
`booking.*`, `ticket.*`, `document.*`, `task.overdue`. A rule on them never runs. They are
not in the webhook catalogue, because a subscription to an event that never fires is a
silent failure. Emitting them is domain work, not 4A's (see STATUS.md Deferred).
`task.completed`, named in 08 §4 as an example, does not exist either.

## 3. The envelope

```json
{
  "id": "5b0c7d3e-6f1a-4c52-9a3e-2f7d9c1b8e40",
  "type": "opportunity.stage_changed",
  "version": 1,
  "occurred_at": "2026-09-30T12:00:00Z",
  "actor": {"type": "user", "user_id": "11"},
  "record": {"type": "opportunity", "id": "7"},
  "data": {"name": "Renewal", "stage_id": "31", "stage_label": "Closed won", "...": "..."}
}
```

- **`id`** is `crm_events.public_id`: a random UUID written with the event. It is the
  receiver's idempotency key and never changes on retry or replay (08 Phase 4). The row's
  sequential `id` stays internal, because it is shared across tenants and would reveal
  platform-wide event volume. Events recorded before `20260821_crm_event_public_id` have no
  public ID and are never delivered. No subscription could have matched them.
- **`type` and `version`.** `version` is per type. It changes when a field is removed,
  renamed or retyped. Adding a field or an envelope key does not change it, so
  **receivers must ignore unknown keys**. A future breaking version is sent as a new version
  number, and a subscription pins the version it was created against (Phase 2 decides how).
- **`occurred_at`** is when the event was recorded, UTC, ISO 8601 with `Z`.
- **`actor.type`** is `user` (with `user_id`), `client_portal` (a client acted in the
  portal; which portal account is not sent), or `system` (scheduled jobs). No names or emails
  of staff are sent. Receivers map `user_id` if they need to.
- **`record`** is the external record type and the record's ID as a string.
- **No tenant identity.** Each subscription belongs to one tenant and signs with its own
  secret (Phase 2–3), so the receiver already knows whose event it is. A tenant public
  identifier can be added later as an additive envelope key if product policy wants one.

## 4. Field policy

`data` holds exactly the fields its catalogue entry declares. Every declared field is always
present, as `null` when the source did not record it or recorded something that is not the
declared kind. Kinds: `id` (string), `string`, `integer`, `decimal` (string, so money never
goes through a float), `boolean`, `date`, `datetime` (UTC `Z`), `string_list`.

**Sent:** record identity and business state that an integration acts on: names, email,
company, source, status, score, owner user ID, stage ID/semantic type/label, amounts and
currency, due dates, the IDs a conversion produced, participant contact and role.

**Never sent:** internal keys (`_automation`, `_automation_dispatch`), dashboard paths
(`href`), staff display names (`actor_name`, `assigned_to_name`, `assigned_by_name`, task
`assignees` labels), the client portal's free-text `message` and `client_account_id`, and
anything a future emitter adds to a payload until the catalogue declares it. Stage *labels*
are sent as `stage_label` for display only: match on `stage_id` or `stage_semantic_type`
(04's rule that editable labels are not business identifiers).

Tenant customer data (a lead's name and email) is sent because the destination is the
tenant's own endpoint, configured by the tenant's admin. That is the reason webhook
configuration is admin-only (08 §11).

## 5. Per-type fields

| Type | `record.type` | `data` fields |
|---|---|---|
| `lead.created` | lead | `name`, `email`, `company`, `source`, `status`, `owner_user_id`, `score`, `score_grade` |
| `lead.updated` | lead | the above + `changed_fields`, `previous_status` |
| `lead.converted` | lead | `name`, `email`, `company`, `status`, `account_id`, `contact_id`, `opportunity_id` |
| `contact.created` | contact | `name`, `email`, `organization_name`, `owner_user_id` |
| `opportunity.assigned` | opportunity | `name`, `company`, `amount`, `stage_label`, `owner_user_id` |
| `opportunity.stage_changed` / `.won` / `.lost` | opportunity | `name`, `stage_id`, `stage_label`, `stage_semantic_type`, `previous_stage_id`, `previous_stage_label`, `previous_stage_semantic_type`, `owner_user_id` |
| `opportunity.participant_added` | opportunity | `name`, `contact_id`, `contact_name`, `role_key`, `is_primary`, `restored` |
| `opportunity.participant_removed` | opportunity | `name`, `contact_id`, `contact_name`, `role_key`, `is_primary` |
| `opportunity.primary_contact_changed` | opportunity | the above + `previous_contact_id` |
| `quote.created` | quote | `quote_number`, `customer_name`, `status`, `total_amount` |
| `quote.status_changed` | quote | the above + `previous_status` |
| `order.created` | order | `order_number`, `status`, `quote_id` |
| `task.assigned` / `task.due_today` | task | `title`, `priority`, `status`, `due_at` |

`GET /api/v1/admin/webhooks/event-types` (admin only) returns this catalogue with each
type's version, record type, gating module and typed fields. It is the same for every tenant.

## 6. Rules for the next phases

- **Module gating.** Each type names a `module_key`. The Phase 3 worker skips delivery when
  that module is disabled for the tenant at delivery time. Phase 2 refuses to subscribe to it.
- **Payload assembly reads only the event row.** `build_webhook_envelope` follows no
  references, so a worker cannot cross tenants through a stale ID.
- **Adding a type** means an entry in `WEBHOOK_EVENT_TYPES` with `version: 1`, a row in §2
  and §5, and a test. An internal event is never exported by default.
- **Automations and alerts are unchanged.** No internal event was renamed, and no payload
  key was added or removed.
