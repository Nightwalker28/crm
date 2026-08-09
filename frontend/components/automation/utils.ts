import type {
  AutomationActionConfig,
  AutomationActionDefinition,
  AutomationConditionField,
  AutomationRule,
  RuleDraft,
} from "./types";

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "Equals",
  not_equals: "Does not equal",
  contains: "Contains",
  not_contains: "Does not contain",
  gt: "Greater than",
  gte: "Greater than or equal",
  lt: "Less than",
  lte: "Less than or equal",
  is_empty: "Is empty",
  is_not_empty: "Is not empty",
  in: "In list",
  not_in: "Not in list",
  changed: "Changed",
  changed_to: "Changed to",
  changed_from: "Changed from",
};

export function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDraft(triggerEvent = ""): RuleDraft {
  return { name: "", description: "", enabled: false, trigger_event: triggerEvent, condition_mode: "all", conditions: [], actions: [] };
}

export function buildCondition(field?: AutomationConditionField) {
  return { id: createDraftId(), field: field?.key ?? "", operator: field?.operators[0] ?? "equals", value: "", values: [] };
}

export function buildAction(definition?: AutomationActionDefinition): AutomationActionConfig {
  const action: AutomationActionConfig = { id: createDraftId(), type: definition?.key ?? "" };
  for (const field of definition?.fields ?? []) {
    if (field.field_type === "select") action[field.key] = field.options[0]?.value ?? "";
    else if (field.key === "priority") action[field.key] = "medium";
    else if (field.field_type === "actor_or_user_id") action[field.key] = "actor";
    else action[field.key] = "";
  }
  return action;
}

export function ruleToDraft(rule: AutomationRule, duplicate = false): RuleDraft {
  return {
    id: duplicate ? undefined : rule.id,
    name: duplicate ? `${rule.name} copy` : rule.name,
    description: rule.description ?? "",
    enabled: duplicate ? false : rule.enabled,
    trigger_event: rule.trigger_event,
    condition_mode: rule.condition_mode ?? "all",
    conditions: (rule.conditions_json ?? []).map((condition) => ({
      id: createDraftId(),
      field: typeof condition.field === "string" ? condition.field : "",
      operator: typeof condition.operator === "string" ? condition.operator : "equals",
      value: condition.value,
      values: Array.isArray(condition.values) ? condition.values : [],
    })),
    actions: (rule.actions_json ?? []).map((action) => ({
      ...action,
      id: createDraftId(),
      type: typeof action.type === "string" ? action.type : "",
    })),
  };
}

export function draftSignature(draft: RuleDraft) {
  return JSON.stringify(draft);
}

export function serializeDraft(draft: RuleDraft, enabled = draft.enabled) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    enabled,
    trigger_event: draft.trigger_event,
    condition_mode: draft.condition_mode,
    conditions_json: draft.conditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
      values: condition.values,
    })),
    actions_json: draft.actions.map((action) => {
      const { id, ...payload } = action;
      void id;
      return payload;
    }),
  };
}

export function valueAsString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function isBlankValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

export function formatModuleLabel(moduleKey: string) {
  return moduleKey.split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function statusPill(status: string) {
  if (status === "succeeded" || status === "enabled") return { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/30" };
  if (status === "failed") return { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/30" };
  if (status === "skipped") return { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/30" };
  return {};
}
