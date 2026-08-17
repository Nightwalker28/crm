"use client";

import { ArrowDown, ArrowUp, Bot, CheckCircle2, ChevronRight, CircleDot, Filter, Plus, Trash2, Zap } from "lucide-react";

import type { AutomationActionDefinition, AutomationConditionField, InspectorSelection, RuleDraft } from "./types";
import { isBlankValue, OPERATOR_LABELS, valueAsString } from "./utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function StepRow({ icon: Icon, eyebrow, title, description, selected, onClick, actions, testId }: {
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
  testId?: string;
}) {
  return <div data-testid={testId} className={cn("flex items-center gap-3 rounded-[var(--radius-control)] border border-line-subtle bg-surface p-3", selected && "border-primary bg-action-primary-muted")}>
    <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-primary"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block text-2xs font-semibold text-copy-label">{eyebrow}</span><span className="mt-0.5 block truncate text-sm font-semibold text-copy-primary">{title}</span><span className="mt-0.5 block truncate text-xs text-copy-muted">{description}</span></span>
    </button>
    {actions}<ChevronRight className="h-4 w-4 shrink-0 text-copy-disabled" aria-hidden="true" />
  </div>;
}

export function AutomationStepList({ draft, selection, triggerLabel, triggerDescription, conditionFields, actionDefinitions, messages, onInspect, onAddCondition, onRemoveCondition, onAddAction, onRemoveAction, onMoveAction }: {
  draft: RuleDraft;
  selection: InspectorSelection;
  triggerLabel: string;
  triggerDescription: string;
  conditionFields: Map<string, AutomationConditionField>;
  actionDefinitions: Map<string, AutomationActionDefinition>;
  messages: string[];
  onInspect: (selection: InspectorSelection) => void;
  onAddCondition: () => void;
  onRemoveCondition: (id: string) => void;
  onAddAction: () => void;
  onRemoveAction: (id: string) => void;
  onMoveAction: (id: string, direction: -1 | 1) => void;
}) {
  return <div className="mx-auto grid max-w-2xl gap-3">
    <StepRow icon={Zap} eyebrow="Trigger" title={triggerLabel} description={triggerDescription} selected={selection.kind === "trigger"} onClick={() => onInspect({ kind: "trigger" })} testId="automation-trigger-step" />
    <div className="mx-auto h-4 w-px bg-line-default" />
    <section className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-raised p-3" aria-labelledby="automation-conditions-title">
      <div className="mb-3 flex items-center justify-between gap-3"><button type="button" className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => onInspect({ kind: "validation" })}><span className="text-2xs font-semibold text-copy-label">Conditions</span><span id="automation-conditions-title" className="mt-0.5 block text-sm font-semibold text-copy-primary">{draft.conditions.length ? `${draft.conditions.length} condition${draft.conditions.length === 1 ? "" : "s"} · match ${draft.condition_mode}` : "No conditions · always continue"}</span></button><Button type="button" variant="outline" size="sm" onClick={onAddCondition} disabled={!conditionFields.size}><Plus />Condition</Button></div>
      <div className="grid gap-2">{draft.conditions.map((condition, index) => { const field = conditionFields.get(condition.field); return <StepRow key={condition.id} icon={Filter} eyebrow={`Condition ${index + 1}`} title={field?.label ?? "Choose a field"} description={`${OPERATOR_LABELS[condition.operator] ?? condition.operator}${isBlankValue(condition.value) ? "" : ` · ${valueAsString(condition.value)}`}`} selected={selection.kind === "condition" && selection.id === condition.id} onClick={() => onInspect({ kind: "condition", id: condition.id })} testId={`automation-condition-${index}`} actions={<Button type="button" variant="destructiveGhost" size="icon-sm" aria-label={`Delete condition ${index + 1}`} onClick={() => onRemoveCondition(condition.id)}><Trash2 /></Button>} />; })}</div>
    </section>
    <div className="mx-auto h-4 w-px bg-line-default" />
    <section className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-raised p-3" aria-labelledby="automation-actions-title">
      <div className="mb-3 flex items-center justify-between gap-3"><div><span className="text-2xs font-semibold text-copy-label">Actions</span><span id="automation-actions-title" className="mt-0.5 block text-sm font-semibold text-copy-primary">{draft.actions.length ? `${draft.actions.length} action${draft.actions.length === 1 ? "" : "s"} in order` : "No actions configured"}</span></div><Button type="button" variant="outline" size="sm" onClick={onAddAction} disabled={!actionDefinitions.size}><Plus />Action</Button></div>
      <div className="grid gap-2">{draft.actions.map((action, index) => { const definition = actionDefinitions.get(action.type); return <StepRow key={action.id} icon={Bot} eyebrow={`Action ${index + 1}`} title={definition?.label ?? "Choose an action"} description={definition?.description ?? "Configure this action."} selected={selection.kind === "action" && selection.id === action.id} onClick={() => onInspect({ kind: "action", id: action.id })} testId={`automation-action-${index}`} actions={<div className="flex items-center gap-0.5"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Move action ${index + 1} up`} onClick={() => onMoveAction(action.id, -1)} disabled={index === 0}><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Move action ${index + 1} down`} onClick={() => onMoveAction(action.id, 1)} disabled={index === draft.actions.length - 1}><ArrowDown /></Button><Button type="button" variant="destructiveGhost" size="icon-sm" aria-label={`Delete action ${index + 1}`} onClick={() => onRemoveAction(action.id)}><Trash2 /></Button></div>} />; })}</div>
    </section>
    <button type="button" onClick={() => onInspect({ kind: "validation" })} className={cn("flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-subtle bg-surface px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", selection.kind === "validation" && "border-primary bg-action-primary-muted")}><span className="flex items-center gap-3">{messages.length ? <CircleDot className="h-5 w-5 text-state-warning" /> : <CheckCircle2 className="h-5 w-5 text-state-success" />}<span><span className="block text-sm font-semibold text-copy-primary">Validation and status</span><span className="block text-xs text-copy-muted">{messages.length ? `${messages.length} item${messages.length === 1 ? "" : "s"} need attention` : "Builder fields look complete"}</span></span></span><ChevronRight className="h-4 w-4 text-copy-disabled" /></button>
  </div>;
}
