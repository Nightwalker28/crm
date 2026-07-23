"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  Filter,
  History,
  ListChecks,
  Plus,
  Save,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { MODULE_REGISTRY, getModuleRegistryLabel } from "@/lib/module-registry";
import { SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

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

type AutomationCondition = {
  id: string;
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
  id: string;
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

type InspectorSelection =
  | { kind: "settings" }
  | { kind: "trigger" }
  | { kind: "condition"; id: string }
  | { kind: "action"; id: string }
  | { kind: "validation" };

type AutomationMode = "builder" | "runs";

const EMPTY_CONDITION_FIELDS: AutomationConditionField[] = [];
const EMPTY_ACTION_DEFINITIONS: AutomationActionDefinition[] = [];

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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyDraft(triggerEvent = "lead.created"): RuleDraft {
  return {
    name: "",
    description: "",
    enabled: false,
    trigger_event: triggerEvent,
    condition_mode: "all",
    conditions: [],
    actions: [],
  };
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
    if (field.field_type === "select") action[field.key] = field.options[0]?.value ?? "";
    else if (field.key === "priority") action[field.key] = "medium";
    else if (field.field_type === "actor_or_user_id") action[field.key] = "actor";
    else action[field.key] = "";
  }
  return action;
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

function draftSignature(draft: RuleDraft) {
  return JSON.stringify(draft);
}

function serializeAction(action: AutomationActionConfig) {
  const { id, ...payload } = action;
  void id;
  return payload;
}

function valueAsString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isBlankValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function formatModuleLabel(moduleKey: string) {
  return moduleKey.split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatRunSource(run: AutomationRun) {
  if (run.source_label) return run.source_label;
  if (run.source_module_key && run.source_record_id) return `${formatModuleLabel(run.source_module_key)} #${run.source_record_id}`;
  if (run.event_id) return `Event #${run.event_id}`;
  return "Not recorded";
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function statusPill(status: string) {
  if (status === "succeeded") return { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/30" };
  if (status === "failed") return { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/30" };
  if (status === "skipped") return { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/30" };
  return {};
}

async function fetchRules(moduleKey?: string | null): Promise<AutomationRule[]> {
  const params = new URLSearchParams();
  if (moduleKey) params.set("module_key", moduleKey);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/admin/automation-rules${suffix}`);
  if (!response.ok) throw new Error("rules");
  const body = await response.json();
  return body.results ?? [];
}

async function fetchTriggerRegistry(): Promise<AutomationTriggerGroup[]> {
  const response = await apiFetch("/admin/automation-rules/trigger-registry");
  if (!response.ok) throw new Error("triggers");
  const body = await response.json();
  return body.results ?? [];
}

async function fetchConditionFields(triggerEvent: string): Promise<AutomationConditionField[]> {
  const params = new URLSearchParams({ trigger_event: triggerEvent });
  const response = await apiFetch(`/admin/automation-rules/condition-fields?${params.toString()}`);
  if (!response.ok) throw new Error("conditions");
  const body = await response.json();
  return body.results ?? [];
}

async function fetchActionRegistry(triggerEvent: string): Promise<AutomationActionDefinition[]> {
  const params = new URLSearchParams({ trigger_event: triggerEvent });
  const response = await apiFetch(`/admin/automation-rules/action-registry?${params.toString()}`);
  if (!response.ok) throw new Error("actions");
  const body = await response.json();
  return body.results ?? [];
}

async function fetchRuns(ruleId?: number, moduleKey?: string | null): Promise<AutomationRun[]> {
  const params = new URLSearchParams({ page: "1", page_size: "10" });
  if (ruleId) params.set("rule_id", String(ruleId));
  if (moduleKey) params.set("module_key", moduleKey);
  const response = await apiFetch(`/admin/automation-rules/runs?${params.toString()}`);
  if (!response.ok) throw new Error("runs");
  const body = await response.json();
  return body.results ?? [];
}

async function previewRule(payload: Record<string, unknown>): Promise<AutomationRulePreview> {
  const response = await apiFetch("/admin/automation-rules/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("preview");
  return response.json();
}

function StepCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  selected,
  onClick,
  actions,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-card)] border border-line-default bg-surface p-3 transition-colors",
        selected && "border-primary bg-action-primary-muted",
      )}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-copy-muted">{eyebrow}</span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-copy-primary">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-copy-muted">{description}</span>
        </span>
      </button>
      {actions}
      <ChevronRight className="h-4 w-4 shrink-0 text-copy-disabled" aria-hidden="true" />
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="h-5 w-10 rounded-full border border-line-strong bg-surface-raised p-0.5 data-[state=checked]:bg-primary"
      >
        <SwitchThumb className="block h-4 w-4 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
      </Switch>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  );
}

export default function AutomationSettingsPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const selectedModuleKey = searchParams.get("module_key")?.trim() || null;
  const selectedModuleLabel = selectedModuleKey
    ? (getModuleRegistryLabel(selectedModuleKey) ?? formatModuleLabel(selectedModuleKey))
    : null;

  const [draft, setDraft] = useState<RuleDraft>(() => emptyDraft());
  const [baseline, setBaseline] = useState(() => draftSignature(emptyDraft()));
  const [selection, setSelection] = useState<InspectorSelection>({ kind: "settings" });
  const [mode, setMode] = useState<AutomationMode>("builder");
  const [ruleSearch, setRuleSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["automation-rules", selectedModuleKey ?? "all"],
    queryFn: () => fetchRules(selectedModuleKey),
  });
  const triggersQuery = useQuery({
    queryKey: ["automation-rule-trigger-registry"],
    queryFn: fetchTriggerRegistry,
  });
  const visibleTriggerGroups = useMemo(() => {
    const groups = triggersQuery.data ?? [];
    return selectedModuleKey ? groups.filter((group) => group.module_key === selectedModuleKey) : groups;
  }, [selectedModuleKey, triggersQuery.data]);
  const visibleTriggerKeys = useMemo(
    () => new Set(visibleTriggerGroups.flatMap((group) => group.triggers.map((trigger) => trigger.key))),
    [visibleTriggerGroups],
  );
  const firstVisibleTriggerKey = visibleTriggerGroups[0]?.triggers[0]?.key ?? "lead.created";
  const effectiveTriggerEvent = visibleTriggerKeys.size && !visibleTriggerKeys.has(draft.trigger_event)
    ? firstVisibleTriggerKey
    : draft.trigger_event;
  const selectedTrigger = visibleTriggerGroups.flatMap((group) => group.triggers).find((trigger) => trigger.key === effectiveTriggerEvent);

  const conditionFieldsQuery = useQuery({
    queryKey: ["automation-rule-condition-fields", effectiveTriggerEvent],
    queryFn: () => fetchConditionFields(effectiveTriggerEvent),
  });
  const actionRegistryQuery = useQuery({
    queryKey: ["automation-rule-action-registry", effectiveTriggerEvent],
    queryFn: () => fetchActionRegistry(effectiveTriggerEvent),
  });
  const runsQuery = useQuery({
    queryKey: ["automation-rule-runs", selectedModuleKey ?? "all", draft.id ?? "all"],
    queryFn: () => fetchRuns(draft.id, selectedModuleKey),
  });

  const conditionFields = conditionFieldsQuery.data ?? EMPTY_CONDITION_FIELDS;
  const conditionFieldMap = useMemo(() => new Map(conditionFields.map((field) => [field.key, field])), [conditionFields]);
  const actionDefinitions = actionRegistryQuery.data ?? EMPTY_ACTION_DEFINITIONS;
  const actionDefinitionMap = useMemo(() => new Map(actionDefinitions.map((action) => [action.key, action])), [actionDefinitions]);
  const selectedRun = (runsQuery.data ?? []).find((run) => run.id === selectedRunId) ?? null;
  const isDirty = draftSignature(draft) !== baseline;
  useUnsavedChangesGuard(isDirty);

  const builderMessages = useMemo(() => {
    const messages: string[] = [];
    if (!draft.name.trim()) messages.push("Rule name is required.");
    for (const [index, condition] of draft.conditions.entries()) {
      const field = conditionFieldMap.get(condition.field);
      if (!field) {
        messages.push(`Condition ${index + 1}: choose a supported field.`);
        continue;
      }
      if (!field.operators.includes(condition.operator)) messages.push(`Condition ${index + 1}: choose a supported operator.`);
      const needsValue = !["is_empty", "is_not_empty", "changed"].includes(condition.operator);
      const usesList = condition.operator === "in" || condition.operator === "not_in";
      if (needsValue && usesList && !(Array.isArray(condition.values) && condition.values.length)) messages.push(`Condition ${index + 1}: enter at least one value.`);
      if (needsValue && !usesList && isBlankValue(condition.value)) messages.push(`Condition ${index + 1}: enter a value.`);
    }
    if (draft.enabled && !draft.actions.length) messages.push("Enabled rules need at least one action.");
    for (const [index, action] of draft.actions.entries()) {
      const definition = actionDefinitionMap.get(action.type);
      if (!definition) {
        if (draft.enabled) messages.push(`Action ${index + 1}: choose a supported action.`);
        continue;
      }
      for (const field of definition.fields) {
        if (draft.enabled && field.required && isBlankValue(action[field.key])) messages.push(`Action ${index + 1}: ${field.label} is required.`);
      }
    }
    return messages;
  }, [actionDefinitionMap, conditionFieldMap, draft]);

  const filteredRules = useMemo(() => {
    const query = ruleSearch.trim().toLowerCase();
    const rules = rulesQuery.data ?? [];
    if (!query) return rules;
    return rules.filter((rule) => [rule.name, rule.description, rule.trigger_event].some((value) => value?.toLowerCase().includes(query)));
  }, [ruleSearch, rulesQuery.data]);

  function buildRulePayload() {
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      enabled: draft.enabled,
      trigger_event: effectiveTriggerEvent,
      condition_mode: draft.condition_mode,
      conditions_json: draft.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
        values: condition.values,
      })),
      actions_json: draft.actions.map(serializeAction),
    };
  }

  function confirmDiscard() {
    return !isDirty || window.confirm("Discard unsaved automation changes?");
  }

  function chooseRule(rule: AutomationRule) {
    if (!confirmDiscard()) return;
    const next = ruleToDraft(rule);
    setDraft(next);
    setBaseline(draftSignature(next));
    setSelection({ kind: "settings" });
    setMode("builder");
  }

  function startNewRule() {
    if (!confirmDiscard()) return;
    const next = emptyDraft(firstVisibleTriggerKey);
    setDraft(next);
    setBaseline(draftSignature(next));
    setSelection({ kind: "settings" });
    setMode("builder");
  }

  function updateCondition(id: string, patch: Partial<AutomationCondition>) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) => condition.id === id ? { ...condition, ...patch } : condition),
    }));
  }

  function addCondition() {
    const condition = buildCondition(conditionFields[0]);
    setDraft((current) => ({ ...current, trigger_event: effectiveTriggerEvent, conditions: [...current.conditions, condition] }));
    setSelection({ kind: "condition", id: condition.id });
  }

  function removeCondition(id: string) {
    setDraft((current) => ({ ...current, conditions: current.conditions.filter((condition) => condition.id !== id) }));
    setSelection({ kind: "validation" });
  }

  function updateAction(id: string, patch: Partial<AutomationActionConfig>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => action.id === id ? { ...action, ...patch } : action),
    }));
  }

  function addAction() {
    const action = buildAction(actionDefinitions[0]);
    setDraft((current) => ({ ...current, trigger_event: effectiveTriggerEvent, actions: [...current.actions, action] }));
    setSelection({ kind: "action", id: action.id });
  }

  function removeAction(id: string) {
    setDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.id !== id) }));
    setSelection({ kind: "validation" });
  }

  function moveAction(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.actions.findIndex((action) => action.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.actions.length) return current;
      const actions = [...current.actions];
      [actions[index], actions[target]] = [actions[target], actions[index]];
      return { ...current, actions };
    });
  }

  const previewMutation = useMutation({
    mutationFn: () => previewRule(buildRulePayload()),
    onSuccess: () => toast.success("Automation draft is valid."),
    onError: () => toast.error("The automation draft could not be validated."),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildRulePayload();
      if (!payload.name) throw new Error("invalid");
      const response = await apiFetch(draft.id ? `/admin/automation-rules/${draft.id}` : "/admin/automation-rules", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("save");
      return response.json() as Promise<AutomationRule>;
    },
    onSuccess: async (rule) => {
      const next = ruleToDraft(rule);
      setDraft(next);
      setBaseline(draftSignature(next));
      toast.success("Automation rule saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["automation-rules"] }),
        queryClient.invalidateQueries({ queryKey: ["automation-rule-runs"] }),
      ]);
    },
    onError: () => toast.error("The automation rule could not be saved. Review the highlighted requirements and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: number) => {
      const response = await apiFetch(`/admin/automation-rules/${ruleId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete");
    },
    onSuccess: async () => {
      const next = emptyDraft(firstVisibleTriggerKey);
      setDraft(next);
      setBaseline(draftSignature(next));
      setSelection({ kind: "settings" });
      toast.success("Automation rule deleted.");
      await queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
    },
    onError: () => toast.error("The automation rule could not be deleted."),
  });

  const isInitialLoading = rulesQuery.isLoading || triggersQuery.isLoading;
  const hasInitialError = rulesQuery.isError || triggersQuery.isError;
  if (isInitialLoading) return <RouteLoadingState label="automation builder" />;
  if (hasInitialError) {
    return (
      <RouteErrorState
        title="Automation builder could not be loaded"
        description="Your rules are unchanged. Try loading the builder again."
        reset={() => {
          void rulesQuery.refetch();
          void triggersQuery.refetch();
        }}
        backHref="/dashboard/settings"
        backLabel="Return to settings"
      />
    );
  }

  const selectedCondition = selection.kind === "condition"
    ? draft.conditions.find((condition) => condition.id === selection.id) ?? null
    : null;
  const selectedConditionField = selectedCondition ? conditionFieldMap.get(selectedCondition.field) : null;
  const selectedAction = selection.kind === "action"
    ? draft.actions.find((action) => action.id === selection.id) ?? null
    : null;
  const selectedActionDefinition = selectedAction ? actionDefinitionMap.get(selectedAction.type) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={selectedModuleLabel ? `${selectedModuleLabel} Automation` : "Automation Builder"}
        description={selectedModuleLabel ? "Build and inspect workflow rules for this module." : "Build tenant workflow rules from supported CRM events and platform-safe actions."}
        actions={
          selectedModuleKey ? (
            <Button asChild variant="outline">
              <Link href={SETTINGS_ROUTES.automation}><ArrowLeft />Global automation</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="flex-col gap-3">
            <div className="flex w-full items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-copy-primary">Rules</h2>
                <p className="text-sm text-copy-muted">{(rulesQuery.data ?? []).length} configured</p>
              </div>
              <Button type="button" size="icon-sm" aria-label="New automation rule" onClick={startNewRule}><Plus /></Button>
            </div>
            <Field>
              <FieldLabel className="sr-only">Automation scope</FieldLabel>
              <Select
                value={selectedModuleKey ?? "global"}
                onValueChange={(value) => {
                  if (!confirmDiscard()) return;
                  window.location.href = value === "global"
                    ? SETTINGS_ROUTES.automation
                    : `${SETTINGS_ROUTES.automation}?module_key=${encodeURIComponent(value)}`;
                }}
              >
                <SelectTrigger aria-label="Automation scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">All modules</SelectItem>
                  {MODULE_REGISTRY.filter((module) => !module.adminOnly && module.enabled && !module.requiredModuleKey).map((module) => (
                    <SelectItem key={module.key} value={module.key}>{module.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <SearchBar value={ruleSearch} onChange={setRuleSearch} placeholder="Search rules" className="md:w-full" />
          </CardHeader>
          <CardBody className="max-h-[58vh] overflow-y-auto px-3 pt-1">
            <div className="grid gap-1">
              {filteredRules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => chooseRule(rule)}
                  className={cn(
                    "rounded-[var(--radius-control)] px-3 py-2.5 text-left hover:bg-surface-muted",
                    draft.id === rule.id && "bg-action-primary-muted text-primary",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{rule.name}</span>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", rule.enabled ? "bg-state-success" : "bg-copy-disabled")} aria-label={rule.enabled ? "Enabled" : "Disabled"} />
                  </span>
                  <span className="mt-1 block truncate text-xs text-copy-muted">{rule.trigger_event}</span>
                </button>
              ))}
              {!filteredRules.length ? <p className="px-3 py-6 text-center text-sm text-copy-muted">No matching rules.</p> : null}
            </div>
          </CardBody>
          <CardFooter className="grid grid-cols-2 gap-2">
            <Button type="button" variant={mode === "builder" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("builder")}><Workflow />Builder</Button>
            <Button type="button" variant={mode === "runs" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("runs")}><History />Runs</Button>
          </CardFooter>
        </Card>

        {mode === "builder" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0">
              <CardHeader>
                <button type="button" className="min-w-0 text-left" onClick={() => setSelection({ kind: "settings" })}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-copy-primary">{draft.name || "Untitled automation"}</h2>
                    <Pill>{draft.enabled ? "Enabled" : "Draft"}</Pill>
                  </div>
                  <p className="mt-1 text-sm text-copy-muted">{draft.description || "Select this header to edit rule settings."}</p>
                </button>
              </CardHeader>
              <CardBody className="bg-surface-muted/40">
                <div className="mx-auto grid max-w-2xl gap-3">
                  <StepCard
                    icon={Zap}
                    eyebrow="When"
                    title={selectedTrigger?.label ?? effectiveTriggerEvent}
                    description={selectedTrigger?.description ?? "Choose the event that starts this rule."}
                    selected={selection.kind === "trigger"}
                    onClick={() => setSelection({ kind: "trigger" })}
                    testId="automation-trigger-step"
                  />

                  <div className="mx-auto h-5 w-px bg-line-default" />

                  <div className="rounded-[var(--radius-card)] border border-line-subtle bg-surface-raised p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <button type="button" onClick={() => setSelection({ kind: "validation" })} className="text-left">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-copy-muted">If</span>
                        <span className="mt-0.5 block text-sm font-semibold text-copy-primary">
                          {draft.conditions.length
                            ? `${draft.conditions.length} condition${draft.conditions.length === 1 ? "" : "s"} · match ${draft.condition_mode}`
                            : "No conditions · always continue"}
                        </span>
                      </button>
                      <Button type="button" variant="outline" size="sm" onClick={addCondition} disabled={!conditionFields.length}><Plus />Condition</Button>
                    </div>
                    <div className="grid gap-2">
                      {draft.conditions.map((condition, index) => {
                        const field = conditionFieldMap.get(condition.field);
                        return (
                          <StepCard
                            key={condition.id}
                            icon={Filter}
                            eyebrow={`Condition ${index + 1}`}
                            title={field?.label ?? "Choose a field"}
                            description={`${OPERATOR_LABELS[condition.operator] ?? condition.operator}${isBlankValue(condition.value) ? "" : ` · ${valueAsString(condition.value)}`}`}
                            selected={selection.kind === "condition" && selection.id === condition.id}
                            onClick={() => setSelection({ kind: "condition", id: condition.id })}
                            testId={`automation-condition-${index}`}
                            actions={
                              <Button type="button" variant="dangerGhost" size="icon-sm" aria-label={`Delete condition ${index + 1}`} onClick={() => removeCondition(condition.id)}><Trash2 /></Button>
                            }
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="mx-auto h-5 w-px bg-line-default" />

                  <div className="rounded-[var(--radius-card)] border border-line-subtle bg-surface-raised p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-copy-muted">Do</span>
                        <span className="mt-0.5 block text-sm font-semibold text-copy-primary">
                          {draft.actions.length ? `${draft.actions.length} action${draft.actions.length === 1 ? "" : "s"} in order` : "No actions configured"}
                        </span>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addAction} disabled={!actionDefinitions.length}><Plus />Action</Button>
                    </div>
                    <div className="grid gap-2">
                      {draft.actions.map((action, index) => {
                        const definition = actionDefinitionMap.get(action.type);
                        return (
                          <StepCard
                            key={action.id}
                            icon={Bot}
                            eyebrow={`Action ${index + 1}`}
                            title={definition?.label ?? "Choose an action"}
                            description={definition?.description ?? "Configure this action in the inspector."}
                            selected={selection.kind === "action" && selection.id === action.id}
                            onClick={() => setSelection({ kind: "action", id: action.id })}
                            testId={`automation-action-${index}`}
                            actions={
                              <div className="flex items-center gap-0.5">
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move action ${index + 1} up`} onClick={() => moveAction(action.id, -1)} disabled={index === 0}><ArrowUp /></Button>
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move action ${index + 1} down`} onClick={() => moveAction(action.id, 1)} disabled={index === draft.actions.length - 1}><ArrowDown /></Button>
                                <Button type="button" variant="dangerGhost" size="icon-sm" aria-label={`Delete action ${index + 1}`} onClick={() => removeAction(action.id)}><Trash2 /></Button>
                              </div>
                            }
                          />
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelection({ kind: "validation" })}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line-default bg-surface px-4 py-3 text-left",
                      selection.kind === "validation" && "border-primary bg-action-primary-muted",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      {builderMessages.length ? <CircleDot className="h-5 w-5 text-state-warning" /> : <CheckCircle2 className="h-5 w-5 text-state-success" />}
                      <span>
                        <span className="block text-sm font-semibold text-copy-primary">Validation</span>
                        <span className="block text-xs text-copy-muted">{builderMessages.length ? `${builderMessages.length} item${builderMessages.length === 1 ? "" : "s"} need attention` : "Builder fields look complete"}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-copy-disabled" />
                  </button>
                </div>
              </CardBody>
              <CardFooter className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 bg-surface/95 backdrop-blur">
                <div className="mr-auto">
                  <p className={cn("text-sm font-medium", isDirty ? "text-state-warning" : "text-state-success")}>{isDirty ? "Unsaved changes" : "All changes saved"}</p>
                </div>
                <Button type="button" variant="outline" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !draft.name.trim()}><ListChecks />{previewMutation.isPending ? "Checking…" : "Validate"}</Button>
                <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !isDirty || !draft.name.trim()}><Save />{saveMutation.isPending ? "Saving…" : "Save rule"}</Button>
                {draft.id ? (
                  <Button
                    type="button"
                    variant="dangerGhost"
                    onClick={() => {
                      if (window.confirm(`Delete ${draft.name}? This rule will stop running immediately.`)) deleteMutation.mutate(draft.id as number);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 />Delete
                  </Button>
                ) : null}
              </CardFooter>
            </Card>

            <Card className="h-fit xl:sticky xl:top-4">
              <CardHeader>
                <div>
                  <h2 className="text-base font-semibold text-copy-primary">
                    {selection.kind === "settings" ? "Rule settings"
                      : selection.kind === "trigger" ? "Trigger"
                        : selection.kind === "condition" ? "Condition"
                          : selection.kind === "action" ? "Action"
                            : "Validation"}
                  </h2>
                  <p className="mt-1 text-sm text-copy-muted">Changes remain local until the rule is saved.</p>
                </div>
              </CardHeader>
              <CardBody>
                {selection.kind === "settings" ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="automation-rule-name">Name <RequiredMark /></FieldLabel>
                      <Input id="automation-rule-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Follow up on new leads" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-rule-description">Description</FieldLabel>
                      <Textarea id="automation-rule-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                    </Field>
                    <Toggle id="automation-rule-enabled" label="Rule enabled" checked={draft.enabled} onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                    <FieldDescription>Enabled rules begin matching new events after this draft is saved.</FieldDescription>
                  </FieldGroup>
                ) : selection.kind === "trigger" ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Trigger event</FieldLabel>
                      <Select
                        value={effectiveTriggerEvent}
                        onValueChange={(value) => {
                          if ((draft.conditions.length || draft.actions.length) && !window.confirm("Changing the trigger clears its conditions and actions. Continue?")) return;
                          setDraft((current) => ({ ...current, trigger_event: value, conditions: [], actions: [] }));
                        }}
                      >
                        <SelectTrigger aria-label="Trigger event"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {visibleTriggerGroups.map((group) => (
                            <SelectGroup key={group.module_key}>
                              <SelectLabel>{formatModuleLabel(group.module_key)}</SelectLabel>
                              {group.triggers.map((trigger) => <SelectItem key={trigger.key} value={trigger.key}>{trigger.label}</SelectItem>)}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm text-copy-secondary">
                      {selectedTrigger?.description ?? "This event starts the automation rule."}
                    </div>
                  </FieldGroup>
                ) : selection.kind === "condition" && selectedCondition ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Match mode</FieldLabel>
                      <Select value={draft.condition_mode} onValueChange={(value) => setDraft((current) => ({ ...current, condition_mode: value as "all" | "any" }))}>
                        <SelectTrigger aria-label="Condition match"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All conditions</SelectItem>
                          <SelectItem value="any">Any condition</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Field</FieldLabel>
                      <Select
                        value={selectedCondition.field || undefined}
                        onValueChange={(value) => {
                          const field = conditionFieldMap.get(value);
                          updateCondition(selectedCondition.id, { field: value, operator: field?.operators[0] ?? "equals", value: "", values: [] });
                        }}
                      >
                        <SelectTrigger aria-label="Condition field"><SelectValue placeholder="Choose field" /></SelectTrigger>
                        <SelectContent>{conditionFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>Operator</FieldLabel>
                      <Select value={selectedCondition.operator} onValueChange={(operator) => updateCondition(selectedCondition.id, { operator, value: "", values: [] })}>
                        <SelectTrigger aria-label="Condition operator"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(selectedConditionField?.operators ?? ["equals"]).map((operator) => <SelectItem key={operator} value={operator}>{OPERATOR_LABELS[operator] ?? operator}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <ConditionValueField condition={selectedCondition} field={selectedConditionField} onChange={(patch) => updateCondition(selectedCondition.id, patch)} />
                    <Button type="button" variant="dangerGhost" onClick={() => removeCondition(selectedCondition.id)}><Trash2 />Remove condition</Button>
                  </FieldGroup>
                ) : selection.kind === "action" && selectedAction ? (
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Action type</FieldLabel>
                      <Select
                        value={selectedAction.type || undefined}
                        onValueChange={(value) => {
                          const replacement = buildAction(actionDefinitionMap.get(value));
                          updateAction(selectedAction.id, { ...replacement, id: selectedAction.id });
                        }}
                      >
                        <SelectTrigger aria-label="Action type"><SelectValue placeholder="Choose action" /></SelectTrigger>
                        <SelectContent>
                          {actionDefinitions.map((definition) => <SelectItem key={definition.key} value={definition.key}>{definition.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {selectedActionDefinition ? <FieldDescription>{selectedActionDefinition.description}</FieldDescription> : null}
                    </Field>
                    {selectedActionDefinition?.fields.map((field) => (
                      <ActionValueField
                        key={field.key}
                        field={field}
                        value={selectedAction[field.key]}
                        onChange={(value) => updateAction(selectedAction.id, { [field.key]: value })}
                      />
                    ))}
                    <Button type="button" variant="dangerGhost" onClick={() => removeAction(selectedAction.id)}><Trash2 />Remove action</Button>
                  </FieldGroup>
                ) : (
                  <ValidationInspector messages={builderMessages} preview={previewMutation.data} error={previewMutation.isError} />
                )}
              </CardBody>
            </Card>
          </div>
        ) : (
          <RunHistory
            runs={runsQuery.data ?? []}
            isLoading={runsQuery.isLoading}
            isError={runsQuery.isError}
            selectedRun={selectedRun}
            onSelectRun={(runId) => setSelectedRunId((current) => current === runId ? null : runId)}
            onRetry={() => void runsQuery.refetch()}
            selectedRuleName={draft.id ? draft.name : null}
          />
        )}
      </div>
    </div>
  );
}

function ConditionValueField({
  condition,
  field,
  onChange,
}: {
  condition: AutomationCondition;
  field?: AutomationConditionField | null;
  onChange: (patch: Partial<AutomationCondition>) => void;
}) {
  const hidesValue = ["is_empty", "is_not_empty", "changed"].includes(condition.operator);
  const usesList = condition.operator === "in" || condition.operator === "not_in";

  return (
    <Field>
      <FieldLabel>Value</FieldLabel>
      {hidesValue ? (
        <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-muted">No value needed</div>
      ) : field?.field_type === "select" && field.options.length && !usesList ? (
        <Select value={valueAsString(condition.value)} onValueChange={(value) => onChange({ value })}>
          <SelectTrigger aria-label="Condition value"><SelectValue placeholder="Choose value" /></SelectTrigger>
          <SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : (
        <Input
          aria-label="Condition value"
          type={field?.field_type === "number" ? "number" : field?.field_type === "date" ? "date" : "text"}
          value={usesList ? (condition.values ?? []).join(", ") : valueAsString(condition.value)}
          onChange={(event) => onChange(usesList
            ? { values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }
            : { value: event.target.value })}
          placeholder={usesList ? "Comma-separated values" : "Value"}
        />
      )}
    </Field>
  );
}

function ActionValueField({
  field,
  value,
  onChange,
}: {
  field: AutomationActionField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <Field>
      <FieldLabel>{field.label}{field.required ? <RequiredMark /> : null}</FieldLabel>
      {field.field_type === "select" ? (
        <Select value={valueAsString(value)} onValueChange={onChange}>
          <SelectTrigger aria-label={field.label}><SelectValue placeholder={field.placeholder ?? "Choose value"} /></SelectTrigger>
          <SelectContent>{field.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      ) : field.field_type === "textarea" ? (
        <Textarea aria-label={field.label} value={valueAsString(value)} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder ?? undefined} />
      ) : (
        <Input
          aria-label={field.label}
          type={field.field_type === "number" ? "number" : "text"}
          value={valueAsString(value)}
          onChange={(event) => onChange(field.field_type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
          placeholder={field.placeholder ?? undefined}
        />
      )}
      {field.field_type === "actor_or_user_id" ? <FieldDescription>Use “actor” for the user who caused the event, or enter a tenant user ID.</FieldDescription> : null}
      {field.field_type === "payload_or_number" ? <FieldDescription>Leave blank to use the triggering record.</FieldDescription> : null}
    </Field>
  );
}

function ValidationInspector({
  messages,
  preview,
  error,
}: {
  messages: string[];
  preview?: AutomationRulePreview;
  error: boolean;
}) {
  return (
    <div className="grid gap-4">
      {messages.length ? (
        <div className="rounded-[var(--radius-control)] border border-state-warning/30 bg-state-warning-muted p-3 text-sm text-copy-secondary">
          <p className="font-semibold text-copy-primary">Needs attention</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{messages.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : (
        <div className="rounded-[var(--radius-control)] border border-state-success/30 bg-state-success-muted p-3 text-sm text-state-success">
          Builder fields look complete.
        </div>
      )}
      {preview ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Pill {...(preview.can_enable ? statusPill("succeeded") : statusPill("skipped"))}>{preview.can_enable ? "Ready to enable" : "Draft only"}</Pill>
            <Pill>{preview.condition_count} conditions</Pill>
            <Pill>{preview.action_count} actions</Pill>
          </div>
          {preview.actions.map((action) => (
            <div key={`${action.index}-${action.type}`} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary">
              {action.index + 1}. {action.label}
            </div>
          ))}
          {preview.warnings.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-state-warning">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-state-danger">The draft could not be validated. No actions were run.</p> : null}
      <p className="text-sm text-copy-muted">Validation checks configuration only. It never executes actions.</p>
    </div>
  );
}

function RunHistory({
  runs,
  isLoading,
  isError,
  selectedRun,
  onSelectRun,
  onRetry,
  selectedRuleName,
}: {
  runs: AutomationRun[];
  isLoading: boolean;
  isError: boolean;
  selectedRun: AutomationRun | null;
  onSelectRun: (runId: number) => void;
  onRetry: () => void;
  selectedRuleName: string | null;
}) {
  if (isError) {
    return (
      <Card>
        <EmptyState
          icon={History}
          title="Run history could not be loaded"
          description="The rules are unaffected. Try loading recent runs again."
          action={<Button type="button" variant="outline" onClick={onRetry}>Try again</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0">
        <CardHeader>
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">Run history</h2>
            <p className="mt-1 text-sm text-copy-secondary">{selectedRuleName ? `Recent runs for ${selectedRuleName}.` : "Recent runs across the selected module scope."}</p>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Rule</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="font-medium text-copy-primary">{run.rule_name ?? `Rule #${run.rule_id}`}</div>
                    <div className="mt-1 text-xs text-copy-muted">{run.trigger_event_key ?? "Unknown trigger"}</div>
                  </TableCell>
                  <TableCell>{formatRunSource(run)}</TableCell>
                  <TableCell><Pill {...statusPill(run.status)}>{run.status}</Pill></TableCell>
                  <TableCell>{run.action_success_count}/{run.action_attempt_count} succeeded</TableCell>
                  <TableCell>{formatDateTime(run.started_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onSelectRun(run.id)}><Eye />{selectedRun?.id === run.id ? "Hide" : "Inspect"}</Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !runs.length ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-copy-muted">No automation runs yet.</TableCell></TableRow> : null}
              {isLoading ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-copy-muted">Loading recent runs…</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Card className="h-fit xl:sticky xl:top-4">
        {selectedRun ? (
          <>
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-copy-primary">Run #{selectedRun.id}</h2>
                  <Pill {...statusPill(selectedRun.status)}>{selectedRun.status}</Pill>
                </div>
                <p className="mt-1 text-sm text-copy-muted">{formatRunSource(selectedRun)}</p>
              </div>
            </CardHeader>
            <CardBody className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-copy-muted">Started</p><p className="mt-1 text-copy-primary">{formatDateTime(selectedRun.started_at)}</p></div>
                <div><p className="text-copy-muted">Completed</p><p className="mt-1 text-copy-primary">{selectedRun.completed_at ? formatDateTime(selectedRun.completed_at) : selectedRun.finished_at ? formatDateTime(selectedRun.finished_at) : "In progress"}</p></div>
              </div>
              {selectedRun.error_message ? <div className="rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-state-danger">{selectedRun.error_message}</div> : null}
              <div>
                <h3 className="text-sm font-semibold text-copy-primary">Action steps</h3>
                <div className="mt-2 grid gap-2">
                  {(selectedRun.step_results_json ?? []).map((step, index) => (
                    <div key={`${selectedRun.id}-${index}`} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-copy-primary">{typeof step.type === "string" ? formatModuleLabel(step.type) : `Action ${index + 1}`}</span>
                        <span className={step.status === "success" ? "text-state-success" : step.status === "failed" ? "text-state-danger" : "text-copy-muted"}>{typeof step.status === "string" ? step.status : "unknown"}</span>
                      </div>
                      {typeof step.error === "string" ? <p className="mt-2 text-state-danger">{step.error}</p> : null}
                    </div>
                  ))}
                  {!(selectedRun.step_results_json ?? []).length ? <p className="text-sm text-copy-muted">No action-step details were recorded.</p> : null}
                </div>
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-copy-primary">Sanitized input</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(selectedRun.input_json)}</pre>
              </details>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-copy-primary">Sanitized result</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(selectedRun.result_json)}</pre>
              </details>
            </CardBody>
          </>
        ) : (
          <EmptyState icon={Clock3} title="Select a run" description="Inspect sanitized inputs, results, and action-step outcomes." />
        )}
      </Card>
    </div>
  );
}
