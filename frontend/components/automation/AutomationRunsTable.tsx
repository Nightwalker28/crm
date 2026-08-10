"use client";

import { Eye, History } from "lucide-react";

import type { AutomationRun } from "./types";
import { formatModuleLabel, statusPill } from "./utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Pill } from "@/components/ui/Pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/datetime";

function sourceLabel(run: AutomationRun) {
  if (run.source_label) return run.source_label;
  if (run.source_module_key && run.source_record_id) return `${formatModuleLabel(run.source_module_key)} #${run.source_record_id}`;
  if (run.event_id) return `Event #${run.event_id}`;
  return "Not recorded";
}

export function AutomationRunsTable({ runs, isRefreshing, hasFilters, onClearFilters, onInspect }: {
  runs: AutomationRun[];
  isRefreshing?: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
  onInspect: (run: AutomationRun) => void;
}) {
  return (
    <ModuleTableShell isRefreshing={isRefreshing} className="min-h-56">
      <Table>
        <TableHeader><TableHeaderRow>
          <TableHead>Rule</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Actions</TableHead><TableHead className="hidden lg:table-cell">Started</TableHead><TableHead className="w-20 text-right">Details</TableHead>
        </TableHeaderRow></TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell><div className="font-medium text-copy-primary">{run.rule_name ?? `Rule #${run.rule_id}`}</div><div className="mt-1 text-xs text-copy-muted">{run.trigger_event_key ?? "Unknown trigger"}</div></TableCell>
              <TableCell>{sourceLabel(run)}</TableCell>
              <TableCell><Pill {...statusPill(run.status)}>{run.status}</Pill></TableCell>
              <TableCell className="hidden md:table-cell">{run.action_success_count}/{run.action_attempt_count} succeeded</TableCell>
              <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(run.started_at)}</TableCell>
              <TableCell className="text-right"><Button type="button" variant="ghost" size="sm" onClick={() => onInspect(run)}><Eye />Inspect</Button></TableCell>
            </TableRow>
          ))}
          {!runs.length ? <TableRow><TableCell colSpan={6} className="p-0"><EmptyState icon={History} title={hasFilters ? "No runs match these filters" : "No automation runs yet"} description={hasFilters ? "Clear the filters to see other runs." : "Execution history appears here after a rule is triggered."} action={hasFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button> : undefined} /></TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
