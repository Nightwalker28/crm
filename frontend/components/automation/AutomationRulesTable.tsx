"use client";

import { Copy, Edit3, History, MoreHorizontal, Power, PowerOff, Trash2, Workflow } from "lucide-react";

import type { AutomationRule } from "./types";
import { formatModuleLabel, statusPill } from "./utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
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
  return (
    <ModuleTableShell isRefreshing={isRefreshing} className="min-h-56">
      <Table>
        <TableHeader>
          <TableHeaderRow>
            <TableHead>Rule</TableHead>
            <TableHead>Module / trigger</TableHead>
            <TableHead className="hidden md:table-cell">Conditions</TableHead>
            <TableHead className="hidden md:table-cell">Actions</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Last updated</TableHead>
            <TableHead className="w-16 text-right">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell>
                <button type="button" className="max-w-72 text-left font-semibold text-copy-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onEdit(rule)}>
                  {rule.name}
                </button>
                {rule.description ? <p className="mt-1 max-w-72 truncate text-xs text-copy-muted">{rule.description}</p> : null}
              </TableCell>
              <TableCell>
                <div className="text-copy-primary">{rule.module_key ? formatModuleLabel(rule.module_key) : "Platform"}</div>
                <div className="mt-1 text-xs text-copy-muted">{triggerLabels.get(rule.trigger_event) ?? rule.trigger_event}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{rule.conditions_json.length || "Always"}</TableCell>
              <TableCell className="hidden md:table-cell">{rule.actions_json.length}</TableCell>
              <TableCell><Pill {...statusPill(rule.enabled ? "enabled" : "disabled")}>{rule.enabled ? "Enabled" : "Disabled"}</Pill></TableCell>
              <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(rule.updated_at)}</TableCell>
              <TableCell className="text-right">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${rule.name}`}><MoreHorizontal /></Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-52 border-line-default bg-surface-raised p-2 text-copy-primary">
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onEdit(rule)}><Edit3 />Edit</Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onDuplicate(rule)}><Copy />Duplicate</Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onToggle(rule)}>{rule.enabled ? <PowerOff /> : <Power />}{rule.enabled ? "Disable" : "Enable"}</Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onViewRuns(rule)}><History />View runs</Button>
                    <Button type="button" variant="dangerGhost" className="w-full justify-start" onClick={() => onDelete(rule)}><Trash2 />Delete</Button>
                  </PopoverContent>
                </Popover>
              </TableCell>
            </TableRow>
          ))}
          {!rules.length ? (
            <TableRow>
              <TableCell colSpan={7} className="p-0">
                <EmptyState
                  icon={Workflow}
                  title={hasFilters ? "No rules match these filters" : "No automation rules yet"}
                  description={hasFilters ? "Clear the search or choose different filters." : "Create a rule to respond to CRM events automatically."}
                  action={<Button type="button" variant={hasFilters ? "outline" : "default"} onClick={hasFilters ? onClearFilters : onCreate}>{hasFilters ? "Clear filters" : "Create rule"}</Button>}
                />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
