"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ListChecks, Power, PowerOff, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AutomationInspector } from "./AutomationInspector";
import { AutomationStepList } from "./AutomationStepList";
import type { AutomationActionConfig, AutomationCondition, AutomationRule, AutomationRulePreview, AutomationTriggerGroup, InspectorSelection, RuleDraft } from "./types";
import { buildAction, buildCondition, draftSignature, emptyDraft, isBlankValue, ruleToDraft, serializeDraft } from "./utils";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { useAutomationActions, useAutomationConditionFields, deleteAutomationRule, persistAutomationRule, previewAutomationRule } from "@/hooks/useAutomationRules";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

export function AutomationRuleEditor({ rule, duplicate = false, triggerGroups, onClose, onSaved, onDeleted }: {
  rule?: AutomationRule;
  duplicate?: boolean;
  triggerGroups: AutomationTriggerGroup[];
  onClose: () => void;
  onSaved: (rule: AutomationRule) => void;
  onDeleted: (ruleId: number) => void;
}) {
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const firstTrigger = triggerGroups[0]?.triggers[0]?.key ?? "";
  const initialDraft = useMemo(() => rule ? ruleToDraft(rule, duplicate) : emptyDraft(firstTrigger), [duplicate, firstTrigger, rule]);
  const [draft, setDraft] = useState<RuleDraft>(initialDraft);
  const [baselineDraft, setBaselineDraft] = useState<RuleDraft>(initialDraft);
  const [selection, setSelection] = useState<InspectorSelection>({ kind: "settings" });
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const conditionFieldsQuery = useAutomationConditionFields(draft.trigger_event);
  const actionDefinitionsQuery = useAutomationActions(draft.trigger_event);
  const conditionFields = useMemo(() => new Map((conditionFieldsQuery.data ?? []).map((field) => [field.key, field])), [conditionFieldsQuery.data]);
  const actionDefinitions = useMemo(() => new Map((actionDefinitionsQuery.data ?? []).map((action) => [action.key, action])), [actionDefinitionsQuery.data]);
  const selectedTrigger = triggerGroups.flatMap((group) => group.triggers).find((trigger) => trigger.key === draft.trigger_event);
  const isDirty = draftSignature(draft) !== draftSignature(baselineDraft);
  useUnsavedChangesGuard(isDirty);

  const messages = useMemo(() => {
    const next: string[] = [];
    if (!draft.name.trim()) next.push("Rule name is required.");
    if (!draft.trigger_event) next.push("Choose a trigger event.");
    for (const [index, condition] of draft.conditions.entries()) {
      const field = conditionFields.get(condition.field);
      if (!field) { next.push(`Condition ${index + 1}: choose a supported field.`); continue; }
      if (!field.operators.includes(condition.operator)) next.push(`Condition ${index + 1}: choose a supported operator.`);
      const needsValue = !["is_empty", "is_not_empty", "changed"].includes(condition.operator);
      const usesList = condition.operator === "in" || condition.operator === "not_in";
      if (needsValue && usesList && !condition.values?.length) next.push(`Condition ${index + 1}: enter at least one value.`);
      if (needsValue && !usesList && isBlankValue(condition.value)) next.push(`Condition ${index + 1}: enter a value.`);
    }
    if (!draft.actions.length) next.push("Add at least one action before enabling this rule.");
    for (const [index, action] of draft.actions.entries()) {
      const definition = actionDefinitions.get(action.type);
      if (!definition) { next.push(`Action ${index + 1}: choose a supported action.`); continue; }
      for (const field of definition.fields) if (field.required && isBlankValue(action[field.key])) next.push(`Action ${index + 1}: ${field.label} is required.`);
    }
    return next;
  }, [actionDefinitions, conditionFields, draft]);

  const previewMutation = useMutation<AutomationRulePreview, Error, boolean>({
    mutationFn: (enabled = draft.enabled) => previewAutomationRule(serializeDraft(draft, enabled)),
    onError: () => toast.error("The automation draft could not be validated."),
  });
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error("invalid");
      if (draft.enabled) {
        const preview = await previewAutomationRule(serializeDraft(draft, true));
        if (!preview.can_enable) throw new Error("cannot_enable");
      }
      return persistAutomationRule(draft.id, serializeDraft(draft));
    },
    onSuccess: async (savedRule) => {
      const next = ruleToDraft(savedRule);
      setDraft(next); setBaselineDraft(next); onSaved(savedRule);
      toast.success("Automation rule saved.");
      await queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
    },
    onError: (error) => toast.error(error.message === "cannot_enable" ? "This rule cannot be enabled until preview validation passes." : "The automation rule could not be saved."),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAutomationRule,
    onSuccess: async (_, ruleId) => { toast.success("Automation rule deleted."); onDeleted(ruleId); await queryClient.invalidateQueries({ queryKey: ["automation-rules"] }); },
    onError: () => toast.error("The automation rule could not be deleted."),
  });

  async function closeEditor() {
    if (isDirty && !(await confirm({ title: "Discard automation changes?", description: "Your unsaved trigger, conditions, and actions will be discarded.", confirmLabel: "Discard changes", variant: "destructive" }))) return;
    onClose();
  }
  function inspect(next: InspectorSelection) { setSelection(next); setInspectorOpen(true); }
  function updateCondition(id: string, patch: Partial<AutomationCondition>) { setDraft((current) => ({ ...current, conditions: current.conditions.map((condition) => condition.id === id ? { ...condition, ...patch } : condition) })); }
  function updateAction(id: string, patch: Partial<AutomationActionConfig>) { setDraft((current) => ({ ...current, actions: current.actions.map((action) => action.id === id ? { ...action, ...patch } : action) })); }
  function moveAction(id: string, direction: -1 | 1) { setDraft((current) => { const index = current.actions.findIndex((action) => action.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= current.actions.length) return current; const actions = [...current.actions]; [actions[index], actions[target]] = [actions[target], actions[index]]; return { ...current, actions }; }); }
  async function changeTrigger(trigger: string) {
    if ((draft.conditions.length || draft.actions.length) && !(await confirm({ title: "Change automation trigger?", description: "Changing the trigger clears conditions and actions because their registries depend on the trigger.", confirmLabel: "Change trigger", variant: "destructive" }))) return;
    setDraft((current) => ({ ...current, trigger_event: trigger, conditions: [], actions: [], enabled: false }));
  }
  async function changeEnabled(enabled: boolean) {
    if (!enabled) { setDraft((current) => ({ ...current, enabled: false })); return; }
    if (messages.length) { inspect({ kind: "validation" }); toast.error("Resolve the validation items before enabling this rule."); return; }
    try {
      const preview = await previewMutation.mutateAsync(true);
      if (!preview.can_enable) { inspect({ kind: "validation" }); toast.error("Resolve the validation items before enabling this rule."); return; }
      setDraft((current) => ({ ...current, enabled: true }));
    } catch { /* mutation owns safe feedback */ }
  }
  async function removeRule() {
    if (!draft.id) return;
    if (await confirm({ title: `Delete ${draft.name}?`, description: "The rule will stop running. Existing history remains available for audit.", confirmLabel: "Delete rule", variant: "destructive" })) deleteMutation.mutate(draft.id);
  }

  return <div className="min-w-0">
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => void closeEditor()}><ArrowLeft />Rules</Button>
        <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => inspect({ kind: "settings" })}><span className="flex flex-wrap items-center gap-2"><span className="truncate text-base font-semibold text-copy-primary">{draft.name || "Untitled automation"}</span><Chip>{draft.enabled ? "Enabled" : draft.id ? "Disabled" : "Draft"}</Chip></span><span className="mt-1 block truncate text-sm text-copy-muted">{draft.description || "Select to edit rule settings."}</span></button>
      </CardHeader>
      <CardBody className="bg-surface-muted/40 py-5"><AutomationStepList draft={draft} selection={selection} triggerLabel={selectedTrigger?.label ?? draft.trigger_event} triggerDescription={selectedTrigger?.description ?? "Choose the event that starts this rule."} conditionFields={conditionFields} actionDefinitions={actionDefinitions} messages={messages} onInspect={inspect} onAddCondition={() => { const condition = buildCondition(conditionFields.values().next().value); setDraft((current) => ({ ...current, conditions: [...current.conditions, condition] })); inspect({ kind: "condition", id: condition.id }); }} onRemoveCondition={(id) => { setDraft((current) => ({ ...current, conditions: current.conditions.filter((condition) => condition.id !== id) })); inspect({ kind: "validation" }); }} onAddAction={() => { const action = buildAction(actionDefinitions.values().next().value); setDraft((current) => ({ ...current, actions: [...current.actions, action] })); inspect({ kind: "action", id: action.id }); }} onRemoveAction={(id) => { setDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.id !== id) })); inspect({ kind: "validation" }); }} onMoveAction={moveAction} /></CardBody>
      <CardFooter className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 bg-surface/95 backdrop-blur">
        <p className={`mr-auto text-sm font-medium ${isDirty ? "text-state-warning" : "text-state-success"}`}>{isDirty ? "Unsaved changes" : "All changes saved"}</p>
        {isDirty ? <Button type="button" variant="ghost" onClick={() => setDraft(baselineDraft)}>Discard</Button> : null}
        <Button type="button" variant="outline" onClick={() => void changeEnabled(!draft.enabled)} disabled={previewMutation.isPending}>{draft.enabled ? <PowerOff /> : <Power />}{draft.enabled ? "Disable" : "Enable"}</Button>
        <Button type="button" variant="outline" onClick={() => { previewMutation.mutate(draft.enabled, { onSuccess: () => { inspect({ kind: "validation" }); toast.success("Automation draft is valid."); } }); }} disabled={previewMutation.isPending || !draft.name.trim()}><ListChecks />{previewMutation.isPending ? "Checking…" : "Validate"}</Button>
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !isDirty || !draft.name.trim()}><Save />{saveMutation.isPending ? "Saving…" : "Save rule"}</Button>
        {draft.id ? <Button type="button" variant="destructiveGhost" onClick={() => void removeRule()} disabled={deleteMutation.isPending}><Trash2 />Delete</Button> : null}
      </CardFooter>
    </Card>
    <AutomationInspector open={inspectorOpen} onOpenChange={setInspectorOpen} selection={selection} draft={draft} triggerGroups={triggerGroups} selectedTriggerDescription={selectedTrigger?.description ?? "This event starts the automation rule."} conditionFields={conditionFields} actionDefinitions={actionDefinitions} messages={messages} preview={previewMutation.data} previewError={previewMutation.isError} onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onTriggerChange={(trigger) => void changeTrigger(trigger)} onEnabledChange={(enabled) => void changeEnabled(enabled)} onUpdateCondition={updateCondition} onRemoveCondition={(id) => { setDraft((current) => ({ ...current, conditions: current.conditions.filter((condition) => condition.id !== id) })); setInspectorOpen(false); }} onUpdateAction={updateAction} onRemoveAction={(id) => { setDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.id !== id) })); setInspectorOpen(false); }} />
  </div>;
}
