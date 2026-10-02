from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AutomationTrigger:
    key: str
    module_key: str
    label: str
    description: str
    # False when nothing in the platform emits it yet. Such a trigger stays valid, so a rule
    # saved on it still loads, but the builder does not offer it and it cannot be enabled.
    available: bool = True


@dataclass(frozen=True)
class AutomationDerivedTrigger:
    """A specific trigger read off a general event, instead of a second event row.

    `quote.accepted` is `quote.status_changed` whose status became `accepted`. Deriving it
    here covers every path that changes a quote's status (the edit form, the client
    portal) without each one emitting a copy, and without the copy reaching webhook and
    Slack consumers as a separate event.

    `field_changes[field]` must exist on the source event (`to_values`, when set, bounds
    its new value). With `from_payload`, the payload value itself must be set instead: a
    lead created with an owner is a lead assigned.
    """

    key: str
    source_event: str
    field: str
    to_values: tuple[str, ...] = ()
    require_value: bool = False
    from_payload: bool = False


@dataclass(frozen=True)
class AutomationConditionField:
    key: str
    module_key: str
    label: str
    field_type: str
    operators: tuple[str, ...]
    options: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class AutomationActionField:
    key: str
    label: str
    field_type: str
    required: bool = False
    placeholder: str | None = None
    options: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class AutomationAction:
    key: str
    category: str
    label: str
    description: str
    module_keys: tuple[str, ...]
    fields: tuple[AutomationActionField, ...]


CHANGE_OPERATORS = ("changed", "changed_to", "changed_from")
TEXT_OPERATORS = ("equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "in", "not_in", *CHANGE_OPERATORS)
NUMBER_OPERATORS = ("equals", "not_equals", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty", "in", "not_in", *CHANGE_OPERATORS)
DATE_OPERATORS = NUMBER_OPERATORS
SELECT_OPERATORS = ("equals", "not_equals", "is_empty", "is_not_empty", "in", "not_in", *CHANGE_OPERATORS)
USER_OPERATORS = ("equals", "not_equals", "is_empty", "is_not_empty", *CHANGE_OPERATORS)


AUTOMATION_TRIGGERS: tuple[AutomationTrigger, ...] = (
    AutomationTrigger("inventory.stock_low", "inventory_stock", "Stock low", "Available stock crosses the reorder point."),
    AutomationTrigger("inventory.adjustment_posted", "inventory_adjustments", "Adjustment posted", "A stock adjustment is posted."),
    AutomationTrigger("inventory.delivery_posted", "inventory_deliveries", "Delivery posted", "A delivery for a sales order is posted."),
    AutomationTrigger("inventory.return_received", "inventory_returns", "Return received", "A customer return is received."),
    AutomationTrigger("lead.created", "sales_leads", "Lead created", "A sales lead is created."),
    AutomationTrigger("lead.updated", "sales_leads", "Lead updated", "A sales lead is updated."),
    AutomationTrigger("lead.status_changed", "sales_leads", "Lead status changed", "A sales lead status changes."),
    AutomationTrigger("lead.converted", "sales_leads", "Lead converted", "A sales lead is converted."),
    AutomationTrigger("lead.assigned", "sales_leads", "Lead assigned", "A sales lead owner changes."),
    AutomationTrigger("opportunity.created", "sales_opportunities", "Opportunity created", "A sales opportunity is created."),
    AutomationTrigger("opportunity.stage_changed", "sales_opportunities", "Opportunity stage changed", "A sales opportunity stage changes."),
    AutomationTrigger("opportunity.won", "sales_opportunities", "Opportunity won", "A sales opportunity is marked won."),
    AutomationTrigger("opportunity.lost", "sales_opportunities", "Opportunity lost", "A sales opportunity is marked lost."),
    AutomationTrigger("deal.assigned", "sales_opportunities", "Deal assigned", "A sales opportunity owner changes."),
    AutomationTrigger("quote.created", "sales_quotes", "Quote created", "A sales quote is created."),
    AutomationTrigger("quote.sent", "sales_quotes", "Quote sent", "A sales quote is sent."),
    AutomationTrigger("quote.accepted", "sales_quotes", "Quote accepted", "A sales quote is accepted."),
    AutomationTrigger("quote.rejected", "sales_quotes", "Quote rejected", "A sales quote is rejected."),
    AutomationTrigger("quote.expired", "sales_quotes", "Quote expired", "A sales quote expires."),
    AutomationTrigger("quote.status_changed", "sales_quotes", "Quote status changed", "A sales quote status changes."),
    AutomationTrigger("order.created", "sales_orders", "Order created", "A sales order is created."),
    AutomationTrigger("order.status_changed", "sales_orders", "Order status changed", "A sales order status changes."),
    AutomationTrigger("order.completed", "sales_orders", "Order completed", "A sales order is completed."),
    AutomationTrigger("order.cancelled", "sales_orders", "Order cancelled", "A sales order is cancelled."),
    AutomationTrigger("booking.created", "calendar", "Booking created", "A calendar booking is created."),
    AutomationTrigger("booking.cancelled", "calendar", "Booking cancelled", "A calendar booking is cancelled.", available=False),
    AutomationTrigger("booking.rescheduled", "calendar", "Booking rescheduled", "A calendar booking is rescheduled.", available=False),
    AutomationTrigger("ticket.created", "support_cases", "Ticket created", "A support ticket is created.", available=False),
    AutomationTrigger("ticket.status_changed", "support_cases", "Ticket status changed", "A support ticket status changes.", available=False),
    AutomationTrigger("ticket.priority_changed", "support_cases", "Ticket priority changed", "A support ticket priority changes.", available=False),
    AutomationTrigger("ticket.replied", "support_cases", "Ticket replied", "A support ticket receives a reply.", available=False),
    AutomationTrigger("case.created", "support_cases", "Support case created", "A support case is created."),
    AutomationTrigger("case.status_changed", "support_cases", "Support case status changed", "A support case status changes."),
    AutomationTrigger("document.uploaded", "documents", "Document uploaded", "A document is uploaded."),
    AutomationTrigger("document.shared", "documents", "Document shared", "A document is shared."),
    AutomationTrigger("task.due_today", "tasks", "Task due today", "A task becomes due today."),
    AutomationTrigger("task.overdue", "tasks", "Task overdue", "A task becomes overdue."),
    AutomationTrigger("task.assigned", "tasks", "Task assigned", "A task is assigned."),
    AutomationTrigger("invoice.overdue", "finance_io", "Invoice overdue", "An invoice becomes overdue."),
)

AUTOMATION_TRIGGERS_BY_KEY = {trigger.key: trigger for trigger in AUTOMATION_TRIGGERS}
SUPPORTED_AUTOMATION_TRIGGERS = frozenset(AUTOMATION_TRIGGERS_BY_KEY)
AVAILABLE_AUTOMATION_TRIGGERS = frozenset(trigger.key for trigger in AUTOMATION_TRIGGERS if trigger.available)

AUTOMATION_DERIVED_TRIGGERS: tuple[AutomationDerivedTrigger, ...] = (
    AutomationDerivedTrigger("lead.status_changed", "lead.updated", "status"),
    AutomationDerivedTrigger("lead.assigned", "lead.updated", "assigned_to", require_value=True),
    AutomationDerivedTrigger("lead.assigned", "lead.created", "assigned_to", require_value=True, from_payload=True),
    AutomationDerivedTrigger("quote.sent", "quote.status_changed", "status", ("sent",)),
    AutomationDerivedTrigger("quote.accepted", "quote.status_changed", "status", ("accepted",)),
    AutomationDerivedTrigger("quote.rejected", "quote.status_changed", "status", ("declined",)),
    AutomationDerivedTrigger("quote.expired", "quote.status_changed", "status", ("expired",)),
    AutomationDerivedTrigger("order.completed", "order.status_changed", "status", ("fulfilled",)),
    AutomationDerivedTrigger("order.cancelled", "order.status_changed", "status", ("cancelled",)),
)
DERIVED_TRIGGERS_BY_SOURCE: dict[str, tuple[AutomationDerivedTrigger, ...]] = {
    source: tuple(item for item in AUTOMATION_DERIVED_TRIGGERS if item.source_event == source)
    for source in {item.source_event for item in AUTOMATION_DERIVED_TRIGGERS}
}

AUTOMATION_CONDITION_FIELDS: tuple[AutomationConditionField, ...] = (
    AutomationConditionField("first_name", "sales_leads", "First Name", "text", TEXT_OPERATORS),
    AutomationConditionField("last_name", "sales_leads", "Last Name", "text", TEXT_OPERATORS),
    AutomationConditionField("company", "sales_leads", "Company", "text", TEXT_OPERATORS),
    AutomationConditionField("primary_email", "sales_leads", "Email", "text", TEXT_OPERATORS),
    AutomationConditionField("phone", "sales_leads", "Phone", "text", TEXT_OPERATORS),
    AutomationConditionField("title", "sales_leads", "Job Title", "text", TEXT_OPERATORS),
    AutomationConditionField("source", "sales_leads", "Source", "text", TEXT_OPERATORS),
    AutomationConditionField("score", "sales_leads", "Score", "number", NUMBER_OPERATORS),
    AutomationConditionField(
        "score_grade",
        "sales_leads",
        "Score Grade",
        "select",
        SELECT_OPERATORS,
        (("hot", "Hot"), ("warm", "Warm"), ("cold", "Cold")),
    ),
    AutomationConditionField(
        "status",
        "sales_leads",
        "Status",
        "select",
        SELECT_OPERATORS,
        (("new", "New"), ("contacted", "Contacted"), ("qualified", "Qualified"), ("unqualified", "Unqualified"), ("converted", "Converted")),
    ),
    AutomationConditionField("created_time", "sales_leads", "Created Time", "date", DATE_OPERATORS),
    AutomationConditionField("assigned_to", "sales_leads", "Owner", "user", USER_OPERATORS),
    AutomationConditionField("opportunity_name", "sales_opportunities", "Deal", "text", TEXT_OPERATORS),
    AutomationConditionField("client", "sales_opportunities", "Client", "text", TEXT_OPERATORS),
    AutomationConditionField(
        "sales_stage",
        "sales_opportunities",
        "Stage",
        "select",
        SELECT_OPERATORS,
        (
            ("lead", "Lead"),
            ("qualified", "Qualified"),
            ("proposal", "Proposal"),
            ("negotiation", "Negotiation"),
            ("closed_won", "Closed won"),
            ("closed_lost", "Closed lost"),
        ),
    ),
    AutomationConditionField(
        "stage_semantic_type",
        "sales_opportunities",
        "Stage outcome",
        "select",
        SELECT_OPERATORS,
        (("open", "Open"), ("ongoing", "In progress"), ("won", "Won"), ("lost", "Lost")),
    ),
    AutomationConditionField("expected_close_date", "sales_opportunities", "Expected Close", "date", DATE_OPERATORS),
    AutomationConditionField("probability_percent", "sales_opportunities", "Probability", "number", NUMBER_OPERATORS),
    AutomationConditionField("total_cost_of_project", "sales_opportunities", "Project Cost", "number", NUMBER_OPERATORS),
    AutomationConditionField("currency_type", "sales_opportunities", "Currency", "text", TEXT_OPERATORS),
    AutomationConditionField("assigned_to", "sales_opportunities", "Owner", "user", USER_OPERATORS),
    AutomationConditionField("quote_number", "sales_quotes", "Quote Number", "text", TEXT_OPERATORS),
    AutomationConditionField("customer_name", "sales_quotes", "Customer", "text", TEXT_OPERATORS),
    AutomationConditionField("opportunity_id", "sales_quotes", "Deal ID", "number", NUMBER_OPERATORS),
    AutomationConditionField("title", "sales_quotes", "Title", "text", TEXT_OPERATORS),
    AutomationConditionField(
        "status",
        "sales_quotes",
        "Status",
        "select",
        SELECT_OPERATORS,
        (("draft", "Draft"), ("sent", "Sent"), ("accepted", "Accepted"), ("declined", "Declined"), ("expired", "Expired")),
    ),
    AutomationConditionField("issue_date", "sales_quotes", "Issue Date", "date", DATE_OPERATORS),
    AutomationConditionField("expiry_date", "sales_quotes", "Expiry Date", "date", DATE_OPERATORS),
    AutomationConditionField("total_amount", "sales_quotes", "Total", "number", NUMBER_OPERATORS),
    AutomationConditionField("assigned_to", "sales_quotes", "Owner", "user", USER_OPERATORS),
    AutomationConditionField("order_number", "sales_orders", "Order Number", "text", TEXT_OPERATORS),
    AutomationConditionField(
        "status",
        "sales_orders",
        "Status",
        "select",
        SELECT_OPERATORS,
        (("draft", "Draft"), ("confirmed", "Confirmed"), ("fulfilled", "Fulfilled"), ("cancelled", "Cancelled")),
    ),
    AutomationConditionField("grand_total", "sales_orders", "Total", "number", NUMBER_OPERATORS),
    AutomationConditionField("created_at", "sales_orders", "Created", "date", DATE_OPERATORS),
    AutomationConditionField("owner_id", "sales_orders", "Owner", "user", USER_OPERATORS),
    AutomationConditionField("subject", "support_cases", "Subject", "text", TEXT_OPERATORS),
    AutomationConditionField(
        "status",
        "support_cases",
        "Status",
        "select",
        SELECT_OPERATORS,
        (("new", "New"), ("open", "Open"), ("pending", "Pending"), ("resolved", "Resolved"), ("closed", "Closed")),
    ),
    AutomationConditionField(
        "priority",
        "support_cases",
        "Priority",
        "select",
        SELECT_OPERATORS,
        (("low", "Low"), ("medium", "Medium"), ("high", "High"), ("urgent", "Urgent")),
    ),
    AutomationConditionField("source", "support_cases", "Source", "text", TEXT_OPERATORS),
    AutomationConditionField("sla_due_at", "support_cases", "SLA Due", "date", DATE_OPERATORS),
    AutomationConditionField("title", "documents", "Title", "text", TEXT_OPERATORS),
    AutomationConditionField("original_filename", "documents", "File Name", "text", TEXT_OPERATORS),
    AutomationConditionField("extension", "documents", "File Type", "text", TEXT_OPERATORS),
    AutomationConditionField("created_at", "documents", "Created", "date", DATE_OPERATORS),
    AutomationConditionField("title", "tasks", "Title", "text", TEXT_OPERATORS),
    AutomationConditionField(
        "status",
        "tasks",
        "Status",
        "select",
        SELECT_OPERATORS,
        (("todo", "To Do"), ("in_progress", "In Progress"), ("blocked", "Blocked"), ("completed", "Completed")),
    ),
    AutomationConditionField(
        "priority",
        "tasks",
        "Priority",
        "select",
        SELECT_OPERATORS,
        (("high", "High"), ("medium", "Medium"), ("low", "Low")),
    ),
    AutomationConditionField("due_at", "tasks", "Due Date", "date", DATE_OPERATORS),
    AutomationConditionField("guest_name", "calendar", "Guest Name", "text", TEXT_OPERATORS),
    AutomationConditionField("guest_email", "calendar", "Guest Email", "text", TEXT_OPERATORS),
    AutomationConditionField("start_at", "calendar", "Meeting Start", "date", DATE_OPERATORS),
    AutomationConditionField("io_number", "finance_io", "Invoice Number", "text", TEXT_OPERATORS),
    AutomationConditionField("customer_name", "finance_io", "Customer", "text", TEXT_OPERATORS),
    AutomationConditionField("total_amount", "finance_io", "Total", "number", NUMBER_OPERATORS),
    AutomationConditionField("due_date", "finance_io", "Due Date", "date", DATE_OPERATORS),
)

AUTOMATION_CONDITION_FIELDS_BY_MODULE = {
    module_key: tuple(field for field in AUTOMATION_CONDITION_FIELDS if field.module_key == module_key)
    for module_key in {field.module_key for field in AUTOMATION_CONDITION_FIELDS}
}

RECORD_MODULE_KEYS = ("sales_leads", "sales_opportunities", "sales_quotes", "sales_orders", "support_cases", "documents", "tasks", "calendar", "finance_io", "inventory_stock", "inventory_adjustments", "inventory_deliveries", "inventory_returns")
# Record comments exist on these modules only (`record_comments.RECORD_COMMENT_MODULES`); a
# note on a task or a document had nowhere to render.
NOTE_MODULE_KEYS = ("sales_leads", "sales_opportunities", "sales_quotes", "sales_orders", "support_cases", "finance_io")

AUTOMATION_ACTIONS: tuple[AutomationAction, ...] = (
    AutomationAction(
        "create_task",
        "record",
        "Create task",
        "Create a follow-up task linked to the triggering record.",
        RECORD_MODULE_KEYS,
        (
            AutomationActionField("title", "Title", "text", True, "Follow up on {{payload.record_label}}"),
            AutomationActionField("description", "Description", "textarea", False, "Optional task notes"),
            AutomationActionField("priority", "Priority", "select", False, options=(("high", "High"), ("medium", "Medium"), ("low", "Low"))),
            AutomationActionField("due_in_days", "Due in days", "number", False, "1"),
            AutomationActionField("assignee_user_id", "Assign to", "user", False, "owner"),
        ),
    ),
    AutomationAction(
        "add_record_note",
        "record",
        "Add note",
        "Add a note to the triggering record's timeline.",
        NOTE_MODULE_KEYS,
        (
            AutomationActionField("body", "Note", "textarea", True, "Automation note"),
        ),
    ),
    AutomationAction(
        "send_notification",
        "communication",
        "Notify someone",
        "Send an in-app notification that links to the triggering record.",
        RECORD_MODULE_KEYS,
        (
            AutomationActionField("user_id", "Notify", "user", True, "owner"),
            AutomationActionField("title", "Title", "text", True, "Heads up: {{payload.record_label}}"),
            AutomationActionField("message", "Message", "textarea", True, "An automation rule ran."),
            AutomationActionField("link_url", "Link", "text", False, "Leave blank to link the record"),
        ),
    ),
    AutomationAction(
        "recalculate_lead_score",
        "record",
        "Recalculate lead score",
        "Refresh the lead score for the triggering lead.",
        ("sales_leads",),
        (),
    ),
    AutomationAction(
        "convert_lead_to_opportunity",
        "workflow",
        "Convert lead",
        "Convert the triggering lead into an account, contact, and deal.",
        ("sales_leads",),
        (
            AutomationActionField("deal_stage", "Deal stage", "select", False, options=(("qualified", "Qualified"), ("proposal", "Proposal"), ("negotiation", "Negotiation"))),
            AutomationActionField("deal_name", "Deal name", "text", False, "{{payload.first_name}} {{payload.last_name}} opportunity"),
        ),
    ),
    AutomationAction(
        "convert_quote_to_order",
        "workflow",
        "Create order from quote",
        "Create a sales order from the triggering quote.",
        ("sales_quotes",),
        (),
    ),
    AutomationAction(
        "assign_support_case",
        "workflow",
        "Assign support case",
        "Assign the triggering support case and notify the assignee.",
        ("support_cases",),
        (
            AutomationActionField("assignee_user_id", "Assign to", "user", True, "owner"),
            AutomationActionField("notification_title", "Notification title", "text", False, "Support case assigned"),
            AutomationActionField("notification_message", "Notification message", "textarea", False, "{{payload.subject}} needs attention."),
        ),
    ),
)

AUTOMATION_ACTIONS_BY_KEY = {action.key: action for action in AUTOMATION_ACTIONS}
SUPPORTED_AUTOMATION_ACTIONS = frozenset(AUTOMATION_ACTIONS_BY_KEY)


def get_trigger_or_none(trigger_key: str) -> AutomationTrigger | None:
    return AUTOMATION_TRIGGERS_BY_KEY.get((trigger_key or "").strip())


def module_key_for_trigger(trigger_key: str) -> str | None:
    trigger = get_trigger_or_none(trigger_key)
    return trigger.module_key if trigger else None


def serialize_trigger(trigger: AutomationTrigger) -> dict[str, str]:
    return {
        "key": trigger.key,
        "module_key": trigger.module_key,
        "label": trigger.label,
        "description": trigger.description,
    }


def grouped_trigger_registry() -> list[dict[str, object]]:
    """The triggers the builder offers: only those something actually emits."""

    offered = [trigger for trigger in AUTOMATION_TRIGGERS if trigger.available]
    module_keys = sorted({trigger.module_key for trigger in offered})
    return [
        {
            "module_key": module_key,
            "triggers": [serialize_trigger(trigger) for trigger in offered if trigger.module_key == module_key],
        }
        for module_key in module_keys
    ]


def is_trigger_available(trigger_key: str) -> bool:
    return (trigger_key or "").strip() in AVAILABLE_AUTOMATION_TRIGGERS


def derived_trigger_keys(event_type: str, payload: dict[str, object] | None) -> list[str]:
    """The specific triggers a general event also satisfies (see `AutomationDerivedTrigger`)."""

    payload = payload or {}
    changes = payload.get("field_changes")
    changes = changes if isinstance(changes, dict) else {}
    keys: list[str] = []
    for derived in DERIVED_TRIGGERS_BY_SOURCE.get(event_type, ()):
        if derived.from_payload:
            new_value = payload.get(derived.field)
        else:
            change = changes.get(derived.field)
            if not isinstance(change, dict):
                continue
            new_value = change.get("to")
            if new_value == change.get("from"):
                continue
        if derived.require_value and new_value in {None, ""}:
            continue
        if derived.to_values and str(new_value) not in derived.to_values:
            continue
        if derived.key not in keys:
            keys.append(derived.key)
    return keys


def condition_fields_for_module(module_key: str) -> tuple[AutomationConditionField, ...]:
    return AUTOMATION_CONDITION_FIELDS_BY_MODULE.get(module_key, ())


def condition_fields_for_trigger(trigger_key: str) -> tuple[AutomationConditionField, ...]:
    module_key = module_key_for_trigger(trigger_key)
    return condition_fields_for_module(module_key or "")


def serialize_condition_field(field: AutomationConditionField) -> dict[str, object]:
    return {
        "key": f"payload.{field.key}",
        "payload_key": field.key,
        "module_key": field.module_key,
        "label": field.label,
        "field_type": field.field_type,
        "operators": list(field.operators),
        "options": [{"value": value, "label": label} for value, label in field.options],
    }


def actions_for_module(module_key: str | None) -> tuple[AutomationAction, ...]:
    if not module_key:
        return AUTOMATION_ACTIONS
    return tuple(action for action in AUTOMATION_ACTIONS if module_key in action.module_keys)


def actions_for_trigger(trigger_key: str) -> tuple[AutomationAction, ...]:
    return actions_for_module(module_key_for_trigger(trigger_key))


def get_action_or_none(action_key: str) -> AutomationAction | None:
    return AUTOMATION_ACTIONS_BY_KEY.get((action_key or "").strip())


def serialize_action(action: AutomationAction) -> dict[str, object]:
    return {
        "key": action.key,
        "category": action.category,
        "label": action.label,
        "description": action.description,
        "module_keys": list(action.module_keys),
        "fields": [
            {
                "key": field.key,
                "label": field.label,
                "field_type": field.field_type,
                "required": field.required,
                "placeholder": field.placeholder,
                "options": [{"value": value, "label": label} for value, label in field.options],
            }
            for field in action.fields
        ],
    }


@dataclass(frozen=True)
class AutomationTemplate:
    """A ready-made rule. Using one opens the builder prefilled; nothing runs until it is saved and enabled."""

    key: str
    name: str
    description: str
    category: str
    trigger_event: str
    actions: tuple[dict[str, object], ...]
    conditions: tuple[dict[str, object], ...] = ()
    condition_mode: str = "all"


AUTOMATION_TEMPLATES: tuple[AutomationTemplate, ...] = (
    AutomationTemplate(
        "inventory_low_stock_task", "Review low stock", "Create a task when a product crosses its reorder point.",
        "Inventory", "inventory.stock_low",
        ({"type": "create_task", "title": "Reorder {{payload.record_label}}", "description": "Available: {{payload.available}} in {{payload.warehouse_name}}. Reorder quantity: {{payload.reorder_quantity}}.", "priority": "high", "due_in_days": 0, "assignee_user_id": "actor"},),
    ),
    AutomationTemplate(
        "new_lead_follow_up",
        "Follow up on every new lead",
        "Give the lead's owner a task to reach out within a day.",
        "Leads",
        "lead.created",
        ({"type": "create_task", "title": "Follow up with {{payload.record_label}}", "priority": "high", "due_in_days": 1, "assignee_user_id": "owner"},),
    ),
    AutomationTemplate(
        "lead_assigned_notify",
        "Tell a rep when a lead is assigned to them",
        "Notify the new owner the moment a lead lands on their desk.",
        "Leads",
        "lead.assigned",
        ({"type": "send_notification", "user_id": "owner", "title": "New lead: {{payload.record_label}}", "message": "You are now the owner of this lead."},),
    ),
    AutomationTemplate(
        "qualified_lead_proposal",
        "Prepare a proposal for qualified leads",
        "When a lead becomes qualified, ask its owner to prepare a proposal.",
        "Leads",
        "lead.status_changed",
        ({"type": "create_task", "title": "Prepare a proposal for {{payload.record_label}}", "priority": "medium", "due_in_days": 2, "assignee_user_id": "owner"},),
        conditions=({"field": "payload.status", "operator": "changed_to", "value": "qualified"},),
    ),
    AutomationTemplate(
        "unassigned_lead_alert",
        "Flag new leads that have no owner",
        "Notify whoever created a lead without an owner, so it is not left unworked.",
        "Leads",
        "lead.created",
        ({"type": "send_notification", "user_id": "actor", "title": "Unassigned lead: {{payload.record_label}}", "message": "This lead has no owner yet. Assign it so someone follows up."},),
        conditions=({"field": "payload.assigned_to", "operator": "is_empty", "value": None},),
    ),
    AutomationTemplate(
        "deal_won_onboarding",
        "Start onboarding when a deal is won",
        "Create a kickoff task for the deal owner and log a note on the deal.",
        "Deals",
        "opportunity.won",
        (
            {"type": "create_task", "title": "Kick off onboarding for {{payload.record_label}}", "priority": "high", "due_in_days": 2, "assignee_user_id": "owner"},
            {"type": "add_record_note", "body": "Deal won. Onboarding task created for the owner."},
        ),
    ),
    AutomationTemplate(
        "deal_lost_review",
        "Review lost deals",
        "Ask the owner to record why a deal was lost while it is fresh.",
        "Deals",
        "opportunity.lost",
        ({"type": "create_task", "title": "Record the loss reason for {{payload.record_label}}", "priority": "low", "due_in_days": 3, "assignee_user_id": "owner"},),
    ),
    AutomationTemplate(
        "quote_sent_follow_up",
        "Chase quotes after they are sent",
        "Remind the quote owner to check in three days after sending.",
        "Quotes",
        "quote.sent",
        ({"type": "create_task", "title": "Check in on quote {{payload.record_label}}", "priority": "medium", "due_in_days": 3, "assignee_user_id": "owner"},),
    ),
    AutomationTemplate(
        "quote_accepted_order",
        "Turn accepted quotes into orders",
        "Create the sales order automatically and tell the owner.",
        "Quotes",
        "quote.accepted",
        (
            {"type": "convert_quote_to_order"},
            {"type": "send_notification", "user_id": "owner", "title": "Quote {{payload.record_label}} accepted", "message": "A sales order was created from this quote."},
        ),
    ),
    AutomationTemplate(
        "invoice_overdue_chase",
        "Chase overdue invoices",
        "Give the invoice owner a task to collect payment.",
        "Finance",
        "invoice.overdue",
        ({"type": "create_task", "title": "Collect payment for {{payload.record_label}}", "priority": "high", "due_in_days": 1, "assignee_user_id": "owner"},),
    ),
    AutomationTemplate(
        "task_overdue_nudge",
        "Nudge on overdue tasks",
        "Notify the assignee when one of their tasks slips past its due date.",
        "Tasks",
        "task.overdue",
        ({"type": "send_notification", "user_id": "owner", "title": "Overdue: {{payload.record_label}}", "message": "This task is past its due date."},),
    ),
    AutomationTemplate(
        "booking_prep",
        "Prepare for booked meetings",
        "When someone books a meeting, give the host a prep task.",
        "Calendar",
        "booking.created",
        ({"type": "create_task", "title": "Prepare for the meeting with {{payload.guest_name}}", "priority": "medium", "due_in_days": 0, "assignee_user_id": "owner"},),
    ),
)

AUTOMATION_TEMPLATES_BY_KEY = {template.key: template for template in AUTOMATION_TEMPLATES}


def serialize_template(template: AutomationTemplate) -> dict[str, object]:
    return {
        "key": template.key,
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "module_key": module_key_for_trigger(template.trigger_event),
        "trigger_event": template.trigger_event,
        "condition_mode": template.condition_mode,
        "conditions_json": [dict(condition) for condition in template.conditions],
        "actions_json": [dict(action) for action in template.actions],
    }
