import { getModuleDisplayName } from "@/lib/module-display";
import type { StatusTone } from "@/lib/statusStyles";

import type {
  AutomationActionConfig,
  AutomationActionDefinition,
  AutomationConditionField,
  AutomationRule,
  AutomationTemplate,
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
    else if (isUserField(field.field_type)) action[field.key] = field.placeholder === "actor" ? USER_TARGET_ACTOR : USER_TARGET_OWNER;
    else action[field.key] = "";
  }
  return action;
}

export function ruleToDraft(rule: AutomationRule, duplicate = false, duplicateName?: string): RuleDraft {
  return {
    id: duplicate ? undefined : rule.id,
    name: duplicate ? duplicateName ?? `${rule.name} copy` : rule.name,
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

export function templateToDraft(template: AutomationTemplate): RuleDraft {
  return ruleToDraft({
    id: 0,
    name: template.name,
    description: template.description,
    module_key: template.module_key,
    enabled: false,
    trigger_event: template.trigger_event,
    condition_mode: template.condition_mode,
    conditions_json: template.conditions_json,
    actions_json: template.actions_json,
    updated_at: "",
  }, true, template.name);
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
  return getModuleDisplayName(moduleKey);
}

export function statusToneFor(status: string): StatusTone {
  // A *run* is `succeeded` and a *step* inside it is `success` — two words for one outcome,
  // both emitted by `automation_rules.py`. This mapper knew only the run's, which is why
  // `AutomationRunDetails` hand-rolled its own ternary for the step column (5.6 batch 7a).
  if (status === "succeeded" || status === "success" || status === "enabled") return "success";
  if (status === "failed") return "critical";
  if (status === "skipped") return "attention";
  return "neutral";
}

/** The record's owner and the person whose change fired the event: the two targets a rule
 * almost always means. A specific user is the exception, so it comes last. */
export const USER_TARGET_OWNER = "owner";
export const USER_TARGET_ACTOR = "actor";
export const USER_TARGET_LABELS: Record<string, string> = {
  [USER_TARGET_OWNER]: "Record owner",
  [USER_TARGET_ACTOR]: "Person who made the change",
};

export function isUserField(fieldType: string) {
  return fieldType === "user" || fieldType === "actor_or_user_id";
}

/** Merge fields an action's text can carry, as `{{payload.key}}` tokens. */
export function mergeFieldTokens(conditionFields: Iterable<AutomationConditionField>) {
  const tokens = [
    { token: "{{payload.record_label}}", label: "Record name" },
    { token: "{{payload.record_url}}", label: "Record link" },
  ];
  for (const field of conditionFields) {
    if (field.field_type === "user") continue;
    tokens.push({ token: `{{${field.key}}}`, label: field.label });
  }
  return tokens;
}

export function conditionSentence(condition: { field: string; operator: string; value?: unknown; values?: unknown[] }, fields: Map<string, AutomationConditionField>) {
  const field = fields.get(condition.field);
  const label = field?.label ?? condition.field.replace(/^payload\./, "");
  const operator = (OPERATOR_LABELS[condition.operator] ?? condition.operator).toLocaleLowerCase();
  if (["is_empty", "is_not_empty", "changed"].includes(condition.operator)) return `${label} ${operator}`;
  const raw = condition.operator === "in" || condition.operator === "not_in" ? (condition.values ?? []).map(String).join(", ") : valueAsString(condition.value);
  const option = field?.options.find((item) => item.value === raw)?.label;
  return `${label} ${operator} ${option ?? (raw || "…")}`;
}
