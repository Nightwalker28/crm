"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { MODULE_REGISTRY, getModuleRegistryLabel } from "@/lib/module-registry";
import { SETTINGS_ROUTES } from "@/lib/routes";

type AutomationRule = {
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

type AutomationTrigger = {
  key: string;
  module_key: string;
  label: string;
  description: string;
};

type AutomationTriggerGroup = {
  module_key: string;
  triggers: AutomationTrigger[];
};

type AutomationRun = {
  id: number;
  rule_id: number;
  event_id: number | null;
  status: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

type AutomationCondition = {
  id?: string;
  field: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
};

type AutomationConditionField = {
  key: string;
  payload_key: string;
  module_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "select";
  operators: string[];
  options: { value: string; label: string }[];
};

type AutomationActionField = {
  key: string;
  label: string;
  field_type: "text" | "textarea" | "number" | "select" | "actor_or_user_id" | "payload_or_number";
  required: boolean;
  placeholder: string | null;
  options: { value: string; label: string }[];
};

type AutomationActionDefinition = {
  key: string;
  category: string;
  label: string;
  description: string;
  module_keys: string[];
  fields: AutomationActionField[];
};

type AutomationActionConfig = {
  id?: string;
  type: string;
  [key: string]: unknown;
};

type AutomationRulePreview = {
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

type RuleDraft = {
  id?: number;
  name: string;
  description: string;
  enabled: boolean;
  trigger_event: string;
  condition_mode: "all" | "any";
  conditions: AutomationCondition[];
  actions: AutomationActionConfig[];
};

const EMPTY_CONDITION_FIELDS: AutomationConditionField[] = [];
const EMPTY_ACTION_DEFINITIONS: AutomationActionDefinition[] = [];
const EMPTY_CONDITIONS: AutomationCondition[] = [];
const EMPTY_ACTIONS: AutomationActionConfig[] = [];

const EMPTY_DRAFT: RuleDraft = {
  name: "",
  description: "",
  enabled: true,
  trigger_event: "lead.created",
  condition_mode: "all",
  conditions: [],
  actions: [
    {
      id: createDraftId(),
      type: "create_task",
      title: "Follow up with {{payload.lead_name}}",
      priority: "medium",
      due_in_days: 1,
      assignee_user_id: "actor",
    },
  ],
};

async function fetchRules(moduleKey?: string | null): Promise<AutomationRule[]> {
  const params = new URLSearchParams();
  if (moduleKey) params.set("module_key", moduleKey);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`/admin/automation-rules${suffix}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchTriggerRegistry(): Promise<AutomationTriggerGroup[]> {
  const res = await apiFetch("/admin/automation-rules/trigger-registry");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchConditionFields(triggerEvent: string): Promise<AutomationConditionField[]> {
  const params = new URLSearchParams({ trigger_event: triggerEvent });
  const res = await apiFetch(`/admin/automation-rules/condition-fields?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchActionRegistry(triggerEvent: string): Promise<AutomationActionDefinition[]> {
  const params = new URLSearchParams({ trigger_event: triggerEvent });
  const res = await apiFetch(`/admin/automation-rules/action-registry?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function fetchRuns(ruleId?: number, moduleKey?: string | null): Promise<AutomationRun[]> {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (ruleId) params.set("rule_id", String(ruleId));
  if (moduleKey) params.set("module_key", moduleKey);
  const res = await apiFetch(`/admin/automation-rules/runs?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body.results ?? [];
}

async function previewRule(payload: Record<string, unknown>): Promise<AutomationRulePreview> {
  const res = await apiFetch("/admin/automation-rules/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as AutomationRulePreview;
}

const OPERATOR_LABELS: Record<string, string> = {
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

function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildCondition(field?: AutomationConditionField): AutomationCondition {
  return {
    id: createDraftId(),
    field: field?.key ?? "",
    operator: field?.operators[0] ?? "equals",
    value: "",
    values: [],
  };
}

function buildAction(definition?: AutomationActionDefinition): AutomationActionConfig {
  const action: AutomationActionConfig = { id: createDraftId(), type: definition?.key ?? "" };
  for (const field of definition?.fields ?? []) {
    if (field.field_type === "select") {
      action[field.key] = field.options[0]?.value ?? "";
    } else if (field.key === "priority") {
      action[field.key] = "medium";
    } else if (field.field_type === "actor_or_user_id") {
      action[field.key] = "actor";
    } else {
      action[field.key] = "";
    }
  }
  return action;
}

function valueAsString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isBlankValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function serializeAction(action: AutomationActionConfig) {
  const { id, ...payload } = action;
  void id;
  return payload;
}

function formatModuleLabel(moduleKey: string) {
  return moduleKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function AutomationSettingsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const selectedModuleKey = searchParams.get("module_key")?.trim() || null;
  const selectedModuleLabel = selectedModuleKey ? (getModuleRegistryLabel(selectedModuleKey) ?? formatModuleLabel(selectedModuleKey)) : null;
  const selectedRuleId = draft.id;
  const rulesQuery = useQuery({ queryKey: ["automation-rules", selectedModuleKey ?? "all"], queryFn: () => fetchRules(selectedModuleKey) });
  const triggersQuery = useQuery({ queryKey: ["automation-rule-trigger-registry"], queryFn: fetchTriggerRegistry });
  const visibleTriggerGroups = useMemo(() => {
    const groups = triggersQuery.data ?? [];
    return selectedModuleKey ? groups.filter((group) => group.module_key === selectedModuleKey) : groups;
  }, [selectedModuleKey, triggersQuery.data]);
  const visibleTriggerKeys = useMemo(() => new Set(visibleTriggerGroups.flatMap((group) => group.triggers.map((trigger) => trigger.key))), [visibleTriggerGroups]);
  const firstVisibleTriggerKey = visibleTriggerGroups[0]?.triggers[0]?.key ?? EMPTY_DRAFT.trigger_event;
  const effectiveTriggerEvent = visibleTriggerKeys.size && !visibleTriggerKeys.has(draft.trigger_event) ? firstVisibleTriggerKey : draft.trigger_event;

  const conditionFieldsQuery = useQuery({
    queryKey: ["automation-rule-condition-fields", effectiveTriggerEvent],
    queryFn: () => fetchConditionFields(effectiveTriggerEvent),
  });
  const actionRegistryQuery = useQuery({
    queryKey: ["automation-rule-action-registry", effectiveTriggerEvent],
    queryFn: () => fetchActionRegistry(effectiveTriggerEvent),
  });
  const runsQuery = useQuery({ queryKey: ["automation-rule-runs", selectedModuleKey ?? "all", selectedRuleId ?? "all"], queryFn: () => fetchRuns(selectedRuleId, selectedModuleKey) });

  const selectedRule = useMemo(() => rulesQuery.data?.find((rule) => rule.id === selectedRuleId), [rulesQuery.data, selectedRuleId]);
  const draftMatchesScope = draft.trigger_event === effectiveTriggerEvent;
  const scopedConditions = useMemo(() => (draftMatchesScope ? draft.conditions : EMPTY_CONDITIONS), [draft.conditions, draftMatchesScope]);
  const scopedActions = useMemo(() => (draftMatchesScope ? draft.actions : EMPTY_ACTIONS), [draft.actions, draftMatchesScope]);
  const conditionFields = conditionFieldsQuery.data ?? EMPTY_CONDITION_FIELDS;
  const conditionFieldMap = useMemo(() => new Map(conditionFields.map((field) => [field.key, field])), [conditionFields]);
  const actionDefinitions = actionRegistryQuery.data ?? EMPTY_ACTION_DEFINITIONS;
  const actionDefinitionMap = useMemo(() => new Map(actionDefinitions.map((action) => [action.key, action])), [actionDefinitions]);
  const builderMessages = useMemo(() => {
    const messages: string[] = [];
    if (!draft.name.trim()) messages.push("Rule name is required.");
    for (const [index, condition] of scopedConditions.entries()) {
      const field = conditionFieldMap.get(condition.field);
      if (!field) {
        messages.push(`Condition ${index + 1}: choose a supported field.`);
        continue;
      }
      if (!field.operators.includes(condition.operator)) messages.push(`Condition ${index + 1}: choose an operator supported by ${field.label}.`);
      const needsValue = !["is_empty", "is_not_empty", "changed"].includes(condition.operator);
      const usesListValue = condition.operator === "in" || condition.operator === "not_in";
      if (needsValue && usesListValue && !(Array.isArray(condition.values) && condition.values.length)) messages.push(`Condition ${index + 1}: enter at least one value.`);
      if (needsValue && !usesListValue && isBlankValue(condition.value)) messages.push(`Condition ${index + 1}: enter a value.`);
    }
    if (draft.enabled && !scopedActions.length) messages.push("Enabled rules need at least one action.");
    for (const [index, action] of scopedActions.entries()) {
      const definition = actionDefinitionMap.get(action.type);
      if (!definition) {
        if (draft.enabled) messages.push(`Action ${index + 1}: choose a supported action.`);
        continue;
      }
      for (const field of definition.fields) {
        if (draft.enabled && field.required && isBlankValue(action[field.key])) {
          messages.push(`Action ${index + 1}: ${field.label} is required.`);
        }
      }
    }
    return messages;
  }, [actionDefinitionMap, conditionFieldMap, draft.enabled, draft.name, scopedActions, scopedConditions]);

  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, currentIndex) =>
        currentIndex === index ? { ...condition, ...patch } : condition,
      ),
    }));
  }

  function addCondition() {
    setDraft((current) => ({
      ...current,
      trigger_event: effectiveTriggerEvent,
      conditions: [...current.conditions, buildCondition(conditionFields[0])],
    }));
  }

  function removeCondition(index: number) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function updateAction(index: number, patch: Partial<AutomationActionConfig>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, currentIndex) =>
        currentIndex === index ? { ...action, ...patch } : action,
      ),
    }));
  }

  function addAction() {
    setDraft((current) => ({
      ...current,
      trigger_event: effectiveTriggerEvent,
      actions: [...current.actions, buildAction(actionDefinitions[0])],
    }));
  }

  function removeAction(index: number) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function resetDraft() {
    setDraft({ ...EMPTY_DRAFT, trigger_event: effectiveTriggerEvent, conditions: [], actions: [] });
  }

  function buildRulePayload() {
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      enabled: draft.enabled,
      trigger_event: effectiveTriggerEvent,
      condition_mode: draft.condition_mode,
      conditions_json: scopedConditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
        values: condition.values,
      })),
      actions_json: scopedActions.map(serializeAction),
    };
  }

  const previewMutation = useMutation({
    mutationFn: async () => previewRule(buildRulePayload()),
    onSuccess: () => toast.success("Automation draft is valid."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to validate automation draft."),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildRulePayload();
      if (!payload.name) throw new Error("Rule name is required.");
      const res = await apiFetch(draft.id ? `/admin/automation-rules/${draft.id}` : "/admin/automation-rules", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      return body as AutomationRule;
    },
    onSuccess: async (rule) => {
      toast.success("Automation rule saved.");
      setDraft(ruleToDraft(rule));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["automation-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["automation-rule-runs"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save rule."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: number) => {
      const res = await apiFetch(`/admin/automation-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }
    },
    onSuccess: async () => {
      toast.success("Automation rule deleted.");
      setDraft(EMPTY_DRAFT);
      await queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to delete rule."),
  });

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title={selectedModuleLabel ? `${selectedModuleLabel} Automation` : "Automation"}
        description={selectedModuleLabel ? "Configure module-specific workflow rules and review matching runs." : "Configure CRM event rules and review recent automation runs."}
        actions={
          selectedModuleKey ? (
            <Link
              href={SETTINGS_ROUTES.automation}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
            >
              <ArrowLeft size={15} />
              Global Automation
            </Link>
          ) : null
        }
      />

      <Card className="px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field>
            <FieldLabel>Automation scope</FieldLabel>
            <Select
              value={selectedModuleKey ?? "global"}
              onValueChange={(value) => {
                window.location.href = value === "global" ? SETTINGS_ROUTES.automation : `${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(value)}`;
              }}
            >
              <SelectTrigger className="w-full md:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global Automation Center</SelectItem>
                {MODULE_REGISTRY.filter((module) => !module.adminOnly && module.enabled).map((module) => (
                  <SelectItem key={module.key} value={module.key}>{module.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedModuleLabel ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-sm text-neutral-400">
              Showing rules for {selectedModuleLabel}.
            </div>
          ) : (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-sm text-neutral-400">
              Showing all automation rules.
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Rules</h2>
              <p className="mt-1 text-sm text-neutral-500">Enabled rules run when matching CRM events are recorded.</p>
            </div>
            <Button type="button" variant="secondary" onClick={resetDraft}>New Rule</Button>
          </div>
          <div className="grid gap-2">
            {(rulesQuery.data ?? []).map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => setDraft(ruleToDraft(rule))}
                className={rule.id === selectedRuleId ? "rounded-md border border-sky-700 bg-sky-950/30 px-4 py-3 text-left" : "rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-left hover:border-neutral-700"}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-neutral-100">{rule.name}</span>
                  <span className={rule.enabled ? "text-xs text-emerald-300" : "text-xs text-neutral-500"}>{rule.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{rule.trigger_event}</div>
                {rule.module_key ? <div className="mt-1 text-xs text-neutral-600">{formatModuleLabel(rule.module_key)}</div> : null}
              </button>
            ))}
            {!rulesQuery.isLoading && !(rulesQuery.data ?? []).length ? <div className="rounded-md border border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">No automation rules yet.</div> : null}
          </div>
        </Card>

        <Card className="px-5 py-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-neutral-100">{draft.id ? "Edit Rule" : "Create Rule"}</h2>
            <FieldDescription className="mt-1">Actions are restricted to platform-safe types.</FieldDescription>
          </div>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Trigger</FieldLabel>
              <Select value={effectiveTriggerEvent} onValueChange={(value) => setDraft((current) => ({ ...current, trigger_event: value, conditions: [], actions: [] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(visibleTriggerGroups.length ? visibleTriggerGroups : [{ module_key: "sales_leads", triggers: [{ key: "lead.created", module_key: "sales_leads", label: "Lead created", description: "" }] }]).map((group) => (
                    <SelectGroup key={group.module_key}>
                      <SelectLabel>{formatModuleLabel(group.module_key)}</SelectLabel>
                      {group.triggers.map((trigger) => (
                        <SelectItem key={trigger.key} value={trigger.key}>{trigger.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Condition match</FieldLabel>
              <Select value={draft.condition_mode} onValueChange={(value) => setDraft((current) => ({ ...current, condition_mode: value as "all" | "any" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All conditions</SelectItem>
                  <SelectItem value="any">Any condition</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Enabled</FieldLabel>
              <div className="flex h-10 items-center">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                  className="relative h-6 w-11 shrink-0 rounded-full border border-neutral-700 bg-neutral-800 data-[state=checked]:bg-emerald-600"
                >
                  <SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
                </Switch>
              </div>
            </Field>
            <Field className="md:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <FieldLabel>Conditions</FieldLabel>
                  <FieldDescription className="mt-1">{draft.condition_mode === "all" ? "Every condition must match." : "At least one condition must match."}</FieldDescription>
                </div>
                <Button type="button" variant="outline" onClick={addCondition} disabled={!conditionFields.length}>
                  <Plus className="h-4 w-4" />
                  Add Condition
                </Button>
              </div>
              <div className="space-y-3">
                {scopedConditions.length ? (
                  scopedConditions.map((condition, index) => {
                    const selectedField = conditionFieldMap.get(condition.field);
                    const operators = selectedField?.operators ?? ["equals"];
                    const hidesValue = condition.operator === "is_empty" || condition.operator === "is_not_empty" || condition.operator === "changed";
                    const usesListValue = condition.operator === "in" || condition.operator === "not_in";

                    return (
                      <div key={condition.id ?? `${condition.field}-${index}`} className="grid gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3 md:grid-cols-[1.2fr_1fr_1.2fr_auto]">
                        <div className="space-y-2">
                          <FieldLabel>Field</FieldLabel>
                          <Select
                            value={condition.field || undefined}
                            onValueChange={(value) => {
                              const field = conditionFieldMap.get(value);
                              updateCondition(index, { field: value, operator: field?.operators[0] ?? "equals", value: "", values: [] });
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Choose field" /></SelectTrigger>
                            <SelectContent>
                              {conditionFields.map((field) => (
                                <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>Operator</FieldLabel>
                          <Select value={condition.operator} onValueChange={(value) => updateCondition(index, { operator: value, value: "", values: [] })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {operators.map((operator) => (
                                <SelectItem key={operator} value={operator}>{OPERATOR_LABELS[operator] ?? operator}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>Value</FieldLabel>
                          {hidesValue ? (
                            <div className="flex h-10 items-center rounded-md border border-neutral-800 px-3 text-sm text-neutral-500">No value needed</div>
                          ) : selectedField?.field_type === "select" && selectedField.options.length && !usesListValue ? (
                            <Select value={typeof condition.value === "string" ? condition.value : ""} onValueChange={(value) => updateCondition(index, { value })}>
                              <SelectTrigger><SelectValue placeholder="Choose value" /></SelectTrigger>
                              <SelectContent>
                                {selectedField.options.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={selectedField?.field_type === "number" ? "number" : selectedField?.field_type === "date" ? "date" : "text"}
                              value={
                                usesListValue
                                  ? Array.isArray(condition.values)
                                    ? condition.values.join(", ")
                                    : ""
                                  : typeof condition.value === "string" || typeof condition.value === "number"
                                    ? String(condition.value)
                                    : ""
                              }
                              onChange={(event) =>
                                updateCondition(
                                  index,
                                  usesListValue
                                    ? { values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }
                                    : { value: event.target.value },
                                )
                              }
                              placeholder={usesListValue ? "Comma-separated values" : "Value"}
                            />
                          )}
                        </div>
                        <div className="flex items-end">
                          <Button type="button" variant="outline" size="sm" onClick={() => removeCondition(index)}>
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-neutral-800 px-4 py-5 text-sm text-neutral-500">No conditions set.</div>
                )}
              </div>
            </Field>
            <Field className="md:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <FieldLabel>Actions</FieldLabel>
                  <FieldDescription className="mt-1">Actions run in order when the trigger and conditions match.</FieldDescription>
                </div>
                <Button type="button" variant="outline" onClick={addAction} disabled={!actionDefinitions.length}>
                  <Plus className="h-4 w-4" />
                  Add Action
                </Button>
              </div>
              <div className="space-y-3">
                {scopedActions.length ? (
                  scopedActions.map((action, index) => {
                    const selectedAction = actionDefinitionMap.get(action.type);
                    return (
                      <div key={action.id ?? `${action.type}-${index}`} className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
                        <div className="grid gap-3 md:grid-cols-[1.2fr_auto]">
                          <div className="space-y-2">
                            <FieldLabel>Action</FieldLabel>
                            <Select
                              value={action.type || undefined}
                              onValueChange={(value) => updateAction(index, buildAction(actionDefinitionMap.get(value)))}
                            >
                              <SelectTrigger><SelectValue placeholder="Choose action" /></SelectTrigger>
                              <SelectContent>
                                {actionDefinitions.map((definition) => (
                                  <SelectItem key={definition.key} value={definition.key}>{definition.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedAction ? <FieldDescription>{selectedAction.description}</FieldDescription> : null}
                          </div>
                          <div className="flex items-end">
                            <Button type="button" variant="outline" size="sm" onClick={() => removeAction(index)}>
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </Button>
                          </div>
                        </div>

                        {selectedAction?.fields.length ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {selectedAction.fields.map((field) => (
                              <div key={field.key} className={field.field_type === "textarea" ? "space-y-2 md:col-span-2" : "space-y-2"}>
                                <FieldLabel>{field.label}{field.required ? " *" : ""}</FieldLabel>
                                {field.field_type === "select" ? (
                                  <Select
                                    value={valueAsString(action[field.key])}
                                    onValueChange={(value) => updateAction(index, { [field.key]: value })}
                                  >
                                    <SelectTrigger><SelectValue placeholder={field.placeholder ?? "Choose value"} /></SelectTrigger>
                                    <SelectContent>
                                      {field.options.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : field.field_type === "textarea" ? (
                                  <textarea
                                    className="min-h-24 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600"
                                    value={valueAsString(action[field.key])}
                                    onChange={(event) => updateAction(index, { [field.key]: event.target.value })}
                                    placeholder={field.placeholder ?? undefined}
                                  />
                                ) : (
                                  <Input
                                    type={field.field_type === "number" ? "number" : "text"}
                                    value={valueAsString(action[field.key])}
                                    onChange={(event) => updateAction(index, { [field.key]: field.field_type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value })}
                                    placeholder={field.placeholder ?? undefined}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-neutral-800 px-4 py-5 text-sm text-neutral-500">No actions set.</div>
                )}
              </div>
            </Field>
          </FieldGroup>
          <div className="mt-5 rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Preview and validation</h3>
                <p className="mt-1 text-sm text-neutral-500">Check the draft before saving. Validation does not run any actions.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !draft.name.trim()}>
                <ListChecks className="h-4 w-4" />
                {previewMutation.isPending ? "Checking..." : "Validate Draft"}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-neutral-800 px-3 py-2">
                <div className="text-xs uppercase text-neutral-500">When</div>
                <div className="mt-1 text-sm text-neutral-200">{effectiveTriggerEvent}</div>
              </div>
              <div className="rounded-md border border-neutral-800 px-3 py-2">
                <div className="text-xs uppercase text-neutral-500">If</div>
                <div className="mt-1 text-sm text-neutral-200">{scopedConditions.length ? `${scopedConditions.length} condition${scopedConditions.length === 1 ? "" : "s"} (${draft.condition_mode})` : "No conditions"}</div>
              </div>
              <div className="rounded-md border border-neutral-800 px-3 py-2">
                <div className="text-xs uppercase text-neutral-500">Do</div>
                <div className="mt-1 text-sm text-neutral-200">{scopedActions.length ? `${scopedActions.length} action${scopedActions.length === 1 ? "" : "s"}` : "No actions"}</div>
              </div>
            </div>
            {builderMessages.length ? (
              <div className="mt-4 rounded-md border border-amber-900/70 bg-amber-950/30 px-3 py-3 text-sm text-amber-200">
                <div className="font-medium">Needs attention</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {builderMessages.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-emerald-900/70 bg-emerald-950/20 px-3 py-3 text-sm text-emerald-200">
                Builder fields look complete.
              </div>
            )}
            {previewMutation.data ? (
              <div className="mt-4 rounded-md border border-neutral-800 px-3 py-3 text-sm text-neutral-300">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={previewMutation.data.can_enable ? "text-emerald-300" : "text-amber-300"}>
                    {previewMutation.data.can_enable ? "Ready to enable" : "Saved draft only"}
                  </span>
                  <span className="text-neutral-500">{formatModuleLabel(previewMutation.data.module_key ?? "global")}</span>
                  <span className="text-neutral-500">{previewMutation.data.condition_count} conditions</span>
                  <span className="text-neutral-500">{previewMutation.data.action_count} actions</span>
                </div>
                {previewMutation.data.actions.length ? (
                  <div className="mt-3 grid gap-2">
                    {previewMutation.data.actions.map((action) => (
                      <div key={`${action.index}-${action.type}`} className="rounded-md bg-neutral-900 px-3 py-2">
                        {action.index + 1}. {action.label}
                      </div>
                    ))}
                  </div>
                ) : null}
                {previewMutation.data.warnings.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-200">
                    {previewMutation.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {previewMutation.error ? (
              <div className="mt-4 rounded-md border border-red-900/70 bg-red-950/30 px-3 py-3 text-sm text-red-200">
                {previewMutation.error instanceof Error ? previewMutation.error.message : "Draft validation failed."}
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap justify-between gap-3">
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.name.trim()}>
              <Save />{saveMutation.isPending ? "Saving..." : "Save Rule"}
            </Button>
            {draft.id ? (
              <Button type="button" variant="destructive" onClick={() => deleteMutation.mutate(draft.id!)} disabled={deleteMutation.isPending}>
                <Trash2 />Delete
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="px-5 py-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-neutral-100">Run History</h2>
          <p className="mt-1 text-sm text-neutral-500">{selectedRule ? `Showing recent runs for ${selectedRule.name}.` : "Showing recent runs across automation rules."}</p>
        </div>
        <Table>
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Run</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Error</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {(runsQuery.data ?? []).map((run) => (
              <TableRow key={run.id}>
                <TableCell>#{run.id}</TableCell>
                <TableCell>{run.rule_id}</TableCell>
                <TableCell><span className={run.status === "succeeded" ? "text-emerald-300" : run.status === "failed" ? "text-red-300" : "text-neutral-300"}>{run.status}</span></TableCell>
                <TableCell>{run.event_id ? `#${run.event_id}` : "-"}</TableCell>
                <TableCell>{formatDateTime(run.started_at)}</TableCell>
                <TableCell className="max-w-md truncate">{run.error_message || "-"}</TableCell>
              </TableRow>
            ))}
            {!runsQuery.isLoading && !(runsQuery.data ?? []).length ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-neutral-500">No automation runs yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ruleToDraft(rule: AutomationRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    enabled: rule.enabled,
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
      id: createDraftId(),
      type: typeof action.type === "string" ? action.type : "",
      ...action,
    })),
  };
}
