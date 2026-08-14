"use client";

import { X } from "lucide-react";

import type { AutomationRun } from "./types";
import { formatModuleLabel, statusPill } from "./utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/Pill";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetOverlay, SheetPortal, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/datetime";

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function AutomationRunDetails({ run, open, onOpenChange }: { run: AutomationRun | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
        <SheetContent side="right" className="z-50 flex h-full w-full max-w-[38rem] flex-col border-l border-line-default bg-surface-raised outline-none">
          <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
            <div><SheetTitle className="text-lg font-semibold text-copy-primary">Run #{run?.id}</SheetTitle><SheetDescription className="mt-1 text-sm text-copy-muted">Safe execution summary and administrator diagnostics.</SheetDescription></div>
            <SheetClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Close run details"><X /></Button></SheetClose>
          </SheetHeader>
          {run ? <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-copy-primary">{run.rule_name ?? `Rule #${run.rule_id}`}</span><Pill {...statusPill(run.status)}>{run.status}</Pill></div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-copy-muted">Source</dt><dd className="mt-1 text-copy-primary">{run.source_label ?? (run.source_module_key && run.source_record_id ? `${formatModuleLabel(run.source_module_key)} #${run.source_record_id}` : "Not recorded")}</dd></div>
              <div><dt className="text-copy-muted">Started</dt><dd className="mt-1 text-copy-primary">{formatDateTime(run.started_at)}</dd></div>
              <div><dt className="text-copy-muted">Succeeded</dt><dd className="mt-1 text-copy-primary">{run.action_success_count} of {run.action_attempt_count}</dd></div>
              <div><dt className="text-copy-muted">Completed</dt><dd className="mt-1 text-copy-primary">{run.completed_at ? formatDateTime(run.completed_at) : run.finished_at ? formatDateTime(run.finished_at) : "In progress"}</dd></div>
            </dl>
            {run.error_message ? <div className="rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-state-danger">{run.error_message}</div> : null}
            <div><h3 className="text-sm font-semibold text-copy-primary">Action steps</h3><div className="mt-2 grid gap-2">{(run.step_results_json ?? []).map((step, index) => <div key={`${run.id}-${index}`} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium text-copy-primary">{typeof step.type === "string" ? formatModuleLabel(step.type) : `Action ${index + 1}`}</span><span className={step.status === "success" ? "text-state-success" : step.status === "failed" ? "text-state-danger" : "text-copy-muted"}>{typeof step.status === "string" ? step.status : "unknown"}</span></div></div>)}</div></div>
            <div className="border-t border-line-subtle pt-5"><p className="mb-3 text-xs font-semibold text-copy-label">Administrator details</p>
              <details><summary className="cursor-pointer text-sm font-semibold text-copy-primary">Sanitized input</summary><pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(run.input_json)}</pre></details>
              <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-copy-primary">Sanitized result</summary><pre className="mt-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3 text-xs text-copy-secondary">{formatJson(run.result_json)}</pre></details>
            </div>
          </div> : null}
        </SheetContent>
      </SheetPortal>
    </Sheet>
  );
}
