from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AutomationTrigger:
    key: str
    module_key: str
    label: str
    description: str


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


AUTOMATION_TRIGGERS: tuple[AutomationTrigger, ...] = (
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
    AutomationTrigger("booking.cancelled", "calendar", "Booking cancelled", "A calendar booking is cancelled."),
    AutomationTrigger("booking.rescheduled", "calendar", "Booking rescheduled", "A calendar booking is rescheduled."),
    AutomationTrigger("ticket.created", "support_cases", "Ticket created", "A support ticket is created."),
    AutomationTrigger("ticket.status_changed", "support_cases", "Ticket status changed", "A support ticket status changes."),
    AutomationTrigger("ticket.priority_changed", "support_cases", "Ticket priority changed", "A support ticket priority changes."),
    AutomationTrigger("ticket.replied", "support_cases", "Ticket replied", "A support ticket receives a reply."),
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
            ("closed_won", "Closed Won"),
            ("closed_lost", "Closed Lost"),
        ),
    ),
    AutomationConditionField("expected_close_date", "sales_opportunities", "Expected Close", "date", DATE_OPERATORS),
    AutomationConditionField("probability_percent", "sales_opportunities", "Probability", "number", NUMBER_OPERATORS),
    AutomationConditionField("total_cost_of_project", "sales_opportunities", "Project Cost", "number", NUMBER_OPERATORS),
    AutomationConditionField("currency_type", "sales_opportunities", "Currency", "text", TEXT_OPERATORS),
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
    AutomationConditionField("file_name", "documents", "File Name", "text", TEXT_OPERATORS),
    AutomationConditionField("category", "documents", "Category", "text", TEXT_OPERATORS),
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
)

AUTOMATION_CONDITION_FIELDS_BY_MODULE = {
    module_key: tuple(field for field in AUTOMATION_CONDITION_FIELDS if field.module_key == module_key)
    for module_key in {field.module_key for field in AUTOMATION_CONDITION_FIELDS}
}

AUTOMATION_ACTIONS: tuple[AutomationAction, ...] = (
    AutomationAction(
        "create_task",
        "record",
        "Create task",
        "Create a follow-up task linked to the triggering record.",
        ("sales_leads", "sales_opportunities", "sales_quotes", "sales_orders", "support_cases", "documents", "tasks", "calendar", "finance_io"),
        (
            AutomationActionField("title", "Title", "text", True, "Follow up with {{payload.lead_name}}"),
            AutomationActionField("description", "Description", "textarea", False, "Optional task notes"),
            AutomationActionField("priority", "Priority", "select", False, options=(("high", "High"), ("medium", "Medium"), ("low", "Low"))),
            AutomationActionField("due_in_days", "Due in days", "number", False, "1"),
            AutomationActionField("assignee_user_id", "Assignee", "actor_or_user_id", False, "actor"),
        ),
    ),
    AutomationAction(
        "add_record_note",
        "record",
        "Create note",
        "Add a note/comment to the triggering record.",
        ("sales_leads", "sales_opportunities", "sales_quotes", "sales_orders", "support_cases", "documents", "tasks", "calendar", "finance_io"),
        (
            AutomationActionField("body", "Note", "textarea", True, "Automation note for {{entity_id}}"),
        ),
    ),
    AutomationAction(
        "send_notification",
        "communication",
        "Notify user",
        "Create an internal notification for a user.",
        ("sales_leads", "sales_opportunities", "sales_quotes", "sales_orders", "support_cases", "documents", "tasks", "calendar", "finance_io"),
        (
            AutomationActionField("user_id", "User", "actor_or_user_id", True, "actor"),
            AutomationActionField("title", "Title", "text", True, "Automation notification"),
            AutomationActionField("message", "Message", "textarea", True, "An automation rule ran."),
            AutomationActionField("link_url", "Link URL", "text", False, "/dashboard"),
        ),
    ),
    AutomationAction(
        "recalculate_lead_score",
        "record",
        "Recalculate lead score",
        "Refresh the lead score for the triggering lead.",
        ("sales_leads",),
        (
            AutomationActionField("lead_id", "Lead ID", "payload_or_number", False, "Uses triggering lead when blank"),
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
    module_keys = sorted({trigger.module_key for trigger in AUTOMATION_TRIGGERS})
    return [
        {
            "module_key": module_key,
            "triggers": [serialize_trigger(trigger) for trigger in AUTOMATION_TRIGGERS if trigger.module_key == module_key],
        }
        for module_key in module_keys
    ]


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
