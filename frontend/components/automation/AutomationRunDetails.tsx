"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { AutomationRun } from "./types";
import { formatModuleLabel, statusToneFor } from "./utils";
import { StatusValue } from "@/components/ui/StatusValue";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatDateTime } from "@/lib/datetime";

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function AutomationRunDetails({ run, open, onOpenChange }: { run: AutomationRun | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <EditorPanel
      open={open}
      onOpenChange={onOpenChange}
      title={`Run #${run?.id}`}
      description="Safe execution summary and administrator diagnostics."
      closeLabel="Close run details"
      size="wide"
    >
      {run ? <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-copy-primary">{run.rule_name ?? `Rule #${run.rule_id}`}</span><StatusValue status={{ tone: statusToneFor(run.status), label: formatSnakeCaseLabel(run.status) }} context="record" /></div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-copy-muted">Source</dt><dd className="mt-1 text-copy-primary">{run.source_label ?? (run.source_module_key && run.source_record_id ? `${formatModuleLabel(run.source_module_key)} #${run.source_record_id}` : "Not recorded")}</dd></div>
          <div><dt className="text-copy-muted">Started</dt><dd className="mt-1 text-copy-primary">{formatDateTime(run.started_at)}</dd></div>
          <div><dt className="text-copy-muted">Succeeded</dt><dd className="mt-1 text-copy-primary">{run.action_success_count} of {run.action_attempt_count}</dd></div>
          <div><dt className="text-copy-muted">Completed</dt><dd className="mt-1 text-copy-primary">{run.completed_at ? formatDateTime(run.completed_at) : run.finished_at ? formatDateTime(run.finished_at) : "In progress"}</dd></div>
        </dl>
        {run.error_message ? <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-state-danger">{run.error_message}</div> : null}
        <div><SectionHeading as="h3" className="mb-2">Action steps</SectionHeading><div className="grid gap-2">{(run.step_results_json ?? []).map((step, index) => <div key={`${run.id}-${index}`} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium text-copy-primary">{typeof step.type === "string" ? formatModuleLabel(step.type) : `Action ${index + 1}`}</span><StatusValue status={{ tone: statusToneFor(typeof step.status === "string" ? step.status : "unknown"), label: formatSnakeCaseLabel(typeof step.status === "string" ? step.status : "unknown") }} context="record" /></div></div>)}</div></div>
        <div className="border-t border-line-subtle pt-5"><SectionHeading as="h3" className="mb-3">Administrator details</SectionHeading>
          <details><summary className="cursor-pointer text-sm text-copy-primary">Sanitized input</summary><pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(run.input_json)}</pre></details>
          <details className="mt-3"><summary className="cursor-pointer text-sm text-copy-primary">Sanitized result</summary><pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(run.result_json)}</pre></details>
        </div>
      </div> : null}
    </EditorPanel>
  );
}
