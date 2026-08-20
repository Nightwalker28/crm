"use client";

import { Eye, History } from "lucide-react";

import type { AutomationRun } from "./types";
import { formatModuleLabel, statusToneFor } from "./utils";
import { Button } from "@/components/ui/button";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { StatusValue } from "@/components/ui/StatusValue";
import { formatDateTime } from "@/lib/datetime";
import { formatSnakeCaseLabel } from "@/lib/module-display";

function sourceLabel(run: AutomationRun) {
  if (run.source_label) return run.source_label;
  if (run.source_module_key && run.source_record_id) return `${formatModuleLabel(run.source_module_key)} #${run.source_record_id}`;
  if (run.event_id) return `Event #${run.event_id}`;
  return "Not recorded";
}

/**
 * R10: every table is `RecordTable`. This hand-assembled `Table` and dropped three columns
 * below `lg` with `hidden md:table-cell`, which is the pre-R10 answer to a table that does
 * not fit — the operator loses the data rather than the width. `RecordTable` derives its
 * min-width from the visible columns and scrolls inside its own region instead, so the run
 * count and the start time are still reachable at any viewport.
 */
export function AutomationRunsTable({ runs, isRefreshing, hasFilters, onClearFilters, onInspect }: {
  runs: AutomationRun[];
  isRefreshing?: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
  onInspect: (run: AutomationRun) => void;
}) {
  const columns: RecordTableColumn<AutomationRun>[] = [
    {
      key: "rule",
      label: "Rule",
      size: "lg",
      render: (run) => (
        <>
          <div className="font-medium text-copy-primary">{run.rule_name ?? `Rule #${run.rule_id}`}</div>
          <div className="mt-1 text-xs text-copy-muted">{run.trigger_event_key ?? "Unknown trigger"}</div>
        </>
      ),
    },
    { key: "source", label: "Source", render: (run) => sourceLabel(run) },
    {
      key: "status",
      label: "Status",
      size: "sm",
      render: (run) => <StatusValue status={{ tone: statusToneFor(run.status), label: formatSnakeCaseLabel(run.status) }} />,
    },
    { key: "actions", label: "Actions", render: (run) => `${run.action_success_count}/${run.action_attempt_count} succeeded` },
    { key: "started", label: "Started", render: (run) => <span className="whitespace-nowrap">{formatDateTime(run.started_at)}</span> },
  ];

  return (
    <RecordTable
      label="Automation runs"
      columns={columns}
      rows={runs}
      rowKey={(run) => run.id}
      isRefreshing={isRefreshing}
      shellVariant="nested"
      rowActions={(run) => (
        <Button type="button" variant="ghost" size="sm" onClick={() => onInspect(run)}><Eye />Inspect</Button>
      )}
      rowActionsLabel="Details"
      hasActiveFilters={hasFilters}
      onClearFilters={onClearFilters}
      filteredEmptyState={{
        icon: History,
        title: "No runs match these filters",
        description: "Clear the filters to see other runs.",
      }}
      emptyState={{
        icon: History,
        title: "No automation runs yet",
        description: "Execution history appears here after a rule is triggered.",
      }}
    />
  );
}
