"use client";

import { Copy, Edit3, History, MoreHorizontal, Power, PowerOff, Trash2, Workflow } from "lucide-react";

import type { AutomationRule } from "./types";
import { formatModuleLabel, statusToneFor } from "./utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { StatusValue } from "@/components/ui/StatusValue";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  rules: AutomationRule[];
  triggerLabels: Map<string, string>;
  isRefreshing?: boolean;
  hasFilters: boolean;
  onCreate: () => void;
  onClearFilters: () => void;
  onEdit: (rule: AutomationRule) => void;
  onDuplicate: (rule: AutomationRule) => void;
  onToggle: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
  onViewRuns: (rule: AutomationRule) => void;
};

/**
 * R10, and one affordance gained on the way: the rule name was a `<button>` inside the
 * cell, so the row itself was inert and the only way into a rule was a 200px target. It is
 * `onOpenRow` now — click, Enter and Space anywhere on the row, with a focus ring — which
 * is the gesture every other list in the app already had.
 */
export function AutomationRulesTable({
  rules,
  triggerLabels,
  isRefreshing,
  hasFilters,
  onCreate,
  onClearFilters,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
  onViewRuns,
}: Props) {
  const columns: RecordTableColumn<AutomationRule>[] = [
    {
      key: "rule",
      label: "Rule",
      size: "lg",
      render: (rule) => (
        <>
          <div className="font-medium text-copy-primary">{rule.name}</div>
          {rule.description ? <p className="mt-1 truncate text-xs text-copy-muted">{rule.description}</p> : null}
        </>
      ),
    },
    {
      key: "trigger",
      label: "Module / trigger",
      render: (rule) => (
        <>
          <div className="text-copy-primary">{rule.module_key ? formatModuleLabel(rule.module_key) : "Platform"}</div>
          <div className="mt-1 text-xs text-copy-muted">{triggerLabels.get(rule.trigger_event) ?? rule.trigger_event}</div>
        </>
      ),
    },
    { key: "conditions", label: "Conditions", size: "sm", render: (rule) => rule.conditions_json.length || "Always" },
    { key: "actions", label: "Actions", size: "sm", render: (rule) => rule.actions_json.length },
    {
      key: "status",
      label: "Status",
      size: "sm",
      render: (rule) => (
        <StatusValue status={{ tone: statusToneFor(rule.enabled ? "enabled" : "disabled"), label: rule.enabled ? "Enabled" : "Disabled" }} />
      ),
    },
    { key: "updated", label: "Last updated", render: (rule) => <span className="whitespace-nowrap">{formatDateTime(rule.updated_at)}</span> },
  ];

  return (
    <RecordTable
      label="Automation rules"
      columns={columns}
      rows={rules}
      rowKey={(rule) => rule.id}
      onOpenRow={onEdit}
      rowLabel={(rule) => `Edit ${rule.name}`}
      isRefreshing={isRefreshing}
      shellVariant="nested"
      rowActions={(rule) => (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${rule.name}`}><MoreHorizontal /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 border-line-default bg-surface-raised p-2 text-copy-primary">
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onEdit(rule)}><Edit3 />Edit</Button>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onDuplicate(rule)}><Copy />Duplicate</Button>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onToggle(rule)}>{rule.enabled ? <PowerOff /> : <Power />}{rule.enabled ? "Disable" : "Enable"}</Button>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onViewRuns(rule)}><History />View runs</Button>
            <Button type="button" variant="destructiveGhost" className="w-full justify-start" onClick={() => onDelete(rule)}><Trash2 />Delete</Button>
          </PopoverContent>
        </Popover>
      )}
      hasActiveFilters={hasFilters}
      onClearFilters={onClearFilters}
      filteredEmptyState={{
        icon: Workflow,
        title: "No rules match these filters",
        description: "Clear the search or choose different filters.",
      }}
      emptyState={{
        icon: Workflow,
        title: "No automation rules yet",
        description: "Create a rule to respond to CRM events automatically.",
        action: <Button type="button" onClick={onCreate}>Create rule</Button>,
      }}
    />
  );
}
