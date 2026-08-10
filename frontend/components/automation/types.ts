export type AutomationRule = {
  id: number;
  name: string;
  description: string | null;
  module_key: string | null;
  enabled: boolean;
  trigger_event: string;
  condition_mode: "all" | "any";
  conditions_json: Record<string, unknown>[];
  actions_json: Record<string, unknown>[];
  updated_at: string;
};

export type AutomationTrigger = {
  key: string;
  module_key: string;
  label: string;
  description: string;
};

export type AutomationTriggerGroup = {
  module_key: string;
  triggers: AutomationTrigger[];
};

export type AutomationRun = {
  id: number;
  rule_id: number;
  rule_name: string | null;
  event_id: number | null;
  trigger_event_key: string | null;
  source_module_key: string | null;
  source_record_id: string | null;
  source_label: string | null;
  status: string;
  input_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  step_results_json: Record<string, unknown>[] | null;
  action_attempt_count: number;
  action_success_count: number;
  action_failed_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  completed_at: string | null;
};

export type AutomationCondition = {
  id: string;
  field: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
};

export type AutomationConditionField = {
  key: string;
  payload_key: string;
  module_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "select";
  operators: string[];
  options: { value: string; label: string }[];
};

export type AutomationActionField = {
  key: string;
  label: string;
  field_type: "text" | "textarea" | "number" | "select" | "actor_or_user_id" | "payload_or_number";
  required: boolean;
  placeholder: string | null;
  options: { value: string; label: string }[];
};

export type AutomationActionDefinition = {
  key: string;
  category: string;
  label: string;
  description: string;
  module_keys: string[];
  fields: AutomationActionField[];
};

export type AutomationActionConfig = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export type AutomationRulePreview = {
  valid: boolean;
  can_enable: boolean;
  module_key: string | null;
  trigger_event: string;
  condition_mode: "all" | "any";
  condition_count: number;
  action_count: number;
  warnings: string[];
  actions: { index: number; type: string; label: string; config: Record<string, unknown> }[];
};

export type RuleDraft = {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  trigger_event: string;
  condition_mode: "all" | "any";
  conditions: AutomationCondition[];
  actions: AutomationActionConfig[];
};

export type InspectorSelection =
  | { kind: "settings" }
  | { kind: "trigger" }
  | { kind: "condition"; id: string }
  | { kind: "action"; id: string }
  | { kind: "validation" };
