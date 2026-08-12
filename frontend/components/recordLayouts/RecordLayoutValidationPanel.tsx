"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import type { RecordLayoutValidationReport } from "@/hooks/useRecordLayoutAdmin";

/**
 * Errors and warnings are rendered as two separate blocks, never merged into one list:
 * an error blocks publishing, a warning is advice the tenant is free to ignore.
 */
export function RecordLayoutValidationPanel({
  validation,
  isChecking,
}: {
  validation: RecordLayoutValidationReport | null;
  isChecking: boolean;
}) {
  if (!validation) {
    return (
      <p className="flex items-center gap-2 text-p-sm text-copy-muted" aria-live="polite">
        <Info className="h-4 w-4" aria-hidden="true" />
        Checking this layout…
      </p>
    );
  }

  const { errors, warnings } = validation;

  return (
    <div className="space-y-3" aria-live="polite" data-layout-validation={validation.valid ? "valid" : "invalid"}>
      {errors.length ? (
        <div
          role="alert"
          className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted p-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-state-danger">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            {errors.length === 1 ? "1 problem blocks publishing" : `${errors.length} problems block publishing`}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-p-sm text-copy-secondary">
            {errors.map((message) => (
              <li key={message} data-layout-error>{message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-p-sm text-copy-secondary">
          <CheckCircle2 className="h-4 w-4 text-state-success" aria-hidden="true" />
          {isChecking ? "Checking this layout…" : "This layout can be published."}
        </div>
      )}

      {warnings.length ? (
        <div className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-state-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {warnings.length === 1 ? "1 suggestion" : `${warnings.length} suggestions`}
          </div>
          <p className="mt-1 text-p-xs text-copy-muted">These do not block publishing.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-p-sm text-copy-secondary">
            {warnings.map((message) => (
              <li key={message} data-layout-warning>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
